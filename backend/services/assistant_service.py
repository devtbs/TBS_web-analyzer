"""In-app AI assistant: a tool-calling agent over the app's own GSC / GA4 / Ads data.

Driven by MiniMax (OpenAI-compatible, model MiniMax-M1) but written provider-agnostic —
the loop uses the standard OpenAI `tools` schema, so pointing it at DeepSeek/Claude is a
config change, not a rewrite.

Two tool classes:
  • read tools  — run automatically (fetch metrics, insights, list clients)
  • action tools — require explicit user confirmation before running (generate a deck)

The loop yields event dicts consumed by the SSE endpoint:
  {"type": "tool",    "name", "message"}       # activity chip
  {"type": "confirm", "name", "args", "summary"}  # pending action, loop pauses
  {"type": "token",   "text"}                  # answer text (streamed in chunks)
  {"type": "done"}
  {"type": "error",   "detail"}
"""
from __future__ import annotations

import json
import re
import logging
from dataclasses import dataclass
from typing import Optional, AsyncGenerator

from openai import AsyncOpenAI

from config import settings

logger = logging.getLogger(__name__)

_MAX_HOPS = 6
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


def _strip_think(text: str) -> str:
    """MiniMax-M1 is a reasoning model that wraps its private reasoning in <think>…</think>.
    Strip it so only the user-facing answer is shown."""
    return _THINK_RE.sub("", text or "").strip()


def assistant_configured() -> bool:
    return bool(settings.MINIMAX_API_KEY)


# ── Tool context ────────────────────────────────────────────────────────────
@dataclass
class ToolContext:
    db: object
    user_email: str
    account_id: Optional[int]
    selected_property: Optional[str] = None      # GSC property url
    selected_customer: Optional[str] = None      # Google Ads customer id
    selected_ga4_property: Optional[str] = None   # GA4 property id


# ── Tool schemas (OpenAI function-calling format) ───────────────────────────
READ_TOOLS = {"get_context", "list_gsc_properties", "list_ga4_properties",
              "gsc_overview", "gsc_movers", "gsc_ctr_opportunities", "paid_vs_organic",
              "list_ads_customers", "ga4_overview", "ads_overview",
              "gsc_striking_distance", "gsc_cannibalization"}
ACTION_TOOLS = {"generate_deck"}
# Tools that pause the loop to ask the user to pick a client (rendered as clickable options).
SELECT_TOOLS = {"ask_client_choice"}

TOOL_SCHEMAS = [
    {"type": "function", "function": {
        "name": "get_context",
        "description": "Return the client the user currently has selected in the UI (GSC property, "
                       "GA4 property id, Google Ads customer id). Call this first to resolve 'this "
                       "property/account' references.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "list_gsc_properties",
        "description": "List the Search Console properties available in the active Google account.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "list_ga4_properties",
        "description": "List the GA4 properties available in the active Google account.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "list_ads_customers",
        "description": "List the Google Ads accounts available in the active Google account.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "ga4_overview",
        "description": "Get GA4 traffic overview (sessions, users, engagement, top channels/pages) "
                       "for a GA4 property id over the last N days.",
        "parameters": {"type": "object", "properties": {
            "property_id": {"type": "string", "description": "GA4 property id (digits)."},
            "days": {"type": "integer", "description": "Look-back window, default 28."},
        }, "required": ["property_id"]},
    }},
    {"type": "function", "function": {
        "name": "ads_overview",
        "description": "Get Google Ads overview (impressions, clicks, cost, conversions, top "
                       "campaigns) for a customer id over the last N days.",
        "parameters": {"type": "object", "properties": {
            "customer_id": {"type": "string", "description": "Google Ads customer id (digits)."},
            "days": {"type": "integer", "description": "Look-back window, default 28."},
        }, "required": ["customer_id"]},
    }},
    {"type": "function", "function": {
        "name": "gsc_overview",
        "description": "Organic search overview for a GSC property: total clicks, impressions, CTR "
                       "and average position WITH period-over-period change, plus the top queries "
                       "and top pages. Use this FIRST for any 'how is organic doing / how did we "
                       "perform' question — it is the core organic report.",
        "parameters": {"type": "object", "properties": {
            "property_url": {"type": "string", "description": "GSC property url, e.g. https://x.com/ or sc-domain:x.com"},
            "days": {"type": "integer", "description": "Look-back window, default 28."},
        }, "required": ["property_url"]},
    }},
    {"type": "function", "function": {
        "name": "gsc_movers",
        "description": "The biggest query risers and fallers by clicks for a GSC property, each with "
                       "its rank movement. Use this to explain WHY organic traffic went up or down.",
        "parameters": {"type": "object", "properties": {
            "property_url": {"type": "string"},
            "days": {"type": "integer", "description": "Look-back window, default 28."},
        }, "required": ["property_url"]},
    }},
    {"type": "function", "function": {
        "name": "gsc_ctr_opportunities",
        "description": "High-impression queries whose click-through rate is below what their rank "
                       "should earn — the clearest quick wins from better titles/meta descriptions.",
        "parameters": {"type": "object", "properties": {
            "property_url": {"type": "string"},
            "days": {"type": "integer", "description": "Look-back window, default 28."},
        }, "required": ["property_url"]},
    }},
    {"type": "function", "function": {
        "name": "paid_vs_organic",
        "description": "Join a client's Google Ads search terms with their Search Console queries to "
                       "answer 'are we paying for terms we already rank for?'. Returns the overlap "
                       "bucketed as DEFEND (already top-3 organic + paying), CONTENT GAP (paid "
                       "converts, organic invisible) and DOUBLE COVERAGE, plus blended acquisition "
                       "and ROAS. Needs BOTH a GSC property and an Ads customer for the same client.",
        "parameters": {"type": "object", "properties": {
            "property_url": {"type": "string", "description": "GSC property url for the client."},
            "customer_id": {"type": "string", "description": "Google Ads customer id (digits) for the SAME client."},
            "days": {"type": "integer", "description": "Look-back window, default 28."},
        }, "required": ["property_url", "customer_id"]},
    }},
    {"type": "function", "function": {
        "name": "gsc_striking_distance",
        "description": "Keywords ranking at positions 4–20 for a GSC property — the quickest "
                       "page-1 wins.",
        "parameters": {"type": "object", "properties": {
            "property_url": {"type": "string", "description": "GSC property url, e.g. https://x.com/ or sc-domain:x.com"},
            "days": {"type": "integer", "description": "Look-back window, default 28."},
        }, "required": ["property_url"]},
    }},
    {"type": "function", "function": {
        "name": "gsc_cannibalization",
        "description": "Find queries where multiple pages of a GSC property compete for the same "
                       "keyword (keyword cannibalization).",
        "parameters": {"type": "object", "properties": {
            "property_url": {"type": "string"},
            "days": {"type": "integer", "description": "Look-back window, default 28."},
        }, "required": ["property_url"]},
    }},
    {"type": "function", "function": {
        "name": "ask_client_choice",
        "description": "Ask the user which client/site to use, shown as clickable options. Call "
                       "this whenever a request needs a specific client and the user hasn't named "
                       "one and none is selected (get_context returned nulls). Pick the kind that "
                       "matches the request: gsc_property for Search Console/organic/keywords, "
                       "ga4_property for traffic/analytics, ads_customer for Google Ads.",
        "parameters": {"type": "object", "properties": {
            "kind": {"type": "string", "enum": ["gsc_property", "ga4_property", "ads_customer"]},
        }, "required": ["kind"]},
    }},
    {"type": "function", "function": {
        "name": "generate_deck",
        "description": "Generate an AI-designed presentation deck for a client. ACTION: this "
                       "produces a deliverable and must be confirmed by the user before running.",
        "parameters": {"type": "object", "properties": {
            "source": {"type": "string", "enum": ["gsc", "ads"],
                       "description": "gsc = organic/Search Console deck; ads = Google Ads deck."},
            "id": {"type": "string", "description": "GSC property url (source=gsc) or Ads customer id (source=ads)."},
            "days": {"type": "integer", "description": "Look-back window, default 28."},
            "label": {"type": "string", "description": "Optional display name for the client."},
        }, "required": ["source", "id"]},
    }},
]

_SYSTEM_PROMPT = (
    "You are the in-app analyst for TBS Web Analyzer, a marketing agency's tool spanning many "
    "clients' Search Console (GSC), Google Analytics (GA4) and Google Ads data. You are a sharp "
    "performance-marketing analyst, not a chatbot: you fetch the real numbers, interpret them, and "
    "say what to do.\n"
    "\n"
    "HOW TO ANSWER\n"
    "- Always fetch real data with a tool before answering a data question; never invent or "
    "estimate numbers. Resolve 'this site/account' via get_context first.\n"
    "- Pick the RIGHT tool: gsc_overview for 'how is organic doing' (it has the totals AND the "
    "period-over-period change); gsc_movers for 'why did traffic change'; gsc_ctr_opportunities / "
    "gsc_striking_distance for quick wins; paid_vs_organic when the question spans paid and organic "
    "for the same client.\n"
    "- Lead with the answer and the number that matters, then one line of what it means, then the "
    "action. Use a short markdown table when comparing more than ~3 numbers. Keep it tight.\n"
    "- Read deltas correctly: for POSITION, a negative change is an IMPROVEMENT (rank moved toward "
    "1). For clicks/impressions/revenue, negative is a decline.\n"
    "- Be honest about declines — state the real number and movement and the likely cause; never "
    "spin a drop as flat or positive. Equally, don't manufacture alarm from noise (a 2→1 click "
    "'-50%' is not a story).\n"
    "- For an e-commerce client, judge Ads on REVENUE and ROAS first, conversion count second: "
    "fewer, larger orders (conversions down, revenue up) is a GOOD period.\n"
    "- If a tool returns an error or empty data, say so plainly and suggest the fix (e.g. reconnect "
    "the account) — do not paper over it with invented numbers.\n"
    "\n"
    "ACTIONS & CLIENTS\n"
    "- generate_deck creates a deliverable; the app confirms with the user before it runs, so just "
    "call it when asked.\n"
    "- If a request needs a specific client and none is selected (get_context shows nothing), call "
    "ask_client_choice so they can pick — never guess a client."
)


# ── Tool handlers ───────────────────────────────────────────────────────────
async def _handle(name: str, args: dict, ctx: ToolContext) -> dict:
    """Dispatch a tool call to the underlying app service. Returns a JSON-able dict."""
    from api.routers._shared import _resolve_token, _gsc_service_for, _ga4_service_for

    if name == "get_context":
        return {
            "selected_gsc_property": ctx.selected_property,
            "selected_ga4_property_id": ctx.selected_ga4_property,
            "selected_ads_customer_id": ctx.selected_customer,
            "note": "These are what the user currently has open in the UI.",
        }

    if name == "list_gsc_properties":
        from services.gsc_service import get_user_properties
        token, is_refresh = _resolve_token(ctx.db, ctx.user_email, ctx.account_id)
        props = await get_user_properties(token, is_refresh_token=is_refresh, user_email=ctx.user_email)
        return {"properties": [{"url": p.get("url"), "display": p.get("display")} for p in props][:100]}

    if name == "list_ga4_properties":
        from services.analytics_service import get_user_ga4_properties
        token, is_refresh = _resolve_token(ctx.db, ctx.user_email, ctx.account_id)
        props = await get_user_ga4_properties(token, is_refresh_token=is_refresh, user_email=ctx.user_email)
        return {"properties": [{"property_id": p.get("property_id"), "display": p.get("display")} for p in props][:100]}

    if name == "list_ads_customers":
        from services.ads_service import ads_is_configured, get_user_ads_customers
        if not ads_is_configured():
            return {"error": "Google Ads is not configured (no developer token)."}
        token, is_refresh = _resolve_token(ctx.db, ctx.user_email, ctx.account_id)
        custs = await get_user_ads_customers(token, is_refresh_token=is_refresh, user_email=ctx.user_email)
        return {"customers": [{"customer_id": c.get("customer_id"), "display": c.get("display")} for c in custs][:100]}

    if name == "ga4_overview":
        service = _ga4_service_for(ctx.db, ctx.user_email, ctx.account_id)
        return await service.get_overview(str(args["property_id"]), int(args.get("days", 28)))

    if name == "ads_overview":
        from services.ads_service import ads_is_configured, AdsService
        if not ads_is_configured():
            return {"error": "Google Ads is not configured (no developer token)."}
        token, is_refresh = _resolve_token(ctx.db, ctx.user_email, ctx.account_id)
        if not is_refresh:
            return {"error": "Google Ads needs a stored refresh token — reconnect the Google account."}
        service = AdsService.from_stored_token(token, is_refresh_token=is_refresh, user_email=ctx.user_email)
        return await service.get_overview(str(args["customer_id"]), int(args.get("days", 28)))

    if name == "gsc_overview":
        # The core organic tool that was missing — clicks/impressions/CTR/position WITH
        # period-over-period change, plus the top queries and pages. Most "how is organic doing?"
        # questions need exactly this, and before it the assistant only had striking-distance and
        # cannibalization, neither of which answers the basic question.
        service = _gsc_service_for(ctx.db, ctx.user_email, ctx.account_id)
        url, days = args["property_url"], int(args.get("days", 28))
        analytics = await service.get_search_analytics(url, days=days, group_by="daily")
        queries = await service.get_top_queries(url, days=days)
        pages = await service.get_top_pages(url, days=days)
        return {
            "totals": analytics.get("totals", {}),
            "change_vs_previous_period_pct": analytics.get("deltas", {}),
            "top_queries": queries[:15],
            "top_pages": pages[:10],
            "note": "Deltas are % change vs the previous equal period. A negative 'position' "
                    "delta is an IMPROVEMENT (rank got closer to 1).",
        }

    if name == "gsc_movers":
        # "What changed and why?" — the biggest query risers and fallers by clicks, each with its
        # rank movement, so the assistant can explain a traffic shift instead of only describing it.
        # get_query_insights returns raw current/prev values, NOT pre-computed deltas, so the
        # change is derived here (an earlier version looked for a `clicks_delta` key that does not
        # exist and scored every query zero).
        service = _gsc_service_for(ctx.db, ctx.user_email, ctx.account_id)
        ins = await service.get_query_insights(args["property_url"], days=int(args.get("days", 28)))
        moved = []
        for r in ins.get("queries") or []:
            cd = (r.get("clicks") or 0) - (r.get("prev_clicks") or 0)
            if cd == 0:
                continue
            pos, prev_pos = r.get("position") or 0, r.get("prev_position") or 0
            moved.append({
                "query": r.get("query"),
                "clicks": r.get("clicks"), "clicks_change": cd,
                "position": pos,
                # negative = rank improved (moved toward 1); only meaningful when it ranked before.
                "position_change": round(pos - prev_pos, 1) if prev_pos else None,
                "impressions": r.get("impressions"),
            })
        risers = sorted((m for m in moved if m["clicks_change"] > 0),
                        key=lambda m: m["clicks_change"], reverse=True)[:10]
        fallers = sorted((m for m in moved if m["clicks_change"] < 0),
                         key=lambda m: m["clicks_change"])[:10]
        return {"rising_queries": risers, "falling_queries": fallers}

    if name == "gsc_ctr_opportunities":
        # High-impression queries whose CTR trails their rank — the clearest quick wins.
        service = _gsc_service_for(ctx.db, ctx.user_email, ctx.account_id)
        data = await service.get_ctr_opportunities(args["property_url"], int(args.get("days", 28)))
        return {"opportunities": data[:20], "total": len(data)}

    if name == "paid_vs_organic":
        # Reuse the cross-channel synthesis the deck pipeline computes — "are we paying for terms we
        # already rank for?". The one question that needs GSC and Ads joined, answered from the same
        # code the deck uses so the assistant and the deck never disagree.
        from services.report_generator import (assemble_gsc_context, assemble_ads_context,
                                               _brand_cores)
        from services.cross_channel import compute_cross_channel
        from services.ads_service import ads_is_configured, AdsService
        if not ads_is_configured():
            return {"error": "Google Ads is not configured (no developer token)."}
        gsc_service = _gsc_service_for(ctx.db, ctx.user_email, ctx.account_id)
        token, is_refresh = _resolve_token(ctx.db, ctx.user_email, ctx.account_id)
        if not is_refresh:
            return {"error": "Google Ads needs a stored refresh token — reconnect the Google account."}
        ads_service = AdsService.from_stored_token(token, is_refresh_token=is_refresh,
                                                   user_email=ctx.user_email)
        days = int(args.get("days", 28))
        gsc_ctx = await assemble_gsc_context(gsc_service, args["property_url"], days)
        try:
            ads_ctx = await assemble_ads_context(ads_service, str(args["customer_id"]), days)
        except Exception:
            # Wrong id, or the connected account can't access this customer — a plain message the
            # model can relay, not a gRPC stack trace.
            logger.warning("paid_vs_organic: Ads fetch failed", exc_info=True)
            return {"error": f"Could not load Google Ads data for customer "
                             f"{args.get('customer_id')} — check the id and that the connected "
                             f"account has access to it."}
        try:
            deep = await ads_service.get_deep_dive(str(args["customer_id"]), days)
        except Exception:
            deep = None
        cross = compute_cross_channel(gsc_ctx, None, ads_ctx, deep,
                                      brand_cores=_brand_cores(gsc_ctx.get("domain", ""), None))
        return {"overlap": cross["overlap"][:12], "blended": cross["blended"],
                "flags": cross["flags"]}

    if name == "gsc_striking_distance":
        service = _gsc_service_for(ctx.db, ctx.user_email, ctx.account_id)
        data = await service.get_striking_distance(args["property_url"], int(args.get("days", 28)))
        return {"keywords": data[:50], "total": len(data)}

    if name == "gsc_cannibalization":
        service = _gsc_service_for(ctx.db, ctx.user_email, ctx.account_id)
        data = await service.get_cannibalization(args["property_url"], int(args.get("days", 28)))
        return {"cannibalized": data[:50], "total": len(data)}

    raise ValueError(f"Unknown tool: {name}")


async def _client_choices(kind: str, ctx: ToolContext) -> dict:
    """Build the clickable option list for the 'pick a client' prompt."""
    if kind == "gsc_property":
        data = await _handle("list_gsc_properties", {}, ctx)
        opts = [{"label": p.get("display") or p.get("url"), "value": p.get("url")}
                for p in data.get("properties", []) if p.get("url")]
        prompt = "Which Search Console property should I use?"
    elif kind == "ads_customer":
        data = await _handle("list_ads_customers", {}, ctx)
        opts = [{"label": c.get("display") or c.get("customer_id"), "value": c.get("customer_id")}
                for c in data.get("customers", []) if c.get("customer_id")]
        prompt = "Which Google Ads account should I use?"
    else:  # ga4_property
        data = await _handle("list_ga4_properties", {}, ctx)
        opts = [{"label": p.get("display") or p.get("property_id"), "value": p.get("property_id")}
                for p in data.get("properties", []) if p.get("property_id")]
        prompt = "Which GA4 property should I use?"
    return {"kind": kind, "prompt": prompt, "options": opts[:50]}


async def _run_generate_deck(args: dict, ctx: ToolContext) -> dict:
    """Execute the confirmed deck action, reusing the existing deck pipeline. Returns a link."""
    from api.routers._shared import _resolve_token
    from services.report_generator import generate_ai_gsc_deck, generate_ai_ads_deck
    from services.image_service import images_enabled
    from api.routers._shared import _save_deck_document

    source = args.get("source")
    days = int(args.get("days", 28))
    # Decks are long structured HTML — keep them on the app's tested deck provider
    # (DeepSeek). MiniMax-M1 is a reasoning model whose <think> output would corrupt the
    # HTML; it drives the chat, not the deck rendering.
    provider = "deepseek"
    token, is_refresh = _resolve_token(ctx.db, ctx.user_email, ctx.account_id)

    if source == "gsc":
        from services.gsc_service import GSCService
        from services.analytics_service import AnalyticsService
        gsc = GSCService.from_stored_token(token, is_refresh_token=is_refresh, user_email=ctx.user_email)
        try:
            ga4 = AnalyticsService.from_stored_token(token, is_refresh_token=is_refresh, user_email=ctx.user_email)
        except Exception:
            ga4 = None
        result = await generate_ai_gsc_deck(gsc, args["id"], days, provider=provider,
                                            images=images_enabled(), ga4_service=ga4)
        doc_id = _save_deck_document(ctx.db, ctx.user_email, html=result["html"], source="gsc",
                                     label=result["domain"], provider=provider)
        return {"document_id": doc_id, "label": result["domain"], "link": f"/documents/{doc_id}"}

    if source == "ads":
        from services.ads_service import ads_is_configured, AdsService
        if not ads_is_configured():
            return {"error": "Google Ads is not configured (no developer token)."}
        if not is_refresh:
            return {"error": "Google Ads needs a stored refresh token — reconnect the Google account."}
        ads = AdsService.from_stored_token(token, is_refresh_token=is_refresh, user_email=ctx.user_email)
        result = await generate_ai_ads_deck(ads, args["id"], days, label=args.get("label", ""),
                                            provider=provider, images=images_enabled())
        doc_id = _save_deck_document(ctx.db, ctx.user_email, html=result["html"], source="ads",
                                     label=result["domain"], provider=provider)
        return {"document_id": doc_id, "label": result["domain"], "link": f"/documents/{doc_id}"}

    return {"error": f"Unknown deck source: {source}"}


def _confirm_summary(name: str, args: dict) -> str:
    if name == "generate_deck":
        kind = "Google Ads" if args.get("source") == "ads" else "Search Console"
        who = args.get("label") or args.get("id")
        return f"Generate a {kind} deck for {who} (last {args.get('days', 28)} days)?"
    return f"Run {name} with {json.dumps(args)}?"


# ── Providers ───────────────────────────────────────────────────────────────
def _providers() -> dict:
    """OpenAI-compatible providers the assistant can drive. Both support tool calls."""
    return {
        "minimax": {"key": settings.MINIMAX_API_KEY, "base_url": settings.MINIMAX_BASE_URL,
                    "model": settings.MINIMAX_MODEL},
        "deepseek": {"key": settings.DEEPSEEK_API_KEY, "base_url": "https://api.deepseek.com",
                     "model": "deepseek-chat"},
    }


def _resolve_provider(provider: Optional[str]) -> dict:
    """Pick a configured provider, falling back to MiniMax then any configured one."""
    provs = _providers()
    cfg = provs.get(provider or "minimax")
    if cfg and cfg["key"]:
        return cfg
    if provs["minimax"]["key"]:
        return provs["minimax"]
    for c in provs.values():
        if c["key"]:
            return c
    return provs["minimax"]  # unconfigured; caller reports the missing-key error


# ── Agent loop ──────────────────────────────────────────────────────────────
def _client(cfg: dict) -> AsyncOpenAI:
    return AsyncOpenAI(api_key=cfg["key"], base_url=cfg["base_url"])


def _norm_messages(messages: list) -> list:
    """Keep only role/content for user+assistant turns from the client."""
    out = [{"role": "system", "content": _SYSTEM_PROMPT}]
    for m in messages:
        role = m.get("role")
        if role in ("user", "assistant") and m.get("content"):
            out.append({"role": role, "content": str(m["content"])})
    return out


async def _emit_text(text: str) -> AsyncGenerator[dict, None]:
    """Chunk a final answer into token events (M1's streaming is noisy with think tags,
    so we run non-streaming then chunk the cleaned text for a typing feel)."""
    text = _strip_think(text)
    if not text:
        text = "I don't have anything to add."
    # ~40-char chunks on word boundaries.
    buf = ""
    for word in text.split(" "):
        buf += word + " "
        if len(buf) >= 40:
            yield {"type": "token", "text": buf}
            buf = ""
    if buf:
        yield {"type": "token", "text": buf}


async def run_assistant(ctx: ToolContext, messages: list,
                        approved_action: Optional[dict] = None,
                        provider: Optional[str] = None) -> AsyncGenerator[dict, None]:
    """Drive the tool-calling loop. Yields event dicts (see module docstring)."""
    cfg = _resolve_provider(provider)
    if not cfg["key"]:
        yield {"type": "error", "detail": "The assistant is not configured (no LLM API key set)."}
        return

    client = _client(cfg)
    model = cfg["model"]

    # If the user just approved a pending action, execute it now and report back.
    if approved_action:
        name, args = approved_action.get("name"), approved_action.get("args", {})
        try:
            if name == "generate_deck":
                yield {"type": "tool", "name": name, "message": "Generating the deck… this can take a minute."}
                result = await _run_generate_deck(args, ctx)
            else:
                result = {"error": f"Unknown action: {name}"}
        except Exception as e:  # noqa: BLE001
            logger.exception("assistant action failed")
            yield {"type": "error", "detail": f"The action failed: {e}"}
            return
        if result.get("error"):
            async for ev in _emit_text(f"I couldn't complete that: {result['error']}"):
                yield ev
        elif result.get("link"):
            async for ev in _emit_text(
                f"Done — the deck for **{result.get('label', 'the client')}** is ready. "
                f"You can open it here: {result['link']}"):
                yield ev
        else:
            async for ev in _emit_text("Done."):
                yield ev
        yield {"type": "done"}
        return

    convo = _norm_messages(messages)

    for _hop in range(_MAX_HOPS):
        try:
            resp = await client.chat.completions.create(
                model=model, messages=convo,
                tools=TOOL_SCHEMAS, tool_choice="auto", max_tokens=4000,
            )
        except Exception as e:  # noqa: BLE001
            logger.exception("assistant model call failed")
            yield {"type": "error", "detail": f"The assistant model call failed: {e}"}
            return

        msg = resp.choices[0].message
        tool_calls = msg.tool_calls or []

        if not tool_calls:
            async for ev in _emit_text(msg.content or ""):
                yield ev
            yield {"type": "done"}
            return

        # Record the assistant turn (with its tool calls) before appending tool results.
        convo.append({
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in tool_calls
            ],
        })

        for tc in tool_calls:
            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}

            # Picker tools pause and ask the user to choose a client (clickable options).
            if name in SELECT_TOOLS:
                try:
                    choice = await _client_choices(args.get("kind", "ga4_property"), ctx)
                except Exception as e:  # noqa: BLE001
                    logger.exception("assistant client-choice failed")
                    yield {"type": "error", "detail": str(e)}
                    return
                if not choice["options"]:
                    async for ev in _emit_text(
                        "I couldn't find any clients to choose from for that. "
                        "Make sure a Google account with access is connected."):
                        yield ev
                    yield {"type": "done"}
                    return
                yield {"type": "select", **choice}
                return

            # Action tools pause for confirmation instead of running.
            if name in ACTION_TOOLS:
                yield {"type": "confirm", "name": name, "args": args,
                       "summary": _confirm_summary(name, args)}
                return

            yield {"type": "tool", "name": name, "message": _activity_label(name)}
            try:
                result = await _handle(name, args, ctx)
            except Exception as e:  # noqa: BLE001
                logger.exception("assistant tool %s failed", name)
                result = {"error": str(e)}
            convo.append({"role": "tool", "tool_call_id": tc.id,
                          "content": json.dumps(result, default=str)[:12000]})

    # Ran out of hops.
    async for ev in _emit_text("I wasn't able to finish that in a few steps — try narrowing the request."):
        yield ev
    yield {"type": "done"}


def _activity_label(name: str) -> str:
    return {
        "get_context": "Checking what you have selected…",
        "list_gsc_properties": "Listing Search Console properties…",
        "list_ga4_properties": "Listing GA4 properties…",
        "list_ads_customers": "Listing Google Ads accounts…",
        "ga4_overview": "Fetching GA4 traffic…",
        "ads_overview": "Fetching Google Ads performance…",
        "gsc_overview": "Pulling the organic search overview…",
        "gsc_movers": "Finding the biggest movers…",
        "gsc_ctr_opportunities": "Looking for CTR quick wins…",
        "paid_vs_organic": "Comparing paid and organic…",
        "gsc_striking_distance": "Finding striking-distance keywords…",
        "gsc_cannibalization": "Checking keyword cannibalization…",
    }.get(name, f"Running {name}…")
