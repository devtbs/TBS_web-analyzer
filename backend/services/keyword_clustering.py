"""SERP-overlap keyword clustering — the technique Keyword Insights uses, done with our own SerpAPI
(no third-party clustering API needed).

Two keywords belong on the SAME page when Google ranks the SAME URLs for them. We fetch each
keyword's top-10 organic URLs and union keywords whose SERPs share >= MIN_OVERLAP URLs (union-find).
Each resulting group is one content cluster. Bounded by MAX_KEYWORDS because every keyword costs one
SerpAPI credit; results are cached 24h so re-runs are cheap. Best-effort — returns [] on any failure.
"""
import asyncio
import logging
import time
from typing import Dict, List

logger = logging.getLogger(__name__)

MAX_KEYWORDS = 18     # SerpAPI credits per analysis for clustering (one call per keyword)
MIN_OVERLAP = 3       # shared top-10 URLs required to merge two keywords (Keyword-Insights default)
TOP_N = 10

_SERP_CACHE: Dict[tuple, tuple] = {}
_TTL = 24 * 60 * 60


async def _serp_urls(keyword: str, location: str) -> set:
    key = (keyword.lower(), location)
    hit = _SERP_CACHE.get(key)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    try:
        from services.serp_service import serp_service
        data = await serp_service._fetch_keyword_data(keyword, location)
        urls = {(c.get("url") or "").split("?")[0].rstrip("/")
                for c in (data.get("competitors") or [])[:TOP_N] if c.get("url")}
    except Exception as e:
        logger.warning("cluster SERP '%s' failed: %s", keyword, str(e)[:120])
        urls = set()
    _SERP_CACHE[key] = (time.time(), urls)
    return urls


async def cluster_by_serp(keyword_rows: List[Dict], location: str = "th") -> List[Dict]:
    """Group opportunity keywords into content clusters by SERP overlap.

    keyword_rows: [{keyword, volume, kd, ...}] (already ranked by volume). Returns clusters:
    [{label, total_volume, keywords:[{keyword, volume, kd}]}] sorted by total volume desc.
    """
    rows = [r for r in (keyword_rows or []) if r.get("keyword")][:MAX_KEYWORDS]
    if len(rows) < 2:
        return []
    kws = [r["keyword"] for r in rows]
    serps = await asyncio.gather(*[_serp_urls(k, location) for k in kws])

    parent = list(range(len(kws)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(len(kws)):
        for j in range(i + 1, len(kws)):
            if serps[i] and serps[j] and len(serps[i] & serps[j]) >= MIN_OVERLAP:
                union(i, j)

    groups: Dict[int, List[Dict]] = {}
    for i in range(len(kws)):
        groups.setdefault(find(i), []).append(rows[i])

    clusters = []
    for members in groups.values():
        members.sort(key=lambda r: (r.get("volume") or 0), reverse=True)
        clusters.append({
            "label": members[0]["keyword"],
            "total_volume": sum((r.get("volume") or 0) for r in members),
            "keywords": [{"keyword": r["keyword"], "volume": r.get("volume"), "kd": r.get("kd")}
                         for r in members],
        })
    clusters.sort(key=lambda c: c["total_volume"], reverse=True)
    return clusters
