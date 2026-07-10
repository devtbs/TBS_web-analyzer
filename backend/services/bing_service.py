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
