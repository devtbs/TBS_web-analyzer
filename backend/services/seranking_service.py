"""SE Ranking Project API service — keyword rank tracking for TBS's client projects.

SE Ranking provides true rank tracking (the exact Google position for each tracked
keyword, over time), which GSC's blended "average position" cannot. Uses TBS's single
account API key from settings (shared across the tool, not per-user).

Docs: https://seranking.com/api/project/getting-started/
Auth: header  Authorization: Token <API_KEY>
Base: https://api.seranking.com/v1/project-management
Rate limit: 5 requests/second.
"""
from typing import List, Dict, Optional
from config import settings
import logging
import time
import httpx

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.seranking.com/v1/project-management"

# ── Simple in-memory TTL cache (account-wide; key has no user since the key is shared) ──
_CACHE: Dict[tuple, tuple] = {}
_TTL_PROJECTS  = 10 * 60   # 10 min – project list rarely changes
_TTL_POSITIONS = 15 * 60   # 15 min – ranking data


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


def invalidate_cache():
    _CACHE.clear()
    logger.info("SE Ranking cache cleared")


class SERankingService:
    """Client for the SE Ranking Project API."""

    def __init__(self, api_key: str = None):
        self.api_key = api_key or settings.SERANKING_API_KEY
        if not self.api_key:
            raise ValueError("SE Ranking API key not configured (SERANKING_API_KEY).")

    @property
    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Token {self.api_key}"}

    async def _get(self, path: str, params: dict = None) -> any:
        url = f"{_BASE_URL}{path}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, headers=self._headers, params=params or {})
        if resp.status_code == 401:
            raise Exception("SE Ranking auth failed (401) — check the API key.")
        if resp.status_code == 429:
            raise Exception("SE Ranking rate limit hit (429) — slow down.")
        if resp.status_code >= 400:
            raise Exception(f"SE Ranking API error {resp.status_code}: {resp.text[:300]}")
        return resp.json()

    async def get_projects(self) -> List[Dict]:
        """List all SE Ranking projects (tracked client sites)."""
        cache_key = ('projects',)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info("SE Ranking cache HIT: projects")
            return cached

        data = await self._get("/sites")
        projects = []
        for site in (data or []):
            projects.append({
                'id': site.get('id'),
                'title': site.get('title') or site.get('name'),
                'domain': site.get('name'),
                'keyword_count': site.get('keyword_count', 0),
                'is_active': site.get('is_active', 1),
                'guest_link': site.get('guest_link'),
            })
        _cache_set(cache_key, projects, _TTL_PROJECTS)
        return projects

    async def _get_keyword_names(self, site_id: int) -> Dict[int, Dict]:
        """Map keyword id → {name, link}. The positions endpoint returns ids only."""
        try:
            data = await self._get("/keywords", params={'site_id': site_id})
        except Exception as e:
            logger.warning(f"Could not fetch keyword names for site {site_id}: {e}")
            return {}
        out = {}
        for kw in (data or []):
            out[kw.get('id')] = {'name': kw.get('name', ''), 'link': kw.get('link', '')}
        return out

    async def get_keyword_positions(self, site_id: int, days: int = 30) -> Dict:
        """
        Fetch per-keyword ranking positions over the period, plus a summary
        (position buckets, average position, improved/declined counts).
        """
        cache_key = ('positions', site_id, days)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"SE Ranking cache HIT: positions {site_id}")
            return cached

        from datetime import datetime, timedelta
        end = datetime.now().date()
        start = end - timedelta(days=days)

        names = await self._get_keyword_names(site_id)

        data = await self._get("/sites/positions", params={
            'site_id': site_id,
            'date_from': start.strftime('%Y-%m-%d'),
            'date_to': end.strftime('%Y-%m-%d'),
        })

        # The response is a list of SEARCH-ENGINE groups, each with its own keyword
        # list. The same keywords can be tracked across several engines/locations; to
        # avoid double-counting we report the primary (first) engine group.
        engine_groups = data or []
        engine_count = len(engine_groups)
        kw_rows = engine_groups[0].get('keywords', []) if engine_groups else []

        keywords = []
        buckets = {'top3': 0, 'top10': 0, 'top30': 0, 'top100': 0, 'not_ranking': 0}
        improved = declined = unchanged = 0
        ranking_positions = []  # for average (exclude not-ranking)

        for kw in kw_rows:
            kw_id = str(kw.get('id'))
            positions = sorted(kw.get('positions', []) or [], key=lambda p: p.get('date', ''))
            # pos == 0 (or missing) means "not ranking in the checked depth" that day.
            latest = positions[-1].get('pos') if positions else None
            earliest = positions[0].get('pos') if positions else None
            current_pos = latest if (latest and latest > 0) else None
            start_pos = earliest if (earliest and earliest > 0) else None

            # Period change: positive = improved (moved up = lower number)
            change = None
            if current_pos is not None and start_pos is not None:
                change = start_pos - current_pos
                if change > 0:
                    improved += 1
                elif change < 0:
                    declined += 1
                else:
                    unchanged += 1
            elif current_pos is not None and start_pos is None:
                improved += 1   # entered the rankings during the period
            elif current_pos is None and start_pos is not None:
                declined += 1   # dropped out of the rankings

            # Bucket by current position
            if current_pos is None:
                buckets['not_ranking'] += 1
            else:
                ranking_positions.append(current_pos)
                if current_pos <= 3:
                    buckets['top3'] += 1
                elif current_pos <= 10:
                    buckets['top10'] += 1
                elif current_pos <= 30:
                    buckets['top30'] += 1
                else:
                    buckets['top100'] += 1

            meta = names.get(kw_id, {})
            landing = kw.get('landing_pages') or []
            landing_url = landing[-1].get('url') if landing and isinstance(landing[-1], dict) else (meta.get('link') or '')
            keywords.append({
                'keyword': meta.get('name') or kw_id,
                'position': current_pos,
                'change': change,
                'volume': kw.get('volume', 0),
                'url': landing_url,
            })

        # Sort: ranking keywords first (best position), not-ranking last
        keywords.sort(key=lambda k: (k['position'] is None, k['position'] or 9999))

        avg_position = round(sum(ranking_positions) / len(ranking_positions), 1) if ranking_positions else None

        result = {
            'site_id': site_id,
            'period': {'start': start.strftime('%Y-%m-%d'), 'end': end.strftime('%Y-%m-%d')},
            'engine_count': engine_count,
            'summary': {
                'total_keywords': len(keywords),
                'avg_position': avg_position,
                'buckets': buckets,
                'improved': improved,
                'declined': declined,
                'unchanged': unchanged,
            },
            'keywords': keywords,
        }
        _cache_set(cache_key, result, _TTL_POSITIONS)
        return result


def get_service() -> SERankingService:
    """Factory that raises a clear error if the key is missing."""
    return SERankingService()
