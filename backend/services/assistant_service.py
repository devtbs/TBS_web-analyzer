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
    selected_client_id: Optional[str] = None      # the picked Client (expands to all of the above)
    selected_analysis_id: Optional[str] = None    # the topical-map analysis currently open (Results page)


# ── Tool schemas (OpenAI function-calling format) ───────────────────────────
READ_TOOLS = {"get_context", "list_clients", "get_client",
              "list_gsc_properties", "list_ga4_properties",
              "gsc_overview", "gsc_movers", "gsc_ctr_opportunities", "paid_vs_organic",
              "list_ads_customers", "ga4_overview", "ads_overview",
              "gsc_striking_distance", "gsc_cannibalization", "get_topical_map",
              "get_tracked_rankings", "list_clustering_runs", "get_clustering_run",
              "list_site_audits", "get_site_audit"}
ACTION_TOOLS = {"generate_deck", "track_keywords", "start_clustering_run"}
# Tools that pause the loop to ask the user to pick a client (rendered as clickable options).
SELECT_TOOLS = {"ask_client_choice"}

TOOL_SCHEMAS = [
    {"type": "function", "function": {
        "name": "get_context",
        "description": "Return the CLIENT the user currently has selected (with its GSC property, "
                       "GA4 property id and Ads customer id already resolved). Call this first to "
                       "resolve 'this client' / 'this property' references.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "list_clients",
        "description": "List the user's managed clients (name + domain + which channels are linked). "
                       "Use this to resolve a client mentioned by name, or to answer 'which clients "
                       "do I have'.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "get_client",
        "description": "Resolve ONE client to all its assets at once — GSC property, GA4 property id, "
                       "Ads customer id and brand terms. Call this after the user names a client, "
                       "then feed the returned ids to gsc_overview / ads_overview / paid_vs_organic. "
                       "Saves asking the user to pick a property/account separately.",
        "parameters": {"type": "object", "properties": {
            "client_id": {"type": "string", "description": "Client id from list_clients."},
            "name": {"type": "string", "description": "Or a client name/domain to match (case-insensitive)."},
        }},
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
        "name": "get_topical_map",
        "description": "Get the topical map / content plan / keyword clusters for the analysis the "
                       "user currently has open on the Results page (site overview, key topics, "
                       "content-plan nodes with titles/URLs/search volume, keyword clusters, and "
                       "bridge topics connecting them). Use this for ANY question about 'this "
                       "topical map', 'the content plan we just made', 'what pages should we build', "
                       "or keyword clusters from the current analysis. Takes no arguments — it always "
                       "refers to whatever analysis is currently open.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "get_tracked_rankings",
        "description": "Get the self-hosted rank tracker's tracked keywords: each keyword's latest "
                       "Google position, change since last check, best position ever, and ranking "
                       "URL. Use this for 'how are we ranking', 'did we move up/down for X', or "
                       "'what's our best keyword' questions.",
        "parameters": {"type": "object", "properties": {
            "client_id": {"type": "string", "description": "Optional — restrict to one client's "
                          "tracked keywords. Defaults to the currently selected client if any, "
                          "otherwise returns all of the user's tracked keywords."},
        }},
    }},
    {"type": "function", "function": {
        "name": "list_clustering_runs",
        "description": "List the user's saved keyword-clustering runs (each groups a keyword set "
                       "into content clusters by SERP overlap). Returns name, domain, status, and "
                       "cluster/keyword counts. Call this before get_clustering_run to find the "
                       "right run_id, or to answer 'what clustering runs do I have'.",
        "parameters": {"type": "object", "properties": {
            "client_id": {"type": "string", "description": "Optional — restrict to one client's runs."},
        }},
    }},
    {"type": "function", "function": {
        "name": "get_clustering_run",
        "description": "Get the full clusters (pillar keyword, total volume, member keywords, "
                       "search intent, GSC ranking status) for ONE saved clustering run. Use "
                       "list_clustering_runs first to find the run_id, unless the user already "
                       "named the site/run.",
        "parameters": {"type": "object", "properties": {
            "run_id": {"type": "string", "description": "Run id from list_clustering_runs."},
            "domain": {"type": "string", "description": "Or match by domain/name instead of an id."},
        }},
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
    {"type": "function", "function": {
        "name": "list_site_audits",
        "description": "List recent technical-SEO audits (crawls) with their score and date. Use "
                       "for 'what's broken on the site' / 'how healthy is this site' questions.",
        "parameters": {"type": "object", "properties": {
            "domain": {"type": "string", "description": "Optional domain/property to filter by."},
        }},
    }},
    {"type": "function", "function": {
        "name": "get_site_audit",
        "description": "Full results of one technical-SEO audit: score, pages crawled, and the "
                       "issues grouped by severity with example URLs. Use after list_site_audits, "
                       "or on its own to get the latest audit for a domain.",
        "parameters": {"type": "object", "properties": {
            "audit_id": {"type": "string", "description": "Audit id from list_site_audits."},
            "domain": {"type": "string", "description": "Or the domain — uses its most recent audit."},
        }},
    }},
    {"type": "function", "function": {
        "name": "track_keywords",
        "description": "Add keywords to the rank tracker so their Google position is checked daily. "
                       "ACTION: costs one SerpAPI search per keyword per day and must be confirmed.",
        "parameters": {"type": "object", "properties": {
            "keywords": {"type": "array", "items": {"type": "string"},
                         "description": "The keywords to start tracking."},
            "domain": {"type": "string", "description": "Domain to track them for, e.g. example.com."},
            "gl": {"type": "string", "description": "Country code, e.g. 'th' or 'us'. Default 'th'."},
            "location_id": {"type": "integer", "description": "Optional specific location id."},
        }, "required": ["keywords", "domain"]},
    }},
    {"type": "function", "function": {
        "name": "start_clustering_run",
        "description": "Start a SERP-overlap keyword clustering job for a list of keywords. "
                       "ACTION: spends SerpAPI credits and must be confirmed. Returns a run id; "
                       "the job runs in the background and the user watches it on the Keyword "
                       "Clustering page.",
        "parameters": {"type": "object", "properties": {
            "keywords": {"type": "array", "items": {"type": "string"},
                         "description": "At least 2 keywords to cluster."},
            "domain": {"type": "string", "description": "Client domain the run belongs to."},
            "name": {"type": "string", "description": "Optional label for the run."},
            "gl": {"type": "string", "description": "Country code, default 'th'."},
            "discover": {"type": "boolean",
                         "description": "Expand the seed list with related keywords before clustering."},
        }, "required": ["keywords"]},
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
    "- For questions about a topical map, content plan, or keyword clusters from an analysis the "
    "user is viewing (e.g. 'this topical map', 'the pages we should build'), call get_topical_map — "
    "it needs no arguments and always refers to whatever analysis is currently open. If it returns "
    "an error saying none is open, tell the user to open the analysis's Results page first.\n"
    "- For rank-tracking questions ('how are we ranking', 'did X move up'), call "
    "get_tracked_rankings. For questions about a saved keyword-clustering run ('what clusters did "
    "we find for X'), call list_clustering_runs to find it, then get_clustering_run for the details.\n"
    "\n"
    "- For technical/site-health questions ('what's broken', 'any SEO issues', 'how healthy is "
    "this site'), call get_site_audit (or list_site_audits first if you need to pick one). Lead "
    "with the score and the highest-severity issues, and say how many pages each affects.\n"
    "\n"
    "ACTIONS & CLIENTS\n"
    "- generate_deck creates a deliverable; the app confirms with the user before it runs, so just "
    "call it when asked.\n"
    "- You can also ACT on what you find, which is often the natural next step after an answer: "
    "track_keywords adds keywords to the daily rank tracker, and start_clustering_run queues a "
    "SERP-overlap clustering job. Both cost SerpAPI credits and are confirmed by the user before "
    "they run, so call them directly when asked — but never call them speculatively, and always "
    "pass the exact keywords you discussed. If you don't know which domain to use, ask.\n"
    "- After a research-style answer (striking distance, keyword clusters, a topical map), it is "
    "good practice to offer the follow-up action in one short line, e.g. 'Want me to track these "
    "five?' — offer it, don't do it unprompted.\n"
    "- If a request needs a specific client and none is selected (get_context shows nothing), call "
    "ask_client_choice so they can pick — never guess a client."
)


# ── Tool handlers ───────────────────────────────────────────────────────────
async def _handle(name: str, args: dict, ctx: ToolContext) -> dict:
    """Dispatch a tool call to the underlying app service. Returns a JSON-able dict."""
    from api.routers._shared import _resolve_token, _gsc_service_for, _ga4_service_for

    if name == "get_context":
        from api.routers.clients import resolve_client
        client = resolve_client(ctx.db, ctx.user_email, ctx.selected_client_id) if ctx.selected_client_id else None
        return {
            "selected_client": client,   # full asset tuple when a client is selected
            "selected_gsc_property": (client or {}).get("gsc_property") or ctx.selected_property,
            "selected_ga4_property_id": (client or {}).get("ga4_property_id") or ctx.selected_ga4_property,
            "selected_ads_customer_id": (client or {}).get("ads_customer_id") or ctx.selected_customer,
            "note": "The selected client's assets — use these ids directly for the data tools.",
        }

    if name == "list_clients":
        from database import Client
        rows = (ctx.db.query(Client)
                .filter(Client.user_email == ctx.user_email, Client.archived == False)  # noqa: E712
                .order_by(Client.name).all())
        return {"clients": [{"id": c.id, "name": c.name, "domain": c.domain,
                             "has_gsc": bool(c.gsc_property), "has_ga4": bool(c.ga4_property_id),
                             "has_ads": bool(c.ads_customer_id)} for c in rows][:200]}

    if name == "get_client":
        from api.routers.clients import resolve_client
        from database import Client
        cid = args.get("client_id")
        if not cid and args.get("name"):
            q = args["name"].strip().lower()
            match = next((c for c in ctx.db.query(Client).filter(
                Client.user_email == ctx.user_email, Client.archived == False).all()  # noqa: E712
                if q in (c.name or "").lower() or q in (c.domain or "").lower()), None)
            cid = match.id if match else None
        client = resolve_client(ctx.db, ctx.user_email, cid) if cid else None
        if not client:
            return {"error": "No matching client — call list_clients to see the available names."}
        return client

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

    if name in ("list_site_audits", "get_site_audit"):
        from database import Audit
        q = ctx.db.query(Audit).filter(Audit.user_email == ctx.user_email)
        dom = (args.get("domain") or "").lower().replace("www.", "").strip("/")
        if dom:
            q = q.filter(Audit.property_url.ilike(f"%{dom}%"))
        if name == "list_site_audits":
            rows = q.order_by(Audit.created_at.desc()).limit(10).all()
            if not rows:
                return {"error": "No site audits have been run yet"
                                 + (f" for {dom}." if dom else ".")}
            return {"audits": [{"audit_id": a.audit_id, "property_url": a.property_url,
                                "status": a.status, "created_at": str(a.created_at),
                                "score": (a.summary or {}).get("score"),
                                "pages_crawled": (a.summary or {}).get("pages_crawled")}
                               for a in rows]}
        if args.get("audit_id"):
            q = q.filter(Audit.audit_id == args["audit_id"])
        a = q.order_by(Audit.created_at.desc()).first()
        if not a:
            return {"error": "That audit wasn't found."}
        # Issues can be long — keep the shape but cap example URLs so the payload stays small.
        issues = [{"type": i.get("type"), "severity": i.get("severity"),
                   "message": i.get("message"), "count": len(i.get("urls") or []),
                   "example_urls": (i.get("urls") or [])[:3]}
                  for i in (a.issues or [])][:40]
        return {"audit_id": a.audit_id, "property_url": a.property_url, "status": a.status,
                "created_at": str(a.created_at), "summary": a.summary, "issues": issues}

    if name == "get_topical_map":
        if not ctx.selected_analysis_id:
            return {"error": "No topical map is currently open. Open one from the Results page first."}
        from utils.storage import database_store
        analysis = database_store.get_analysis(ctx.db, ctx.selected_analysis_id)
        if not analysis or analysis.get("user_email") != ctx.user_email:
            return {"error": "That analysis is no longer available."}
        maps = analysis.get("topical_maps") or []
        if not maps:
            return {"error": "This analysis has no topical map yet (still processing or it failed)."}
        m = maps[0]   # primary site's map — competitor maps (if any) follow at index 1+
        strategy = m.get("content_strategy") or {}
        return {
            "url": m.get("url"), "central_entity": m.get("central_entity"),
            "business_model": m.get("business_model"), "key_topics": m.get("key_topics"),
            "core_topics": strategy.get("core_topics"), "outer_topics": strategy.get("outer_topics"),
            "content_gaps": strategy.get("content_gaps"), "bridge_topics": m.get("bridge_topics"),
            "content_plan_nodes": [
                {"title": a.get("title"), "main_entity": a.get("main_entity"),
                 "context": a.get("context"), "suggested_url": a.get("suggested_url"),
                 "section": a.get("section"), "search_volume": a.get("search_volume"),
                 "kd": a.get("kd")}
                for a in (m.get("content_articles") or [])
            ],
            "keyword_clusters": [
                {"label": c.get("label"), "total_volume": c.get("total_volume"),
                 "keywords": [k.get("keyword") for k in (c.get("keywords") or [])][:8]}
                for c in (m.get("keyword_clusters") or [])
            ],
        }

    if name == "get_tracked_rankings":
        from services import rank_tracker_service as rt
        client_id = args.get("client_id") or ctx.selected_client_id
        rows = rt.list_tracked(ctx.db, ctx.user_email, client_id)
        return {"keywords": [
            {"keyword": r["keyword"], "domain": r["domain"], "position": r["position"],
             "delta": r["delta"], "best": r["best"], "url": r.get("url"),
             "checked_on": r.get("checked_on")}
            for r in rows
        ][:150], "total": len(rows)}

    if name == "list_clustering_runs":
        from database import ClusteringRun
        from services import clustering_service as cs
        cs.sweep_stale(ctx.db, ctx.user_email)
        q = ctx.db.query(ClusteringRun).filter(ClusteringRun.user_email == ctx.user_email)
        if args.get("client_id"):
            q = q.filter(ClusteringRun.client_id == args["client_id"])
        runs = q.order_by(ClusteringRun.created_at.desc()).limit(30).all()
        return {"runs": [cs.summarize(r) for r in runs]}

    if name == "get_clustering_run":
        from database import ClusteringRun
        from services import clustering_service as cs
        run = None
        if args.get("run_id"):
            run = (ctx.db.query(ClusteringRun)
                   .filter(ClusteringRun.id == args["run_id"], ClusteringRun.user_email == ctx.user_email)
                   .first())
        elif args.get("domain"):
            q = args["domain"].strip().lower()
            run = (ctx.db.query(ClusteringRun)
                   .filter(ClusteringRun.user_email == ctx.user_email,
                           (ClusteringRun.domain.ilike(f"%{q}%")) | (ClusteringRun.name.ilike(f"%{q}%")))
                   .order_by(ClusteringRun.created_at.desc()).first())
        if not run:
            return {"error": "No matching clustering run — call list_clustering_runs to see the available ones."}
        summary = cs.summarize(run, include_result=True)
        clusters = summary.pop("clusters", [])
        summary["clusters"] = [
            {"pillar": c.get("pillar"), "total_volume": c.get("total_volume"),
             "intent": c.get("intent"), "gsc_status": c.get("gsc_status"),
             "keywords": [k.get("keyword") for k in (c.get("keywords") or [])][:8]}
            for c in clusters
        ][:40]
        return summary

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


async def _run_track_keywords(args: dict, ctx: ToolContext) -> dict:
    """Add keywords to the rank tracker (runs only after the user confirms)."""
    from services import rank_tracker_service as rts
    kws = [k for k in (args.get("keywords") or []) if str(k).strip()]
    domain = (args.get("domain") or "").strip()
    if not kws:
        return {"error": "no keywords given"}
    if not domain:
        return {"error": "no domain given — say which site these should be tracked for"}
    added = rts.add_keywords(ctx.db, ctx.user_email, ctx.selected_client_id, domain,
                             kws, args.get("gl") or "th", args.get("location_id"))
    return {"added": added, "requested": len(kws), "domain": domain,
            "message": (f"Now tracking {added} new keyword(s) for {domain}"
                        + (f" ({len(kws) - added} were already tracked)" if added < len(kws) else "")
                        + ". Positions are checked daily.")}


async def _run_start_clustering(args: dict, ctx: ToolContext) -> dict:
    """Queue a SERP-overlap clustering job (runs only after the user confirms)."""
    import asyncio as _asyncio
    import uuid as _uuid
    from database import ClusteringRun
    from services import clustering_service as cs

    keywords = cs.parse_keywords(args.get("keywords") or [])
    if len(keywords) < 2:
        return {"error": "need at least 2 keywords to cluster"}
    keywords = keywords[:cs.RUN_CAP]
    domain = (args.get("domain") or "").strip()
    run = ClusteringRun(
        id=str(_uuid.uuid4()), user_email=ctx.user_email, client_id=ctx.selected_client_id,
        name=(args.get("name") or domain or f"{len(keywords)} keywords")[:200],
        domain=domain or None, gl=(args.get("gl") or "th"),
        status="queued", progress={"done": 0, "total": len(keywords)},
        params={"keywords": keywords, "keyword_count": len(keywords),
                "min_overlap": 3, "top_n": 10, "mode": "hard",
                "discover": bool(args.get("discover")), "exclude_ranked": True,
                "gsc_property": ctx.selected_property, "account_id": ctx.account_id},
    )
    ctx.db.add(run)
    ctx.db.commit()
    _asyncio.create_task(cs.run_job(run.id))
    return {"run_id": run.id, "keyword_count": len(keywords),
            "message": (f"Started a clustering run over {len(keywords)} keywords. "
                        "It runs in the background — open the Keyword Clustering page to watch it.")}


def _confirm_summary(name: str, args: dict) -> str:
    if name == "generate_deck":
        kind = "Google Ads" if args.get("source") == "ads" else "Search Console"
        who = args.get("label") or args.get("id")
        return f"Generate a {kind} deck for {who} (last {args.get('days', 28)} days)?"
    if name == "track_keywords":
        kws = args.get("keywords") or []
        return (f"Track {len(kws)} keyword(s) for {args.get('domain', 'this site')}? "
                f"This checks their position daily (1 SerpAPI search per keyword per day).")
    if name == "start_clustering_run":
        kws = args.get("keywords") or []
        extra = " with discovery expansion" if args.get("discover") else ""
        return f"Start a clustering run over {len(kws)} keyword(s){extra}? This spends SerpAPI credits."
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
            elif name == "track_keywords":
                yield {"type": "tool", "name": name, "message": "Adding keywords to the rank tracker…"}
                result = await _run_track_keywords(args, ctx)
            elif name == "start_clustering_run":
                yield {"type": "tool", "name": name, "message": "Queueing the clustering run…"}
                result = await _run_start_clustering(args, ctx)
            else:
                result = {"error": f"Unknown action: {name}"}
        except Exception as e:  # noqa: BLE001
            logger.exception("assistant action failed")
            yield {"type": "error", "detail": f"The action failed: {e}"}
            return
        if result.get("error"):
            async for ev in _emit_text(f"I couldn't complete that: {result['error']}"):
                yield ev
        elif result.get("message"):
            async for ev in _emit_text(result["message"]):
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
        "list_clients": "Looking up your clients…",
        "get_client": "Resolving the client…",
        "gsc_overview": "Pulling the organic search overview…",
        "gsc_movers": "Finding the biggest movers…",
        "gsc_ctr_opportunities": "Looking for CTR quick wins…",
        "paid_vs_organic": "Comparing paid and organic…",
        "gsc_striking_distance": "Finding striking-distance keywords…",
        "gsc_cannibalization": "Checking keyword cannibalization…",
        "get_topical_map": "Reading the topical map…",
        "get_tracked_rankings": "Checking tracked rankings…",
        "list_clustering_runs": "Looking up clustering runs…",
        "get_clustering_run": "Reading the clustering run…",
        "list_site_audits": "Listing site audits…",
        "get_site_audit": "Reading the site audit…",
    }.get(name, f"Running {name}…")
