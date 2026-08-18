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


# Cap concurrent SerpAPI calls during a large clustering run. A semaphore is created lazily PER EVENT
# LOOP (an asyncio.Semaphore binds to the loop that first uses it, so a single module-level one breaks
# if a second loop ever touches it). One semaphore per loop keeps the limit correct and loop-safe.
import weakref
_SEM_BY_LOOP: "weakref.WeakKeyDictionary" = weakref.WeakKeyDictionary()
_SEM_LIMIT = 6


def _sem() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    s = _SEM_BY_LOOP.get(loop)
    if s is None:
        s = asyncio.Semaphore(_SEM_LIMIT)
        _SEM_BY_LOOP[loop] = s
    return s


async def _serp_urls(keyword: str, location: str, top_n: int = TOP_N) -> set:
    key = (keyword.lower(), location, top_n)
    hit = _SERP_CACHE.get(key)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    try:
        from services.serp_service import serp_service
        async with _sem():
            data = await serp_service._fetch_keyword_data(keyword, location)
        urls = {(c.get("url") or "").split("?")[0].rstrip("/")
                for c in (data.get("competitors") or [])[:top_n] if c.get("url")}
    except Exception as e:
        logger.warning("cluster SERP '%s' failed: %s", keyword, str(e)[:120])
        urls = set()
    _SERP_CACHE[key] = (time.time(), urls)
    return urls


def _build_clusters(rows: List[Dict], serps: List[set], min_overlap: int, mode: str) -> List[Dict]:
    """Turn per-keyword SERP URL-sets into clusters. `mode`:
      - 'hard'    : union-find — transitive groups, each keyword in exactly one cluster.
      - 'centric' : pillar-seeded — highest-volume unclustered keyword seeds a cluster and pulls in
                    only keywords sharing >= min_overlap with THAT pillar (tighter, page-focused).
    """
    n = len(rows)
    if mode == "centric":
        order = sorted(range(n), key=lambda i: (rows[i].get("volume") or 0), reverse=True)
        used = [False] * n
        groups: List[List[Dict]] = []
        for i in order:
            if used[i] or not serps[i]:
                continue
            members = [rows[i]]
            used[i] = True
            for j in order:
                if used[j] or not serps[j]:
                    continue
                if len(serps[i] & serps[j]) >= min_overlap:
                    members.append(rows[j])
                    used[j] = True
            groups.append(members)
        # keywords with no SERP still form singletons
        for i in range(n):
            if not used[i]:
                groups.append([rows[i]])
        return groups

    # hard / agglomerative (union-find)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(n):
        for j in range(i + 1, n):
            if serps[i] and serps[j] and len(serps[i] & serps[j]) >= min_overlap:
                ra, rb = find(i), find(j)
                if ra != rb:
                    parent[rb] = ra
    grouped: Dict[int, List[Dict]] = {}
    for i in range(n):
        grouped.setdefault(find(i), []).append(rows[i])
    return list(grouped.values())


async def cluster_by_serp(keyword_rows: List[Dict], location: str = "th", *,
                          min_overlap: int = MIN_OVERLAP, top_n: int = TOP_N,
                          mode: str = "hard", max_keywords: int = MAX_KEYWORDS,
                          progress=None) -> List[Dict]:
    """Group keywords into content clusters by SERP overlap (the Keyword-Insights technique).

    keyword_rows: [{keyword, volume, kd, ...}]. `min_overlap` = shared top-N URLs needed to merge
    (accuracy). `mode` = 'hard'|'centric'. `progress(done, total)` is an optional async callback for
    long runs. Returns [{label, pillar, total_volume, avg_kd, keywords:[{keyword,volume,kd}]}] sorted
    by total volume.
    """
    rows = [r for r in (keyword_rows or []) if r.get("keyword")][:max_keywords]
    if len(rows) < 2:
        return []
    kws = [r["keyword"] for r in rows]

    # Fetch SERPs with progress reporting (fetches run concurrently, bounded by _SEM).
    serps: List[set] = [set()] * len(kws)
    done = 0

    async def _one(idx, kw):
        nonlocal done
        s = await _serp_urls(kw, location, top_n)
        serps[idx] = s
        done += 1
        if progress and (done % 10 == 0 or done == len(kws)):
            await progress(done, len(kws))

    await asyncio.gather(*[_one(i, k) for i, k in enumerate(kws)])

    groups = _build_clusters(rows, serps, min_overlap, mode)

    clusters = []
    for members in groups:
        members.sort(key=lambda r: (r.get("volume") or 0), reverse=True)
        kds = [r.get("kd") for r in members if r.get("kd") is not None]
        clusters.append({
            "label": members[0]["keyword"],
            "pillar": members[0]["keyword"],
            "total_volume": sum((r.get("volume") or 0) for r in members),
            "avg_kd": round(sum(kds) / len(kds)) if kds else None,
            "keywords": [{"keyword": r["keyword"], "volume": r.get("volume"), "kd": r.get("kd")}
                         for r in members],
        })
    clusters.sort(key=lambda c: c["total_volume"], reverse=True)
    return clusters
