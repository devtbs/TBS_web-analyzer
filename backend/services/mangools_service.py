"""Mangools KWFinder REST client — real keyword volume + difficulty (KD) + CPC.

This is the correct integration for a server-side pipeline: the Mangools *MCP server* only wraps this
same REST API for AI chat clients (Claude/Cursor) and counts against the same quota. We call the REST
API directly with a single `x-access-token` header.

Response fields (verified live): each keyword row has `kw`, `sv` (search volume), `seo` (KD 0-100),
`cpc`, `ppc`, `msv` (monthly search-volume trend). Best-effort throughout — any failure or a missing
key yields an empty list so the topical map still builds.
"""
import asyncio
import logging
import time
from typing import Dict, List

import httpx

logger = logging.getLogger(__name__)

_BASE = "https://api.mangools.com/v3"
_CACHE: Dict[tuple, tuple] = {}
_TTL = 24 * 60 * 60   # Mangools de-dupes identical lookups within 24h, so cache for 24h.

# TLD → Mangools location_id (subset; falls back to Thailand to match the SERP default).
_TLD_LOCATION = {
    "th": 2764, "uk": 2826, "co.uk": 2826, "au": 2036, "com.au": 2036, "sg": 2702,
    "my": 2458, "ph": 2608, "vn": 2704, "in": 2356, "jp": 2392, "us": 2840, "ca": 2124,
    "de": 2276, "fr": 2250,
}
_DEFAULT_LOCATION = 2764   # Thailand
_DEFAULT_LANGUAGE = 0      # Any Language


def mangools_configured() -> bool:
    from config import settings
    return bool((settings.MANGOOLS_API_KEY or "").strip())


def location_for_domain(domain: str) -> int:
    d = (domain or "").lower().strip("/")
    for tld, loc in sorted(_TLD_LOCATION.items(), key=lambda kv: -len(kv[0])):
        if d.endswith("." + tld):
            return loc
    return _DEFAULT_LOCATION


def _cache_get(key):
    e = _CACHE.get(key)
    if not e:
        return None
    ts, data = e
    if time.time() - ts > _TTL:
        _CACHE.pop(key, None)
        return None
    return data


def _norm(rows) -> List[Dict]:
    out = []
    for r in rows or []:
        kw = r.get("kw")
        if not kw:
            continue
        out.append({
            "keyword": kw,
            "volume": int(r.get("sv") or 0),
            "kd": r.get("seo"),                 # keyword difficulty 0-100 (may be null on thin kws)
            "cpc": (r.get("cpc") or {}).get("value") if isinstance(r.get("cpc"), dict) else r.get("cpc"),
            "ppc": r.get("ppc"),
        })
    return out


def _headers():
    from config import settings
    return {"x-access-token": (settings.MANGOOLS_API_KEY or "").strip()}


async def get_related_keywords(seed: str, location_id: int = None, language_id: int = None) -> List[Dict]:
    """Real related keywords for a seed (volume/KD/CPC), via KWFinder related-keywords. Cached 24h."""
    if not mangools_configured() or not seed or not seed.strip():
        return []
    loc = location_id or _DEFAULT_LOCATION
    lang = _DEFAULT_LANGUAGE if language_id is None else language_id
    key = ("related", seed.strip().lower(), loc, lang)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    def _run():
        params = {"kw": seed, "location_id": loc, "language_id": lang}
        with httpx.Client(timeout=30) as c:
            resp = c.get(f"{_BASE}/kwfinder/related-keywords", params=params, headers=_headers())
            resp.raise_for_status()
            return resp.json()

    try:
        data = await asyncio.to_thread(_run)
        rows = _norm(data.get("keywords", []))
        _CACHE[key] = (time.time(), rows)
        return rows
    except Exception as e:
        logger.warning("mangools related-keywords '%s' failed: %s", seed, str(e)[:150])
        return []
