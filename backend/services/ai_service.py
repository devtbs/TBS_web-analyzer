from typing import Awaitable, Callable, Dict, List, Optional
from openai import AsyncOpenAI
from config import settings
import json
import asyncio
import logging

logger = logging.getLogger(__name__)


def _mcp_tools() -> list:
    """Remote MCP servers to expose to the Responses API, parsed from OPENAI_MCP_SERVERS.

    OpenAI dials these servers itself and executes the tool calls server-side, so no MCP client is
    needed here. Returns [] on empty or malformed config — a bad server list must not take deck
    generation down with it.
    """
    raw = (getattr(settings, "OPENAI_MCP_SERVERS", "") or "").strip()
    if not raw:
        return []
    try:
        entries = json.loads(raw)
        if isinstance(entries, dict):
            entries = [entries]
    except Exception as e:
        logger.error("OPENAI_MCP_SERVERS is not valid JSON — ignoring it: %s", str(e)[:120])
        return []

    tools = []
    for e in entries:
        if not isinstance(e, dict) or not e.get("url"):
            logger.warning("MCP server entry skipped (needs at least a url): %r", e)
            continue
        tool = {
            "type": "mcp",
            "server_label": e.get("label") or "mcp",
            "server_url": e["url"],
            # Deck generation is unattended: an approval request would arrive as an output item
            # with nobody to answer it, and the run would stall. Default to never, per-server
            # overridable for anyone driving this interactively.
            "require_approval": e.get("require_approval", "never"),
        }
        if e.get("description"):
            tool["server_description"] = e["description"]
        if e.get("allowed_tools"):
            tool["allowed_tools"] = e["allowed_tools"]
        if e.get("authorization"):
            tool["authorization"] = e["authorization"]
        tools.append(tool)
    if tools:
        logger.info("MCP servers attached to Responses API: %s",
                    ", ".join(t["server_label"] for t in tools))
    return tools

# Optional async progress reporter threaded through the deck pipeline so long runs can
# stream phase-by-phase status to the UI. None = silent (the default everywhere).
ProgressCb = Optional[Callable[[str], Awaitable[None]]]

# Optional async callback fed each text delta as the deck streams in, so callers can
# react to partial output (e.g. kick off image generation the moment a placeholder
# appears). None = no streaming; the call awaits the full response as before.
DeltaCb = Optional[Callable[[str], Awaitable[None]]]


# The Alibaba TOKEN PLAN (prepaid subscription) endpoint. This is a DEDICATED base URL that comes
# with the purchased package and only accepts the plan's own `sk-sp-…` seat key — the public
# pay-as-you-go DashScope endpoints reject it with invalid_api_key (and billed per-token, which is
# what we're moving off). One key + this base URL reaches every model in the plan.
_TOKEN_PLAN_BASE = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"

# OpenAI-compatible providers the user can choose from. Each deck-writing model
# is reached through the same chat-completions API, just a different base_url/model.
AI_PROVIDERS = {
    # Plain DeepSeek runs on DeepSeek's OWN endpoint + key (billed separately from the Alibaba
    # plan) — kept deliberately, per the user. It is NOT a reasoning model and doesn't accept
    # enable_thinking, which the "aliyuncs" guard below handles.
    "deepseek": {"key": "DEEPSEEK_API_KEY", "base_url": "https://api.deepseek.com",
                 "model": "deepseek-chat", "label": "DeepSeek", "max_tokens": 8192},
    # The rest are served by the Alibaba Token Plan, so the single QWEN_API_KEY (the plan's sk-sp
    # seat key) reaches every one on prepaid credit. They are reasoning models (they emit hidden
    # reasoning_content that eats into the token budget), so they get a larger per-call ceiling;
    # the continuation loop (below) still stitches long single responses.
    # OpenAI via the RESPONSES API (/v1/responses), not chat-completions — a different endpoint and
    # payload shape, so it takes its own code path below. `model` is read from settings at call time
    # because the id lives in .env; the provider is hidden from the picker until it is set.
    "luna": {"key": "OPENAI_API_KEY", "base_url": None, "model": None,
             "model_setting": "OPENAI_RESPONSES_MODEL", "api": "responses",
             "label": "GPT-5.6 Luna", "max_tokens": 32768,
             # Reasoning models reject `temperature`; leave it off unless you know it is accepted.
             "temperature": False,
             "reasoning_setting": "OPENAI_REASONING_EFFORT"},
    "qwen3.7-max": {"key": "QWEN_API_KEY", "base_url": _TOKEN_PLAN_BASE,
                    "model": "qwen3.7-max", "label": "Qwen3.7 Max", "max_tokens": 16384},
    "qwen3.7-plus": {"key": "QWEN_API_KEY", "base_url": _TOKEN_PLAN_BASE,
                     "model": "qwen3.7-plus", "label": "Qwen3.7 Plus (fast)", "max_tokens": 16384},
    "glm": {"key": "QWEN_API_KEY", "base_url": _TOKEN_PLAN_BASE,
            "model": "glm-5.2", "label": "GLM-5.2", "max_tokens": 16384},
    "deepseek-v4": {"key": "QWEN_API_KEY", "base_url": _TOKEN_PLAN_BASE,
                    "model": "deepseek-v4-pro", "label": "DeepSeek V4 Pro", "max_tokens": 16384},
    "kimi": {"key": "QWEN_API_KEY", "base_url": _TOKEN_PLAN_BASE,
             "model": "kimi-k2.7-code", "label": "Kimi K2.7", "max_tokens": 16384},
}

# A full HTML deck (8-10 slides + inline Plotly JSON) exceeds any single response's
# output-token ceiling (DeepSeek caps at 8192), which truncates the deck mid-document
# — too few slides, charts cut off. When a response stops because it hit that limit
# (finish_reason == "length"), we ask the model to continue and stitch the parts.
# This is the real lever on total deck length — each step adds up to max_tokens more
# (8 * 8192 ≈ 65K tokens), far beyond any single-call ceiling. The loop stops early as
# soon as the model finishes naturally, so most decks won't use them all.
_MAX_CONTINUATIONS = 8


def resolve_provider(name: str) -> str:
    """Return `name` if that provider is usable, else fall back to one that is.

    Without this, setting DEFAULT_AI_PROVIDER to a model whose API key is not in .env yet would
    break EVERY analysis in the product, not just decks — a config typo becoming a total outage.
    """
    name = (name or "").strip() or "deepseek"
    cfg = AI_PROVIDERS.get(name)
    if cfg and getattr(settings, cfg["key"], "") and (
            cfg.get("model") or getattr(settings, cfg.get("model_setting") or "", "")):
        return name
    for fallback in ("deepseek", "qwen3.7-plus", "glm"):
        fb = AI_PROVIDERS.get(fallback)
        if fb and getattr(settings, fb["key"], ""):
            logger.warning("AI provider %r is not configured — falling back to %r.", name, fallback)
            return fallback
    logger.error("No AI provider is configured (tried %r and the fallbacks).", name)
    return name


async def _create_response(client, kwargs: dict, stream: bool = False):
    """Call the Responses API, dropping MCP tools if the MCP server is the thing that failed.

    OpenAI fetches each MCP server's tool list before running the model, so an unreachable or
    unauthorised server returns 424 external_connector_error and the WHOLE request fails — no deck
    at all. MCP is an enhancement, not a dependency: a Maton outage (or a bad token) must not stop
    a scheduled client report from being written. Retry once without tools, and say so loudly.
    """
    try:
        return await client.responses.create(**kwargs, **({"stream": True} if stream else {}))
    except Exception as e:
        msg = str(e)
        mcp_failed = "external_connector_error" in msg or "MCP server" in msg
        if not (mcp_failed and kwargs.get("tools")):
            raise
        labels = [t.get("server_label") for t in kwargs.get("tools") or []]
        logger.error("MCP server(s) %s unreachable (%s) — retrying WITHOUT tools so the "
                     "generation still completes. Check the server URL and its API key.",
                     labels, msg[:160])
        retry = {k: v for k, v in kwargs.items() if k != "tools"}
        return await client.responses.create(**retry, **({"stream": True} if stream else {}))


def _warn_if_awaiting_approval(output) -> None:
    """An MCP server set to require approval returns an `mcp_approval_request` output item and then
    waits. Nothing in this pipeline can answer one, so the tool call simply never happens — log it
    loudly instead of letting the deck come back quietly missing whatever the tool would have added.
    """
    for item in (output or []):
        if getattr(item, "type", None) == "mcp_approval_request":
            logger.error(
                "MCP tool %r on server %r needs approval, which this pipeline cannot give — the "
                "call was skipped. Set require_approval to \"never\" for this server, or add the "
                "tool to allowed_tools.",
                getattr(item, "name", "?"), getattr(item, "server_label", "?"))


class AIService:
    """AI service for intelligent content analysis"""
    
    def __init__(self):
        self.groq_client = None
        self.deepseek_client = None
        self.anthropic_client = None

        # Initialize Groq (uses OpenAI-compatible API)
        if hasattr(settings, 'GROQ_API_KEY') and settings.GROQ_API_KEY:
            self.groq_client = AsyncOpenAI(
                api_key=settings.GROQ_API_KEY,
                base_url="https://api.groq.com/openai/v1"
            )

        # DeepSeek on its own endpoint/key — powers briefs, topical map, knowledge graph and the
        # comparator (billed separately from the Alibaba plan, by design).
        if hasattr(settings, 'DEEPSEEK_API_KEY') and settings.DEEPSEEK_API_KEY:
            self.deepseek_client = AsyncOpenAI(
                api_key=settings.DEEPSEEK_API_KEY,
                base_url="https://api.deepseek.com"
            )

        # Initialize Anthropic (Claude) — used for client-facing monthly reports,
        # where narrative quality matters most.
        if hasattr(settings, 'ANTHROPIC_API_KEY') and settings.ANTHROPIC_API_KEY:
            from anthropic import AsyncAnthropic
            self.anthropic_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    async def analyze_with_anthropic(
        self,
        prompt: str,
        system_prompt: str = None,
        model: str = "claude-opus-4-8",
        max_tokens: int = 16000,
    ) -> str:
        """Generate text with Claude. Streams (recommended for long report output)
        and uses adaptive thinking for higher-quality reasoning."""
        if not self.anthropic_client:
            raise ValueError("Anthropic API key not configured (ANTHROPIC_API_KEY).")

        kwargs = {
            "model": model,
            "max_tokens": max_tokens,
            "thinking": {"type": "adaptive"},
            "messages": [{"role": "user", "content": prompt}],
        }
        if system_prompt:
            kwargs["system"] = system_prompt

        async with self.anthropic_client.messages.stream(**kwargs) as stream:
            message = await stream.get_final_message()

        return "".join(
            block.text for block in message.content if getattr(block, "type", None) == "text"
        )

    async def analyze_with_provider(self, prompt: str, system_prompt: str = None,
                                    provider: str = None, on_progress: ProgressCb = None,
                                    on_delta: DeltaCb = None, temperature: float = 0.8) -> str:
        """Generate text with a user-chosen OpenAI-compatible provider (DeepSeek,
        OpenAI, Qwen, Kimi, xAI). Used for AI-designed presentations.

        If on_delta is given, the response is streamed and each text delta is passed to
        it as it arrives (lets the deck pipeline start generating images for placeholders
        the moment they appear, instead of waiting for the whole deck). The full text is
        still returned either way.
        """
        # Unspecified means "use the product default" (DEFAULT_AI_PROVIDER), resolved through the
        # same fallback the analysis path uses so an unconfigured default degrades instead of 500ing.
        provider = resolve_provider(provider or settings.DEFAULT_AI_PROVIDER)
        cfg = AI_PROVIDERS.get(provider)
        if not cfg:
            raise ValueError(f"Unknown AI provider: {provider}")
        api_key = getattr(settings, cfg["key"], "")
        if not api_key:
            raise ValueError(f"{cfg['label']} API key not configured ({cfg['key']}).")

        # Providers whose model id lives in .env (see OPENAI_RESPONSES_MODEL) resolve it here.
        model_id = cfg.get("model") or getattr(settings, cfg.get("model_setting") or "", "")
        if not model_id:
            raise ValueError(
                f"{cfg['label']} model id not configured ({cfg.get('model_setting')}). "
                f"Set it in backend/.env and restart.")

        kwargs = {"api_key": api_key}
        if cfg["base_url"]:
            kwargs["base_url"] = cfg["base_url"]
        client = AsyncOpenAI(**kwargs)

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        max_tokens = cfg.get("max_tokens", 8000)
        # The Alibaba-hosted models (Qwen, GLM, DeepSeek-V4, Kimi) are reasoning models: left on,
        # they spend the ENTIRE token budget on hidden reasoning and emit no deck HTML (GLM-5.2
        # measured 410s / 53K reasoning chars / 0 content). enable_thinking=False makes them
        # output the deck directly. Match on "aliyuncs" so this covers BOTH the public DashScope
        # endpoints and the Token Plan's dedicated maas.aliyuncs.com base URL — keying it to
        # "dashscope" alone silently dropped the flag when we moved onto the plan.
        extra_body = {"enable_thinking": False} if "aliyuncs" in (cfg.get("base_url") or "") else None
        # The Responses API is a different endpoint with a different payload; everything else about
        # this loop (continuation on truncation, streaming deltas) works the same, so only the single
        # call swaps out.
        use_responses = cfg.get("api") == "responses"
        send_temp = temperature if cfg.get("temperature", True) else None
        reasoning_effort = getattr(settings, cfg.get("reasoning_setting") or "", "") or None

        parts: List[str] = []
        for attempt in range(_MAX_CONTINUATIONS + 1):
            if use_responses:
                content, finish_reason = await self._respond_once(
                    client, model_id, messages, max_tokens, on_delta, send_temp, reasoning_effort)
            else:
                content, finish_reason = await self._complete_once(
                    client, model_id, messages, max_tokens, on_delta, extra_body, temperature)
            parts.append(content)
            logger.info("provider=%s call %d finish_reason=%s (chars so far=%d)",
                        provider, attempt + 1, finish_reason, sum(len(p) for p in parts))
            if finish_reason != "length":
                break
            if attempt == _MAX_CONTINUATIONS:
                logger.warning("provider=%s hit continuation cap (%d) — output may still be truncated",
                               provider, _MAX_CONTINUATIONS)
            if on_progress:
                await on_progress(f"Writing slides… (part {attempt + 2})")
            # Hit the output-token ceiling — continue exactly where it stopped.
            messages.append({"role": "assistant", "content": content})
            messages.append({"role": "user", "content":
                "Continue the response from exactly where you stopped. Do not repeat any "
                "content already written, do not restart, and do not add any preface — "
                "output only the continuation so the two parts concatenate seamlessly."})
        return "".join(parts)

    async def _respond_once(self, client, model, messages, max_tokens, on_delta: DeltaCb,
                            temperature: Optional[float] = None,
                            reasoning_effort: Optional[str] = None):
        """One call against the OpenAI RESPONSES API (/v1/responses).

        Returns (content, finish_reason) in the same shape as _complete_once so the continuation
        loop above is shared: "length" when the model hit max_output_tokens, else "stop".

        Two shape differences from chat-completions worth knowing: the system prompt goes in
        `instructions` rather than as a message, and truncation is reported as
        status="incomplete" + incomplete_details.reason instead of a finish_reason.
        """
        instructions = next((m["content"] for m in messages if m["role"] == "system"), None)
        conversation = [m for m in messages if m["role"] != "system"]
        kwargs = {"model": model, "input": conversation, "max_output_tokens": max_tokens}
        if instructions:
            kwargs["instructions"] = instructions
        if temperature is not None:
            kwargs["temperature"] = temperature
        # Cap hidden reasoning: it is billed and spends max_output_tokens, so an uncapped reasoning
        # model can return an empty deck. See OPENAI_REASONING_EFFORT in config.py.
        if reasoning_effort:
            kwargs["reasoning"] = {"effort": reasoning_effort}
        mcp = _mcp_tools()
        if mcp:
            kwargs["tools"] = mcp

        if on_delta is None:
            resp = await _create_response(client, kwargs)
            _warn_if_awaiting_approval(getattr(resp, "output", None))
            reason = "stop"
            if getattr(resp, "status", None) == "incomplete":
                det = getattr(resp, "incomplete_details", None)
                if getattr(det, "reason", None) == "max_output_tokens":
                    reason = "length"
            return (getattr(resp, "output_text", "") or ""), reason

        buf: List[str] = []
        reason = "stop"
        stream = await _create_response(client, kwargs, stream=True)
        async for event in stream:
            etype = getattr(event, "type", "")
            if etype == "response.output_text.delta":
                piece = getattr(event, "delta", "") or ""
                if piece:
                    buf.append(piece)
                    try:
                        await on_delta("".join(buf))
                    except Exception:
                        logger.exception("on_delta callback failed (continuing stream)")
            elif etype in ("response.completed", "response.incomplete"):
                r = getattr(event, "response", None)
                _warn_if_awaiting_approval(getattr(r, "output", None))
                det = getattr(r, "incomplete_details", None)
                if getattr(det, "reason", None) == "max_output_tokens":
                    reason = "length"
        return "".join(buf), reason

    async def _complete_once(self, client, model, messages, max_tokens, on_delta: DeltaCb,
                             extra_body: Optional[dict] = None, temperature: float = 0.8):
        """One chat-completion. Streams (feeding on_delta) when a delta callback is given,
        otherwise a single awaited call. Returns (content, finish_reason). `extra_body` carries
        provider-specific params (e.g. {"enable_thinking": False} to disable reasoning)."""
        if on_delta is None:
            response = await client.chat.completions.create(
                model=model, messages=messages, temperature=temperature, max_tokens=max_tokens,
                extra_body=extra_body,
            )
            choice = response.choices[0]
            return (choice.message.content or ""), choice.finish_reason

        buf: List[str] = []
        finish_reason = None
        stream = await client.chat.completions.create(
            model=model, messages=messages, temperature=0.8, max_tokens=max_tokens, stream=True,
            extra_body=extra_body,
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            ch = chunk.choices[0]
            piece = (ch.delta.content or "") if ch.delta else ""
            if piece:
                buf.append(piece)
                try:
                    await on_delta("".join(buf))
                except Exception:
                    logger.exception("on_delta callback failed (continuing stream)")
            if ch.finish_reason:
                finish_reason = ch.finish_reason
        return "".join(buf), finish_reason

    @staticmethod
    def configured_providers() -> list:
        """List providers that have an API key set, for the UI picker."""
        out = []
        for pid, cfg in AI_PROVIDERS.items():
            if not getattr(settings, cfg["key"], ""):
                continue
            # A provider whose model id comes from .env is only usable once that is set too —
            # listing it early would put an option in the picker that fails on click.
            if not (cfg.get("model") or getattr(settings, cfg.get("model_setting") or "", "")):
                continue
            out.append({"id": pid, "label": cfg["label"]})
        return out

    async def analyze_with_groq(self, prompt: str, system_prompt: str = None) -> str:
        """Analyze content using Groq (fast, free tier available)"""
        if not self.groq_client:
            raise ValueError("Groq API key not configured")
        
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        try:
            response = await self.groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",  # Fast and capable model
                messages=messages,
                temperature=0.7,
                max_tokens=6000,  # Groq's safe limit (max ~8000)
                response_format={"type": "json_object"} if "json" in (system_prompt or "").lower() or "json" in prompt.lower() else None
            )
            return response.choices[0].message.content
        except Exception as e:
            error_msg = str(e)
            print(f"Groq API error: {error_msg}")
            raise
    
    async def analyze_with_deepseek(self, prompt: str, system_prompt: str = None, max_tokens: int = 8000) -> str:
        """Analyze content using DeepSeek (good for complex analysis)"""
        if not self.deepseek_client:
            raise ValueError("DeepSeek API key not configured")
        
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        try:
            # DeepSeek limit is 8192 tokens, use 8000 for safety
            safe_max_tokens = min(max_tokens, 8000)

            response = await self.deepseek_client.chat.completions.create(
                model="deepseek-chat",  # DeepSeek direct
                messages=messages,
                temperature=0.7,
                max_tokens=safe_max_tokens,
                response_format={"type": "json_object"} if "json" in (system_prompt or "").lower() or "json" in prompt.lower() else None
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"DeepSeek API error: {str(e)}")
            raise
    
    async def analyze_with_ai(self, prompt: str, system_prompt: str = None, prefer_anthropic: bool = True,
                              use_deepseek: bool = False, provider: str = None) -> str:
        """Run an analysis prompt on the heavyweight model, or Groq for quick/cheap work.

        `use_deepseek` is a historical name: it never really meant "DeepSeek", it meant "use the
        good model rather than the fast one". It now routes to DEFAULT_AI_PROVIDER so switching the
        product's model is one setting instead of an edit at 60+ call sites. Pass `provider` to pin
        a specific one.
        """
        chosen = provider or (resolve_provider(settings.DEFAULT_AI_PROVIDER) if use_deepseek else None)
        if chosen:
            return await self.analyze_with_provider(prompt, system_prompt, provider=chosen)
        if not self.groq_client:
            raise ValueError("Groq API key not configured")
        return await self.analyze_with_groq(prompt, system_prompt)
    
    async def extract_json(self, prompt: str, system_prompt: str = None, use_deepseek: bool = False) -> dict:
        """Extract structured JSON data using AI with robust parsing"""
        response = await self.analyze_with_ai(prompt, system_prompt, use_deepseek=use_deepseek)
        
        # Clean the response
        response = response.strip()
        
        # Try multiple parsing strategies
        import re
        
        # Strategy 1: Look for JSON in markdown code blocks
        if "```json" in response:
            json_start = response.find("```json") + 7
            json_end = response.find("```", json_start)
            if json_end > json_start:
                json_str = response[json_start:json_end].strip()
            else:
                # No closing ```, might be truncated
                json_str = response[json_start:].strip()
            
            try:
                return self._parse_json_with_repair(json_str)
            except json.JSONDecodeError as e:
                print(f"JSON parse error in code block: {str(e)}, trying cleanup...")
        
        # Strategy 2: Look for any code block
        if "```" in response:
            json_start = response.find("```") + 3
            # Skip language identifier if present
            if response[json_start:json_start+10].strip().split('\n')[0].isalpha():
                json_start = response.find("\n", json_start) + 1
            json_end = response.find("```", json_start)
            if json_end > json_start:
                json_str = response[json_start:json_end].strip()
            else:
                json_str = response[json_start:].strip()
            
            try:
                return self._parse_json_with_repair(json_str)
            except json.JSONDecodeError as e:
                print(f"JSON parse error in generic block: {str(e)}, trying cleanup...")
        
        # Strategy 3: Find JSON object with regex
        json_match = re.search(r'\{[\s\S]*\}', response, re.DOTALL)
        if json_match:
            json_str = json_match.group()
            try:
                return self._parse_json_with_repair(json_str)
            except json.JSONDecodeError as e:
                print(f"JSON parse error in regex match: {str(e)}, trying cleanup...")
                
        # Strategy 4: Find JSON array with regex (for article lists)
        array_match = re.search(r'\[\s*\{[\s\S]*\}\s*\]', response, re.DOTALL)
        if array_match:
            json_str = array_match.group()
            try:
                return self._parse_json_with_repair(json_str)
            except json.JSONDecodeError as e:
                print(f"JSON parse error in array match: {str(e)}, trying repair...")
        
        # Strategy 5: Try parsing the entire response
        try:
            return self._parse_json_with_repair(response)
        except json.JSONDecodeError as e:
            print(f"JSON parse error on full response: {str(e)}")
            raise ValueError(f"Could not extract valid JSON from AI response. First 500 chars: {response[:500]}")
    
    def _clean_json_string(self, json_str: str) -> str:
        """Clean common JSON formatting issues"""
        import re
        
        # Remove trailing commas before closing braces/brackets
        json_str = re.sub(r',(\s*[}\]])', r'\1', json_str)
        
        # Fix unescaped quotes in strings (basic attempt)
        # This is tricky and might not catch all cases
        
        # Remove comments (// and /* */)
        json_str = re.sub(r'//.*?\n', '\n', json_str)
        json_str = re.sub(r'/\*.*?\*/', '', json_str, flags=re.DOTALL)
        
        # Remove any text before first { or [
        first_brace = json_str.find('{')
        first_bracket = json_str.find('[')
        if first_brace >= 0 and (first_bracket < 0 or first_brace < first_bracket):
            json_str = json_str[first_brace:]
        elif first_bracket >= 0:
            json_str = json_str[first_bracket:]
        
        # Remove any text after last } or ]
        last_brace = json_str.rfind('}')
        last_bracket = json_str.rfind(']')
        if last_brace >= 0 and last_brace > last_bracket:
            json_str = json_str[:last_brace + 1]
        elif last_bracket >= 0:
            json_str = json_str[:last_bracket + 1]
        
        return json_str.strip()
    
    def _parse_json_with_repair(self, json_str: str) -> dict:
        """Parse JSON with automatic repair for common issues"""
        import re
        
        # First try direct parsing
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            pass
        
        # Clean and try again
        cleaned = self._clean_json_string(json_str)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as e:
            # Try to repair truncated JSON
            repaired = self._repair_truncated_json(cleaned)
            try:
                return json.loads(repaired)
            except json.JSONDecodeError:
                # Last resort: try to extract partial valid JSON
                print(f"Attempting to extract partial valid JSON...")
                partial = self._extract_partial_json(cleaned)
                return json.loads(partial)
    
    def _repair_truncated_json(self, json_str: str) -> str:
        """Repair truncated JSON by closing unclosed structures"""
        import re
        
        # First, try to find and remove incomplete trailing content
        # Look for the last complete key-value pair
        
        # Pattern 1: Truncated in the middle of a string value (most common)
        # Find the last properly closed string value or structure
        last_valid_positions = [
            json_str.rfind('",'),      # Last complete string value in object
            json_str.rfind('",\n'),    # Last complete string value with newline
            json_str.rfind('},'),      # Last complete nested object
            json_str.rfind('],'),      # Last complete nested array
            json_str.rfind(': "'),     # Last key with string value start
        ]
        
        # Find the last occurrence of a complete item
        last_complete = max([pos for pos in last_valid_positions if pos > 0], default=-1)
        
        # If we found a complete item and there's content after it that looks incomplete
        if last_complete > 0:
            remaining = json_str[last_complete + 2:].strip()
            # Check if remaining content looks incomplete (unclosed quotes, etc.)
            if remaining and (remaining.count('"') % 2 != 0 or 
                            remaining.count('{') != remaining.count('}') or
                            remaining.count('[') != remaining.count(']')):
                # Truncate to last complete item
                json_str = json_str[:last_complete + 1]
        
        # Count opening and closing braces/brackets after cleanup
        open_braces = json_str.count('{')
        close_braces = json_str.count('}')
        open_brackets = json_str.count('[')
        close_brackets = json_str.count(']')
        
        # Remove trailing comma if present
        json_str = re.sub(r',(\s*[}\]])', r'\1', json_str)
        
        # Close unclosed structures
        if open_brackets > close_brackets:
            json_str += ']' * (open_brackets - close_brackets)
        if open_braces > close_braces:
            json_str += '}' * (open_braces - close_braces)
        
        return json_str
    
    def _extract_partial_json(self, json_str: str) -> str:
        """Extract the largest valid JSON structure from partial data"""
        import re
        
        # Try to find complete objects/arrays
        # Look for the last complete item in an array
        if json_str.strip().startswith('['):
            # Find all complete objects in the array
            complete_items = []
            depth = 0
            current_item = ""
            in_string = False
            escape_next = False
            
            for i, char in enumerate(json_str):
                if escape_next:
                    current_item += char
                    escape_next = False
                    continue
                
                if char == '\\':
                    escape_next = True
                    current_item += char
                    continue
                
                if char == '"' and not escape_next:
                    in_string = not in_string
                
                if not in_string:
                    if char == '{':
                        if depth == 0:
                            current_item = ""
                        depth += 1
                    elif char == '}':
                        depth -= 1
                        if depth == 0 and current_item:
                            complete_items.append(current_item + '}')
                            current_item = ""
                            continue
                
                if depth > 0:
                    current_item += char
            
            if complete_items:
                return '[' + ','.join(complete_items) + ']'
        
        # If it's an object, try to close it properly
        return self._repair_truncated_json(json_str)
    
    async def extract_json_with_thinking(self, prompt: str, system_prompt: str = None) -> dict:
        """
        Extract structured JSON using DeepSeek (legacy method for compatibility)
        """
        return await self.extract_json(prompt, system_prompt, use_deepseek=True)



# Singleton instance
ai_service = AIService()
