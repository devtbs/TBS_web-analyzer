"""AI monthly SEO report generator.

Assembles a normalized data snapshot for a client site, then has Claude write a
polished, client-facing monthly report from it. Today it draws on SE Ranking
keyword data; GSC and GA4 sections plug into `assemble_context()` the same way as
those integrations come online.
"""
from typing import Dict, Optional
from datetime import datetime, timedelta
import json
import logging

from services.ai_service import ai_service
from services.seranking_service import SERankingService

logger = logging.getLogger(__name__)


def _gsc_period(days: int) -> Dict[str, str]:
    """The actual calendar range a GSC `days` window covers, matching the lag the
    GSC service applies (data lands ~3 days late). Returns ISO bounds + a human label
    like '1 – 28 May 2026' for the report cover."""
    from services.gsc_service import GSC_DATA_LAG_DAYS
    end = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
    start = end - timedelta(days=days)

    def _fmt(d):
        return f"{d.day} {d.strftime('%b %Y')}"

    if start.year == end.year and start.month == end.month:
        label = f"{start.day}–{end.day} {end.strftime('%b %Y')}"
    elif start.year == end.year:
        label = f"{start.day} {start.strftime('%b')} – {end.day} {end.strftime('%b %Y')}"
    else:
        label = f"{_fmt(start)} – {_fmt(end)}"
    return {"start": start.isoformat(), "end": end.isoformat(), "label": label}


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
        "period": _gsc_period(days),
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

    period = ctx.get("period") or {}
    period_label = period.get("label", f"last {ctx['days']} days")
    return f"""Organic search (Google Search Console) report for {ctx['domain']}.
Reporting period: {period_label} (last {ctx['days']} days, compared with the previous {ctx['days']} days).
On the COVER slide, show this reporting period ({period_label}) as the subtitle.

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
                               images: bool = True, notes: str = "", on_progress=None) -> Dict:
    """AI-designed organic-search deck for a GSC property (from My Sites), using the
    chosen prompt + provider. Returns the HTML only — the file is rendered on download."""
    from services.ai_deck_service import (generate_deck_html, resolve_ai_images, resolve_ai_icons,
                                          _AI_IMG_RE, GSC_STRUCTURE, UNIQUE_STYLE_BRAND)
    from services.highlights import to_brief_block
    if on_progress:
        await on_progress("Gathering Search Console data…")
    context = await assemble_gsc_context(service, property_url, days)
    brief = _gsc_data_brief(context) + to_brief_block(notes)
    # Shared cache lets image generation start (during the streamed write) and finish
    # concurrently with slide-writing instead of serially afterward.
    image_cache = {} if images else None
    html = await generate_deck_html(brief, prompt=prompt, brand=UNIQUE_STYLE_BRAND,
                                    structure=GSC_STRUCTURE, provider=provider,
                                    on_progress=on_progress, image_cache=image_cache)
    html = (await resolve_ai_images(html, on_progress=on_progress, image_cache=image_cache)
            if images else _AI_IMG_RE.sub("", html))
    html = resolve_ai_icons(html)
    return {
        "property_url": property_url,
        "domain": context["domain"],
        "html": html,
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
