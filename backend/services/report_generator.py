"""AI monthly SEO report generator.

Assembles a normalized data snapshot for a client site, then has Claude write a
polished, client-facing monthly report from it. Today it draws on SE Ranking
keyword data; GSC and GA4 sections plug into `assemble_context()` the same way as
those integrations come online.
"""
from typing import Dict, List, Optional
from pathlib import Path
from datetime import datetime, timedelta
import asyncio
import json
import logging
import re

from services.ai_service import ai_service

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


def property_display(property_url: str) -> tuple:
    """Human label + bare domain for a GSC property string, PRESERVING what makes distinct
    properties distinct. `sc-domain:x`, `https://x`, `https://www.x` and `http://x` share a bare
    domain but are different properties with different data — so the label keeps scheme/www/path.

    Returns (label, bare_domain). `_domain_from_property` stays the bare-domain source of truth.
    """
    domain = _domain_from_property(property_url)
    if property_url.startswith("sc-domain:"):
        return domain, domain
    try:
        from urllib.parse import urlparse
        u = urlparse(property_url)
        host = u.netloc  # keeps www.
        path = (u.path or "").rstrip("/")
        label = f"{host}{path}" or property_url
        if u.scheme == "http":
            label = "http://" + label
        return label, domain
    except Exception:
        return property_url, domain


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

    # Site-wide revenue, only when the property records any (0 => not an ecommerce site).
    # For a shop this outranks every engagement metric above it.
    _rev = _num(t.get("revenue"))
    ga4_money = ""
    if _rev > 0:
        ga4_money = (
            f"\n- REVENUE (site-wide, all channels): {t.get('revenue', 0)} "
            f"({_delta(d.get('revenue'))})"
            f"\n- Average order value: {t.get('aov', 0)} ({_delta(d.get('aov'))})"
            f"\n  THIS IS AN E-COMMERCE SITE — revenue is the headline measure. Fewer conversions "
            f"with higher revenue is a GOOD period; lead with the revenue figure and never report "
            f"the conversion drop as a decline on its own.")
    return f"""WEBSITE ANALYTICS (Google Analytics / GA4) — on-site behaviour for the same site and period.

AUDIENCE & ENGAGEMENT (current value, change vs previous period):
- Sessions: {t.get('sessions', 0)} ({_delta(d.get('sessions'))})
- Total users: {t.get('users', 0)} ({_delta(d.get('users'))})
- New users: {t.get('new_users', 0)} ({_delta(d.get('new_users'))})
- Pageviews: {t.get('pageviews', 0)} ({_delta(d.get('pageviews'))})
- Engagement rate: {t.get('engagement_rate', 0)}% ({_delta(d.get('engagement_rate'), 'pp')})
- Bounce rate: {t.get('bounce_rate', 0)}% ({_delta(d.get('bounce_rate'), 'pp')}; lower is better)
- Avg session duration: {t.get('avg_session_duration', 0)}s ({_delta(d.get('avg_session_duration'))})
- Conversions: {t.get('conversions', 0)} ({_delta(d.get('conversions'))}){ga4_money}

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
    period_label = period.get("label", f"last {ctx.get('days', 28)} days")
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
{brand_rule}Reporting period: {period_label} (last {ctx.get('days', 28)} days, compared with the previous {ctx.get('days', 28)} days).
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
                               provider: str = None, prompt: Optional[str] = None,
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

    period_label = ctx.get("period_label") or f"last {ctx.get('days', 28)} days"
    core = _ga4_brief_sections(ctx)
    return f"""Website analytics (Google Analytics / GA4) report for {ctx['name']}.
Reporting period: {period_label} (last {ctx.get('days', 28)} days, compared with the previous {ctx.get('days', 28)} days).
On the COVER slide, show this reporting period ({period_label}) as the subtitle.

{core}

BY DEVICE (sessions by device category):
{device_lines}

GEOGRAPHY — SESSIONS BY COUNTRY (use for a choropleth world map + a top-countries bar).
Country values are full English names — render a Plotly choropleth with "locationmode":"country names", shaded by sessions.
{geo_lines}

Use only these numbers. Report declines HONESTLY and PROMINENTLY — state each drop with its real number and movement, the likely cause, and the specific fix. Professional and calm, never alarmist, but never hidden or spun."""


async def generate_ai_ga4_deck(service, property_id: str, days: int = 28, *,
                               label: str = "", provider: str = None,
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


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


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
    def _camp(c):
        # A campaign table ranked by cost with no revenue column cannot show which campaigns
        # actually pay for themselves — the whole question for an e-commerce account.
        base = (f"  - {c.get('name','')} ({c.get('status','')}): {c.get('impressions',0)} impressions, "
                f"{c.get('clicks',0)} clicks, {c.get('cost',0)}{cur_sfx} cost, "
                f"{c.get('conversions',0)} conversions")
        if _num(c.get("conversions_value")) > 0:
            base += f", {c.get('conversions_value')}{cur_sfx} revenue, {c.get('roas', 0)}x ROAS"
        return base

    campaign_lines = "\n".join(_camp(c) for c in campaign_rows) or "  (none)"

    # REVENUE, when the account records any. For an e-commerce client this is the point of the whole
    # report: conversion COUNT can fall while revenue RISES (fewer, larger orders), and a deck that
    # only counts conversions calls that a decline. Emitted only when conversion value exists, so
    # lead-gen accounts are not padded with "Revenue: 0" lines.
    revenue = _num(t.get("conversions_value"))
    conv = _num(t.get("conversions"))
    money = ""
    if revenue > 0:
        aov = round(revenue / conv, 2) if conv else 0
        money = f"""
- Conversion value (REVENUE): {t.get('conversions_value', 0)}{cur_sfx} ({_delta(d.get('conversions_value'))})
- ROAS (revenue returned per unit of spend): {t.get('roas', 0)}x ({_delta(d.get('roas'))})
- Average order value: {aov}{cur_sfx}
  THIS ACCOUNT EARNS REVENUE PER ORDER — judge it on REVENUE and ROAS FIRST, conversion count second.
  If conversions fell but revenue rose, that is a WIN (fewer, larger orders), NOT a decline: say so
  plainly and lead with the revenue figure. Never headline a conversion-count drop without the
  revenue movement stated beside it."""

    out = f"""{prefix}ACCOUNT PERFORMANCE (current value, change vs previous period):
- Impressions: {t.get('impressions', 0)} ({_delta(d.get('impressions'))})
- Clicks: {t.get('clicks', 0)} ({_delta(d.get('clicks'))})
- CTR: {t.get('ctr', 0)}% ({_delta(d.get('ctr'), 'pp')})
- Avg CPC: {t.get('avg_cpc', 0)}{cur_sfx} ({_delta(d.get('avg_cpc'))})
- Cost: {t.get('cost', 0)}{cur_sfx} ({_delta(d.get('cost'))})
- Conversions: {t.get('conversions', 0)} ({_delta(d.get('conversions'))})
- Conversion rate: {t.get('conversion_rate', 0)}% ({_delta(d.get('conversion_rate'), 'pp')})
- Cost per conversion: {t.get('cost_per_conversion', 0)}{cur_sfx} ({_delta(d.get('cost_per_conversion'))}; lower is better){money}

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
        def _term(x):
            base = (f"  - {x.get('term','')}: {x.get('clicks',0)} clicks, {x.get('cost',0)}{cur_sfx} "
                    f"cost, {x.get('conversions',0)} conversions")
            if _num(x.get("conversions_value")) > 0:
                base += f", {x.get('conversions_value')}{cur_sfx} revenue, {x.get('roas', 0)}x ROAS"
            return base

        st = "\n".join(_term(x) for x in (deep.get("search_terms") or [])[:12]) or "  (none)"
        out += f"\n\nTOP PAID KEYWORDS (by conversions):\n{kw}\n\nTOP PAID SEARCH TERMS (what people actually typed):\n{st}"
    return out


def _ads_data_brief(ctx: Dict, label: str) -> str:
    cur = ctx.get("currency") or ""
    period_label = ctx.get("period_label") or f"last {ctx.get('days', 28)} days"
    return f"""Paid search (Google Ads) report for {label}. All costs are in {cur or 'the account currency'}.
Reporting period: {period_label} (last {ctx.get('days', 28)} days, compared with the previous {ctx.get('days', 28)} days).
On the COVER slide, show this reporting period ({period_label}) as the subtitle.

{_ads_brief_sections(ctx)}

{_HONESTY_CLOSER}"""


async def generate_ai_ads_deck(service, customer_id: str, days: int = 28, *,
                               label: str = "", provider: str = None,
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
        # Revenue outranks every count above it for an e-commerce client.
        if b.get("ads_revenue") is not None:
            lines.append(f"- PAID REVENUE (conversion value): {b['ads_revenue']}{sfx}")
        if b.get("roas") is not None:
            lines.append(f"- PAID ROAS: {b['roas']}x — revenue returned per unit of ad spend")
        if b.get("aov") is not None:
            lines.append(f"- Average order value: {b['aov']}{sfx}")
        if b.get("ga4_revenue") is not None:
            lines.append(f"- SITE-WIDE REVENUE (all channels, from GA4): {b['ga4_revenue']}{sfx}")
        if b.get("blended_roas") is not None:
            # Deliberately caveated: this divides ALL site revenue by paid spend, so it includes
            # revenue paid did not generate. Presented bare it flatters the ad account.
            lines.append(
                f"- BLENDED ROAS (TOTAL site revenue / paid spend): {b['blended_roas']}x — this "
                f"counts revenue from EVERY channel against the ad spend alone, so it is NOT a "
                f"measure of paid performance. Use it only to show what the whole business returns "
                f"per unit of media invested, and say that is what it is. Paid ROAS above is the "
                f"figure that judges the ad account.")
        if b.get("is_ecommerce"):
            lines.append("  THIS IS AN E-COMMERCE CLIENT. Revenue and ROAS are the headline measures "
                         "on EVERY slide that reports performance — conversion counts are secondary. "
                         "A period with fewer conversions but higher revenue is a GOOD period; say so.")
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
            # Revenue per term decides whether "you already rank for this" is actually a criticism.
            money = (f", {r['ads_value']}{sfx} revenue, {r['ads_roas']}x ROAS"
                     if r.get("ads_value") else "")
            rows.append(
                f"- {r['bucket']}{brand}: \"{r['term']}\" — {pos}, {r['organic_clicks']} organic "
                f"clicks | paid: {r['ads_clicks']} clicks, {r['ads_cost']}{sfx}, "
                f"{r['ads_conversions']} conversions{money}")
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
                                    provider: str = None, prompt: Optional[str] = None,
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

    period_label = ctx.get("period_label") or f"last {ctx.get('days', 28)} days"
    brief = f"""Bing (Microsoft) organic search report for {label}.
Reporting period: {period_label} (last {ctx.get('days', 28)} days, compared with the previous {ctx.get('days', 28)} days).
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
                                label: str = "", provider: str = None,
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


# ============================================================================
# PROSPECT PROPOSAL DECK (AIO / GEO / AEO pitch)
# ============================================================================
# Sales collateral for a site we have no access to. Everything measurable comes from a prospect
# analysis (SERP + Mangools + AI Overview readings); there is deliberately NO Search Console data.

# Edit these rates here — they are the only place pricing is defined, so changing a tier needs no
# code change elsewhere. Taken from the Panorama proposal as the standing TBS rate card.
PROPOSAL_PRICING = {
    "currency": "THB",
    "tiers": [
        {"name": "Starter", "monthly": 40000,
         "for": "Single location, one language, core AI visibility",
         "includes": ["10 tracked AI prompts", "50 SEO keywords", "2 answer pages / month",
                      "Monthly dashboard"]},
        {"name": "Mid-Market", "monthly": 80000,
         "for": "Multi-service or multi-language, competitive niche",
         "includes": ["30 tracked AI prompts", "150 SEO keywords", "5 answer pages / month",
                      "Digital PR outreach", "Monthly dashboard + review"]},
        {"name": "Enterprise", "monthly": 150000,
         "for": "Multi-location or multi-brand, category leadership",
         "includes": ["75+ tracked AI prompts", "400+ SEO keywords", "10+ answer pages / month",
                      "Tier-1 digital PR", "Quarterly strategy review"]},
        {"name": "Custom", "monthly": None,
         "for": "Groups, franchises, or bespoke scope",
         "includes": ["Scoped to requirement"]},
    ],
    "one_time_audit": 25000,
    "scales_with": ["tracked AI prompts", "SEO keywords", "locations / languages",
                    "content pieces per month", "backlink and PR volume"],
}

# Stated as fact in the deck, so keep these sourced and current rather than letting the model
# invent market statistics — the structure explicitly forbids inventing any.
PROPOSAL_WHY_NOW = [
    "AI Overviews now appear on the majority of informational Google queries.",
    "Users who see an AI answer still click through when the source is cited — being cited is the "
    "new click.",
    "Assistants answer from a retrieval index, not from a ranking page: being #1 on Google does not "
    "mean being present in the answer.",
]

# Which retrieval index each assistant leans on — the AEO argument for why one strategy is not enough.
PROPOSAL_AI_INDEX_MAP = [
    {"assistant": "ChatGPT Search", "index": "Bing"},
    {"assistant": "Claude", "index": "Brave"},
    {"assistant": "Google AI Overviews / Gemini", "index": "Google"},
    {"assistant": "Perplexity", "index": "Own crawler + Bing"},
    {"assistant": "Copilot", "index": "Bing"},
]


def _proposal_brief(analysis: Dict) -> str:
    """Turn a stored prospect analysis into the deck's data brief.

    Reads ONLY what a prospect run can produce. Anything absent is rendered as "(none)" so the
    model omits that slide rather than inventing content for it.
    """
    maps = analysis.get("topical_maps") or []
    m = maps[0] if maps else {}
    strat = m.get("content_strategy") or {}
    aiv = m.get("ai_visibility") or {}
    domain = _domain_from(m.get("url") or "")
    brand = m.get("central_entity") or domain

    def _lines(rows, fmt, empty="(none)"):
        out = [fmt(r) for r in rows]
        return "\n".join(out) if out else empty

    kw = [k for k in (m.get("keyword_volumes") or []) if k.get("keyword")][:15]
    arts = (m.get("content_articles") or [])[:10]
    comps = (m.get("competitive_analysis") or {}).get("top_competitors") or []

    cited = aiv.get("top_cited_competitors") or []
    # Three distinct states, and conflating them would put a false claim in a client-facing deck:
    #   missing   — the analysis predates AI-visibility capture, so nothing was measured
    #   measured, no AI Overviews appeared
    #   measured, with results
    if not aiv:
        ai_block = ("(NOT MEASURED — this analysis was run before AI visibility capture existed. "
                    "OMIT the visibility and cited-competitors slides entirely; do NOT state or "
                    "imply anything about this brand's presence in AI answers.)")
    elif not aiv.get("queries_checked"):
        ai_block = "(none — no queries could be checked)"
    else:
        ai_block = ""
    if aiv.get("queries_checked"):
        ai_block = (
            f"  Queries checked: {aiv.get('queries_checked')}\n"
            f"  Returned an AI Overview: {aiv.get('ai_overview_present')}\n"
            f"  Of those, resolved (sources readable): {aiv.get('resolved')}\n"
            f"  {brand} was cited in: {aiv.get('cited_count')} of {aiv.get('resolved')}\n"
            f"  Cited on: {', '.join(aiv.get('cited_queries') or []) or '(none)'}\n"
            f"  Absent on: {', '.join(aiv.get('not_cited_queries') or []) or '(none)'}"
        )

    return f"""BRAND: {brand}
DOMAIN: {domain}
BUSINESS MODEL: {m.get('business_model') or '(unknown)'}
CENTRAL ENTITY: {m.get('central_entity') or '(unknown)'}

WHY NOW (state these as given; do NOT add statistics of your own):
{chr(10).join('  - ' + f for f in PROPOSAL_WHY_NOW)}

AI ASSISTANT → RETRIEVAL INDEX:
{_lines(PROPOSAL_AI_INDEX_MAP, lambda r: f"  {r['assistant']} → {r['index']}")}

AI VISIBILITY (measured on live SERPs — report as a fraction, never as a market percentage):
{ai_block}

CITED COMPETITORS (domains the AI cited instead):
{_lines(cited, lambda r: f"  {r['domain']} — cited {r['citations']}x")}

COMPETITORS (organic):
{_lines([{'d': c} for c in comps[:10]], lambda r: f"  {r['d']}")}

KEYWORD OPPORTUNITIES (real monthly volume):
{_lines(kw, lambda k: f"  {k.get('keyword')} — {k.get('avg_monthly_searches') or 0}/mo, KD {k.get('kd')}")}

CORE TOPICS (revenue-driving): {', '.join(strat.get('core_topics') or []) or '(none)'}
OUTER TOPICS (authority-building): {', '.join(strat.get('outer_topics') or []) or '(none)'}
CONTENT GAPS: {', '.join(strat.get('content_gaps') or []) or '(none)'}

CONTENT PLAN (representative sample of a larger map):
{_lines(arts, lambda a: f"  {a.get('main_entity')} · {a.get('context')} · {a.get('suggested_url') or '(proposed)'} · {a.get('search_volume') or '—'}/mo")}

PRICING (currency {PROPOSAL_PRICING['currency']}; one-time audit {PROPOSAL_PRICING['one_time_audit']}):
{_lines(PROPOSAL_PRICING['tiers'], lambda t: f"  {t['name']} — {t['monthly'] or 'on application'}/mo — {t['for']} — includes: {'; '.join(t['includes'])}")}
  Scales with: {', '.join(PROPOSAL_PRICING['scales_with'])}
"""


def _domain_from(url: str) -> str:
    from urllib.parse import urlparse
    try:
        return (urlparse(url).netloc or url).replace("www.", "").strip("/")
    except Exception:
        return (url or "").replace("www.", "").strip("/")


_TEMPLATE_DIR = Path(__file__).parent / "templates"


def _proposal_css() -> str:
    return (_TEMPLATE_DIR / "proposal_deck.css").read_text(encoding="utf-8")


def _proposal_page(brand: str, slides_html: str, viewer: bool = False, intro: str = "") -> str:
    """Assemble the proposal page.

    Two outputs, deliberately different:
      viewer=False (default) — plain slides. This is what gets STORED and previewed: the preview
        renderer screenshots each `.slide`, and the viewer script relocates every slide into a
        single stage and hides the rest, which made the renderer find nothing and produce an
        empty carousel.
      viewer=True — the reference's standalone deck: stage, keyboard nav, fullscreen, PDF
        download. Used only when publishing, where a browser actually runs the script.
    """
    def _tpl(name, default=""):
        try:
            return (_TEMPLATE_DIR / name).read_text(encoding="utf-8")
        except Exception:
            logger.warning("proposal template %s missing", name)
            return default

    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{_esc(brand)} — AI Search Visibility Proposal</title>"
        f"<style>{_proposal_fonts()}</style>"
        f"<style>{_proposal_css()}</style>"
        + (f"<style>{_tpl('proposal_intro.css')}</style>"
           f"<style>{_tpl('proposal_viewer.css')}</style>" if viewer else "")
        + "</head><body>"
        # The summary sections and the viewer chrome only make sense on the published page; the
        # stored copy stays plain slides so the preview renderer can screenshot them.
        # On the stored copy the summary lives inside a <template>: browsers never render it and
        # the preview renderer never sees it, but publishing can lift it back out verbatim.
        + ((intro if viewer
            else f'<template id="proposal-intro">{intro}</template>') if intro else "")
        + (_tpl("proposal_viewer.html") if viewer else "")
        + slides_html
        + (f"<script>{_tpl('proposal_viewer.js')}</script>" if viewer else "")
        + "</body></html>")


def proposal_page_for_publish(brand: str, stored_html: str) -> str:
    """Re-wrap a stored proposal with the slide viewer, for publishing.

    The stored deck is plain slides so the preview renderer can screenshot them; the published
    site wants the interactive deck. Pull the slides back out and re-assemble.
    """
    m = re.search(r"<body[^>]*>(.*)</body>", stored_html, re.S)
    inner = m.group(1) if m else stored_html
    mi = re.search(r'<template id="proposal-intro">(.*?)</template>', inner, re.S)
    intro = mi.group(1) if mi else ""
    slides = inner.replace(mi.group(0), "") if mi else inner
    return _proposal_page(brand, slides, viewer=True, intro=intro)


def _proposal_fonts() -> str:
    """Kanit + Outfit as base64 @font-face rules.

    The PDF pipeline does not fetch the Google Fonts stylesheet, so a remote <link> silently falls
    back and the deck renders in the browser default — which is why every export so far came out in
    the wrong typeface. Embedding removes the network dependency entirely. Latin subsets only:
    the full family set (thai/cyrillic/vietnamese) would triple the file for no benefit here.
    """
    try:
        return (_TEMPLATE_DIR / "proposal_fonts.css").read_text(encoding="utf-8")
    except Exception:
        logger.warning("embedded proposal fonts missing — falling back to the remote stylesheet")
        return ""


def _proposal_examples() -> str:
    return (_TEMPLATE_DIR / "proposal_examples.html").read_text(encoding="utf-8")


# The reference deck's exact running order. The model fills these in; it does not choose them.
PROPOSAL_SLIDES = [
    ("01 · Cover", "Cover — the promise in four words, brand and date. No metrics."),
    ("02 · Contents", "Contents — the six sections as a simple numbered list."),
    ("Section 01", "Section divider — 'Why now'."),
    ("04 · The shift", "How buyers discover this category has changed. Use the WHY NOW facts verbatim."),
    ("05 · What 'good enough' SEO misses", "The trap: ranking is not being cited. Problem cards."),
    ("Section 02", "Section divider — 'One strategy'."),
    ("07 · The unified thesis", "AIO + GEO + AEO as one discipline strengthening entity prominence."),
    ("08 · Old SEO vs Modern SEO", "Two compare-cards: same craft, different surface."),
    ("Section 03", "Section divider — 'The 3 pillars'."),
    ("10 · AIO", "AIO — visibility inside AI answers. Two sentences plus what it requires."),
    ("11 · GEO", "GEO — influencing what future models learn."),
    ("12 · AEO", "AEO — winning the retrieval path. Include the assistant→index table."),
    ("13 · How the 3 pillars work together", "One team, one strategy, three surfaces."),
    ("Section 04", "Section divider — '{brand} audit'."),
    ("15 · Current state", "KPI stats from the analysis: demand available, competitors, coverage. "
                           "If AI VISIBILITY is NOT MEASURED, omit every AI-presence number here."),
    ("16 · Where {brand} isn't cited", "AI VISIBILITY as a fraction plus the absent queries, and "
                                       "CITED COMPETITORS as a table. OMIT THIS SLIDE ENTIRELY if not measured."),
    ("17 · The coverage gap", "CORE vs OUTER topics and the gaps — the topical map, from the analysis."),
    ("Section 05", "Section divider — 'The plan'."),
    ("19 · Plan of action", "The sequenced steps, numbered, each with its deliverable."),
    ("20 · What we measure", "Leading vs lagging indicators and the reporting cadence."),
    ("21 · Why TBS", "Short credibility slide."),
    ("22 · Next steps", "The immediate first step and what it produces."),
    ("Section 06", "Section divider — 'Pricing'."),
    ("24 · Investment", "PRICING tiers as comparison cards plus the one-time audit."),
    ("25 · Close", "Closing slide — the gap found, the first step, contact."),
]


_PHOTO_BAD = ("logo", "icon", "sprite", "favicon", "avatar", "badge", "placeholder",
              "award", "banner", ".svg", ".gif")
_PHOTO_EXT = (".jpg", ".jpeg", ".png", ".webp", ".avif")


def _site_photos(analysis: Dict) -> list:
    """Every usable photograph from the analysed site, with the words in its path.

    Image paths are how we match a picture to a topic — a hotel files its photos under
    /Wellness/, /Zimmer/, /Restaurant/, which is exactly the vocabulary the topical map uses.
    """
    import urllib.parse
    seen, out = set(), []
    for page in (analysis.get("scraped_data") or []):
        urls = [(i.get("src") or i.get("url") or "") for i in (page.get("images") or [])]
        urls += re.findall(r"!\[[^\]]*\]\((https?://[^\s\)]+)\)", page.get("markdown") or "")
        for u in urls:
            u = u.strip()
            low = u.lower()
            if (not u.startswith("http") or u in seen
                    or any(b in low for b in _PHOTO_BAD)
                    or not any(low.split("?")[0].endswith(e) for e in _PHOTO_EXT)):
                continue
            seen.add(u)
            words = {w.lower() for w in re.findall(r"[A-Za-zÀ-ÿ]{4,}",
                                                   urllib.parse.unquote(u))}
            out.append({"url": u, "words": words})
    return out


def _photo_for(text: str, photos: list, used: set) -> str:
    """Best unused photo for this slide, matched on shared words with its path.

    Prefix matching (4+ chars) rather than equality, so an English topic still finds a
    German folder — "Suites" matches "Suiten", "Wellness" matches "Wellness".
    """
    if not photos:
        return ""
    want = {w.lower() for w in re.findall(r"[A-Za-zÀ-ÿ]{4,}", text or "")}
    best, best_score = None, 0
    for ph in photos:
        if ph["url"] in used:
            continue
        score = sum(1 for a in want for b in ph["words"]
                    if a == b or a[:5] == b[:5])
        if score > best_score:
            best, best_score = ph, score
    if best is None:                       # nothing matched — take the next unused photo
        best = next((p for p in photos if p["url"] not in used), None)
    if not best:
        return ""
    used.add(best["url"])
    return best["url"]


def _proposal_hero_image(analysis: Dict) -> str:
    """Pick a hero photo for the cover/close from the ANALYSED SITE's own scraped images.

    A proposal about a hotel should show that hotel, not stock photography — and we already
    crawled the site, so its own imagery is right there. Prefers a large content image over
    logos/icons/sprites, which make for poor covers.
    """
    # The scraper's `images` list is populated only by the BeautifulSoup path; every analysis here
    # comes through Firecrawl, where the images live in the markdown as ![alt](url). Read both, so
    # this works on analyses that already exist rather than needing a re-scrape.
    bad = ("logo", "icon", "sprite", "favicon", "avatar", "badge", "placeholder",
           "award", "banner", ".svg", ".gif")
    candidates = []
    for page in (analysis.get("scraped_data") or []):
        for img in (page.get("images") or []):
            src = (img.get("src") or img.get("url") or "").strip()
            if src.startswith("http") and not (img.get("alt") or "").lower().startswith(("logo", "icon")):
                candidates.append(src)
        candidates += re.findall(r"!\[[^\]]*\]\((https?://[^\s\)]+)\)", page.get("markdown") or "")

    for src in candidates:
        low = src.lower()
        if any(b in low for b in bad):
            continue
        # Skip anything that is plainly not a photograph.
        if not any(low.split("?")[0].endswith(e) for e in (".jpg", ".jpeg", ".png", ".webp", ".avif")):
            continue
        return src
    return ""


TOPICAL_MAP_TOKEN = "<!--TOPICAL_MAP-->"


def _fix_intro_images(intro_html: str, tmap_html: str) -> str:
    """Resolve the reference intro's images, which all point at RELATIVE files.

    The reference page ships four screenshots (prompts-0pct.jpg, topic-map.jpg,
    content-strategy.jpg, seranking-current-state.png) that exist only next to the original
    deployment. Published anywhere else they 404 and the prospect sees broken-image alt text —
    which is what shipped.

    Only one of them has a real equivalent for a new client: the topical map, which we already
    render ourselves. That figure becomes the client's OWN map, inlined as SVG (vector, so it stays
    sharp and needs no rasteriser on the server).

    Every other figure is REMOVED rather than back-filled with a site photo. Those figures are data
    screenshots — a decorative photo under a caption reading "list of benchmark AI prompts" reads as
    a mistake, and the remaining ones are screenshots of the reference client's own dashboard, which
    must never reach a different prospect. The cards keep their stat blocks and prose either way.
    """
    if not intro_html:
        return intro_html

    def _replace(mo):
        block = mo.group(0)
        if 'topic-map' in block or 'topical map' in block.lower():
            return f'<div class="problem-image problem-image-map">{tmap_html}</div>' if tmap_html else ""
        return ""

    # Figures are anchors wrapping an image — matched by shape, not by class, because the audit
    # section uses .audit-image rather than .problem-image and would otherwise leave an empty
    # clickable link behind pointing at the missing file. A bare <img> is handled after.
    out = re.sub(r'<a\b[^>]*href="(?!https?:)[^"]*"[^>]*>\s*<img\b.*?</a>',
                 _replace, intro_html, flags=re.S)
    return re.sub(r'<img[^>]*src="(?!https?:)[^"]*"[^>]*/?>', _replace, out)


def _render_topical_map(m: Dict) -> str:
    """Draw the client's topical map as an SVG cluster diagram.

    SVG rather than a PNG: the deck is assembled server-side where there is no browser to rasterise
    with (the frontend's PNG export uses html-to-image in the page). Inline SVG also stays sharp at
    any print size and needs no hosting — strictly better than a bitmap here.

    Layout is a hub-and-spoke: the central entity at the middle, Core areas on the inner ring
    (revenue), Outer areas on the outer ring (authority), spokes showing they feed the core.
    """
    import math
    cs = m.get("content_strategy") or {}
    core = [t for t in (cs.get("core_topics") or []) if t][:8]
    outer = [t for t in (cs.get("outer_topics") or []) if t][:10]
    gaps = [t for t in (cs.get("content_gaps") or []) if t][:6]
    centre = (m.get("central_entity") or "").strip() or "The brand"
    if not (core or outer):
        return ""

    # Rings must clear each other once label boxes are counted, not just their centres — at the
    # first spacing the outer ring's boxes landed on top of the inner ring's.
    W, H, CX, CY = 1160, 660, 580, 310
    R1, R2 = 175, 315
    parts = [f'<svg viewBox="0 0 {W} {H}" width="100%" xmlns="http://www.w3.org/2000/svg" '
             f'font-family="Kanit, system-ui, sans-serif" role="img" '
             f'aria-label="Topical map for {_esc(centre)}">']

    def ring(items, radius, fill, stroke, rx, offset=0.0):
        out = []
        n = max(len(items), 1)
        for i, label in enumerate(items):
            ang = (2 * math.pi * i / n) - math.pi / 2 + offset
            x, y = CX + radius * math.cos(ang), CY + radius * math.sin(ang) * 0.84
            txt = label if len(label) <= 21 else label[:19] + "…"
            w = max(92, min(172, 7.2 * len(txt) + 20))
            out.append(f'<line x1="{CX}" y1="{CY}" x2="{x:.0f}" y2="{y:.0f}" '
                       f'stroke="#d9dde3" stroke-width="1"/>')
            out.append(
                f'<g><rect x="{x - w/2:.0f}" y="{y - 15:.0f}" width="{w:.0f}" height="30" rx="{rx}" '
                f'fill="{fill}" stroke="{stroke}" stroke-width="1"/>'
                f'<text x="{x:.0f}" y="{y + 5:.0f}" text-anchor="middle" font-size="12" '
                f'fill="#333333">{_esc(txt)}</text></g>')
        return out

    # Outer ring first so the spokes sit behind the inner nodes.
    parts += ring(outer, R2, "#D8F8E4", "#7fd7a5", 15, offset=math.pi / max(len(outer) or 1, 1))
    parts += ring(core, R1, "#D8EBFA", "#6fb6ea", 15)

    cw = max(180, min(300, 9 * len(centre) + 40))
    parts.append(
        f'<rect x="{CX - cw/2:.0f}" y="{CY - 26}" width="{cw:.0f}" height="52" rx="10" '
        f'fill="#333333"/>'
        f'<text x="{CX}" y="{CY + 5}" text-anchor="middle" font-size="15" font-weight="600" '
        f'fill="#ffffff">{_esc(centre if len(centre) <= 30 else centre[:28] + "…")}</text>')

    # Legend
    for i, (lbl, col) in enumerate((("Core — revenue", "#D8EBFA"), ("Outer — authority", "#D8F8E4"))):
        x = 40 + i * 190
        parts.append(f'<rect x="{x}" y="{H - 34}" width="14" height="14" rx="4" fill="{col}" '
                     f'stroke="#b9c4d0"/>'
                     f'<text x="{x + 22}" y="{H - 22}" font-size="12" fill="#6A6B6B">{lbl}</text>')
    parts.append("</svg>")
    svg = "".join(parts)

    nodes, clusters = len(m.get("content_articles") or []), len(m.get("keyword_clusters") or [])
    bits = [f"{len(core)} core areas", f"{len(outer)} supporting areas"]
    if nodes:
        bits.append(f"{nodes} planned pages")
    if clusters:
        bits.append(f"{clusters} SERP-verified clusters")
    gap_html = ""
    if gaps:
        chips = "".join(f'<span class="tmap-chip">{_esc(g)}</span>' for g in gaps)
        gap_html = (f'<div class="tmap-gaps"><div class="tmap-head">Gaps to close</div>'
                    f'<div class="tmap-list">{chips}</div></div>')
    return f'{svg}{gap_html}<p class="tmap-foot">{" · ".join(bits)}</p>'


def _esc(v) -> str:
    return (str(v).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _reference_intro() -> list:
    """The seven summary sections that sit ABOVE the slide viewer on the reference page —
    hero, stats, problem, thesis, pillars, audit, roadmap. Localised exactly like the slides."""
    import json
    try:
        return json.loads((_TEMPLATE_DIR / "proposal_intro.json").read_text(encoding="utf-8"))
    except Exception:
        logger.warning("proposal intro sections missing")
        return []


def _reference_slides() -> list:
    import json
    return json.loads((_TEMPLATE_DIR / "proposal_slides.json").read_text(encoding="utf-8"))


_REWRITE_SYSTEM = (
    "You translate slide copy from one client to another. You never see or write HTML.\n"
    "You are given a numbered list of text fragments taken from an approved slide, and the new "
    "client's data. Return a JSON array of exactly the same length, in the same order, where each "
    "entry is the rewritten version of that fragment.\n"
    "Rules:\n"
    "- Keep each fragment's role, tone and approximate LENGTH. A three-word label stays a "
    "three-word label; a one-line stat caption stays one line.\n"
    "- Swap the old client's name, city, domain and sector wording for the new client's.\n"
    "- Numbers: keep generic market statistics about AI search exactly as they are. Replace "
    "client-specific figures ONLY with values from DATA. If DATA has no equivalent, rewrite the "
    "fragment so it carries no number — never invent one, never keep the old client's.\n"
    "- If a fragment needs no change, return it unchanged.\n"
    "- Output the JSON array only. No prose, no code fences."
)

# Tags whose text is markup, not copy — rewriting these would break the slide.
_SKIP_TAGS = {"script", "style"}


def _slide_text_nodes(soup):
    """Every human-readable text node in a slide, in document order."""
    out = []
    for node in soup.find_all(string=True):
        if node.parent.name in _SKIP_TAGS:
            continue
        if node.strip():
            out.append(node)
    return out


async def _rewrite_slide(slide: dict, brand: str, domain: str, brief: str, provider: str) -> str:
    """Localise one reference slide by replacing ONLY its text nodes.

    The model is never given HTML and never emits HTML — it receives a list of strings and returns
    a list of strings, which we substitute back into the parsed document. Asking a model to "return
    this markup unchanged" does not work: given an 8,000-character slide it rewrites the layout into
    something simpler every time. This removes the possibility.
    """
    from bs4 import BeautifulSoup
    from services.ai_service import ai_service

    soup = BeautifulSoup(slide["html"], "html.parser")
    nodes = _slide_text_nodes(soup)
    if not nodes:
        return slide["html"]

    numbered = "\n".join(f"{i}. {n.strip()}" for i, n in enumerate(nodes))
    user = (f"NEW CLIENT: {brand} ({domain})\n\nDATA (the only client figures you may use):\n{brief}\n\n"
            f"FRAGMENTS ({len(nodes)} of them — return exactly {len(nodes)} strings):\n{numbered}")
    try:
        raw = await ai_service.analyze_with_provider(user, _REWRITE_SYSTEM, provider=provider)
    except Exception as e:
        logger.error("proposal slide %s (%s) failed: %s", slide["n"], slide["label"], str(e)[:160])
        return slide["html"]          # ship the reference wording rather than nothing

    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M).strip()
    try:
        new_texts = json.loads(raw)
        assert isinstance(new_texts, list)
    except Exception:
        logger.warning("proposal slide %s: reply was not a JSON array — keeping reference wording",
                       slide["n"])
        return slide["html"]

    if len(new_texts) != len(nodes):
        logger.warning("proposal slide %s: got %d fragments, expected %d — keeping reference wording",
                       slide["n"], len(new_texts), len(nodes))
        return slide["html"]

    for node, replacement in zip(nodes, new_texts):
        if isinstance(replacement, str) and replacement.strip():
            # Preserve the original leading/trailing whitespace so inline spacing survives.
            lead = node[:len(node) - len(node.lstrip())]
            trail = node[len(node.rstrip()):]
            node.replace_with(f"{lead}{replacement.strip()}{trail}")
    return str(soup)


async def generate_ai_proposal_deck(analysis: Dict, *, provider: str = None, images: bool = False,
                                    notes: str = "", on_progress=None, creativity: str = "balanced",
                                    pipeline: str = "single", models: Optional[dict] = None,
                                    theme_mode: str = "tbs", custom_color: Optional[str] = None,
                                    style: str = "tbs", prompt: Optional[str] = None) -> Dict:
    """AIO/GEO/AEO proposal: the approved reference deck, re-worded for a new prospect.

    The model does not design slides and does not choose a structure. Each of the 25 reference
    slides is handed back to it verbatim with the new client's data, and it returns the same markup
    with only the wording swapped. That is the only way to guarantee the output looks exactly like
    the approved deck — describing the design to a model produced flat, sparse slides no matter how
    detailed the description got.

    Slides are rewritten CONCURRENTLY in small batches: 25 sequential calls would take minutes, and
    one call for all 25 makes the model economise and produce thin content.
    """
    from services.highlights import to_brief_block
    from config import settings

    maps = analysis.get("topical_maps") or []
    if not maps:
        raise ValueError("This analysis has no topical map yet — let it finish before building a proposal.")
    m = maps[0]
    domain = _domain_from(m.get("url") or "")
    brand = m.get("central_entity") or domain
    hero = _proposal_hero_image(analysis)
    photos = _site_photos(analysis)
    tmap_html = _render_topical_map(m)
    prov = provider or settings.DEFAULT_AI_PROVIDER
    brief = _proposal_brief(analysis) + to_brief_block(notes)

    slides = _reference_slides()
    if on_progress:
        await on_progress(f"Re-wording {len(slides)} slides for {brand}…")

    done = 0
    results: List[str] = [""] * len(slides)
    BATCH = 5
    for i in range(0, len(slides), BATCH):
        chunk = slides[i:i + BATCH]
        outs = await asyncio.gather(*[_rewrite_slide(sl, brand, domain, brief, prov) for sl in chunk])
        for k, out in enumerate(outs):
            results[i + k] = out
        done += len(chunk)
        if on_progress:
            await on_progress(f"Slides {done}/{len(slides)}…")

    body = "\n".join(r for r in results if r)
    if not body:
        raise ValueError("Every slide failed to generate — check the AI provider configuration.")

    # The page above the deck is part of the proposal, not decoration — localise it the same way.
    intro = _reference_intro()
    intro_out = ""
    if intro:
        if on_progress:
            await on_progress(f"Re-wording the {len(intro)} summary sections…")
        outs = await asyncio.gather(*[_rewrite_slide(sec, brand, domain, brief, prov)
                                      for sec in intro])
        intro_out = "\n".join(o for o in outs if o)
        intro_out = _fix_intro_images(intro_out, tmap_html)

    # ── Deterministic injections ─────────────────────────────────────────────────────────
    # The reference cover carries a RELATIVE image (hero-lake.jpg) that 404s anywhere else, and its
    # closing slide has none. Point the cover at this client's own photo and add one to the close.
    if photos:
        # Give the cover, every section divider, the map slide and the close a photo chosen to match
        # that slide's own subject, so the imagery tracks the client's topics instead of repeating
        # one hero. Matched on the words in the image path — how sites actually file their photos.
        used: set = set()
        def _place(mo):
            slide = mo.group(0)
            wants_photo = ('slide-cover' in slide or 'slide-divider' in slide
                           or '<img' in slide or 'CLOSE' in slide.upper())
            if not wants_photo:
                return slide
            plain = re.sub(r"<[^>]+>", " ", slide)
            url = _photo_for(plain, photos, used)
            if not url:
                return slide
            if '<img' in slide:            # repoint the reference's own (relative, 404ing) image
                return re.sub(r'<img([^>]*?)src="[^"]*"([^>]*)>',
                              lambda m2: f'<img{m2.group(1)}src="{url}"{m2.group(2)}>', slide)
            img = f'<img class="slide-hero" src="{url}" alt="{_esc(brand)}">'
            return slide.replace('<div class="slide-foot"', img + '<div class="slide-foot"', 1) \
                if '<div class="slide-foot"' in slide else slide[:-12] + img + slide[-12:]
        body = re.sub(r'<div class="slide-block">.*?</div>\s*</div>', _place, body, flags=re.S)
    else:
        # No usable photo — strip the reference's broken relative image rather than ship a 404.
        body = re.sub(r'<img[^>]*src="(?!https?:)[^"]*"[^>]*>', "", body)

    # Safety net: the model is told to swap the old client's name and domain, but a proposal that
    # still says "panoramaresort.ch" would be humiliating in front of a prospect. Sweep any survivor
    # deterministically rather than trusting the rewrite to have caught every mention.
    for old_ref, repl in (("panoramaresort.ch", domain), ("Panorama Resort &amp; Spa", _esc(brand)),
                          ("Panorama Resort & Spa", brand), ("Panorama", brand)):
        # Skip a swap whose replacement CONTAINS the thing being replaced — for a client actually
        # called "Panorama Resort & Spa" this turned correct copy into
        # "Panorama Resort & Spa Resort & Spa".
        if repl and old_ref not in repl:
            body = body.replace(old_ref, repl)

    # The reference has no topical-map slide, so add the client's real map as its own slide at the
    # end of the audit section (immediately before the "Section 05" divider).
    if tmap_html:
        map_slide = (
            '<div class="slide-block"><div class="slide">'
            '<div class="slide-num">Topical map</div>'
            f'<h2 class="slide-title">What complete coverage looks like for {_esc(brand)}</h2>'
            '<div class="slide-sub">Core areas earn revenue. Outer areas build the authority that '
            'makes the core credible to a retrieval system.</div>'
            f'<div class="slide-body">{tmap_html}</div>'
            '<div class="slide-foot">TBS MARKETING · 04 · AUDIT</div>'
            "</div></div>")
        mo = re.search(r'<div class="slide-block">(?:(?!</div>\n</div>).)*?Section 05', body, re.S)
        body = (body[:mo.start()] + map_slide + body[mo.start():]) if mo else body + map_slide

    html = _proposal_page(brand, body, intro=intro_out)
    kept = sum(1 for r in results if r)
    logger.info("proposal deck for %s: %d/%d slides kept", brand, kept, len(slides))
    return {"domain": domain, "brand": brand, "html": html, "artifacts": {}}
