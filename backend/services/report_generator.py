"""AI monthly SEO report generator.

Assembles a normalized data snapshot for a client site, then has Claude write a
polished, client-facing monthly report from it. Today it draws on SE Ranking
keyword data; GSC and GA4 sections plug into `assemble_context()` the same way as
those integrations come online.
"""
from typing import Dict, Optional
import json
import logging

from services.ai_service import ai_service
from services.seranking_service import SERankingService

logger = logging.getLogger(__name__)


REPORT_SYSTEM_PROMPT = """You are a senior SEO account manager at TBS Marketing writing the monthly performance report a client will actually read.

Write in clear, confident, plain English for a busy business owner — not an SEO technician. Explain what the numbers mean for their business, not just what they are. Be honest about declines but frame them constructively with the plan to address them.

Structure the report in Markdown:
1. **Executive Summary** — 3–4 sentences: the headline story of the month.
2. **Keyword Rankings** — how visibility changed: how many keywords are on page 1 (top 10), notable climbers (name the keyword and the movement), and any that slipped. Reference real numbers from the data.
3. **Wins of the Month** — 2–4 concrete positives.
4. **Areas to Improve** — 1–3 honest opportunities.
5. **Recommended Next Steps** — 3–5 specific, actionable items for next month.

Rules:
- Use ONLY the data provided. Never invent metrics, keywords, or numbers.
- When you cite a keyword, use its real text and real position from the data.
- Keep it concise — a client should read it in 3–4 minutes.
- Do not include a code block or raw JSON. Output clean Markdown starting with an H1 title."""


async def assemble_context(site_id: int, days: int = 30) -> Dict:
    """Gather all available data for a site into one normalized dict for the AI.

    Extensible: GSC and GA4 blocks are added here as those integrations land.
    """
    svc = SERankingService()

    projects = await svc.get_projects()
    project = next((p for p in projects if p.get('id') == site_id), None)

    positions = await svc.get_keyword_positions(site_id, days)

    # Pre-digest movers so the model doesn't have to scan the full keyword list.
    kws = positions.get('keywords', [])
    rising = sorted(
        [k for k in kws if k.get('change') and k['change'] > 0],
        key=lambda k: k['change'], reverse=True
    )[:10]
    falling = sorted(
        [k for k in kws if k.get('change') and k['change'] < 0],
        key=lambda k: k['change']
    )[:10]
    top_ranked = [k for k in kws if k.get('position')][:15]

    return {
        'site': {
            'domain': project.get('domain') if project else str(site_id),
            'title': project.get('title') if project else None,
        },
        'period_days': days,
        'period': positions.get('period'),
        'seranking': {
            'summary': positions.get('summary'),
            'top_ranked_keywords': top_ranked,
            'biggest_climbers': rising,
            'biggest_drops': falling,
        },
        # 'gsc': {...},   # added in a later phase
        # 'ga4': {...},   # added in a later phase
    }


# ============================================================================
# Data → Deck bridge: turn the real SE Ranking snapshot into a branded PPTX.
# Numbers are mapped deterministically (never invented); only the prose is
# written by the LLM, with a templated fallback so it works without an API key.
# ============================================================================

DECK_NARRATIVE_SYSTEM = """You are a senior SEO account manager at TBS Marketing.
From the SE Ranking data provided, write the *prose* for a client-facing slide deck.
Use ONLY the numbers in the data — never invent metrics. Be positive but honest;
frame declines as opportunities. Return STRICT JSON only, no markdown, with keys:
{"exec_headline": str (<=8 words),
 "exec_summary": str (2-3 sentences),
 "recommendations": [{"title": str (<=4 words), "body": str (1 sentence)}],  // exactly 4
 "takeaways": [str, str, str]}"""


def _fmt_change(change) -> str:
    """SE Ranking change: positive = moved up (improved). Render as an arrow chip."""
    if change is None or change == 0:
        return "—"
    return f"▲{int(abs(change))}" if change > 0 else f"▼{int(abs(change))}"


def _fmt_pos(position) -> str:
    return str(position) if position is not None else "—"


def _period_label(period: Optional[Dict]) -> str:
    if not period:
        return ""
    start, end = period.get("start", ""), period.get("end", "")
    return f"{start} – {end}" if start and end else (end or start)


async def _deck_narrative(context: Dict) -> Dict:
    """LLM-written prose for the deck; falls back to templated text on any failure."""
    summary = context["seranking"]["summary"] or {}
    try:
        prompt = (
            "Write the deck prose from this SE Ranking data (JSON):\n\n"
            + json.dumps(context, indent=2, ensure_ascii=False)
        )
        # extract_json uses the configured Groq/DeepSeek client and parses robustly.
        data = await ai_service.extract_json(prompt, system_prompt=DECK_NARRATIVE_SYSTEM)
        if data.get("exec_summary") and data.get("recommendations"):
            return data
    except Exception as e:  # no key, parse failure, etc. — degrade gracefully
        logger.warning("Deck narrative LLM failed, using templated fallback: %s", e)

    on_page1 = (summary.get("buckets", {}).get("top3", 0)
                + summary.get("buckets", {}).get("top10", 0))
    total = summary.get("total_keywords", 0)
    return {
        "exec_headline": "Organic Visibility Update",
        "exec_summary": (
            f"This period {on_page1} of {total} tracked keywords rank on page one, "
            f"with an average position of {summary.get('avg_position', 'n/a')}. "
            f"{summary.get('improved', 0)} keywords improved while "
            f"{summary.get('declined', 0)} need attention."
        ),
        "recommendations": [
            {"title": "Push near-misses", "body": "Move page-2 keywords onto page one with targeted content and internal links."},
            {"title": "Defend winners", "body": "Keep top-ranked pages fresh to hold and improve their positions."},
            {"title": "Expand winning topics", "body": "Build supporting content around the keywords gaining ground."},
            {"title": "Review the watch list", "body": "Address declining keywords before they slip further."},
        ],
        "takeaways": [
            f"{on_page1} of {total} keywords rank on page one",
            f"Average position: {summary.get('avg_position', 'n/a')}",
            f"{summary.get('improved', 0)} keywords improved this period",
        ],
    }


async def generate_deck_data_from_context(context: Dict) -> Dict:
    """Map a real assemble_context() snapshot into normalized SEO deck data."""
    sr = context["seranking"]
    summary = sr.get("summary") or {}
    buckets = summary.get("buckets") or {}
    domain = context["site"]["domain"]
    title = context["site"].get("title") or domain

    top = sr.get("top_ranked_keywords") or []
    climbers = sr.get("biggest_climbers") or []
    drops = sr.get("biggest_drops") or []

    def _kw(k):
        return {"term": k.get("keyword", ""), "position": _fmt_pos(k.get("position")),
                "change": _fmt_change(k.get("change")), "volume": k.get("volume", 0)}

    narrative = await _deck_narrative(context)
    on_page1 = buckets.get("top3", 0) + buckets.get("top10", 0)
    hero = top[0] if top else {}

    return {
        "sample": False,
        "company": title,
        "site_label": domain,
        "report_label": "SEO Performance",
        "report_title": "SEO Performance\nReport",
        "period": _period_label(context.get("period")),
        "prepared_by": "TBS Marketing",
        "hero_kicker": "ORGANIC SEARCH",
        "hero_line": "Visibility\n& Growth",
        "exec_headline": narrative["exec_headline"],
        "exec_summary": narrative["exec_summary"],
        "kpis": [
            {"label": "Keywords Tracked", "value": str(summary.get("total_keywords", 0)), "delta": "Full set"},
            {"label": "On Page 1", "value": str(on_page1), "delta": "pos 1–10"},
            {"label": "Avg. Position", "value": str(summary.get("avg_position", "—")), "delta": "lower is better"},
            {"label": "Improved", "value": str(summary.get("improved", 0)), "delta": "this period"},
        ],
        "top_keywords": [_kw(k) for k in top[:8]],
        "hero_keyword": {
            "term": hero.get("keyword", "—"),
            "position": f"#{hero.get('position')}" if hero.get("position") is not None else "—",
            "sub": f"{hero.get('volume', 0):,} searches / mo" if hero.get("volume") else "",
            "note": "Your strongest high-volume term — a click away from the top spots.",
        },
        "climbers": [_kw(k) for k in climbers[:6]],
        "drops": [_kw(k) for k in drops[:6]],
        "recommendations": narrative["recommendations"][:4],
        "takeaways": narrative["takeaways"][:3],
        "closing_headline": "Building Momentum\nin Organic Search",
    }


async def generate_deck(site_id: int, days: int = 30) -> Dict:
    """Assemble real data, map it to deck data, and render the .pptx bytes."""
    from services.presentation_generator import build_seo_deck
    context = await assemble_context(site_id, days)
    deck_data = await generate_deck_data_from_context(context)
    pptx_bytes = build_seo_deck(deck_data)
    return {
        "site_id": site_id,
        "domain": context["site"]["domain"],
        "deck_data": deck_data,
        "pptx_bytes": pptx_bytes,
    }


SLIDESPEAK_BRAND_INSTRUCTIONS = (
    "This is a client-facing monthly SEO report from TBS Marketing. "
    "Primary brand colour is deep blue #26397A on white/light backgrounds — premium, "
    "professional B2B aesthetic, strong spacing, clean modern typography. "
    "Use ONLY the figures in the brief — never invent metrics, keywords, or numbers. "
    "Preserve keyword text exactly as written (including Thai). "
    "Be positive but honest: frame any declines as optimisation opportunities. "
    "One topic per slide, no overcrowding. Executive, confident, data-driven tone."
)


def _data_brief(context: Dict) -> str:
    """Turn the real data snapshot into a readable text brief for the AI designer."""
    sr = context["seranking"]
    summary = sr.get("summary") or {}
    buckets = summary.get("buckets") or {}
    domain = context["site"]["domain"]
    on_page1 = buckets.get("top3", 0) + buckets.get("top10", 0)

    def kw_lines(items):
        out = []
        for k in items:
            out.append(
                f"  - {k.get('keyword','')}: position {k.get('position')}, "
                f"change {k.get('change')}, volume {k.get('volume', 0)}/mo"
            )
        return "\n".join(out) if out else "  (none)"

    return f"""Monthly SEO performance report for {domain}.
Reporting period: {_period_label(context.get('period'))}.

OVERVIEW (use these exact numbers):
- Keywords tracked: {summary.get('total_keywords', 0)}
- Keywords on page 1 (positions 1-10): {on_page1}
- Average position: {summary.get('avg_position', 'n/a')}
- Keywords improved: {summary.get('improved', 0)}
- Keywords declined: {summary.get('declined', 0)}

TOP-RANKED KEYWORDS:
{kw_lines(sr.get('top_ranked_keywords') or [])}

BIGGEST CLIMBERS:
{kw_lines(sr.get('biggest_climbers') or [])}

KEYWORDS TO WATCH (declines):
{kw_lines(sr.get('biggest_drops') or [])}

Suggested structure: cover; executive summary; keyword rankings overview;
biggest movers; wins of the month; opportunities; recommended next steps; closing."""


async def generate_ai_deck(site_id: int, days: int = 30, *, length: int = 8) -> Dict:
    """AI-designed deck via SlideSpeak, built from the client's real SE Ranking data."""
    from services.slidespeak_service import SlideSpeakService
    context = await assemble_context(site_id, days)
    brief = _data_brief(context)
    svc = SlideSpeakService()
    pptx_bytes = await svc.generate_deck(
        brief,
        length=length,
        fetch_images=True,
        tone="professional",
        custom_user_instructions=SLIDESPEAK_BRAND_INSTRUCTIONS,
    )
    return {
        "site_id": site_id,
        "domain": context["site"]["domain"],
        "brief": brief,
        "pptx_bytes": pptx_bytes,
    }


# ============================================================================
# GSC (Google Search Console / "My Sites") → AI deck. Organic search data.
# ============================================================================

def _domain_from_property(property_url: str) -> str:
    if property_url.startswith("sc-domain:"):
        return property_url.split(":", 1)[1]
    try:
        from urllib.parse import urlparse
        return urlparse(property_url).netloc.replace("www.", "") or property_url
    except Exception:
        return property_url


async def assemble_gsc_context(service, property_url: str, days: int = 28) -> Dict:
    """Gather GSC search performance + top queries/pages + device/country/quick-win
    breakdowns and the time-series trend for one property. Each optional block degrades
    gracefully so one failed sub-fetch can't break the whole deck."""
    analytics = await service.get_search_analytics(property_url, days=days, group_by="daily")
    queries = await service.get_top_queries(property_url, days=days)
    pages = await service.get_top_pages(property_url, days=days)

    async def _safe(coro):
        try:
            return await coro
        except Exception as e:
            logger.warning("GSC sub-fetch failed (non-fatal): %s", e)
            return []

    devices = await _safe(service.get_devices(property_url, days=days))
    countries = await _safe(service.get_countries(property_url, days=days))
    striking = await _safe(service.get_striking_distance(property_url, days=days))

    return {
        "property_url": property_url,
        "domain": _domain_from_property(property_url),
        "days": days,
        "analytics": analytics,
        "trend": (analytics or {}).get("chart_data") or [],
        "top_queries": queries[:15],
        "top_pages": pages[:10],
        "devices": devices,
        "top_countries": countries[:8],
        "striking_distance": striking[:12],
    }


def _gsc_data_brief(ctx: Dict) -> str:
    a = ctx.get("analytics") or {}
    totals = a.get("totals") or {}
    deltas = a.get("deltas") or {}

    def _d(v, suffix="%"):
        return "n/a" if v is None else f"{v:+}{suffix}"

    q_lines = "\n".join(
        f"  - \"{q.get('query','')}\": {q.get('clicks',0)} clicks, "
        f"{q.get('impressions',0)} impressions, {q.get('ctr',0)}% CTR, pos {q.get('position','?')}"
        for q in ctx.get("top_queries", [])
    ) or "  (none)"
    p_lines = "\n".join(
        f"  - {p.get('url','')}: {p.get('clicks',0)} clicks, "
        f"{p.get('impressions',0)} impressions, {p.get('ctr',0)}% CTR, pos {p.get('position','?')}"
        for p in ctx.get("top_pages", [])
    ) or "  (none)"
    trend_lines = "\n".join(
        f"  - {t.get('month','')}: {t.get('clicks',0)} clicks, {t.get('impressions',0)} impressions"
        for t in ctx.get("trend", [])
    ) or "  (none)"
    dev_lines = "\n".join(
        f"  - {d.get('name','')}: {d.get('clicks',0)} clicks, {d.get('impressions',0)} impressions, "
        f"{d.get('ctr',0)}% CTR, pos {d.get('position','?')}"
        for d in ctx.get("devices", [])
    ) or "  (none)"
    sd_lines = "\n".join(
        f"  - \"{s.get('query','')}\" at pos {s.get('position','?')} ({s.get('impressions',0)} impressions, "
        f"~{s.get('potential_clicks',0)} extra clicks if pushed to top 3) — {s.get('page','')}"
        for s in ctx.get("striking_distance", [])
    ) or "  (none)"
    country_lines = "\n".join(
        f"  - {c.get('name','')}: {c.get('clicks',0)} clicks, {c.get('impressions',0)} impressions"
        for c in ctx.get("top_countries", [])
    ) or "  (none)"

    return f"""Organic search (Google Search Console) report for {ctx['domain']}.
Reporting window: last {ctx['days']} days, compared with the previous {ctx['days']} days.

OVERALL SEARCH PERFORMANCE (current value, change vs previous period):
- Clicks: {totals.get('clicks', 0)} ({_d(deltas.get('clicks'))})
- Impressions: {totals.get('impressions', 0)} ({_d(deltas.get('impressions'))})
- CTR: {totals.get('ctr', 0)}% ({_d(deltas.get('ctr'), 'pp')})
- Average position: {totals.get('position', 0)} ({_d(deltas.get('position'), 'pp')}; lower is better)

PERFORMANCE OVER TIME (daily; use for a trend line/area chart):
{trend_lines}

TOP QUERIES (by clicks):
{q_lines}

NEAR PAGE 1 — QUICK-WIN KEYWORDS (positions 4-20, ranked by impressions):
{sd_lines}

TOP PAGES (by clicks):
{p_lines}

BY DEVICE:
{dev_lines}

TOP COUNTRIES (by clicks):
{country_lines}

Use only these numbers. Positive but honest framing; declines = opportunities."""


async def generate_ai_gsc_deck(service, property_url: str, days: int = 28, *,
                               provider: str = "deepseek", prompt: Optional[str] = None,
                               images: bool = True, notes: str = "") -> Dict:
    """AI-designed organic-search deck for a GSC property (from My Sites), using the
    chosen prompt + provider. Returns the HTML only — the file is rendered on download."""
    from services.ai_deck_service import (generate_deck_html, resolve_ai_images,
                                          _AI_IMG_RE, GSC_STRUCTURE, UNIQUE_STYLE_BRAND)
    from services.highlights import to_brief_block
    context = await assemble_gsc_context(service, property_url, days)
    brief = _gsc_data_brief(context) + to_brief_block(notes)
    html = await generate_deck_html(brief, prompt=prompt, brand=UNIQUE_STYLE_BRAND,
                                    structure=GSC_STRUCTURE, provider=provider)
    html = await resolve_ai_images(html) if images else _AI_IMG_RE.sub("", html)
    return {
        "property_url": property_url,
        "domain": context["domain"],
        "html": html,
    }


async def generate_ai_html_deck(
    site_id: int,
    days: int = 30,
    *,
    fmt: str = "pdf",
    prompt: Optional[str] = None,
    brand: Optional[str] = None,
    structure: Optional[str] = None,
) -> Dict:
    """Free AI-designed deck: LLM writes unique HTML from the real data + an
    editable prompt, then Chromium renders it to the chosen format (pdf|pptx)."""
    from services.ai_deck_service import generate_deck_html, render_deck
    context = await assemble_context(site_id, days)
    brief = _data_brief(context)
    html = await generate_deck_html(brief, prompt=prompt, brand=brand, structure=structure)
    file_bytes = await render_deck(html, fmt=fmt)
    return {
        "site_id": site_id,
        "domain": context["site"]["domain"],
        "format": fmt,
        "html": html,           # kept for preview / debugging
        "file_bytes": file_bytes,
    }


async def generate_monthly_report(site_id: int, days: int = 30) -> Dict:
    """Assemble the data snapshot and generate the client-facing report markdown."""
    context = await assemble_context(site_id, days)

    domain = context['site']['domain']
    prompt = f"""Write the monthly SEO report for **{domain}** covering the last {context['period_days']} days.

Here is the data to base the report on (JSON):

{json.dumps(context, indent=2, ensure_ascii=False)}

Write the full report now, following the structure and rules in your instructions."""

    markdown = await ai_service.analyze_with_anthropic(
        prompt=prompt,
        system_prompt=REPORT_SYSTEM_PROMPT,
    )

    return {
        'site_id': site_id,
        'domain': domain,
        'period': context.get('period'),
        'context': context,        # the raw data the report was built from (for transparency)
        'report_markdown': markdown,
    }
