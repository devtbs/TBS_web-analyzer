"""AI monthly SEO report generator.

Assembles a normalized data snapshot for a client site, then has Claude write a
polished, client-facing monthly report from it. Today it draws on SE Ranking
keyword data; GSC and GA4 sections plug into `assemble_context()` the same way as
those integrations come online.
"""
from typing import Dict, List, Optional
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


def _keyword_mix(queries: List[Dict]) -> Dict:
    """Grounded 'Unique Keywords' summary from the queries GSC actually returned: the
    distinct-query count plus how those keywords' average rank is distributed across
    positions 1-3 / 4-10 / 11+. Position-based (not word-count) so it's language-neutral —
    a word-count 'long-tail' split is meaningless for spaceless scripts like Thai/CJK."""
    seen = set()
    top3 = mid = low = 0
    for q in queries:
        text = (q.get("query") or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        pos = q.get("position") or 0
        if pos and pos <= 3:
            top3 += 1
        elif pos and pos <= 10:
            mid += 1
        else:
            low += 1
    return {"unique": len(seen), "top3": top3, "mid": mid, "low": low}


async def assemble_gsc_context(service, property_url: str, days: int = 28, *,
                               ga4_service=None) -> Dict:
    """Gather GSC search performance + top queries/pages + device/country/quick-win
    breakdowns and the time-series trend for one property. Each optional block degrades
    gracefully so one failed sub-fetch can't break the whole deck.

    If `ga4_service` is provided, the country map prefers real GA4 sessions (matched to the
    site's GA4 property); otherwise it falls back to GSC organic clicks by country."""
    analytics = await service.get_search_analytics(property_url, days=days, group_by="daily")
    queries = await service.get_top_queries(property_url, days=days)
    pages = await service.get_top_pages(property_url, days=days)
    domain = _domain_from_property(property_url)

    async def _safe(coro):
        try:
            return await coro
        except Exception as e:
            logger.warning("GSC sub-fetch failed (non-fatal): %s", e)
            return []

    devices = await _safe(service.get_devices(property_url, days=days))
    countries = await _safe(service.get_countries(property_url, days=days))
    striking = await _safe(service.get_striking_distance(property_url, days=days))
    search_types = await _safe(service.get_search_types(property_url, days=days))
    search_appearance = await _safe(service.get_search_appearance(property_url, days=days))
    ctr_opps = await _safe(service.get_ctr_opportunities(property_url, days=days))
    # 12-month combo + per-query movers/footprint history. Both heavier — kept optional.
    monthly = await _safe(service.get_search_analytics(property_url, days=365, group_by="monthly"))
    insights = await _safe(service.get_query_insights(property_url, days=days, history_months=12))

    # GA4 enrichment: match this domain to its GA4 property ONCE, then pull both the
    # sessions-by-country map and the full analytics overview (audience/engagement, daily
    # trend, traffic-by-channel). Everything here is non-fatal — a site with no matching
    # GA4 property just yields a Search-Console-only deck (geo falls back to GSC clicks).
    geo = {"mode": "clicks", "rows": (countries or [])[:20]}
    ga4 = None
    if ga4_service is not None:
        try:
            prop = await ga4_service.find_property_for_domain(domain)
            if prop and prop.get("property_id"):
                pid = prop["property_id"]
                rows = await _safe(ga4_service.get_geo(pid, days))
                if rows:
                    geo = {"mode": "sessions", "rows": rows}
                try:
                    overview = await ga4_service.get_overview(pid, days=days)
                    period = overview.get("period") or {}
                    ga4 = {
                        "name": prop.get("display") or domain,
                        "period_label": _human_period(period.get("start", ""), period.get("end", "")),
                        "totals": overview.get("totals") or {},
                        "deltas": overview.get("deltas") or {},
                        "trend": overview.get("chart_data") or [],
                        "channels": overview.get("channels") or [],
                    }
                except Exception as e:
                    logger.warning("GA4 overview fetch failed (non-fatal): %s", e)
        except Exception as e:
            logger.warning("GA4 property match failed (non-fatal): %s", e)

    return {
        "property_url": property_url,
        "domain": domain,
        "days": days,
        "period": _gsc_period(days),
        "analytics": analytics,
        "trend": (analytics or {}).get("chart_data") or [],
        "monthly_trend": (monthly or {}).get("chart_data") or [],
        "top_queries": queries[:15],
        "bubble_queries": sorted(queries, key=lambda q: q.get("impressions", 0), reverse=True)[:30],
        "keyword_mix": _keyword_mix(queries),
        "query_insights": insights or {},
        "top_pages": pages[:10],
        "devices": devices,
        "search_types": search_types,
        "search_appearance": (search_appearance or [])[:8],
        "ctr_opportunities": (ctr_opps or [])[:12],
        "top_countries": countries[:8],
        "striking_distance": striking[:12],
        "geo": geo,
        "ga4": ga4,
    }


def _ga4_brief_sections(ga4: Dict) -> str:
    """GA4 analytics sections for the combined Monthly Report brief (audience/engagement,
    sessions trend, traffic by channel). Geography is already covered by the GSC GEOGRAPHY
    block, which prefers GA4 sessions when the property is matched."""
    t = ga4.get("totals") or {}
    d = ga4.get("deltas") or {}

    def _delta(v, suffix="%"):
        return "n/a" if v is None else f"{v:+}{suffix}"

    trend_lines = "\n".join(
        f"  - {row.get('name','')}: {row.get('sessions',0)} sessions, "
        f"{row.get('users',0)} users, {row.get('conversions',0)} conversions"
        for row in ga4.get("trend", [])
    ) or "  (none)"
    channel_lines = "\n".join(
        f"  - {c.get('channel','')}: {c.get('sessions',0)} sessions, "
        f"{c.get('users',0)} users, {c.get('conversions',0)} conversions"
        for c in ga4.get("channels", [])
    ) or "  (none)"
    return f"""WEBSITE ANALYTICS (Google Analytics / GA4) — on-site behaviour for the same site and period.

AUDIENCE & ENGAGEMENT (current value, change vs previous period):
- Sessions: {t.get('sessions', 0)} ({_delta(d.get('sessions'))})
- Total users: {t.get('users', 0)} ({_delta(d.get('users'))})
- New users: {t.get('new_users', 0)} ({_delta(d.get('new_users'))})
- Pageviews: {t.get('pageviews', 0)} ({_delta(d.get('pageviews'))})
- Engagement rate: {t.get('engagement_rate', 0)}% ({_delta(d.get('engagement_rate'), 'pp')})
- Bounce rate: {t.get('bounce_rate', 0)}% ({_delta(d.get('bounce_rate'), 'pp')}; lower is better)
- Avg session duration: {t.get('avg_session_duration', 0)}s ({_delta(d.get('avg_session_duration'))})
- Conversions: {t.get('conversions', 0)} ({_delta(d.get('conversions'))})

SESSIONS OVER TIME (daily; use for a sessions/users/conversions trend chart):
{trend_lines}

TRAFFIC BY CHANNEL (by sessions — organic, direct, paid, referral, social, etc.):
{channel_lines}"""


def _gsc_data_brief(ctx: Dict) -> str:
    a = ctx.get("analytics") or {}
    totals = a.get("totals") or {}
    deltas = a.get("deltas") or {}
    km = ctx.get("keyword_mix") or {}

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
    stype_lines = "\n".join(
        f"  - {s.get('name','')}: {s.get('clicks',0)} clicks, {s.get('impressions',0)} impressions, "
        f"{s.get('ctr',0)}% CTR, pos {s.get('position','?')}"
        for s in ctx.get("search_types", [])
    ) or "  (none)"
    appearance_lines = "\n".join(
        f"  - {s.get('name','')}: {s.get('clicks',0)} clicks, {s.get('impressions',0)} impressions, "
        f"{s.get('ctr',0)}% CTR, pos {s.get('position','?')}"
        for s in ctx.get("search_appearance", [])
    ) or "  (none)"
    ctr_opp_lines = "\n".join(
        f"  - \"{o.get('query','')}\" at pos {o.get('position','?')}: {o.get('impressions',0)} impressions, "
        f"{o.get('actual_ctr','?')}% actual CTR vs {o.get('expected_ctr','?')}% expected "
        f"(~{o.get('missed_clicks',0)} missed clicks)"
        for o in ctx.get("ctr_opportunities", [])
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

    # ── 12-month combo (clicks/impressions bars + avg-position line) ──
    monthly_lines = "\n".join(
        f"  - {m.get('month','')}: {m.get('clicks',0)} clicks, {m.get('impressions',0)} impressions, "
        f"avg pos {m.get('position','?')}"
        for m in ctx.get("monthly_trend", [])
    ) or "  (none)"

    # ── Keyword position vs impressions (bubble) ──
    bubble_lines = "\n".join(
        f"  - \"{q.get('query','')}\": pos {q.get('position','?')}, {q.get('impressions',0)} impressions, "
        f"{q.get('clicks',0)} clicks"
        for q in ctx.get("bubble_queries", [])
    ) or "  (none)"

    # ── Biggest movers (queries) from query_insights: clicks + position deltas ──
    qi = (ctx.get("query_insights") or {}).get("queries") or []

    def _clk_delta(q):
        return q.get("clicks", 0) - q.get("prev_clicks", 0)

    def _pos_delta(q):  # + = improved (a lower position number is better)
        pp = q.get("prev_position") or 0
        return round(pp - q.get("position", 0), 1) if pp else 0

    movers_clk = [q for q in qi if q.get("prev_clicks")]
    risers_c = [q for q in sorted(movers_clk, key=_clk_delta, reverse=True) if _clk_delta(q) > 0][:8]
    fallers_c = [q for q in sorted(movers_clk, key=_clk_delta) if _clk_delta(q) < 0][:8]
    movers_pos = [q for q in qi if q.get("prev_position")]
    risers_p = [q for q in sorted(movers_pos, key=_pos_delta, reverse=True) if _pos_delta(q) > 0][:8]
    fallers_p = [q for q in sorted(movers_pos, key=_pos_delta) if _pos_delta(q) < 0][:8]

    def _mv_clk(rows):
        return "\n".join(
            f"  - \"{q.get('query','')}\": {q.get('prev_clicks',0)} → {q.get('clicks',0)} clicks ({_clk_delta(q):+})"
            for q in rows) or "  (none)"

    def _mv_pos(rows):
        return "\n".join(
            f"  - \"{q.get('query','')}\": pos {q.get('prev_position','?')} → {q.get('position','?')} ({_pos_delta(q):+})"
            for q in rows) or "  (none)"

    # ── Biggest movers (pages) by clicks delta (a percentage) ──
    pages_ctx = ctx.get("top_pages", [])
    page_risers = [p for p in sorted(pages_ctx, key=lambda p: p.get("clicks_delta") or 0, reverse=True)
                   if (p.get("clicks_delta") or 0) > 0][:6]
    page_fallers = [p for p in sorted(pages_ctx, key=lambda p: p.get("clicks_delta") or 0)
                    if (p.get("clicks_delta") or 0) < 0][:6]

    def _mv_page(rows):
        return "\n".join(
            f"  - {p.get('url','')}: {p.get('clicks',0)} clicks ({(p.get('clicks_delta') or 0):+}% vs prev)"
            for p in rows) or "  (none)"

    # ── Query footprint per month (counts; approximate — bounded to current queries) ──
    months = (ctx.get("query_insights") or {}).get("months") or []
    foot = {m: {"total": 0, "p13": 0, "p410": 0} for m in months}
    for q in qi:
        for cell in q.get("monthly", []):
            mo = cell.get("month")
            if mo not in foot or (cell.get("impressions") or 0) <= 0:
                continue
            foot[mo]["total"] += 1
            pos = cell.get("position")
            if pos is not None and pos <= 3:
                foot[mo]["p13"] += 1
            elif pos is not None and pos <= 10:
                foot[mo]["p410"] += 1
    foot_lines = "\n".join(
        f"  - {m}: {foot[m]['total']} queries total, {foot[m]['p13']} in pos 1-3, {foot[m]['p410']} in pos 4-10"
        for m in months) or "  (none)"

    # ── Geography (choropleth source): real GA4 sessions when matched, else GSC clicks ──
    geo = ctx.get("geo") or {}
    if geo.get("mode") == "sessions":
        geo_metric = "SESSIONS"
        geo_note = ("Country values are full English names — render a Plotly choropleth with "
                    "\"locationmode\":\"country names\", shaded by sessions.")
        geo_lines = "\n".join(
            f"  - {r.get('country','')}: {r.get('sessions',0)} sessions, {r.get('users',0)} users"
            for r in geo.get("rows", [])) or "  (none)"
    else:
        geo_metric = "ORGANIC CLICKS"
        geo_note = ("Country codes are ISO-3 (e.g. 'tha','sgp','usa') — render a Plotly choropleth "
                    "with \"locationmode\":\"ISO-3\" (uppercase the codes), shaded by clicks.")
        geo_lines = "\n".join(
            f"  - {r.get('name','')}: {r.get('clicks',0)} clicks, {r.get('impressions',0)} impressions"
            for r in geo.get("rows", [])) or "  (none)"

    period = ctx.get("period") or {}
    period_label = period.get("label", f"last {ctx['days']} days")
    ga4 = ctx.get("ga4") or None
    ga4_block = ("\n\n" + _ga4_brief_sections(ga4)) if ga4 else ""
    intro = (
        f"Monthly performance report (Google Search Console + Google Analytics) for {ctx['domain']}. "
        "It combines organic SEARCH data with website ANALYTICS (sessions, engagement, channels)."
        if ga4 else
        f"Organic search (Google Search Console) report for {ctx['domain']}."
    )
    return f"""{intro}
Reporting period: {period_label} (last {ctx['days']} days, compared with the previous {ctx['days']} days).
On the COVER slide, show this reporting period ({period_label}) as the subtitle.

OVERALL SEARCH PERFORMANCE (current value, change vs previous period):
- Clicks: {totals.get('clicks', 0)} ({_d(deltas.get('clicks'))})
- Impressions: {totals.get('impressions', 0)} ({_d(deltas.get('impressions'))})
- CTR: {totals.get('ctr', 0)}% ({_d(deltas.get('ctr'), 'pp')})
- Average position: {totals.get('position', 0)} ({_d(deltas.get('position'), 'pp')}; lower is better)

PERFORMANCE OVER TIME (daily; use for the daily impressions & URL-clicks area charts):
{trend_lines}

MONTHLY PERFORMANCE (last 12 months; use for the clicks+impressions bar + avg-position line combo chart):
{monthly_lines}

TOP QUERIES (by clicks):
{q_lines}

KEYWORD POSITION vs IMPRESSIONS (top queries; use for a bubble/scatter chart — x = avg position, y = impressions, bubble size ∝ impressions):
{bubble_lines}

KEYWORD MIX (distinct queries tracked this period + how their average rank is distributed; use for a "Unique Keywords" metric + a ranking-distribution donut):
- Unique keywords (distinct queries): {km.get('unique', 0)}
- In positions 1-3 (page-1 top): {km.get('top3', 0)}
- In positions 4-10 (page-1 lower): {km.get('mid', 0)}
- In positions 11+ (page 2+): {km.get('low', 0)}

NEAR PAGE 1 — QUICK-WIN KEYWORDS (positions 4-20, ranked by impressions):
{sd_lines}

BIGGEST MOVERS — QUERIES, BY CLICKS (rising; previous → current):
{_mv_clk(risers_c)}
BIGGEST MOVERS — QUERIES, BY CLICKS (falling; previous → current):
{_mv_clk(fallers_c)}
BIGGEST MOVERS — QUERIES, BY POSITION (improved; Δ is positive when rank gets better):
{_mv_pos(risers_p)}
BIGGEST MOVERS — QUERIES, BY POSITION (declined):
{_mv_pos(fallers_p)}

BIGGEST MOVERS — LANDING PAGES (rising by clicks):
{_mv_page(page_risers)}
BIGGEST MOVERS — LANDING PAGES (falling by clicks):
{_mv_page(page_fallers)}

QUERY FOOTPRINT (per month; use for a stacked bar of top-10 query counts [pos 1-3 + pos 4-10] with a total-queries line):
{foot_lines}

TOP PAGES (by clicks):
{p_lines}

BY DEVICE:
{dev_lines}

BY SEARCH TYPE (web/image/video/news; use for a search-surface breakdown chart — OMIT the slide if only 'web' is present or this is (none)):
{stype_lines}

SEARCH APPEARANCE (rich-result types — FAQ, product snippets, etc.; clicks/impressions/CTR/position. OMIT the slide entirely if this is (none)):
{appearance_lines}

CTR OPPORTUNITIES (high-impression queries whose CTR is below expected for their rank; use for a quick-CTR-wins slide — actual vs expected CTR, ranked by missed clicks. OMIT the slide if (none)):
{ctr_opp_lines}

TOP COUNTRIES (by clicks):
{country_lines}

GEOGRAPHY — {geo_metric} BY COUNTRY (use for a choropleth world map + a top-countries bar). {geo_note}
{geo_lines}{ga4_block}

Use only these numbers. Positive but honest framing; declines = opportunities."""


async def generate_ai_gsc_deck(service, property_url: str, days: int = 28, *,
                               provider: str = "deepseek", prompt: Optional[str] = None,
                               images: bool = True, notes: str = "", on_progress=None,
                               ga4_service=None) -> Dict:
    """AI-designed organic-search deck for a GSC property (from My Sites), using the
    chosen prompt + provider. Returns the HTML only — the file is rendered on download.

    If `ga4_service` is given, the country map uses real GA4 sessions matched to the site's
    GA4 property (falling back to GSC clicks-by-country when there's no match)."""
    from services.ai_deck_service import (generate_deck_html, resolve_ai_images, resolve_ai_icons,
                                          _AI_IMG_RE, GSC_STRUCTURE, UNIQUE_STYLE_BRAND, _apply_theme)
    from services.site_theme import detect_site_accent
    from services.highlights import to_brief_block
    if on_progress:
        await on_progress("Gathering Search Console data…")
    context = await assemble_gsc_context(service, property_url, days, ga4_service=ga4_service)
    brief = _gsc_data_brief(context) + to_brief_block(notes)
    # Theme the deck to the site's own brand colour (not always orange).
    theme = await detect_site_accent(context["domain"])
    brand = UNIQUE_STYLE_BRAND + (
        f"\n\nREQUIRED BRAND ACCENT: build the palette around {theme['accent']} as --accent and "
        f"{theme['accent2']} as --accent-2, on a warm cream/ivory ground with dark ink. Do NOT default to "
        f"terracotta/orange unless that brand colour is itself orange."
    )
    # Shared cache lets image generation start (during the streamed write) and finish
    # concurrently with slide-writing instead of serially afterward.
    image_cache = {} if images else None
    html = await generate_deck_html(brief, prompt=prompt, brand=brand,
                                    structure=GSC_STRUCTURE, provider=provider,
                                    on_progress=on_progress, image_cache=image_cache,
                                    seed=context["domain"])
    html = (await resolve_ai_images(html, on_progress=on_progress, image_cache=image_cache)
            if images else _AI_IMG_RE.sub("", html))
    html = resolve_ai_icons(html)
    # Deterministically force the site theme regardless of what the model emitted.
    html = _apply_theme(html, theme["accent"], theme["accent2"])
    return {
        "property_url": property_url,
        "domain": context["domain"],
        "html": html,
    }


# ============================================================================
# GA4 (Google Analytics) → AI deck. Website analytics / on-site behaviour only.
# ============================================================================

async def assemble_ga4_context(service, property_id: str, days: int = 28, *,
                               label: str = "") -> Dict:
    """Gather GA4 overview (audience/engagement, sessions trend, channels), device split
    and sessions-by-country for one property. Each optional block degrades gracefully."""
    async def _safe(coro, default):
        try:
            return await coro
        except Exception as e:
            logger.warning("GA4 sub-fetch failed (non-fatal): %s", e)
            return default

    overview = await service.get_overview(property_id, days=days)
    devices = await _safe(service.get_devices(property_id, days=days), [])
    geo = await _safe(service.get_geo(property_id, days=days), [])
    period = overview.get("period") or {}
    return {
        "property_id": property_id,
        "name": label or f"Property {property_id}",
        "days": days,
        "period_label": _human_period(period.get("start", ""), period.get("end", "")),
        "totals": overview.get("totals") or {},
        "deltas": overview.get("deltas") or {},
        "trend": overview.get("chart_data") or [],
        "channels": overview.get("channels") or [],
        "devices": devices,
        "geo": geo,
    }


def _ga4_data_brief(ctx: Dict) -> str:
    """Client-facing brief for a GA4-only deck: reuses the shared audience/engagement,
    sessions-trend and channel sections, plus device and geography breakdowns."""
    device_lines = "\n".join(
        f"  - {d.get('device','')}: {d.get('sessions',0)} sessions "
        f"({d.get('session_share_pct',0)}% share)"
        for d in ctx.get("devices", [])
    ) or "  (none)"
    geo_lines = "\n".join(
        f"  - {r.get('country','')}: {r.get('sessions',0)} sessions, {r.get('users',0)} users"
        for r in ctx.get("geo", [])
    ) or "  (none)"

    period_label = ctx.get("period_label") or f"last {ctx['days']} days"
    core = _ga4_brief_sections(ctx)
    return f"""Website analytics (Google Analytics / GA4) report for {ctx['name']}.
Reporting period: {period_label} (last {ctx['days']} days, compared with the previous {ctx['days']} days).
On the COVER slide, show this reporting period ({period_label}) as the subtitle.

{core}

BY DEVICE (sessions by device category):
{device_lines}

GEOGRAPHY — SESSIONS BY COUNTRY (use for a choropleth world map + a top-countries bar).
Country values are full English names — render a Plotly choropleth with "locationmode":"country names", shaded by sessions.
{geo_lines}

Use only these numbers. Positive but honest framing; declines = opportunities."""


async def generate_ai_ga4_deck(service, property_id: str, days: int = 28, *,
                               label: str = "", provider: str = "deepseek",
                               prompt: Optional[str] = None, images: bool = True,
                               notes: str = "", on_progress=None) -> Dict:
    """AI-designed website-analytics deck for a GA4 property. Returns the HTML only —
    the file is rendered on download. `label` is the property display name (for the cover)."""
    from services.ai_deck_service import (generate_deck_html, resolve_ai_images, resolve_ai_icons,
                                          _AI_IMG_RE, GA4_STRUCTURE, UNIQUE_STYLE_BRAND)
    from services.highlights import to_brief_block
    if on_progress:
        await on_progress("Gathering Google Analytics data…")
    context = await assemble_ga4_context(service, property_id, days, label=label)
    name = context["name"]
    brief = _ga4_data_brief(context) + to_brief_block(notes)
    image_cache = {} if images else None
    html = await generate_deck_html(brief, prompt=prompt, brand=UNIQUE_STYLE_BRAND,
                                    structure=GA4_STRUCTURE, provider=provider,
                                    on_progress=on_progress, image_cache=image_cache,
                                    seed=name)
    html = (await resolve_ai_images(html, on_progress=on_progress, image_cache=image_cache)
            if images else _AI_IMG_RE.sub("", html))
    html = resolve_ai_icons(html)
    return {"property_id": property_id, "domain": name, "html": html}


# ============================================================================
# Shared helpers for GA4/Ads period formatting.
# ============================================================================

def _human_period(start_iso: str, end_iso: str) -> str:
    """Turn an ISO start/end pair (as returned by GA4/Ads get_overview) into a human
    label like '1 – 28 May 2026' for the deck cover. Mirrors `_gsc_period`'s formatting."""
    try:
        start = datetime.strptime(start_iso, "%Y-%m-%d").date()
        end = datetime.strptime(end_iso, "%Y-%m-%d").date()
    except Exception:
        return f"{start_iso} – {end_iso}"

    def _fmt(d):
        return f"{d.day} {d.strftime('%b %Y')}"

    if start.year == end.year and start.month == end.month:
        return f"{start.day}–{end.day} {end.strftime('%b %Y')}"
    if start.year == end.year:
        return f"{start.day} {start.strftime('%b')} – {end.day} {end.strftime('%b %Y')}"
    return f"{_fmt(start)} – {_fmt(end)}"


# ============================================================================
# Google Ads → AI deck. Paid-campaign performance data.
# ============================================================================

async def assemble_ads_context(service, customer_id: str, days: int = 28) -> Dict:
    """Gather Google Ads headline metrics + daily trend + top campaigns for one account."""
    overview = await service.get_overview(customer_id, days=days)
    period = overview.get("period") or {}
    return {
        "customer_id": customer_id,
        "days": days,
        "currency": overview.get("currency") or "",
        "period_label": _human_period(period.get("start", ""), period.get("end", "")),
        "totals": overview.get("totals") or {},
        "deltas": overview.get("deltas") or {},
        "trend": overview.get("chart_data") or [],
        "campaigns": overview.get("campaigns") or [],
    }


def _ads_data_brief(ctx: Dict, label: str) -> str:
    t = ctx.get("totals") or {}
    d = ctx.get("deltas") or {}
    cur = ctx.get("currency") or ""
    cur_sfx = f" {cur}" if cur else ""

    def _delta(v, suffix="%"):
        return "n/a" if v is None else f"{v:+}{suffix}"

    trend_lines = "\n".join(
        f"  - {row.get('name','')}: {row.get('clicks',0)} clicks, "
        f"{row.get('cost',0)}{cur_sfx} cost, {row.get('conversions',0)} conversions"
        for row in ctx.get("trend", [])
    ) or "  (none)"
    campaign_lines = "\n".join(
        f"  - {c.get('name','')} ({c.get('status','')}): {c.get('impressions',0)} impressions, "
        f"{c.get('clicks',0)} clicks, {c.get('cost',0)}{cur_sfx} cost, {c.get('conversions',0)} conversions"
        for c in ctx.get("campaigns", [])
    ) or "  (none)"

    period_label = ctx.get("period_label") or f"last {ctx['days']} days"
    return f"""Paid search (Google Ads) report for {label}. All costs are in {cur or 'the account currency'}.
Reporting period: {period_label} (last {ctx['days']} days, compared with the previous {ctx['days']} days).
On the COVER slide, show this reporting period ({period_label}) as the subtitle.

ACCOUNT PERFORMANCE (current value, change vs previous period):
- Impressions: {t.get('impressions', 0)} ({_delta(d.get('impressions'))})
- Clicks: {t.get('clicks', 0)} ({_delta(d.get('clicks'))})
- CTR: {t.get('ctr', 0)}% ({_delta(d.get('ctr'), 'pp')})
- Avg CPC: {t.get('avg_cpc', 0)}{cur_sfx} ({_delta(d.get('avg_cpc'))})
- Cost: {t.get('cost', 0)}{cur_sfx} ({_delta(d.get('cost'))})
- Conversions: {t.get('conversions', 0)} ({_delta(d.get('conversions'))})
- Conversion rate: {t.get('conversion_rate', 0)}% ({_delta(d.get('conversion_rate'), 'pp')})
- Cost per conversion: {t.get('cost_per_conversion', 0)}{cur_sfx} ({_delta(d.get('cost_per_conversion'))}; lower is better)

PERFORMANCE OVER TIME (daily; use for a trend line/area chart):
{trend_lines}

TOP CAMPAIGNS (by cost):
{campaign_lines}

Use only these numbers. Positive but honest framing; declines = opportunities."""


async def generate_ai_ads_deck(service, customer_id: str, days: int = 28, *,
                               label: str = "", provider: str = "deepseek",
                               prompt: Optional[str] = None, images: bool = True,
                               notes: str = "", on_progress=None) -> Dict:
    """AI-designed paid-search deck for a Google Ads account. Returns the HTML only —
    the file is rendered on download. `label` is the account display name (for the cover)."""
    from services.ai_deck_service import (generate_deck_html, resolve_ai_images, resolve_ai_icons,
                                          _AI_IMG_RE, GOOGLE_ADS_STRUCTURE, UNIQUE_STYLE_BRAND)
    from services.highlights import to_brief_block
    if on_progress:
        await on_progress("Gathering Google Ads data…")
    context = await assemble_ads_context(service, customer_id, days)
    name = label or f"Account {customer_id}"
    brief = _ads_data_brief(context, name) + to_brief_block(notes)
    image_cache = {} if images else None
    html = await generate_deck_html(brief, prompt=prompt, brand=UNIQUE_STYLE_BRAND,
                                    structure=GOOGLE_ADS_STRUCTURE, provider=provider,
                                    on_progress=on_progress, image_cache=image_cache,
                                    seed=name)
    html = (await resolve_ai_images(html, on_progress=on_progress, image_cache=image_cache)
            if images else _AI_IMG_RE.sub("", html))
    html = resolve_ai_icons(html)
    return {"customer_id": customer_id, "domain": name, "html": html}


async def assemble_bing_context(access_token: str, site: str, days: int = 28,
                                ai_perf_csv: Optional[str] = None) -> Dict:
    """Gather Bing Webmaster headline metrics + daily trend + top queries/pages for one site.
    Bing gives no period deltas, so derive them from the daily series. Optionally fold in the
    AI Performance CSV export (citations/cited-pages) since that data has no API yet."""
    from services import bing_service

    traffic = await bing_service.get_rank_and_traffic(access_token, site)  # full daily history, ascending
    queries = await bing_service.get_query_stats(access_token, site)
    pages = await bing_service.get_page_stats(access_token, site)

    period = bing_service.split_period_deltas(traffic, days)
    trend = traffic[-days:] if days else traffic
    period_start = trend[0]["date"] if trend else ""
    period_end = trend[-1]["date"] if trend else ""

    ai = bing_service.parse_ai_performance_csv(ai_perf_csv) if ai_perf_csv else None

    return {
        "site": site,
        "days": days,
        "period_label": _human_period(period_start, period_end),
        "totals": period["current"],
        "previous": period["previous"],
        "deltas": period["deltas"],
        "trend": trend,
        "queries": sorted(queries, key=lambda q: q.get("clicks", 0), reverse=True)[:15],
        "pages": sorted(pages, key=lambda p: p.get("clicks", 0), reverse=True)[:15],
        "ai": ai,
    }


def _bing_data_brief(ctx: Dict, label: str) -> str:
    t = ctx.get("totals") or {}
    d = ctx.get("deltas") or {}

    def _delta(v, suffix="%"):
        return "n/a" if v is None else f"{v:+}{suffix}"

    def _ctr(clicks, impr):
        return round(clicks / impr * 100, 2) if impr else 0

    trend_lines = "\n".join(
        f"  - {r.get('date','')}: {r.get('clicks',0)} clicks, {r.get('impressions',0)} impressions"
        for r in ctx.get("trend", [])
    ) or "  (none)"
    query_lines = "\n".join(
        f"  - {q.get('query','')}: {q.get('clicks',0)} clicks, {q.get('impressions',0)} impressions, "
        f"{_ctr(q.get('clicks',0), q.get('impressions',0))}% CTR, avg position {q.get('position','n/a')}"
        for q in ctx.get("queries", [])
    ) or "  (none)"
    page_lines = "\n".join(
        f"  - {p.get('page','')}: {p.get('clicks',0)} clicks, {p.get('impressions',0)} impressions, "
        f"{_ctr(p.get('clicks',0), p.get('impressions',0))}% CTR"
        for p in ctx.get("pages", [])
    ) or "  (none)"

    period_label = ctx.get("period_label") or f"last {ctx['days']} days"
    brief = f"""Bing (Microsoft) organic search report for {label}.
Reporting period: {period_label} (last {ctx['days']} days, compared with the previous {ctx['days']} days).
On the COVER slide, show this reporting period ({period_label}) as the subtitle.

BING SEARCH PERFORMANCE (current value, change vs previous period):
- Clicks: {t.get('clicks', 0)} ({_delta(d.get('clicks'))})
- Impressions: {t.get('impressions', 0)} ({_delta(d.get('impressions'))})
- CTR: {t.get('ctr', 0)}% ({_delta(d.get('ctr'), 'pp')})

PERFORMANCE OVER TIME (daily; use for a clicks & impressions trend chart):
{trend_lines}

TOP QUERIES (by clicks):
{query_lines}

TOP PAGES (by clicks):
{page_lines}
"""

    ai = ctx.get("ai")
    if ai:
        ai_lines = "\n".join(
            f"  - {r.get('date','')}: {r.get('citations',0)} citations, {r.get('cited_pages',0)} cited pages"
            for r in ai.get("daily", [])
        ) or "  (none)"
        peak = ai.get("peak") or {}
        brief += f"""
AI SEARCH VISIBILITY (Microsoft Copilot / Bing AI citations — how often this site is cited as a source in AI answers):
- Total citations: {ai.get('total_citations', 0)} over {ai.get('start','')} to {ai.get('end','')}
- Average cited pages per active day: {ai.get('avg_cited_pages', 0)}
- Peak day: {peak.get('date','')} with {peak.get('citations',0)} citations
CITATIONS OVER TIME (daily; use for an AI-citations area/line chart):
{ai_lines}
"""

    brief += "\nUse only these numbers. Positive but honest framing; declines = opportunities."
    return brief


async def generate_ai_bing_deck(access_token: str, site: str, days: int = 28, *,
                                label: str = "", provider: str = "deepseek",
                                prompt: Optional[str] = None, images: bool = True,
                                notes: str = "", ai_perf_csv: Optional[str] = None,
                                on_progress=None) -> Dict:
    """AI-designed Bing search deck for one verified site. Returns the HTML only —
    the file is rendered on download. `label` is the site display name (for the cover)."""
    from services.ai_deck_service import (generate_deck_html, resolve_ai_images, resolve_ai_icons,
                                          _AI_IMG_RE, BING_STRUCTURE, UNIQUE_STYLE_BRAND)
    from services.highlights import to_brief_block
    if on_progress:
        await on_progress("Gathering Bing Webmaster data…")
    context = await assemble_bing_context(access_token, site, days, ai_perf_csv=ai_perf_csv)
    name = label or site
    brief = _bing_data_brief(context, name) + to_brief_block(notes)
    image_cache = {} if images else None
    html = await generate_deck_html(brief, prompt=prompt, brand=UNIQUE_STYLE_BRAND,
                                    structure=BING_STRUCTURE, provider=provider,
                                    on_progress=on_progress, image_cache=image_cache,
                                    seed=name)
    html = (await resolve_ai_images(html, on_progress=on_progress, image_cache=image_cache)
            if images else _AI_IMG_RE.sub("", html))
    html = resolve_ai_icons(html)
    return {"site": site, "domain": name, "html": html}


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
