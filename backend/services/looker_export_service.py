"""Looker Studio export layer for Google Search Console data.

This module sits *on top of* ``GSCService`` (services/gsc_service.py) and reshapes the
data it already fetches into flat, Looker-Studio-ready tables. Nothing here re-implements
GSC fetching, quota gating, caching, or the 3-day data-lag offset — those all live in
``GSCService`` and are reused as-is.

Design goals
------------
1.  **Pipeline-agnostic core.** ``build_export()`` returns plain ``list[dict]`` tables plus
    a ``SCHEMAS`` descriptor (column name -> type). The same payload feeds Google Sheets,
    BigQuery, a Looker Community Connector, or a raw JSON download with zero re-mapping.
2.  **Flat & typed.** Every table is one row = one record, only scalar cells (str / int /
    float / bool). No nested objects — Looker Studio and the Sheets connector choke on
    those. Column names are stable ``snake_case`` so report fields never break.
3.  **Reuse, don't duplicate.** Striking distance, CTR gaps, position buckets, and
    period-over-period deltas come straight from the existing service methods.
4.  **Fail soft.** Quota errors (HTTP 429) and empty responses degrade to empty tables with
    a ``status`` note rather than blowing up the whole export.

What GSC does *not* provide
---------------------------
Indexing trends, 404/excluded URLs, and Core Web Vitals buckets are **not** available from
the Search Analytics API used everywhere else in this app. They come from separate sources
(URL Inspection API, Index Coverage, and the CrUX / PageSpeed Insights API respectively).
``build_technical_health_stub()`` documents the exact Looker-compatible schema for those
tables so the dashboard can be wired now and populated when those feeds are added — see the
docstring there. We emit the empty-but-typed tables so the Looker blends don't error.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable, Any

from googleapiclient.errors import HttpError

from services.gsc_service import GSCService, GSC_DATA_LAG_DAYS

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
#  Looker Studio / BigQuery schema descriptors
#
#  Looker's Sheets connector infers types from the data, but giving BigQuery (or a
#  Community Connector's getSchema()) an explicit type map removes every "schema
#  mapping error". Types use Looker's vocabulary: TEXT, NUMBER, PERCENT, URL,
#  YEAR_MONTH_DAY, BOOLEAN.
# ─────────────────────────────────────────────────────────────────────────────
SCHEMAS: Dict[str, Dict[str, str]] = {
    "queries": {
        "query": "TEXT",
        "brand_segment": "TEXT",          # "Branded" | "Generic"
        "topic_cluster": "TEXT",          # broad topic label (see _cluster_for)
        "clicks": "NUMBER",
        "impressions": "NUMBER",
        "ctr": "PERCENT",                 # already 0–100
        "position": "NUMBER",
        "clicks_delta_pct": "NUMBER",     # % vs previous period; blank when no prior data
    },
    "pages": {
        "page": "URL",
        "subfolder": "TEXT",              # first path segment, the cluster key for pages
        "clicks": "NUMBER",
        "impressions": "NUMBER",
        "ctr": "PERCENT",
        "position": "NUMBER",
        "clicks_delta_pct": "NUMBER",
    },
    "movers": {
        "query": "TEXT",
        "brand_segment": "TEXT",
        "topic_cluster": "TEXT",
        "position_current": "NUMBER",
        "position_previous": "NUMBER",
        "position_delta": "NUMBER",       # previous − current; +ve = improved (moved up)
        "direction": "TEXT",              # "Gained" | "Lost" | "Stable"
        "clicks": "NUMBER",
        "impressions": "NUMBER",
    },
    "striking_distance": {
        "query": "TEXT",
        "page": "URL",
        "topic_cluster": "TEXT",
        "position": "NUMBER",
        "clicks": "NUMBER",
        "impressions": "NUMBER",
        "ctr": "PERCENT",
        "potential_clicks": "NUMBER",     # extra clicks if pushed to top-3
    },
    "ctr_gaps": {
        "query": "TEXT",
        "topic_cluster": "TEXT",
        "position": "NUMBER",
        "impressions": "NUMBER",
        "clicks": "NUMBER",
        "actual_ctr": "PERCENT",
        "expected_ctr": "PERCENT",
        "ctr_gap": "PERCENT",             # expected − actual
        "missed_clicks": "NUMBER",
    },
    "position_buckets": {
        "date": "YEAR_MONTH_DAY",
        "bucket": "TEXT",                 # "1-3" | "4-10" | "11-20" | "21+"
        "impressions": "NUMBER",
    },
    # ── Looker template parity: GSC report pages ──
    "gsc_monthly": {                      # combo chart: Impressions bars + Clicks/Position lines
        "month": "YEAR_MONTH",
        "clicks": "NUMBER",
        "impressions": "NUMBER",
        "ctr": "PERCENT",
        "position": "NUMBER",
    },
    "gsc_kpis": {                         # 6 scorecards, each with % + absolute change
        "metric": "TEXT",                 # Search Traffic | Search Volume | CTR | Avg Position | Unique Pages | Unique Keywords
        "value": "NUMBER",
        "pct_change": "NUMBER",
        "abs_change": "NUMBER",
    },
    "gsc_timeseries": {                   # Performance Over Time — current vs previous period
        "period_index": "NUMBER",         # aligned week index (1..N) so the two series overlay
        "week_start": "YEAR_MONTH_DAY",
        "search_traffic": "NUMBER",       # clicks, current period
        "search_traffic_prev": "NUMBER",  # clicks, previous period (same index)
    },
    "gsc_brand_generic": {               # Performance By Brand / Generic
        "segment": "TEXT",                # "Branded" | "Generic"
        "clicks": "NUMBER",
        "impressions": "NUMBER",
        "clicks_delta_pct": "NUMBER",
    },
    "gsc_position_buckets_summary": {     # Position Tracking — one row per Top 3/10/20/Rest tier
        "bucket": "TEXT",                 # "Top 3" | "Top 10" | "Top 20" | "Rest"
        "unique_keywords": "NUMBER",
        "search_volume": "NUMBER",        # sum impressions
        "search_traffic": "NUMBER",       # sum clicks
        "avg_position": "NUMBER",
        "brand_pct": "PERCENT",           # % of keywords in the tier that are Branded
        "long_tail_pct": "PERCENT",       # % of keywords with >=3 words
        "unique_keywords_delta": "NUMBER",
        "search_volume_delta_pct": "NUMBER",
        "search_traffic_delta_pct": "NUMBER",
        "avg_position_delta": "NUMBER",
    },
    "gsc_keyword_bubble": {              # Keyword Position & Search Volume scatter
        "query": "TEXT",
        "brand_segment": "TEXT",
        "position": "NUMBER",             # x-axis (avg position)
        "impressions": "NUMBER",          # y-axis (search volume)
        "clicks": "NUMBER",               # bubble size
    },
    # ── Looker template parity: GA4 report pages ──
    "ga4_kpis": {                         # Acquisition / Behavior / Conversion scorecards
        "metric": "TEXT",                 # Sessions | Engaged Sessions | Avg Session Duration | Engagement Rate | Conversions | Goal Conversion Rate
        "value": "NUMBER",
        "pct_change": "NUMBER",
        "abs_change": "NUMBER",
    },
    "ga4_sessions_timeseries": {          # Sessions Over Time — current vs previous month
        "period_index": "NUMBER",
        "date": "YEAR_MONTH_DAY",
        "sessions": "NUMBER",
        "sessions_prev": "NUMBER",
    },
    "ga4_channels": {                     # Sessions By Channel
        "channel": "TEXT",
        "sessions": "NUMBER",
        "users": "NUMBER",
        "conversions": "NUMBER",
        "session_share_pct": "PERCENT",
    },
    "ga4_countries": {                    # Sessions By Country (map + top list)
        "country": "TEXT",
        "sessions": "NUMBER",
        "users": "NUMBER",
        "sessions_delta_pct": "NUMBER",
    },
    "ga4_devices": {                      # Sessions By Device (donut)
        "device": "TEXT",
        "sessions": "NUMBER",
        "session_share_pct": "PERCENT",
        "sessions_delta_pct": "NUMBER",
    },
    "landing_pages": {                    # GSC × GA4 blend: rankings → on-site outcomes
        "page": "URL",
        "clicks": "NUMBER",               # GSC
        "impressions": "NUMBER",          # GSC
        "ctr": "PERCENT",                 # GSC
        "position": "NUMBER",             # GSC
        "sessions": "NUMBER",             # GA4 (blank if unmatched)
        "conversions": "NUMBER",          # GA4
        "conv_rate": "PERCENT",           # GA4 conversions / sessions
        "engagement_rate": "PERCENT",     # GA4
    },
    # Technical-health tables (sourced outside Search Analytics — see module docstring)
    "indexing": {
        "date": "YEAR_MONTH_DAY",
        "state": "TEXT",                  # "Indexed" | "Not Indexed"
        "url_count": "NUMBER",
    },
    "excluded_urls": {
        "url": "URL",
        "reason": "TEXT",                 # e.g. "404", "Excluded by noindex", "Crawled - not indexed"
        "last_crawled": "YEAR_MONTH_DAY",
    },
    "core_web_vitals": {
        "form_factor": "TEXT",            # "DESKTOP" | "MOBILE"
        "metric": "TEXT",                 # "LCP" | "INP" | "CLS"
        "bucket": "TEXT",                 # "Good" | "Needs Improvement" | "Poor"
        "url_share_pct": "PERCENT",
    },
}


# ─────────────────────────────────────────────────────────────────────────────
#  Classification helpers (brand segmentation + topic clustering)
# ─────────────────────────────────────────────────────────────────────────────
def _compile_brand(brand_regex: Optional[str]) -> Optional[re.Pattern]:
    """Compile the brand keyword regex once. Accepts a plain pipe list
    ("brandname|brand name") or any valid regex. Returns None if not provided
    or invalid (so everything falls back to 'Generic')."""
    if not brand_regex or not brand_regex.strip():
        return None
    try:
        return re.compile(brand_regex.strip(), re.IGNORECASE)
    except re.error:
        logger.warning("Invalid brand_regex %r — treating all queries as Generic", brand_regex)
        return None


def _brand_segment(query: str, brand_pat: Optional[re.Pattern]) -> str:
    """Branded vs Generic. A query is Branded when the brand pattern matches anywhere
    in it (case-insensitive). Drives the classic 'Brand vs Non-brand' Looker pages."""
    if brand_pat and brand_pat.search(query or ""):
        return "Branded"
    return "Generic"


def _cluster_for(text: str, cluster_rules: Optional[List[Dict[str, str]]]) -> str:
    """Group a query (or page) into a broad topic cluster.

    ``cluster_rules`` is an ordered list of ``{"label": ..., "pattern": ...}``. The first
    rule whose regex matches wins — so order rules specific→general. When no rule matches
    (or none supplied) we fall back to the query's first significant token, which gives a
    coarse-but-useful auto-cluster instead of a single "Other" bucket.

    Example rules:
        [{"label": "Pricing", "pattern": "price|cost|cheap|quote"},
         {"label": "Reviews", "pattern": "review|vs|compare|best"}]
    """
    t = (text or "").strip().lower()
    if not t:
        return "(unclustered)"
    if cluster_rules:
        for rule in cluster_rules:
            pat = rule.get("pattern")
            if not pat:
                continue
            try:
                if re.search(pat, t, re.IGNORECASE):
                    return rule.get("label") or pat
            except re.error:
                continue
    # Fallback: first token longer than 2 chars — a cheap auto-cluster
    for tok in re.split(r"\s+", t):
        if len(tok) > 2:
            return tok
    return t


def _subfolder(page_url: str) -> str:
    """First path segment of a URL — the natural 'content section' cluster for pages
    (e.g. https://site.com/blog/post -> '/blog/'). '/' for the homepage."""
    try:
        from urllib.parse import urlparse
        path = urlparse(page_url).path.strip("/")
    except Exception:
        path = ""
    if not path:
        return "/"
    return "/" + path.split("/")[0] + "/"


# ─────────────────────────────────────────────────────────────────────────────
#  Fallback wrapper
# ─────────────────────────────────────────────────────────────────────────────
async def _safe(label: str, coro_factory: Callable[[], Any], default: Any):
    """Run an awaitable, returning ``default`` (and logging) on quota/empty failures.

    Keeps one failing GSC call (e.g. a 429 quota error or a property with no data for a
    table) from aborting the entire export. Returns ``(value, error_note)``.
    """
    try:
        return await coro_factory(), None
    except HttpError as e:
        status_code = getattr(getattr(e, "resp", None), "status", "?")
        note = f"{label}: GSC HTTP {status_code}" + (" (quota — retry later)" if str(status_code) == "429" else "")
        logger.warning("Export fallback — %s", note)
        return default, note
    except Exception as e:  # service methods re-raise as plain Exception
        note = f"{label}: {e}"
        logger.warning("Export fallback — %s", note)
        return default, note


# ─────────────────────────────────────────────────────────────────────────────
#  Biggest-movers matrix (30-day vs previous 30-day, by AVERAGE POSITION)
#
#  The existing service exposes clicks deltas everywhere, but the "what's working right
#  now" movers view needs POSITION in both periods. We fetch query-level position for the
#  current and previous windows directly off the already-built live service object
#  (reusing its quota gate + auth), then diff them.
# ─────────────────────────────────────────────────────────────────────────────
async def _fetch_query_positions(service: GSCService, property_url: str,
                                  start, end, filters_json: Optional[str]) -> Dict[str, Dict]:
    """query -> {clicks, impressions, position} for one date range."""
    req = {
        "startDate": start.strftime("%Y-%m-%d"),
        "endDate": end.strftime("%Y-%m-%d"),
        "dimensions": ["query"],
        "rowLimit": 25000,
        "dataState": "all",
    }
    service._apply_filter(req, filters_json)  # reuse the service's filter translation
    resp = await service._aexecute(
        service.service.searchanalytics().query(siteUrl=property_url, body=req)
    )
    out: Dict[str, Dict] = {}
    for row in resp.get("rows", []):
        out[row["keys"][0]] = {
            "clicks": row.get("clicks", 0),
            "impressions": row.get("impressions", 0),
            "position": row.get("position", 0),
        }
    return out


async def build_movers(service: GSCService, property_url: str, *, window: int = 30,
                       brand_pat: Optional[re.Pattern], cluster_rules, min_impressions: int = 30,
                       filters_json: Optional[str] = None) -> List[Dict]:
    """Biggest position movers: current ``window`` days vs the prior ``window`` days.

    ``position_delta = previous − current`` so a POSITIVE delta means the query climbed
    (lower position number is better). Stable = |delta| < 0.5. Filtered to queries with at
    least ``min_impressions`` in the current window to drop noise."""
    start, end, prev_start, prev_end = _period_bounds(window)

    # Reuse the memoized query fetch — KPIs/brand/buckets pull the same query×period data,
    # so on the shared export run this hits the cache instead of re-querying GSC.
    cur = await _fetch_dim_totals(service, property_url, "query", start, end, filters_json)
    prev = await _fetch_dim_totals(service, property_url, "query", prev_start, prev_end, filters_json)

    rows: List[Dict] = []
    for q, c in cur.items():
        if c["impressions"] < min_impressions or q not in prev:
            continue
        pos_c = round(c["position"], 1)
        pos_p = round(prev[q]["position"], 1)
        delta = round(pos_p - pos_c, 1)
        if abs(delta) < 0.5:
            direction = "Stable"
        elif delta > 0:
            direction = "Gained"
        else:
            direction = "Lost"
        rows.append({
            "query": q,
            "brand_segment": _brand_segment(q, brand_pat),
            "topic_cluster": _cluster_for(q, cluster_rules),
            "position_current": pos_c,
            "position_previous": pos_p,
            "position_delta": delta,
            "direction": direction,
            "clicks": c["clicks"],
            "impressions": c["impressions"],
        })
    # Sort by magnitude of movement so the dashboard's top/bottom rows are the headline movers
    rows.sort(key=lambda r: abs(r["position_delta"]), reverse=True)
    return rows


# ─────────────────────────────────────────────────────────────────────────────
#  Looker-template parity builders (GSC report pages)
# ─────────────────────────────────────────────────────────────────────────────
LONG_TAIL_MIN_WORDS = 3   # queries with >= this many words count as "long tail"


def _period_bounds(days: int):
    """(start, end, prev_start, prev_end) honoring the GSC 3-day data lag, matching the
    windowing every GSCService method uses."""
    end = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
    start = end - timedelta(days=days)
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=days)
    return start, end, prev_start, prev_end


async def _fetch_dim_totals(service: GSCService, property_url: str, dimension: str,
                            start, end, filters_json: Optional[str]) -> Dict[str, Dict]:
    """key -> {clicks, impressions, position} for one dimension over a date range,
    paginating past the 25k-row cap (mirrors the `_fetch_all` pattern in get_query_decay so
    long windows aren't truncated). Used for distinct counts, brand splits and buckets.

    Memoized per export run: build_export stashes an `_export_memo` dict on the service, so
    the same (dimension, range) — e.g. 'query' for the current period, which KPIs, brand,
    position buckets and movers all need — is fetched from GSC only once instead of 4-5×.
    This is the single biggest export speedup; the query fetch is paginated and by far the
    most expensive call."""
    memo = getattr(service, '_export_memo', None)
    memo_key = (dimension, property_url, start.isoformat(), end.isoformat(), filters_json)
    if memo is not None and memo_key in memo:
        return memo[memo_key]

    # Cross-request server cache (15-min TTL) so a cold client still reuses recent fetches.
    from services.gsc_service import _cache_get, _cache_set, _TTL_ANALYTICS
    cache_key = (service.user_email, 'export_dim', *memo_key)
    cached = _cache_get(cache_key)
    if cached is not None:
        if memo is not None:
            memo[memo_key] = cached
        return cached

    out: Dict[str, Dict] = {}
    start_row = 0
    while True:
        req = {
            "startDate": start.strftime("%Y-%m-%d"),
            "endDate": end.strftime("%Y-%m-%d"),
            "dimensions": [dimension],
            "rowLimit": 25000,
            "startRow": start_row,
            "dataState": "all",
        }
        service._apply_filter(req, filters_json)
        resp = await service._aexecute(
            service.service.searchanalytics().query(siteUrl=property_url, body=req))
        batch = resp.get("rows", [])
        for row in batch:
            out[row["keys"][0]] = {
                "clicks": row.get("clicks", 0),
                "impressions": row.get("impressions", 0),
                "position": row.get("position", 0),
            }
        if len(batch) < 25000 or start_row >= 225000:
            break
        start_row += 25000
    if memo is not None:
        memo[memo_key] = out
    _cache_set(cache_key, out, _TTL_ANALYTICS)
    return out


async def build_gsc_monthly(service: GSCService, property_url: str, *, months: int = 13,
                            filters_json: Optional[str] = None) -> List[Dict]:
    """Monthly clicks / impressions / CTR / impression-weighted position for the combo chart.
    Built from a single date-dimensioned fetch bucketed to YYYY-MM (clean YEAR_MONTH labels,
    no 12-month cap or year ambiguity)."""
    from collections import defaultdict
    end = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
    start = (end.replace(day=1) - timedelta(days=1)).replace(day=1)
    for _ in range(months - 1):  # walk back `months-1` whole months
        start = (start - timedelta(days=1)).replace(day=1)

    rows = await _fetch_dim_totals(service, property_url, "date", start, end, filters_json)
    buckets = defaultdict(lambda: {"clicks": 0, "impressions": 0, "wpos": 0.0})
    for date_str, m in rows.items():
        ym = date_str[:7]  # YYYY-MM
        b = buckets[ym]
        b["clicks"] += m["clicks"]
        b["impressions"] += m["impressions"]
        b["wpos"] += m["position"] * m["impressions"]
    out = []
    for ym in sorted(buckets.keys()):
        b = buckets[ym]
        imp = b["impressions"]
        out.append({
            "month": ym,
            "clicks": b["clicks"],
            "impressions": imp,
            "ctr": round(b["clicks"] / imp * 100, 2) if imp else 0,
            "position": round(b["wpos"] / imp, 1) if imp else 0,
        })
    return out[-months:]


def _pct(curr, prev):
    return round(((curr - prev) / abs(prev)) * 100, 1) if prev else None


async def build_gsc_kpis(service: GSCService, property_url: str, *, days: int,
                         filters_json: Optional[str] = None) -> List[Dict]:
    """The 6 GSC scorecards (value + % change + absolute change): Search Traffic, Search
    Volume, CTR, Avg Position, Unique Pages, Unique Keywords. Clicks/impressions/CTR/position
    reuse get_search_analytics; the two 'unique' counts are distinct-key counts current vs
    previous period."""
    analytics = await service.get_search_analytics(property_url, days, "daily", filters_json)
    cur, prv = analytics["totals"], analytics["previous_totals"]

    start, end, prev_start, prev_end = _period_bounds(days)
    cur_pages = await _fetch_dim_totals(service, property_url, "page", start, end, filters_json)
    prv_pages = await _fetch_dim_totals(service, property_url, "page", prev_start, prev_end, filters_json)
    cur_q = await _fetch_dim_totals(service, property_url, "query", start, end, filters_json)
    prv_q = await _fetch_dim_totals(service, property_url, "query", prev_start, prev_end, filters_json)

    def kpi(metric, value, prev_value):
        return {"metric": metric, "value": value,
                "pct_change": _pct(value, prev_value),
                "abs_change": round(value - prev_value, 2)}

    return [
        kpi("Search Traffic", cur["clicks"], prv["clicks"]),
        kpi("Search Volume", cur["impressions"], prv["impressions"]),
        kpi("Search CTR", cur["ctr"], prv["ctr"]),
        kpi("Average Position", cur["position"], prv["position"]),
        kpi("Unique Pages", len(cur_pages), len(prv_pages)),
        kpi("Unique Keywords", len(cur_q), len(prv_q)),
    ]


async def build_gsc_timeseries(service: GSCService, property_url: str, *, days: int,
                               filters_json: Optional[str] = None) -> List[Dict]:
    """Weekly Search Traffic (clicks), current period overlaid on the previous period,
    aligned by week index so Looker can draw the 'vs previous month' comparison."""
    from collections import defaultdict
    start, end, prev_start, prev_end = _period_bounds(days)

    async def _weekly(s, e):
        rows = await _fetch_dim_totals(service, property_url, "date", s, e, filters_json)
        weeks = defaultdict(int)
        for date_str, m in rows.items():
            d = datetime.strptime(date_str, "%Y-%m-%d").date()
            monday = d - timedelta(days=d.weekday())
            weeks[monday] += m["clicks"]
        return [weeks[k] for k in sorted(weeks.keys())], sorted(weeks.keys())

    cur_vals, cur_keys = await _weekly(start, end)
    prev_vals, _ = await _weekly(prev_start, prev_end)

    out = []
    for i, monday in enumerate(cur_keys):
        out.append({
            "period_index": i + 1,
            "week_start": monday.strftime("%Y-%m-%d"),
            "search_traffic": cur_vals[i],
            "search_traffic_prev": prev_vals[i] if i < len(prev_vals) else 0,
        })
    return out


async def build_gsc_brand_generic(service: GSCService, property_url: str, *, days: int,
                                  brand_pat: Optional[re.Pattern],
                                  filters_json: Optional[str] = None) -> List[Dict]:
    """Branded vs Generic clicks/impressions with period-over-period click delta."""
    start, end, prev_start, prev_end = _period_bounds(days)
    cur = await _fetch_dim_totals(service, property_url, "query", start, end, filters_json)
    prv = await _fetch_dim_totals(service, property_url, "query", prev_start, prev_end, filters_json)

    def agg(rows):
        out = {"Branded": {"clicks": 0, "impressions": 0}, "Generic": {"clicks": 0, "impressions": 0}}
        for q, m in rows.items():
            seg = _brand_segment(q, brand_pat)
            out[seg]["clicks"] += m["clicks"]
            out[seg]["impressions"] += m["impressions"]
        return out

    cur_a, prv_a = agg(cur), agg(prv)
    return [{
        "segment": seg,
        "clicks": cur_a[seg]["clicks"],
        "impressions": cur_a[seg]["impressions"],
        "clicks_delta_pct": _pct(cur_a[seg]["clicks"], prv_a[seg]["clicks"]),
    } for seg in ("Branded", "Generic")]


# Position tiers are cumulative "Top N" bands, matching the template's toggle. A query in
# position 2 counts toward Top 3, Top 10 and Top 20; "Rest" is everything beyond 20.
_POSITION_TIERS = [("Top 3", 3.0), ("Top 10", 10.0), ("Top 20", 20.0), ("Rest", float("inf"))]


def _bucket_stats(rows: Dict[str, Dict], lo: float, hi: float, brand_pat) -> Dict:
    """Aggregate query rows whose position is in (prev_hi, hi]. Returns counts/sums for one tier."""
    keywords, clicks, impr, wpos, brand_n, long_n = 0, 0, 0, 0.0, 0, 0
    for q, m in rows.items():
        p = m["position"]
        if lo < p <= hi:
            keywords += 1
            clicks += m["clicks"]
            impr += m["impressions"]
            wpos += p * m["impressions"]
            if _brand_segment(q, brand_pat) == "Branded":
                brand_n += 1
            if len(re.split(r"\s+", q.strip())) >= LONG_TAIL_MIN_WORDS:
                long_n += 1
    return {"keywords": keywords, "clicks": clicks, "impressions": impr,
            "avg_position": round(wpos / impr, 1) if impr else 0,
            "brand_n": brand_n, "long_n": long_n}


async def build_gsc_position_buckets(service: GSCService, property_url: str, *, days: int,
                                     brand_pat: Optional[re.Pattern],
                                     filters_json: Optional[str] = None) -> List[Dict]:
    """Position Tracking tiers (Top 3/10/20/Rest): unique keywords, search volume, traffic,
    avg position, brand %, long-tail %, each with a delta vs the previous period."""
    start, end, prev_start, prev_end = _period_bounds(days)
    cur = await _fetch_dim_totals(service, property_url, "query", start, end, filters_json)
    prv = await _fetch_dim_totals(service, property_url, "query", prev_start, prev_end, filters_json)

    out = []
    prev_hi = 0.0
    for name, hi in _POSITION_TIERS:
        lo = 0.0 if name != "Rest" else 20.0
        # cumulative for Top tiers: (0, hi]; Rest: (20, inf)
        c = _bucket_stats(cur, lo, hi, brand_pat)
        p = _bucket_stats(prv, lo, hi, brand_pat)
        out.append({
            "bucket": name,
            "unique_keywords": c["keywords"],
            "search_volume": c["impressions"],
            "search_traffic": c["clicks"],
            "avg_position": c["avg_position"],
            "brand_pct": round(c["brand_n"] / c["keywords"] * 100, 1) if c["keywords"] else 0,
            "long_tail_pct": round(c["long_n"] / c["keywords"] * 100, 1) if c["keywords"] else 0,
            "unique_keywords_delta": c["keywords"] - p["keywords"],
            "search_volume_delta_pct": _pct(c["impressions"], p["impressions"]),
            "search_traffic_delta_pct": _pct(c["clicks"], p["clicks"]),
            "avg_position_delta": round(c["avg_position"] - p["avg_position"], 1),
        })
    return out


async def build_gsc_keyword_bubble(service: GSCService, property_url: str, *, days: int,
                                   brand_pat: Optional[re.Pattern], limit: int = 200,
                                   filters_json: Optional[str] = None) -> List[Dict]:
    """Top keywords for the Position × Search-Volume bubble chart (reuses get_top_queries)."""
    queries = await service.get_top_queries(property_url, days, filters_json)
    queries = sorted(queries, key=lambda q: q["impressions"], reverse=True)[:limit]
    return [{
        "query": q["query"],
        "brand_segment": _brand_segment(q["query"], brand_pat),
        "position": q["position"],
        "impressions": q["impressions"],
        "clicks": q["clicks"],
    } for q in queries]


# ─────────────────────────────────────────────────────────────────────────────
#  Looker-template parity builders (GA4 report pages)
# ─────────────────────────────────────────────────────────────────────────────
async def build_ga4_tables(ga4_service, ga4_property_id: str, *, days: int) -> Dict[str, List[Dict]]:
    """Build the GA4 section (kpis, sessions timeseries, channels, countries, devices) from
    the extended AnalyticsService. Each sub-fetch is wrapped by the caller's _safe()."""
    overview = await ga4_service.get_overview(ga4_property_id, days)
    totals = overview["totals"]
    deltas = overview.get("deltas", {})
    abs_deltas = overview.get("abs_deltas", {})

    def kpi(metric, key):
        return {"metric": metric, "value": totals.get(key, 0),
                "pct_change": deltas.get(key), "abs_change": abs_deltas.get(key)}

    ga4_kpis = [
        kpi("Sessions", "sessions"),
        kpi("Engaged Sessions", "engaged_sessions"),
        kpi("Avg Session Duration", "avg_session_duration"),
        kpi("Engagement Rate", "engagement_rate"),
        kpi("Conversions", "conversions"),
        kpi("Goal Conversion Rate", "goal_conversion_rate"),
    ]

    # Sessions over time: align current vs previous series by index.
    cur_series = overview.get("chart_data", [])
    prev_series = overview.get("prev_chart_data", [])
    ga4_timeseries = []
    for i, point in enumerate(cur_series):
        ga4_timeseries.append({
            "period_index": i + 1,
            "date": point.get("date", ""),
            "sessions": point.get("sessions", 0),
            "sessions_prev": prev_series[i]["sessions"] if i < len(prev_series) else 0,
        })

    total_sessions = sum(c.get("sessions", 0) for c in overview.get("channels", [])) or 1
    ga4_channels = [{
        "channel": c.get("channel", ""),
        "sessions": c.get("sessions", 0),
        "users": c.get("users", 0),
        "conversions": c.get("conversions", 0),
        "session_share_pct": round(c.get("sessions", 0) / total_sessions * 100, 1),
    } for c in overview.get("channels", [])]

    ga4_countries = await ga4_service.get_geo_with_deltas(ga4_property_id, days)
    ga4_devices = await ga4_service.get_devices(ga4_property_id, days)
    # Raw landing-page metrics keyed by path — joined to GSC pages by build_export.
    ga4_landing = await ga4_service.get_landing_pages(ga4_property_id, days)

    return {
        "ga4_kpis": ga4_kpis,
        "ga4_sessions_timeseries": ga4_timeseries,
        "ga4_channels": ga4_channels,
        "ga4_countries": ga4_countries,
        "ga4_devices": ga4_devices,
        "_landing_raw": ga4_landing,  # consumed by build_export, not a Looker table
    }


def _blend_landing_pages(gsc_pages: List[Dict], ga4_landing: Optional[Dict]) -> List[Dict]:
    """Left-join GSC pages (clicks/impressions/ctr/position) with GA4 landing-page metrics
    (sessions/conversions/engagement) on the URL path. GSC `page` is a full URL; GA4 keys are
    paths — normalize the GSC URL to its path before matching. Unmatched GSC pages keep blank
    GA4 columns so the table is still a complete 'top landing pages by clicks' view."""
    from urllib.parse import urlparse
    ga4_landing = ga4_landing or {}
    out = []
    for p in gsc_pages:
        path = (urlparse(p["page"]).path.rstrip("/") or "/")
        g = ga4_landing.get(path, {})
        sessions = g.get("sessions")
        conversions = g.get("conversions")
        conv_rate = (round(conversions / sessions * 100, 2)
                     if sessions and conversions is not None else (0 if sessions else None))
        out.append({
            "page": p["page"],
            "clicks": p["clicks"],
            "impressions": p["impressions"],
            "ctr": p["ctr"],
            "position": p["position"],
            "sessions": sessions,
            "conversions": conversions,
            "conv_rate": conv_rate,
            "engagement_rate": g.get("engagement_rate"),
        })
    out.sort(key=lambda r: r["clicks"], reverse=True)
    return out


# ─────────────────────────────────────────────────────────────────────────────
#  Main export builder
# ─────────────────────────────────────────────────────────────────────────────
async def build_export(
    service: GSCService,
    property_url: str,
    *,
    days: int = 30,
    brand_regex: Optional[str] = None,
    cluster_rules: Optional[List[Dict[str, str]]] = None,
    filters_json: Optional[str] = None,
    ga4_service=None,
    ga4_property_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Assemble every Looker-Studio-ready table for one property.

    Returns::

        {
          "property": "...", "generated_at": ISO8601, "period_days": 30,
          "schemas": SCHEMAS,                  # column -> Looker type, for connectors/BQ
          "tables": { "queries": [...], "pages": [...], ... },   # flat list[dict] each
          "summary": {...},                    # for Smart Interpretations (see build_summary)
          "warnings": [ "...quota...", ... ],  # non-fatal fallback notes
        }

    All tables are independent and fail soft: a quota error on one leaves the rest intact.
    """
    brand_pat = _compile_brand(brand_regex)
    warnings: List[str] = []

    # Per-run fetch memo: dedupes the expensive paginated query/page fetches that KPIs,
    # brand, position buckets and movers all need (see _fetch_dim_totals).
    service._export_memo = {}

    def collect(note):
        if note:
            warnings.append(note)

    # GA4 runs on a SEPARATE service object, so it's safe to overlap with the GSC calls.
    # Kick it off now and await it at the end so its ~5 calls interleave with GSC work
    # (bounded by the shared GOOGLE_CALL_GATE semaphore) instead of running strictly after.
    ga4_task = None
    if ga4_service is not None and ga4_property_id:
        ga4_task = asyncio.create_task(_safe(
            "ga4", lambda: build_ga4_tables(ga4_service, ga4_property_id, days=days),
            {"ga4_kpis": [], "ga4_sessions_timeseries": [], "ga4_channels": [],
             "ga4_countries": [], "ga4_devices": []}))

    # ── Queries (current period, with clicks delta) ── reuse get_top_queries ──
    raw_queries, note = await _safe(
        "queries", lambda: service.get_top_queries(property_url, days, filters_json), [])
    collect(note)
    queries = [{
        "query": q["query"],
        "brand_segment": _brand_segment(q["query"], brand_pat),
        "topic_cluster": _cluster_for(q["query"], cluster_rules),
        "clicks": q["clicks"],
        "impressions": q["impressions"],
        "ctr": q["ctr"],
        "position": q["position"],
        "clicks_delta_pct": q.get("clicks_delta"),
    } for q in raw_queries]

    # ── Pages (current period) ── reuse get_top_pages ──
    raw_pages, note = await _safe(
        "pages", lambda: service.get_top_pages(property_url, days, filters_json), [])
    collect(note)
    pages = [{
        "page": p["url"],
        "subfolder": _subfolder(p["url"]),
        "clicks": p["clicks"],
        "impressions": p["impressions"],
        "ctr": p["ctr"],
        "position": p["position"],
        "clicks_delta_pct": p.get("clicks_delta"),
    } for p in raw_pages]

    # ── Movers (position delta, 30 vs prior 30) ──
    movers, note = await _safe(
        "movers",
        lambda: build_movers(service, property_url, window=days, brand_pat=brand_pat,
                             cluster_rules=cluster_rules, filters_json=filters_json),
        [])
    collect(note)

    # ── Striking distance (pos 11–20) ── reuse get_striking_distance, then narrow ──
    # The service default is 4–20; the template's "striking distance" page is the
    # off-page-1 band 11–20, so we request exactly that.
    raw_striking, note = await _safe(
        "striking_distance",
        lambda: service.get_striking_distance(property_url, days, min_pos=11, max_pos=20,
                                              filters_json=filters_json),
        [])
    collect(note)
    striking = [{
        "query": s["query"],
        "page": s["page"],
        "topic_cluster": _cluster_for(s["query"], cluster_rules),
        "position": s["position"],
        "clicks": s["clicks"],
        "impressions": s["impressions"],
        "ctr": s["ctr"],
        "potential_clicks": s["potential_clicks"],
    } for s in raw_striking]

    # ── CTR gaps (high impressions, low CTR vs benchmark) ── reuse get_ctr_opportunities ──
    raw_ctr, note = await _safe(
        "ctr_gaps",
        lambda: service.get_ctr_opportunities(property_url, days, min_impressions=50,
                                             filters_json=filters_json),
        [])
    collect(note)
    ctr_gaps = [{
        "query": c["query"],
        "topic_cluster": _cluster_for(c["query"], cluster_rules),
        "position": c["position"],
        "impressions": c["impressions"],
        "clicks": c["clicks"],
        "actual_ctr": c["actual_ctr"],
        "expected_ctr": c["expected_ctr"],
        "ctr_gap": c["ctr_gap"],
        "missed_clicks": c["missed_clicks"],
    } for c in raw_ctr]

    # ── Position buckets over time ── reuse get_daily_stats, then unpivot to long form ──
    # Looker prefers long/tidy (date, bucket, value) over wide columns for stacked charts.
    raw_daily, note = await _safe(
        "position_buckets", lambda: service.get_daily_stats(property_url, days, filters_json), [])
    collect(note)
    position_buckets: List[Dict] = []
    for d in raw_daily:
        for bucket in ("1-3", "4-10", "11-20", "21+"):
            position_buckets.append({
                "date": d["date"],
                "bucket": bucket,
                "impressions": d.get(bucket, 0),
            })

    # ── Looker-template parity tables (GSC report pages) ──
    gsc_monthly, note = await _safe(
        "gsc_monthly", lambda: build_gsc_monthly(service, property_url, filters_json=filters_json), [])
    collect(note)
    gsc_kpis, note = await _safe(
        "gsc_kpis", lambda: build_gsc_kpis(service, property_url, days=days, filters_json=filters_json), [])
    collect(note)
    gsc_timeseries, note = await _safe(
        "gsc_timeseries", lambda: build_gsc_timeseries(service, property_url, days=days, filters_json=filters_json), [])
    collect(note)
    gsc_brand_generic, note = await _safe(
        "gsc_brand_generic",
        lambda: build_gsc_brand_generic(service, property_url, days=days, brand_pat=brand_pat, filters_json=filters_json), [])
    collect(note)
    gsc_pos_summary, note = await _safe(
        "gsc_position_buckets_summary",
        lambda: build_gsc_position_buckets(service, property_url, days=days, brand_pat=brand_pat, filters_json=filters_json), [])
    collect(note)
    gsc_bubble, note = await _safe(
        "gsc_keyword_bubble",
        lambda: build_gsc_keyword_bubble(service, property_url, days=days, brand_pat=brand_pat, filters_json=filters_json), [])
    collect(note)

    # ── Technical health stubs (typed but empty — see module docstring) ──
    tech = build_technical_health_stub()

    tables = {
        "queries": queries,
        "pages": pages,
        "movers": movers,
        "striking_distance": striking,
        "ctr_gaps": ctr_gaps,
        "position_buckets": position_buckets,
        "gsc_monthly": gsc_monthly,
        "gsc_kpis": gsc_kpis,
        "gsc_timeseries": gsc_timeseries,
        "gsc_brand_generic": gsc_brand_generic,
        "gsc_position_buckets_summary": gsc_pos_summary,
        "gsc_keyword_bubble": gsc_bubble,
        **tech,
    }

    # ── GA4 section (optional — awaits the task started concurrently above) ──
    ga4_landing = None
    if ga4_task is not None:
        ga4_tables, note = await ga4_task
        collect(note)
        ga4_landing = ga4_tables.pop("_landing_raw", None)  # internal join input, not a table
        tables.update(ga4_tables)

    # ── Landing-page blend: GSC pages × GA4 outcomes (always built from GSC pages;
    #    GA4 columns blank when no GA4 property is connected) ──
    tables["landing_pages"] = _blend_landing_pages(pages, ga4_landing)

    summary = build_summary(tables, days=days)

    return {
        "property": property_url,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "period_days": days,
        "schemas": SCHEMAS,
        "tables": tables,
        "summary": summary,
        "warnings": warnings,
    }


def build_technical_health_stub() -> Dict[str, List[Dict]]:
    """Return empty-but-typed Indexing / Excluded-URL / Core-Web-Vitals tables.

    These three are NOT in the Search Analytics API. Wire your feed in here:
      • indexing      — URL Inspection API (urlInspection.index.inspect) or a
                        weekly Index-Coverage export; emit rows {date, state, url_count}.
      • excluded_urls — same inspection feed; emit {url, reason, last_crawled} for any URL
                        whose verdict != 'PASS' (404, noindex, "Crawled - currently not indexed").
      • core_web_vitals — CrUX / PageSpeed Insights API; emit {form_factor, metric, bucket,
                        url_share_pct} from the histogram buckets.
    Emitting the typed empty tables now means the Looker blends/joins exist and won't error
    before the feeds are connected."""
    return {"indexing": [], "excluded_urls": [], "core_web_vitals": []}


# ─────────────────────────────────────────────────────────────────────────────
#  Smart Interpretations summary (LLM-readable)
# ─────────────────────────────────────────────────────────────────────────────
def build_summary(tables: Dict[str, List[Dict]], *, days: int) -> Dict[str, Any]:
    """Condense the tables into a compact, explicitly-labelled summary an LLM (or the
    app's existing AI-deck pipeline) can turn into 'Smart Interpretations' text.

    Deliberately small and pre-ranked so the model doesn't have to crunch raw rows: it
    reads headline counts + the few rows that actually matter and writes prose."""
    queries = tables.get("queries", [])
    movers = tables.get("movers", [])
    ctr_gaps = tables.get("ctr_gaps", [])
    striking = tables.get("striking_distance", [])

    def _sum(rows, k):
        return sum(r.get(k, 0) or 0 for r in rows)

    branded = [q for q in queries if q["brand_segment"] == "Branded"]
    generic = [q for q in queries if q["brand_segment"] == "Generic"]
    total_clicks = _sum(queries, "clicks") or 1  # avoid /0

    # Cluster roll-up — clicks per topic cluster, top 8
    cluster_clicks: Dict[str, int] = {}
    for q in queries:
        cluster_clicks[q["topic_cluster"]] = cluster_clicks.get(q["topic_cluster"], 0) + (q.get("clicks") or 0)
    top_clusters = sorted(cluster_clicks.items(), key=lambda kv: kv[1], reverse=True)[:8]

    gained = [m for m in movers if m["direction"] == "Gained"][:10]
    lost = [m for m in movers if m["direction"] == "Lost"][:10]

    return {
        "period_days": days,
        "totals": {
            "queries_tracked": len(queries),
            "clicks": _sum(queries, "clicks"),
            "impressions": _sum(queries, "impressions"),
        },
        "brand_split": {
            "branded_clicks": _sum(branded, "clicks"),
            "generic_clicks": _sum(generic, "clicks"),
            "branded_share_pct": round(_sum(branded, "clicks") / total_clicks * 100, 1),
        },
        "top_clusters": [{"cluster": c, "clicks": v} for c, v in top_clusters],
        "biggest_gainers": [
            {"query": m["query"], "position_delta": m["position_delta"],
             "position_current": m["position_current"]} for m in gained
        ],
        "biggest_losers": [
            {"query": m["query"], "position_delta": m["position_delta"],
             "position_current": m["position_current"]} for m in lost
        ],
        "urgent_ctr_gaps": [
            {"query": c["query"], "position": c["position"], "ctr_gap": c["ctr_gap"],
             "missed_clicks": c["missed_clicks"]} for c in ctr_gaps[:10]
        ],
        "striking_distance_opportunities": len(striking),
        "striking_distance_potential_clicks": _sum(striking, "potential_clicks"),
        # A ready-to-use natural-language scaffold so even a non-LLM consumer has prose.
        "headline": _headline(branded, generic, total_clicks, gained, lost, ctr_gaps, striking),
    }


def _headline(branded, generic, total_clicks, gained, lost, ctr_gaps, striking) -> str:
    """One-paragraph deterministic summary (fallback when no LLM is in the loop)."""
    bits = []
    bshare = round(sum(q.get("clicks", 0) for q in branded) / total_clicks * 100, 1)
    bits.append(f"Branded queries drove {bshare}% of clicks ({len(branded)} branded vs {len(generic)} generic terms).")
    if gained:
        g = gained[0]
        bits.append(f"Biggest gainer: '{g['query']}' improved {g['position_delta']} positions to {g['position_current']}.")
    if lost:
        l = lost[0]
        bits.append(f"Biggest drop: '{l['query']}' fell {abs(l['position_delta'])} positions to {l['position_current']}.")
    if ctr_gaps:
        miss = sum(c.get("missed_clicks", 0) for c in ctr_gaps[:10])
        bits.append(f"Top 10 CTR gaps are leaking ~{miss} clicks/period — likely title/meta fixes.")
    if striking:
        pot = sum(s.get("potential_clicks", 0) for s in striking)
        bits.append(f"{len(striking)} queries sit in striking distance (pos 11–20) worth ~{pot} extra clicks if pushed to page 1.")
    return " ".join(bits)


# ─────────────────────────────────────────────────────────────────────────────
#  Google Sheets writer (pipeline target)
#
#  Looker Studio's Google Sheets connector reads one tab = one table. We clear and rewrite
#  each tab so the report always sees a clean flat grid (header row + typed cells).
#
#  AUTH NOTE: writing to Sheets needs the scope
#      https://www.googleapis.com/auth/spreadsheets
#  GSCService only requests 'webmasters.readonly', so pass credentials that include the
#  Sheets scope here. Two practical options:
#    (a) Add 'spreadsheets' to the OAuth consent the user grants on connect, then build
#        google.oauth2.credentials.Credentials with the broader scope; OR
#    (b) Use a service account that owns (or is shared as Editor on) the target sheet —
#        cleanest for an unattended/scheduled export. Share the sheet with the SA email.
# ─────────────────────────────────────────────────────────────────────────────
def write_to_google_sheet(export: Dict[str, Any], spreadsheet_id: str, credentials) -> Dict[str, Any]:
    """Write each table in ``export['tables']`` to its own tab in ``spreadsheet_id``.

    ``credentials`` is a google.auth credentials object carrying the Sheets scope (see the
    AUTH NOTE above). Returns a per-tab row-count report. Synchronous — call via
    ``asyncio.to_thread`` from async code, matching how GSCService offloads blocking calls.
    """
    from googleapiclient.discovery import build

    svc = build("sheets", "v4", credentials=credentials)
    meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    existing = {s["properties"]["title"] for s in meta.get("sheets", [])}

    report: Dict[str, int] = {}
    for table_name, rows in export["tables"].items():
        cols = list(SCHEMAS.get(table_name, {}).keys())
        if not cols and rows:
            cols = list(rows[0].keys())

        # Ensure the tab exists
        if table_name not in existing:
            svc.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": [{"addSheet": {"properties": {"title": table_name}}}]},
            ).execute()
            existing.add(table_name)

        # Clear, then write header + body as a single flat grid
        svc.spreadsheets().values().clear(
            spreadsheetId=spreadsheet_id, range=f"{table_name}").execute()

        grid = [cols] + [[_cell(r.get(c)) for c in cols] for r in rows]
        svc.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{table_name}!A1",
            valueInputOption="RAW",
            body={"values": grid},
        ).execute()
        report[table_name] = len(rows)

    logger.info("Sheets export complete for %s: %s", export.get("property"), report)
    return {"spreadsheet_id": spreadsheet_id, "rows_written": report, "warnings": export.get("warnings", [])}


def _cell(v: Any):
    """Coerce a value into a Sheets-safe scalar. None -> '' so blank cells stay blank
    (Looker reads empty string as NULL) rather than the literal text 'None'."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    return v
