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


def _brand_core(domain: str) -> str:
    """The domain's second-level label, alnum-lowercased, for brand-query matching
    (e.g. 'jesseandson.com' -> 'jesseandson'). Returns '' when < 4 chars (too short to
    match safely — disables brand filtering)."""
    import re
    label = (domain or "").strip().lower()
    label = label.replace("sc-domain:", "").replace("https://", "").replace("http://", "").lstrip("www.")
    label = label.split("/")[0].split(".")[0]           # second-level label
    core = re.sub(r"[^a-z0-9]", "", label)
    return core if len(core) >= 4 else ""


def _brand_cores(domain: str, extra_terms=None) -> List[str]:
    """Every brand core to filter on: the domain-derived one plus any operator-supplied
    terms (free text, comma/newline separated). Terms shorter than 4 chars after
    normalisation are dropped — they'd match unrelated queries as substrings."""
    import re
    cores = []
    auto = _brand_core(domain)
    if auto:
        cores.append(auto)
    for term in re.split(r"[,\n]", (extra_terms or "") if isinstance(extra_terms, str)
                         else ",".join(extra_terms or [])):
        core = re.sub(r"[^a-z0-9]", "", term.strip().lower())
        if len(core) >= 4 and core not in cores:
            cores.append(core)
    return cores


def _is_brand_query(query: str, cores) -> bool:
    """True when a query is branded/navigational for any core in `cores` (from _brand_cores).
    Matches the '&' / 'and' / concatenated-domain variants that dominate branded searches,
    e.g. for core 'jesseandson': 'jesse and sons', 'jesse & son', 'jesse & son custom tailors'
    -> True; 'custom tailors bangkok' -> False."""
    if isinstance(cores, str):
        cores = [cores] if cores else []
    if not cores:
        return False
    import re
    qn = re.sub(r"[^a-z0-9]", "", (query or "").lower())
    if not qn:
        return False
    qn2 = qn.replace("and", "")
    for core in cores:
        core2 = core.replace("and", "")
        if (core in qn) or (bool(core2) and core2 in qn2):
            return True
    return False


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
                               ga4_service=None, brand_terms: Optional[str] = None) -> Dict:
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

    # Drop branded/navigational queries (auto-detected from the domain, plus any operator-supplied
    # `brand_terms`) from every surface that drives a RECOMMENDATION — the table, CTR opportunities,
    # striking distance, the bubble chart and the per-query movers. Otherwise the deck keeps telling
    # the client to "rank better for <their own name>", which they already own.
    # keyword_mix follows the same filter so the deck's "unique keywords" story is the non-branded
    # one. The headline totals (clicks/impressions/CTR/position) still cover EVERY query — they're
    # the site's real performance, and restating them net of brand would be dishonest. `brand_split`
    # below reconciles the two.
    cores = _brand_cores(domain, brand_terms)

    def _nb(rows, key="query"):
        # NO fallback to the unfiltered rows when everything is branded. An earlier version did
        # `kept or rows`, which inverted the whole feature exactly where it mattered most: the CTR
        # opportunities for jesseandson.com were 100% branded, so the filter emptied them and the
        # fallback handed all three brand terms straight back — the deck then recommended rewriting
        # titles for "jesse and sons". An empty section is the correct, honest answer; the brief
        # tells the planner to drop the slide rather than fill it with brand.
        return [r for r in (rows or []) if not _is_brand_query(r.get(key, ""), cores)]

    nonbrand = _nb(queries)
    ctr_opps = _nb(ctr_opps)
    # Landing pages, net of brand. get_top_pages aggregates by page ONLY, so its clicks include
    # branded search: for jesseandson.com the homepage showed 479 clicks (54% of the site) that
    # were overwhelmingly people googling the brand name — while the slide was captioned
    # "non-branded traffic". The caption was false, which is worse than a layout bug. Rebuilding
    # from page+query rows lets us drop branded queries before aggregating, so the number finally
    # matches the label. Kept as a SEPARATE key: `top_pages` still carries the period-over-period
    # deltas that the movers slide needs, and those are legitimately all-traffic.
    pages_nonbrand = None
    if cores:
        try:
            pq = await service.get_pages_with_queries(property_url, days=days)
            rebuilt = []
            for pg in pq or []:
                kept = [q for q in (pg.get("queries") or [])
                        if not _is_brand_query(q.get("query", ""), cores)]
                clicks = sum(q.get("clicks") or 0 for q in kept)
                impr = sum(q.get("impressions") or 0 for q in kept)
                if impr <= 0:
                    continue
                wpos = sum((q.get("position") or 0) * (q.get("impressions") or 0) for q in kept)
                rebuilt.append({
                    "url": (pg.get("url") or "").rstrip("/"),
                    "clicks": clicks,
                    "impressions": impr,
                    "ctr": round(100 * clicks / impr, 2),
                    "position": round(wpos / impr, 1),
                    "nonbrand_queries": len(kept),
                })
            rebuilt.sort(key=lambda r: (r["clicks"], r["impressions"]), reverse=True)
            pages_nonbrand = rebuilt or None
        except Exception:
            # Fall back to all-traffic pages — the brief then LABELS them as such rather than
            # claiming a filter that did not run.
            logger.exception("non-brand page rebuild failed; keeping all-traffic pages")
            pages_nonbrand = None

    striking = _nb(striking)
    if insights and insights.get("queries"):
        insights = {**insights, "queries": _nb(insights["queries"])}

    # The one place brand is allowed to appear: a single honest split, so the deck can say
    # "X% of clicks are branded, here's the other Y%" once and then spend itself on non-branded
    # demand. Without this the reader can't tell why the query counts don't reconcile.
    brand_split = None
    if cores and len(nonbrand) < len(queries):
        branded = [q for q in queries if _is_brand_query(q.get("query", ""), cores)]

        def _sum(rows, key):
            return sum(r.get(key) or 0 for r in rows)

        b_clicks, n_clicks = _sum(branded, "clicks"), _sum(nonbrand, "clicks")
        b_impr, n_impr = _sum(branded, "impressions"), _sum(nonbrand, "impressions")
        total_clicks, total_impr = b_clicks + n_clicks, b_impr + n_impr
        brand_split = {
            "branded_queries": len(branded),
            "nonbranded_queries": len(nonbrand),
            "branded_clicks": b_clicks,
            "nonbranded_clicks": n_clicks,
            "branded_click_share": round(100 * b_clicks / total_clicks, 1) if total_clicks else 0,
            "branded_impression_share": round(100 * b_impr / total_impr, 1) if total_impr else 0,
        }

    return {
        "property_url": property_url,
        "domain": domain,
        "days": days,
        "period": _gsc_period(days),
        "analytics": analytics,
        "trend": (analytics or {}).get("chart_data") or [],
        "monthly_trend": (monthly or {}).get("chart_data") or [],
        "top_queries": nonbrand[:15],
        "brand_excluded": bool(cores and len(nonbrand) < len(queries)),
        "bubble_queries": sorted(nonbrand, key=lambda q: q.get("impressions", 0), reverse=True)[:30],
        "keyword_mix": _keyword_mix(nonbrand),
        "brand_split": brand_split,
        "query_insights": insights or {},
        "top_pages": pages[:10],
        "top_pages_nonbrand": (pages_nonbrand or [])[:10],
        "pages_brand_excluded": bool(pages_nonbrand),
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


def _empty_note(ctx: Dict) -> str:
    """Placeholder for a query section the brand filter emptied. Says WHY it's empty and that the
    slide must be dropped — otherwise the planner keeps the slide and pads it with brand terms."""
    if ctx.get("brand_excluded"):
        return ("  (none — every query here was branded and was removed. This is a real, valid "
                "result: SKIP this slide entirely. Do NOT re-introduce branded queries to fill it, "
                "do NOT invent queries, and do NOT present it as a data problem.)")
    return "  (none — SKIP this slide; do not invent data to fill it.)"


def _gsc_data_brief(ctx: Dict, *, compact: bool = False, include_ga4: bool = True,
                    sections_only: bool = False) -> str:
    """The GSC brief. Three keyword-only flags exist purely for the COMBINED deck; all default to
    the single-platform behaviour, so this function's output is unchanged for the GSC deck.

    sections_only — emit the DATA sections without the intro, reporting-period line, cover
        instruction or honesty closer. A combined brief carries three platforms and must emit
        exactly one of each; three "On the COVER slide…" instructions in one prompt is how a deck
        ends up with three cover slides.
    include_ga4 — this brief already inlines a GA4 section when assemble_gsc_context auto-matched a
        property. The combined brief emits GA4 centrally from the EXPLICITLY chosen property, so
        leaving this on would print GA4 twice with two different sets of numbers.
    compact — drop the sections whose slides the combined structure omits, and shorten the long
        tables. The full brief is ~20 sections; three of those in one prompt is what causes the
        model to ration its effort and flatten the composition.
    """
    a = ctx.get("analytics") or {}
    totals = a.get("totals") or {}
    deltas = a.get("deltas") or {}
    km = ctx.get("keyword_mix") or {}

    def _d(v, suffix="%"):
        return "n/a" if v is None else f"{v:+}{suffix}"

    q_lines = "\n".join(
        f"  - \"{q.get('query','')}\": {q.get('clicks',0)} clicks, "
        f"{q.get('impressions',0)} impressions, {q.get('ctr',0)}% CTR, pos {q.get('position','?')}"
        for q in (ctx.get("top_queries", [])[:10] if compact else ctx.get("top_queries", []))
    ) or "  (none)"
    top_queries_header = (
        "TOP QUERIES (by clicks — NON-BRANDED only; branded/navigational queries are intentionally "
        "excluded as they aren't a priority for this client. Do NOT say brand queries dominate):"
        if ctx.get("brand_excluded")
        else "TOP QUERIES (by clicks):"
    )
    bs = ctx.get("brand_split") or {}
    brand_rule = (
        "\nBRAND RULE — THIS DECK IS ABOUT NON-BRANDED SEARCH:\n"
        "Branded/navigational queries have ALREADY been removed from the query table, CTR "
        "opportunities, striking distance, the query bubble chart, the movers list and the unique-"
        "keyword mix. The client already ranks for their own name; it is not an opportunity.\n"
        + ("- Landing-page clicks are ALSO brand-filtered this run — the page table is non-branded.\n"
           if ctx.get("pages_brand_excluded") else
           "- EXCEPTION: landing-page, device, country, search-type and trend figures still INCLUDE "
           "branded traffic (they cannot be split by query). Caption them \"all traffic\" and NEVER "
           "describe them as non-branded.\n") +
        f"- Branded share of query clicks: {bs.get('branded_click_share', 0)}% "
        f"({bs.get('branded_queries', 0)} branded queries vs {bs.get('nonbranded_queries', 0)} "
        f"non-branded). State this ONCE, as context, on the overview slide only.\n"
        "- After that one mention, EVERY theme, insight, chart, opportunity and recommendation "
        "must be about NON-BRANDED demand.\n"
        "- NEVER recommend improving rank, CTR, or content for a branded query. NEVER make brand "
        "visibility a theme or a recommendation. NEVER say brand terms are missing or "
        "under-performing — they were removed on purpose.\n"
        "- The headline totals above cover ALL queries (branded included) because they are the "
        f"site's true performance. Query-level lists cover the {bs.get('nonbranded_queries', 0)} "
        "non-branded queries only, so they will not add up to the totals. That is expected — do "
        "not reconcile them, apologise for them, or call it a data gap.\n"
        if ctx.get("brand_excluded") else ""
    )
    # Prefer the brand-filtered page table; fall back to all-traffic. The HEADER below always
    # states which one this is — a page list captioned "non-branded" that silently includes brand
    # is a false claim on a client slide, and that is exactly what shipped.
    _pages_for_brief = ctx.get("top_pages_nonbrand") or ctx.get("top_pages", [])
    p_lines = "\n".join(
        f"  - {p.get('url','')}: {p.get('clicks',0)} clicks, "
        f"{p.get('impressions',0)} impressions, {p.get('ctr',0)}% CTR, pos {p.get('position','?')}"
        for p in _pages_for_brief
    ) or "  (none)"
    pages_header = (
        "TOP LANDING PAGES (NON-BRANDED clicks only — branded search has been removed from these "
        "figures, so they are lower than the site totals and will not reconcile with them. That is "
        "correct; do not apologise for it):"
        if ctx.get("pages_brand_excluded")
        else "TOP LANDING PAGES (ALL traffic, INCLUDING branded search — the brand filter could not "
             "be applied here. Caption these as \"all traffic\"; do NOT label them non-branded):"
    )
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
        for o in (ctx.get("ctr_opportunities", [])[:8] if compact else ctx.get("ctr_opportunities", []))
    ) or _empty_note(ctx)
    sd_lines = "\n".join(
        f"  - \"{s.get('query','')}\" at pos {s.get('position','?')} ({s.get('impressions',0)} impressions, "
        f"~{s.get('potential_clicks',0)} extra clicks if pushed to top 3) — {s.get('page','')}"
        for s in (ctx.get("striking_distance", [])[:8] if compact else ctx.get("striking_distance", []))
    ) or _empty_note(ctx)
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
            for r in (geo.get("rows", [])[:12] if compact else geo.get("rows", []))) or "  (none)"
    else:
        geo_metric = "ORGANIC CLICKS"
        geo_note = ("Country codes are ISO-3 (e.g. 'tha','sgp','usa') — render a Plotly choropleth "
                    "with \"locationmode\":\"ISO-3\" (uppercase the codes), shaded by clicks.")
        geo_lines = "\n".join(
            f"  - {r.get('name','')}: {r.get('clicks',0)} clicks, {r.get('impressions',0)} impressions"
            for r in (geo.get("rows", [])[:12] if compact else geo.get("rows", []))) or "  (none)"

    period = ctx.get("period") or {}
    period_label = period.get("label", f"last {ctx['days']} days")
    ga4 = ctx.get("ga4") or None
    ga4_block = ("\n\n" + _ga4_brief_sections(ga4)) if (ga4 and include_ga4) else ""

    # ── Analyst playbook: core principles (from deck_playbook.md) + grounded conditional flags ──
    from services.analyst_flags import compute_analyst_flags, load_core_principles
    core = load_core_principles()
    flags = compute_analyst_flags(ctx)
    analyst_block = ""
    if core or flags:
        flag_lines = "\n".join(f"  - {f}" for f in flags) or "  (none)"
        analyst_block = (
            "\n\nANALYST PLAYBOOK (apply these principles to EVERY slide's narrative):\n" + core +
            "\n\nANALYST FLAGS (pre-computed from THIS site's data — weave these specific, grounded "
            "insights & recommendations into the relevant slides; do NOT invent others, and do NOT "
            "restate raw numbers without the takeaway):\n" + flag_lines
        )
    intro = (
        f"Monthly performance report (Google Search Console + Google Analytics) for {ctx['domain']}. "
        "It combines organic SEARCH data with website ANALYTICS (sessions, engagement, channels)."
        if ga4 else
        f"Organic search (Google Search Console) report for {ctx['domain']}."
    )
    # ── sections the COMBINED deck drops ───────────────────────────────────────────────────────
    # Each is a whole block so `compact` removes the heading with its data — a heading left over an
    # empty list reads as missing data and the planner tries to fill it. The choice of what goes is
    # driven by which slides COMBINED_STRUCTURE omits, so the brief never carries data for a slide
    # that cannot be built. Daily trend goes because the monthly combo already carries the organic
    # story; by-POSITION movers go because by-CLICKS is the client-facing one; TOP COUNTRIES goes
    # because GEOGRAPHY already covers it (a redundancy that exists in the full brief too).
    daily_block = "" if compact else f"""PERFORMANCE OVER TIME (daily; use for the daily impressions & URL-clicks area charts):
{trend_lines}

"""
    pos_movers_block = "" if compact else f"""BIGGEST MOVERS — QUERIES, BY POSITION (improved; Δ is positive when rank gets better):
{_mv_pos(risers_p)}
BIGGEST MOVERS — QUERIES, BY POSITION (declined):
{_mv_pos(fallers_p)}
"""
    footprint_block = "" if compact else f"""QUERY FOOTPRINT (per month; use for a stacked bar of top-10 query counts [pos 1-3 + pos 4-10] with a total-queries line):
{foot_lines}

"""
    stype_block = "" if compact else f"""BY SEARCH TYPE (web/image/video/news; use for a search-surface breakdown chart — OMIT the slide if only 'web' is present or this is (none)):
{stype_lines}

"""
    appearance_block = "" if compact else f"""SEARCH APPEARANCE (rich-result types — FAQ, product snippets, etc.; clicks/impressions/CTR/position. OMIT the slide entirely if this is (none)):
{appearance_lines}

"""
    countries_block = "" if compact else f"""TOP COUNTRIES (by clicks):
{country_lines}

"""
    header = f"""{intro}
{brand_rule}Reporting period: {period_label} (last {ctx['days']} days, compared with the previous {ctx['days']} days).
On the COVER slide, show this reporting period ({period_label}) as the subtitle.

"""
    body = f"""OVERALL SEARCH PERFORMANCE (current value, change vs previous period):
- Clicks: {totals.get('clicks', 0)} ({_d(deltas.get('clicks'))})
- Impressions: {totals.get('impressions', 0)} ({_d(deltas.get('impressions'))})
- CTR: {totals.get('ctr', 0)}% ({_d(deltas.get('ctr'), 'pp')})
- Average position: {totals.get('position', 0)} ({_d(deltas.get('position'), 'pp')}; lower is better)

{daily_block}MONTHLY PERFORMANCE (last 12 months; use for the clicks+impressions bar + avg-position line combo chart):
{monthly_lines}

{top_queries_header}
{q_lines}

KEYWORD POSITION vs IMPRESSIONS (top queries; use for a bubble/scatter chart — x = avg position, y = impressions, bubble size ∝ impressions):
{bubble_lines}

KEYWORD MIX ({"non-branded " if ctx.get("brand_excluded") else ""}distinct queries tracked this period + how their average rank is distributed; use for a "Unique Keywords" metric + a ranking-distribution donut):
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
{pos_movers_block}
BIGGEST MOVERS — LANDING PAGES (ALL traffic incl. branded — period-over-period deltas are
only available unfiltered; caption as "all traffic"):
{_mv_page(page_risers)}
BIGGEST MOVERS — LANDING PAGES (falling by clicks):
{_mv_page(page_fallers)}

{footprint_block}{pages_header}
{p_lines}

BY DEVICE:
{dev_lines}

{stype_block}{appearance_block}CTR OPPORTUNITIES (high-impression queries whose CTR is below expected for their rank; use for a quick-CTR-wins slide — actual vs expected CTR, ranked by missed clicks. OMIT the slide if (none)):
{ctr_opp_lines}

{countries_block}GEOGRAPHY — {geo_metric} BY COUNTRY (use for a choropleth world map + a top-countries bar). {geo_note}
{geo_lines}{ga4_block}{analyst_block}"""
    if sections_only:
        # The brand rule travels with the GSC data it governs, not with the deck-level preamble.
        return brand_rule + body
    return header + body + "\n\n" + _HONESTY_CLOSER


def _brand_accent_directive(accent: str, accent2: str) -> str:
    """The editorial art direction + the resolved accent colours. Keeps UNIQUE_STYLE_BRAND's
    art-direction (that's what makes decks look designed rather than templated) but drops its colour
    prescriptions (cream ground / "don't default to navy"), which would fight the chosen palette.
    The ground/fonts come from the assigned STYLE directive; _apply_theme enforces the accents."""
    return (
        "Design like a high-end EDITORIAL DESIGN STUDIO — art-direction-led, poster/magazine grade — NOT a "
        "generic corporate slide template. Use OVERSIZED confident headlines in the assigned display face "
        "(mix ONE italic accent word into a headline), tiny ALL-CAPS letter-spaced kicker/eyebrow labels and a "
        "small corner 'system' tag or slide index, and ONE repeating editorial motif used with restraint (a "
        "dot/ruled grid, a slightly rotated outlined frame, a star/circle, pill/tape labels) carried across "
        "slides — never over charts/tables. Layouts must be confident and ASYMMETRIC with generous negative "
        "space and a clear focal point; vary them slide to slide. Treat the cover, section dividers and closing "
        "as poster pages: huge expressive type on a bold saturated or dark colour field. Avoid AI-slop: no thin "
        "accent lines under titles, no full-width decorative colour bars unless they serve the layout, no "
        "centred evenly-stacked default layouts.\n\n"
        f"REQUIRED BRAND ACCENT: build the palette around {accent} as --accent (the ONE vivid pop — emphasis, "
        f"KPIs, the primary chart series) and {accent2} as --accent-2 (secondary series / subtle fills). Take "
        "the ground, surface and fonts from the assigned HOUSE STYLE / THEME."
    )


async def resolve_deck_palette(theme_mode: str = "tbs", custom_color: Optional[str] = None,
                               domain: str = "") -> Dict:
    """Resolve {accent, accent2} for the chosen colour mode: 'tbs' (TBS house palette, the default),
    'custom' (a picked hex, accent-2 derived), or 'site' (auto-detected from the client's website)."""
    from services.ai_deck_service import TBS_PALETTE
    mode = (theme_mode or "tbs").lower()
    if mode == "custom" and custom_color:
        from services.site_theme import _accents, _hex_to_rgb
        rgb = _hex_to_rgb(custom_color)
        if rgb:
            return _accents(rgb)
    if mode == "site":
        from services.site_theme import detect_site_accent
        return await detect_site_accent(domain)
    return {"accent": TBS_PALETTE["accent"], "accent2": TBS_PALETTE["accent2"]}


async def generate_ai_gsc_deck(service, property_url: str, days: int = 28, *,
                               provider: str = "deepseek", prompt: Optional[str] = None,
                               images: bool = True, notes: str = "", on_progress=None,
                               ga4_service=None, creativity: str = "balanced",
                               pipeline: str = "single", models: Optional[dict] = None,
                               theme_mode: str = "tbs", custom_color: Optional[str] = None,
                               style: str = "tbs", brand_terms: Optional[str] = None) -> Dict:
    """AI-designed organic-search deck for a GSC property (from My Sites), using the
    chosen prompt + provider. Returns the HTML only — the file is rendered on download.

    `brand_terms` is free text (comma/newline separated) naming this client's brand
    variants; they're dropped from the query surfaces on top of the domain-derived core.

    If `ga4_service` is given, the country map uses real GA4 sessions matched to the site's
    GA4 property (falling back to GSC clicks-by-country when there's no match)."""
    from services.ai_deck_service import (generate_deck_html, resolve_ai_images, resolve_ai_icons,
                                          _AI_IMG_RE, GSC_STRUCTURE, _apply_theme)
    from services.highlights import to_brief_block
    if on_progress:
        await on_progress("Gathering Search Console data…")
    context = await assemble_gsc_context(service, property_url, days, ga4_service=ga4_service,
                                         brand_terms=brand_terms)
    brief = _gsc_data_brief(context) + to_brief_block(notes)
    # Resolve the deck palette by colour mode (TBS house by default; site brand or custom on request).
    palette = await resolve_deck_palette(theme_mode, custom_color, context["domain"])
    brand = _brand_accent_directive(palette["accent"], palette["accent2"])
    # Shared cache lets image generation start (during the streamed write) and finish
    # concurrently with slide-writing instead of serially afterward.
    image_cache = {} if images else None
    artifacts = {}   # filled with per-slide md/html by the per-slide pipeline
    html = await generate_deck_html(brief, prompt=prompt, brand=brand,
                                    structure=GSC_STRUCTURE, provider=provider,
                                    on_progress=on_progress, image_cache=image_cache,
                                    seed=context["domain"], creativity=creativity,
                                    pipeline=pipeline, models=models, style=style,
                                    artifacts=artifacts)
    html = (await resolve_ai_images(html, on_progress=on_progress, image_cache=image_cache)
            if images else _AI_IMG_RE.sub("", html))
    html = resolve_ai_icons(html)
    html = _apply_theme(html, palette["accent"], palette["accent2"])
    return {
        "property_url": property_url,
        "domain": context["domain"],
        "html": html,
        "artifacts": artifacts,
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

Use only these numbers. Report declines HONESTLY and PROMINENTLY — state each drop with its real number and movement, the likely cause, and the specific fix. Professional and calm, never alarmist, but never hidden or spun."""


async def generate_ai_ga4_deck(service, property_id: str, days: int = 28, *,
                               label: str = "", provider: str = "deepseek",
                               prompt: Optional[str] = None, images: bool = True,
                               notes: str = "", on_progress=None,
                               creativity: str = "balanced",
                               pipeline: str = "single", models: Optional[dict] = None,
                               theme_mode: str = "tbs", custom_color: Optional[str] = None,
                               style: str = "tbs") -> Dict:
    """AI-designed website-analytics deck for a GA4 property. Returns the HTML only —
    the file is rendered on download. `label` is the property display name (for the cover)."""
    from services.ai_deck_service import (generate_deck_html, resolve_ai_images, resolve_ai_icons,
                                          _AI_IMG_RE, GA4_STRUCTURE, _apply_theme)
    from services.highlights import to_brief_block
    if on_progress:
        await on_progress("Gathering Google Analytics data…")
    context = await assemble_ga4_context(service, property_id, days, label=label)
    name = context["name"]
    brief = _ga4_data_brief(context) + to_brief_block(notes)
    palette = await resolve_deck_palette(theme_mode, custom_color, name)
    brand = _brand_accent_directive(palette["accent"], palette["accent2"])
    image_cache = {} if images else None
    artifacts = {}   # filled with per-slide md/html by the per-slide pipeline
    html = await generate_deck_html(brief, prompt=prompt, brand=brand,
                                    structure=GA4_STRUCTURE, provider=provider,
                                    on_progress=on_progress, image_cache=image_cache,
                                    seed=name, creativity=creativity,
                                    pipeline=pipeline, models=models, style=style,
                                    artifacts=artifacts)
    html = (await resolve_ai_images(html, on_progress=on_progress, image_cache=image_cache)
            if images else _AI_IMG_RE.sub("", html))
    html = resolve_ai_icons(html)
    html = _apply_theme(html, palette["accent"], palette["accent2"])
    return {"property_id": property_id, "domain": name, "html": html, "artifacts": artifacts}


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


# The closing paragraph every brief ends with. Was duplicated verbatim at the tail of the GSC, GA4
# and Ads briefs; a combined deck would have made it four copies (and printed it three times in one
# prompt). Defined once so all callers stay in step.
_HONESTY_CLOSER = (
    "Use only these numbers. Report declines HONESTLY and PROMINENTLY — state each drop with its "
    "real number and movement, the likely cause, and the specific fix. Professional and calm, never "
    "alarmist, but never hidden or spun."
)


def _ads_brief_sections(ctx: Dict, *, compact: bool = False, deep: Optional[Dict] = None,
                        prefix: str = "") -> str:
    """The Ads DATA sections only — no intro, no period line, no cover instruction, no closer.

    Mirrors _ga4_brief_sections. Splitting these out is what lets the combined brief carry three
    platforms while emitting exactly ONE intro and ONE cover instruction; three briefs each asking
    for a cover slide is how a deck ends up with three cover slides.

    `prefix` platform-qualifies the section headers ("PAID "). In a merged brief the bare header
    "PERFORMANCE OVER TIME" appears in BOTH the GSC and Ads sections, leaving the model no way to
    tell which trend belongs to which channel.
    """
    t = ctx.get("totals") or {}
    d = ctx.get("deltas") or {}
    cur = ctx.get("currency") or ""
    cur_sfx = f" {cur}" if cur else ""

    def _delta(v, suffix="%"):
        return "n/a" if v is None else f"{v:+}{suffix}"

    trend_rows = ctx.get("trend", [])
    if compact:
        trend_rows = trend_rows[-14:]        # a fortnight reads as a trend; 28 rows is filler
    trend_lines = "\n".join(
        f"  - {row.get('name','')}: {row.get('clicks',0)} clicks, "
        f"{row.get('cost',0)}{cur_sfx} cost, {row.get('conversions',0)} conversions"
        for row in trend_rows
    ) or "  (none)"
    campaign_rows = ctx.get("campaigns", [])
    if compact:
        campaign_rows = campaign_rows[:8]
    campaign_lines = "\n".join(
        f"  - {c.get('name','')} ({c.get('status','')}): {c.get('impressions',0)} impressions, "
        f"{c.get('clicks',0)} clicks, {c.get('cost',0)}{cur_sfx} cost, {c.get('conversions',0)} conversions"
        for c in campaign_rows
    ) or "  (none)"

    out = f"""{prefix}ACCOUNT PERFORMANCE (current value, change vs previous period):
- Impressions: {t.get('impressions', 0)} ({_delta(d.get('impressions'))})
- Clicks: {t.get('clicks', 0)} ({_delta(d.get('clicks'))})
- CTR: {t.get('ctr', 0)}% ({_delta(d.get('ctr'), 'pp')})
- Avg CPC: {t.get('avg_cpc', 0)}{cur_sfx} ({_delta(d.get('avg_cpc'))})
- Cost: {t.get('cost', 0)}{cur_sfx} ({_delta(d.get('cost'))})
- Conversions: {t.get('conversions', 0)} ({_delta(d.get('conversions'))})
- Conversion rate: {t.get('conversion_rate', 0)}% ({_delta(d.get('conversion_rate'), 'pp')})
- Cost per conversion: {t.get('cost_per_conversion', 0)}{cur_sfx} ({_delta(d.get('cost_per_conversion'))}; lower is better)

{prefix}PERFORMANCE OVER TIME (daily; use for a trend line/area chart):
{trend_lines}

TOP {prefix}CAMPAIGNS (by cost):
{campaign_lines}"""

    # Deep-dive keywords/search terms only exist for the combined deck (get_deep_dive). They are the
    # raw material for the paid-vs-organic overlap, so they are worth their tokens only there.
    if deep:
        kw = "\n".join(
            f"  - {k.get('keyword','')} [{k.get('match_type','')}]: {k.get('clicks',0)} clicks, "
            f"{k.get('cost',0)}{cur_sfx} cost, {k.get('conversions',0)} conversions"
            for k in (deep.get("keywords") or [])[:12]
        ) or "  (none)"
        st = "\n".join(
            f"  - {s.get('term','')}: {s.get('clicks',0)} clicks, {s.get('cost',0)}{cur_sfx} cost, "
            f"{s.get('conversions',0)} conversions"
            for s in (deep.get("search_terms") or [])[:12]
        ) or "  (none)"
        out += f"\n\nTOP PAID KEYWORDS (by conversions):\n{kw}\n\nTOP PAID SEARCH TERMS (what people actually typed):\n{st}"
    return out


def _ads_data_brief(ctx: Dict, label: str) -> str:
    cur = ctx.get("currency") or ""
    period_label = ctx.get("period_label") or f"last {ctx['days']} days"
    return f"""Paid search (Google Ads) report for {label}. All costs are in {cur or 'the account currency'}.
Reporting period: {period_label} (last {ctx['days']} days, compared with the previous {ctx['days']} days).
On the COVER slide, show this reporting period ({period_label}) as the subtitle.

{_ads_brief_sections(ctx)}

{_HONESTY_CLOSER}"""


async def generate_ai_ads_deck(service, customer_id: str, days: int = 28, *,
                               label: str = "", provider: str = "deepseek",
                               prompt: Optional[str] = None, images: bool = True,
                               notes: str = "", on_progress=None,
                               creativity: str = "balanced",
                               pipeline: str = "single", models: Optional[dict] = None,
                               theme_mode: str = "tbs", custom_color: Optional[str] = None,
                               style: str = "tbs") -> Dict:
    """AI-designed paid-search deck for a Google Ads account. Returns the HTML only —
    the file is rendered on download. `label` is the account display name (for the cover)."""
    from services.ai_deck_service import (generate_deck_html, resolve_ai_images, resolve_ai_icons,
                                          _AI_IMG_RE, GOOGLE_ADS_STRUCTURE, _apply_theme)
    from services.highlights import to_brief_block
    if on_progress:
        await on_progress("Gathering Google Ads data…")
    context = await assemble_ads_context(service, customer_id, days)
    name = label or f"Account {customer_id}"
    brief = _ads_data_brief(context, name) + to_brief_block(notes)
    palette = await resolve_deck_palette(theme_mode, custom_color, name)
    brand = _brand_accent_directive(palette["accent"], palette["accent2"])
    image_cache = {} if images else None
    artifacts = {}   # filled with per-slide md/html by the per-slide pipeline
    html = await generate_deck_html(brief, prompt=prompt, brand=brand,
                                    structure=GOOGLE_ADS_STRUCTURE, provider=provider,
                                    on_progress=on_progress, image_cache=image_cache,
                                    seed=name, creativity=creativity,
                                    pipeline=pipeline, models=models, style=style,
                                    artifacts=artifacts)
    html = (await resolve_ai_images(html, on_progress=on_progress, image_cache=image_cache)
            if images else _AI_IMG_RE.sub("", html))
    html = resolve_ai_icons(html)
    html = _apply_theme(html, palette["accent"], palette["accent2"])
    return {"customer_id": customer_id, "domain": name, "html": html, "artifacts": artifacts}


# ============================================================================
# COMBINED → AI deck. Any subset of GSC + GA4 + Google Ads for ONE client.
#
# Not a new pipeline: a fourth caller of generate_deck_html with a merged brief. All the risk is in
# the merge, because three briefs written for standalone decks each carry their own intro, their own
# reporting period and their own "On the COVER slide…" instruction — concatenate them naively and
# the model is told to build three cover slides from three different periods.
# ============================================================================

def _cross_channel_block(cross: Optional[Dict]) -> str:
    """Render the precomputed synthesis. The model never derives these numbers — it explains them."""
    if not cross:
        return ""
    cur = cross.get("currency") or ""
    sfx = f" {cur}" if cur else ""
    parts: List[str] = []

    b = cross.get("blended")
    if b:
        lines = [
            f"- Organic clicks: {b['organic_clicks']} ({b['organic_share']}% of acquisition) "
            f"[source: {b['organic_source']}]",
            f"- Paid clicks: {b['paid_clicks']} ({b['paid_share']}%)",
            f"- Paid cost: {b['ads_cost']}{sfx}",
        ]
        if b.get("paid_cpa") is not None:
            lines.append(f"- Paid cost per conversion: {b['paid_cpa']}{sfx} "
                         f"({b['ads_conversions']} conversions)")
        if b.get("blended_cpa") is not None:
            lines.append(f"- BLENDED cost per conversion (paid spend / ALL conversions): "
                         f"{b['blended_cpa']}{sfx}")
        if b.get("organic_click_value") is not None:
            lines.append(
                f"- Organic click value: {b['organic_click_value']}{sfx} — what those organic clicks "
                f"would have cost at the account's own average CPC of {b['avg_cpc']}{sfx}. This is "
                f"MEDIA COST AVOIDED, not revenue and not money saved. Say it that way.")
        parts.append("BLENDED ACQUISITION (organic and paid together — use for the whole-picture "
                     "slide):\n" + "\n".join(lines))

    recon = cross.get("reconciliation") or []
    if recon:
        parts.append("CHANNEL RECONCILIATION (how the platforms count the same traffic):\n"
                     + "\n".join(f"- {r}" for r in recon))

    overlap = cross.get("overlap") or []
    if overlap:
        rows = []
        for r in overlap:
            pos = f"organic pos {r['organic_position']}" if r["organic_position"] is not None \
                else "NOT ranking organically"
            brand = " [BRANDED]" if r["branded"] else ""
            rows.append(
                f"- {r['bucket']}{brand}: \"{r['term']}\" — {pos}, {r['organic_clicks']} organic "
                f"clicks | paid: {r['ads_clicks']} clicks, {r['ads_cost']}{sfx}, "
                f"{r['ads_conversions']} conversions")
        parts.append(
            "PAID/ORGANIC QUERY OVERLAP (terms appearing in BOTH channels; already joined and "
            "classified — use these buckets verbatim, do NOT reclassify):\n"
            "  DEFEND = already ranks organic top 3 and is also being paid for.\n"
            "  CONTENT GAP = paid converts but organic ranks 11+ or not at all.\n"
            "  DOUBLE COVERAGE = organic 4-10 plus paid; both surfaces held.\n"
            + "\n".join(rows))

    flags = cross.get("flags") or []
    if flags:
        parts.append("CROSS-CHANNEL FLAGS (headline conclusions — state these, do not soften):\n"
                     + "\n".join(f"- {f}" for f in flags))

    if not parts:
        return ""
    return "=== CROSS-CHANNEL SYNTHESIS ===\n" + "\n\n".join(parts)


def _combined_data_brief(gsc_ctx: Optional[Dict], ga4_ctx: Optional[Dict],
                         ads_ctx: Optional[Dict], *, client: str, days: int,
                         ads_label: str = "", ads_deep: Optional[Dict] = None,
                         cross: Optional[Dict] = None) -> str:
    """One brief covering every platform that loaded.

    Ordering is deliberate: the synthesis comes FIRST, before any single-platform section. The model
    plans from what it reads first, so leading with the cross-channel picture is what makes the deck
    read as one report rather than three chapters.
    """
    present = [n for n, c in (("Google Search Console", gsc_ctx), ("Google Analytics 4", ga4_ctx),
                              ("Google Ads", ads_ctx)) if c]
    if len(present) > 1:
        sources = ", ".join(present[:-1]) + " and " + present[-1]
    else:
        sources = present[0] if present else "no platforms"

    # One period line for the whole deck, taken from whichever platform is present, in preference
    # order. Three period lines is how a deck ends up quoting three different date ranges.
    period_label = ""
    for c, key in ((gsc_ctx, "period"), (ga4_ctx, "period_label"), (ads_ctx, "period_label")):
        if not c:
            continue
        period_label = (c.get("period") or {}).get("label", "") if key == "period" else c.get(key, "")
        if period_label:
            break
    period_label = period_label or f"last {days} days"

    head = (
        f"Combined digital performance report for {client}. It brings together {sources} into ONE "
        f"report about ONE business.\n"
        f"Reporting period: {period_label} (last {days} days, compared with the previous {days} days).\n"
        f"On the COVER slide, show this reporting period ({period_label}) as the subtitle.\n")
    if cross and cross.get("period_mismatch"):
        head += cross["period_mismatch"] + "\n"

    blocks = [head.rstrip()]

    cc = _cross_channel_block(cross)
    if cc:
        blocks.append(cc)

    # Each platform: its sections, or an explicit absence marker. Silence is what makes a planner
    # invent data — the same reason _empty_note exists for emptied query sections.
    if gsc_ctx:
        blocks.append("=== ORGANIC SEARCH (Google Search Console) ===\n"
                      + _gsc_data_brief(gsc_ctx, compact=True, include_ga4=False, sections_only=True))
    else:
        blocks.append("(No Search Console data for this client — OMIT every organic-search slide. "
                      "Do NOT describe paid or analytics data as 'organic search'.)")

    if ga4_ctx:
        blocks.append("=== WEBSITE ANALYTICS ===\n" + _ga4_brief_sections(ga4_ctx))
    else:
        blocks.append("(No Analytics data for this client — OMIT every on-site behaviour, "
                      "engagement and channel-mix slide.)")

    if ads_ctx:
        blocks.append("=== PAID SEARCH (Google Ads) ===\n"
                      + _ads_brief_sections(ads_ctx, compact=True, deep=ads_deep, prefix="PAID "))
    else:
        blocks.append("(No Google Ads data for this client — OMIT every paid-search slide AND every "
                      "paid-vs-organic comparison. Do NOT infer paid performance from other data.)")

    blocks.append(_HONESTY_CLOSER)
    return "\n\n".join(blocks)


async def generate_ai_combined_deck(*, days: int = 28,
                                    gsc_service=None, property_url: str = "",
                                    ga4_service=None, ga4_property_id: str = "",
                                    ads_service=None, ads_customer_id: str = "",
                                    ads_label: str = "",
                                    provider: str = "deepseek", prompt: Optional[str] = None,
                                    images: bool = True, notes: str = "", on_progress=None,
                                    creativity: str = "balanced", pipeline: str = "single",
                                    models: Optional[dict] = None, theme_mode: str = "tbs",
                                    custom_color: Optional[str] = None, style: str = "tbs",
                                    brand_terms: Optional[str] = None) -> Dict:
    """One deck from any combination of GSC, GA4 and Google Ads.

    Every platform is optional and every fetch degrades independently: a client with no Ads refresh
    token still gets their organic deck, and it says NOTHING about paid rather than inventing it.
    At least one platform must load, otherwise there is no report to write."""
    from services.ai_deck_service import (generate_deck_html, resolve_ai_images, resolve_ai_icons,
                                          _AI_IMG_RE, COMBINED_STRUCTURE, _apply_theme)
    from services.cross_channel import compute_cross_channel
    from services.highlights import to_brief_block

    gsc_ctx = ga4_ctx = ads_ctx = ads_deep = None

    if gsc_service and property_url:
        if on_progress:
            await on_progress("Gathering Search Console data…")
        try:
            gsc_ctx = await assemble_gsc_context(gsc_service, property_url, days,
                                                 ga4_service=ga4_service, brand_terms=brand_terms)
        except Exception:
            logger.exception("combined deck: Search Console fetch failed")

    if ga4_service:
        # Without GSC there is no domain to match on, so the property must have been chosen.
        pid = ga4_property_id
        if not pid and gsc_ctx:
            try:
                match = await ga4_service.find_property_for_domain(gsc_ctx["domain"])
                pid = (match or {}).get("property_id") or ""
            except Exception:
                logger.warning("combined deck: GA4 auto-match failed", exc_info=True)
        if pid:
            if on_progress:
                await on_progress("Gathering Analytics data…")
            try:
                ga4_ctx = await assemble_ga4_context(ga4_service, pid, days,
                                                     label=(gsc_ctx or {}).get("domain", ""))
            except Exception:
                logger.exception("combined deck: GA4 fetch failed")

    if ads_service and ads_customer_id:
        if on_progress:
            await on_progress("Gathering Google Ads data…")
        try:
            ads_ctx = await assemble_ads_context(ads_service, ads_customer_id, days)
        except Exception:
            logger.exception("combined deck: Google Ads fetch failed")
        if ads_ctx:
            # Deep-dive is the ONLY source of paid search terms, so losing it costs the overlap
            # slides but must not cost the whole paid section.
            try:
                ads_deep = await ads_service.get_deep_dive(ads_customer_id, days)
            except Exception:
                logger.warning("combined deck: Ads deep-dive failed — no overlap slides",
                               exc_info=True)

    if not any((gsc_ctx, ga4_ctx, ads_ctx)):
        raise ValueError("No platform data could be loaded for this client — check the selected "
                         "property/account and that the connected Google account has access.")

    # ONE identity for the whole deck: palette, typographic seed and cover title. GSC is preferred
    # because it carries a real domain; without it fall back to whatever names the client.
    client = ((gsc_ctx or {}).get("domain")
              or (ga4_ctx or {}).get("name")
              or ads_label or (f"Account {ads_customer_id}" if ads_customer_id else "") or "Report")

    cross = compute_cross_channel(
        gsc_ctx, ga4_ctx, ads_ctx, ads_deep,
        brand_cores=_brand_cores((gsc_ctx or {}).get("domain", ""), brand_terms))

    brief = _combined_data_brief(gsc_ctx, ga4_ctx, ads_ctx, client=client, days=days,
                                 ads_label=ads_label, ads_deep=ads_deep,
                                 cross=cross) + to_brief_block(notes)

    palette = await resolve_deck_palette(theme_mode, custom_color, client)
    brand = _brand_accent_directive(palette["accent"], palette["accent2"])
    image_cache = {} if images else None
    artifacts = {}
    html = await generate_deck_html(brief, prompt=prompt, brand=brand,
                                    structure=COMBINED_STRUCTURE, provider=provider,
                                    on_progress=on_progress, image_cache=image_cache,
                                    seed=client, creativity=creativity,
                                    pipeline=pipeline, models=models, style=style,
                                    artifacts=artifacts)
    html = (await resolve_ai_images(html, on_progress=on_progress, image_cache=image_cache)
            if images else _AI_IMG_RE.sub("", html))
    html = resolve_ai_icons(html)
    html = _apply_theme(html, palette["accent"], palette["accent2"])
    return {
        "domain": client,
        "html": html,
        "artifacts": artifacts,
        "platforms": [n for n, c in (("gsc", gsc_ctx), ("ga4", ga4_ctx), ("ads", ads_ctx)) if c],
    }


async def assemble_bing_context(access_token: str, site: str, days: int = 28,
                                ai_perf_csv: Optional[str] = None,
                                ai_perf_data: Optional[Dict] = None) -> Dict:
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

    # Prefer an already-parsed AI-performance dict (auto-pulled via bookmarklet); otherwise parse
    # the manually uploaded CSV. Either way `ai` matches parse_ai_performance_csv's shape.
    ai = ai_perf_data or (bing_service.parse_ai_performance_csv(ai_perf_csv) if ai_perf_csv else None)

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
        gq = ai.get("queries") or []
        if gq:
            gq_lines = "\n".join(
                f"  - {q.get('query','')}: {q.get('citations',0)} citations, "
                f"{q.get('citation_share','n/a')} citation share, intent {q.get('intent','n/a')}, "
                f"topic {q.get('topic','n/a')}"
                for q in gq[:15]
            )
            brief += f"""
GROUNDING QUERIES (the search phrases Copilot generated to retrieve this site, ranked by citations —
use for a table showing which AI queries the site wins, with intent/topic/citation-share):
{gq_lines}
"""

    brief += ("\nUse only these numbers. Report declines HONESTLY and PROMINENTLY — state each drop with "
              "its real number and movement, the likely cause, and the specific fix. Professional and calm, "
              "never alarmist, but never hidden or spun.")
    return brief


async def generate_ai_bing_deck(access_token: str, site: str, days: int = 28, *,
                                label: str = "", provider: str = "deepseek",
                                prompt: Optional[str] = None, images: bool = True,
                                notes: str = "", ai_perf_csv: Optional[str] = None,
                                ai_perf_data: Optional[Dict] = None,
                                on_progress=None, creativity: str = "balanced",
                                pipeline: str = "single", models: Optional[dict] = None,
                                theme_mode: str = "tbs", custom_color: Optional[str] = None,
                                style: str = "tbs") -> Dict:
    """AI-designed Bing search deck for one verified site. Returns the HTML only —
    the file is rendered on download. `label` is the site display name (for the cover)."""
    from services.ai_deck_service import (generate_deck_html, resolve_ai_images, resolve_ai_icons,
                                          _AI_IMG_RE, BING_STRUCTURE, _apply_theme)
    from services.highlights import to_brief_block
    if on_progress:
        await on_progress("Gathering Bing Webmaster data…")
    context = await assemble_bing_context(access_token, site, days, ai_perf_csv=ai_perf_csv,
                                          ai_perf_data=ai_perf_data)
    name = label or site
    brief = _bing_data_brief(context, name) + to_brief_block(notes)
    palette = await resolve_deck_palette(theme_mode, custom_color, name)
    brand = _brand_accent_directive(palette["accent"], palette["accent2"])
    image_cache = {} if images else None
    artifacts = {}   # filled with per-slide md/html by the per-slide pipeline
    html = await generate_deck_html(brief, prompt=prompt, brand=brand,
                                    structure=BING_STRUCTURE, provider=provider,
                                    on_progress=on_progress, image_cache=image_cache,
                                    seed=name, creativity=creativity,
                                    pipeline=pipeline, models=models, style=style,
                                    artifacts=artifacts)
    html = (await resolve_ai_images(html, on_progress=on_progress, image_cache=image_cache)
            if images else _AI_IMG_RE.sub("", html))
    html = resolve_ai_icons(html)
    html = _apply_theme(html, palette["accent"], palette["accent2"])
    return {"site": site, "domain": name, "html": html, "artifacts": artifacts}


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
