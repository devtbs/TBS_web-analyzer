"""Bing Webmaster Tools service.

Fetches verified sites and search-performance data (impressions, clicks, top queries,
top pages) from the Bing Webmaster Tools JSON API, complementing GSC (Google organic).

Auth is OAuth 2.0 against Bing's own server (see api/routers/_shared.refresh_bing_token):
a stored refresh token is exchanged for a short-lived access token, sent as a Bearer
header. When no OAuth client is configured the integration reports "not configured"
rather than crashing, so the rest of the app is unaffected.
"""
from typing import List, Dict, Optional
import logging
import re
import time
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

API_BASE = "https://ssl.bing.com/webmaster/api.svc/json"

# ── Module-level in-memory TTL cache (same pattern as ads_service) ──
_CACHE: Dict[tuple, tuple] = {}
_TTL_SITES  = 10 * 60   # 10 min – verified-site list rarely changes
_TTL_REPORT = 15 * 60   # 15 min – traffic / query / page stats

# .NET date wrapper Bing returns, e.g. "/Date(1741590000000-0700)/".
_DOTNET_DATE = re.compile(r"/Date\((-?\d+)(?:[+-]\d+)?\)/")


def _cache_get(key: tuple):
    entry = _CACHE.get(key)
    if entry is None:
        return None
    ts, ttl, data = entry
    if time.time() - ts > ttl:
        del _CACHE[key]
        return None
    return data


def _cache_set(key: tuple, data, ttl: int):
    _CACHE[key] = (time.time(), ttl, data)


def invalidate_cache(user_email: str = None):
    """Drop cached entries. Cache keys are (user_email, account_id, ...) so matching on
    the first element clears everything for a user."""
    keys = [k for k in _CACHE if user_email is None or k[0] == user_email]
    for k in keys:
        del _CACHE[k]
    logger.info(f"Bing cache invalidated: {len(keys)} entries removed")


def bing_is_configured() -> bool:
    """True only when a Bing OAuth client (id + secret) is present in config."""
    from config import settings
    return bool((settings.BING_CLIENT_ID or '').strip() and (settings.BING_CLIENT_SECRET or '').strip())


def parse_dotnet_date(value: str) -> Optional[str]:
    """Convert Bing's "/Date(epoch_ms-offset)/" to an ISO date string (YYYY-MM-DD).
    Returns None if the value doesn't match."""
    if not value:
        return None
    m = _DOTNET_DATE.search(str(value))
    if not m:
        return None
    epoch_ms = int(m.group(1))
    return datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


async def _api_get(method: str, access_token: str, params: dict = None) -> list:
    """Call a Bing Webmaster JSON API method with a Bearer token. Returns the `d` array."""
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{API_BASE}/{method}", headers=headers, params=params or {})
        resp.raise_for_status()
        body = resp.json()
    return body.get("d", []) or []


async def get_verified_sites(access_token: str) -> List[Dict]:
    """Return the caller's verified sites: [{url}]. Filters out unverified sites."""
    rows = await _api_get("GetUserSites", access_token)
    return [{"url": r.get("Url")} for r in rows if r.get("IsVerified") and r.get("Url")]


async def get_rank_and_traffic(access_token: str, site_url: str) -> List[Dict]:
    """Daily traffic for a site: [{date, clicks, impressions}] sorted ascending by date."""
    rows = await _api_get("GetRankAndTrafficStats", access_token, {"siteUrl": site_url})
    out = [
        {
            "date": parse_dotnet_date(r.get("Date")),
            "clicks": r.get("Clicks", 0),
            "impressions": r.get("Impressions", 0),
        }
        for r in rows
    ]
    return sorted([r for r in out if r["date"]], key=lambda r: r["date"])


def _aggregate_by(rows: List[Dict], label_key: str) -> List[Dict]:
    """BWT's GetQueryStats/GetPageStats return one row PER DAY per item (each row has a
    Date). Collapse them into one row per item, summing clicks/impressions and taking the
    impression-weighted average position. Both endpoints put the item text in `Query`."""
    agg: Dict[str, Dict] = {}
    for r in rows:
        name = r.get("Query")
        if not name:
            continue
        clicks = r.get("Clicks", 0) or 0
        impr = r.get("Impressions", 0) or 0
        pos = r.get("AvgImpressionPosition")
        a = agg.get(name)
        if a is None:
            agg[name] = {label_key: name, "clicks": clicks, "impressions": impr,
                         "_pos_weight": (pos * impr) if pos and pos > 0 else 0}
        else:
            a["clicks"] += clicks
            a["impressions"] += impr
            if pos and pos > 0:
                a["_pos_weight"] += pos * impr
    out = []
    for a in agg.values():
        impr = a["impressions"]
        a["position"] = round(a.pop("_pos_weight") / impr, 1) if impr else None
        out.append(a)
    return out


async def get_query_stats(access_token: str, site_url: str) -> List[Dict]:
    """Top queries for a site (aggregated across days): [{query, clicks, impressions, position}]."""
    rows = await _api_get("GetQueryStats", access_token, {"siteUrl": site_url})
    return _aggregate_by(rows, "query")


async def get_page_stats(access_token: str, site_url: str) -> List[Dict]:
    """Top pages for a site (aggregated across days): [{page, clicks, impressions, position}]."""
    rows = await _api_get("GetPageStats", access_token, {"siteUrl": site_url})
    return _aggregate_by(rows, "page")


# ---------------------------------------------------------------------------
# AI Performance (no API yet — parsed from the dashboard's CSV export) + deltas
# ---------------------------------------------------------------------------

def _norm_csv_date(value: str) -> Optional[str]:
    """Normalize the AI Performance CSV date ('M/D/YYYY 12:00:00 AM') to ISO YYYY-MM-DD."""
    if not value:
        return None
    head = value.strip().strip('"').split(" ")[0]  # drop the time component
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(head, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_ai_performance_csv(text: str) -> Optional[Dict]:
    """Parse the Bing AI Performance 'Overview Stats' CSV export.

    Columns: Date, Citations, Cited Pages (daily). Returns aggregated stats + the daily
    series for charting, or None if the text isn't a recognizable AI Performance export.
    """
    import csv
    import io

    if not text or not text.strip():
        return None
    # Real Bing exports are UTF-8 with a BOM, which would otherwise corrupt the first header
    # ("﻿Date") and make every column lookup miss. Strip it before parsing.
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    if not reader.fieldnames:
        return None
    # Tolerant header lookup (BOM/case/space-insensitive).
    fields = {(f or "").lstrip("﻿").strip().lower(): f for f in reader.fieldnames}
    date_f = fields.get("date")
    cit_f = fields.get("citations")
    pages_f = fields.get("cited pages")
    if not (date_f and cit_f):
        return None

    daily = []
    for row in reader:
        d = _norm_csv_date(row.get(date_f, ""))
        if not d:
            continue
        try:
            citations = int(float(row.get(cit_f, 0) or 0))
        except (ValueError, TypeError):
            citations = 0
        try:
            cited_pages = int(float(row.get(pages_f, 0) or 0)) if pages_f else 0
        except (ValueError, TypeError):
            cited_pages = 0
        daily.append({"date": d, "citations": citations, "cited_pages": cited_pages})

    return aggregate_ai_daily(daily)


def aggregate_ai_daily(daily: List[Dict]) -> Optional[Dict]:
    """Collapse a list of daily AI-performance rows ({date, citations, cited_pages}) into the
    headline shape used by the deck. Shared by parse_ai_performance_csv and the auto-pull path
    (bing_ai_service) so both produce identical structures. Returns None if there are no rows."""
    if not daily:
        return None
    daily = sorted(daily, key=lambda r: r["date"])
    total = sum(r["citations"] for r in daily)
    active = [r for r in daily if r["cited_pages"] > 0]
    avg_pages = round(sum(r["cited_pages"] for r in active) / len(active), 1) if active else 0
    peak = max(daily, key=lambda r: r["citations"])
    return {
        "daily": daily,
        "total_citations": total,
        "avg_cited_pages": avg_pages,
        "peak": peak,
        "start": daily[0]["date"],
        "end": daily[-1]["date"],
    }


def split_period_deltas(daily: List[Dict], days: int) -> Dict:
    """Split a daily traffic series (get_rank_and_traffic output, sorted ascending) into the
    most recent `days` (current) vs the `days` before that (previous), and return totals +
    period-over-period % change for clicks/impressions plus derived CTR. Bing has no native
    deltas, so we derive them here to match the depth of the GSC/Ads decks."""
    def _sum(rows):
        clicks = sum(r.get("clicks", 0) for r in rows)
        impr = sum(r.get("impressions", 0) for r in rows)
        ctr = round(clicks / impr * 100, 2) if impr else 0
        return {"clicks": clicks, "impressions": impr, "ctr": ctr}

    def _pct(cur, prev):
        if not prev:
            return None
        return round((cur - prev) / prev * 100, 1)

    cur_rows = daily[-days:] if days else daily
    prev_rows = daily[-2 * days:-days] if days else []
    cur, prev = _sum(cur_rows), _sum(prev_rows)
    return {
        "current": cur,
        "previous": prev,
        "deltas": {
            "clicks": _pct(cur["clicks"], prev["clicks"]),
            "impressions": _pct(cur["impressions"], prev["impressions"]),
            "ctr": (round(cur["ctr"] - prev["ctr"], 2) if prev["impressions"] else None),
        },
    }
