"""Google Search Console API service for fetching properties and data"""
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from typing import List, Dict, Optional
import logging
import time

logger = logging.getLogger(__name__)

# ── Module-level in-memory TTL cache ──────────────────────────────────────
# Key: (user_email, method, *args)  Value: (timestamp, data)
_CACHE: Dict[tuple, tuple] = {}

# TTL constants (seconds)
_TTL_PROPERTIES   =  5 * 60   #  5 min  – property list rarely changes
_TTL_ANALYTICS    = 15 * 60   # 15 min  – chart / KPI data
_TTL_PAGES        = 30 * 60   # 30 min  – per-page breakdown is expensive

def _cache_get(key: tuple):
    """Return cached value if still valid, else None."""
    entry = _CACHE.get(key)
    if entry is None:
        return None
    ts, ttl, data = entry
    if time.time() - ts > ttl:
        del _CACHE[key]
        return None
    return data

def _cache_set(key: tuple, data, ttl: int):
    """Store value with timestamp and TTL."""
    _CACHE[key] = (time.time(), ttl, data)

def invalidate_cache(user_email: str = None):
    """Invalidate all cache entries, optionally scoped to a user."""
    keys = [k for k in _CACHE if user_email is None or k[0] == user_email]
    for k in keys:
        del _CACHE[k]
    logger.info(f"Cache invalidated: {len(keys)} entries removed")



class GSCService:
    """Service for interacting with Google Search Console API"""
    
    SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly']
    
    def __init__(self, access_token: str = None, refresh_token: str = None, user_email: str = 'default'):
        """
        Initialize GSC service.

        - If refresh_token is provided: builds long-lived credentials that auto-refresh.
          This is the preferred path for permanent connections.
        - If only access_token is provided: uses it directly (expires in ~1 hour).
        """
        from config import settings
        self.user_email = user_email  # used as cache namespace

        if refresh_token:
            self.credentials = Credentials(
                token=access_token,
                refresh_token=refresh_token,
                token_uri='https://oauth2.googleapis.com/token',
                client_id=settings.GOOGLE_CLIENT_ID,
                client_secret=settings.GOOGLE_CLIENT_SECRET,
                scopes=self.SCOPES,
            )
            if not self.credentials.valid:
                self.credentials.refresh(GoogleRequest())
        elif access_token:
            self.credentials = Credentials(token=access_token)
        else:
            raise ValueError("Either access_token or refresh_token must be provided")

        self.service = build('searchconsole', 'v1', credentials=self.credentials)

    @classmethod
    def from_stored_token(cls, stored_token: str, is_refresh_token: bool = False, user_email: str = 'default'):
        """Factory: create a GSCService from the value stored in the database."""
        if is_refresh_token:
            return cls(refresh_token=stored_token, user_email=user_email)
        else:
            return cls(access_token=stored_token, user_email=user_email)

    async def get_properties(self) -> List[Dict[str, str]]:
        """
        Fetch all Search Console properties accessible by the user.
        Cached for _TTL_PROPERTIES seconds.
        """
        cache_key = (self.user_email, 'properties')
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info("Cache HIT: properties")
            return cached

        try:
            sites_list = self.service.sites().list().execute()
            properties = []
            site_entries = sites_list.get('siteEntry', [])

            for site in site_entries:
                site_url = site.get('siteUrl')
                if site_url and not site_url.startswith('sc-domain:'):
                    properties.append({
                        'url': site_url,
                        'permission_level': site.get('permissionLevel'),
                    })

            logger.info(f"Found {len(properties)} URL prefix properties")
            _cache_set(cache_key, properties, _TTL_PROPERTIES)
            return properties

        except HttpError as e:
            logger.error(f"HTTP Error {e.resp.status} fetching GSC properties: {str(e)}")
            raise Exception(f"Failed to fetch Search Console properties: HTTP {e.resp.status}")
        except Exception as e:
            logger.error(f"Unexpected error fetching GSC properties: {str(e)}")
            raise Exception(f"Failed to fetch Search Console properties: {str(e)}")

    async def verify_property_access(self, property_url: str) -> bool:
        """Verify that the user has access to a specific property."""
        try:
            self.service.sites().get(siteUrl=property_url).execute()
            return True
        except HttpError as e:
            if e.resp.status == 404:
                return False
            logger.error(f"Error verifying property access: {str(e)}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error verifying property: {str(e)}")
            return False

    async def get_pages_with_queries(self, property_url: str, days: int = 90) -> List[Dict]:
        """Fetch all pages from a property with their ranking queries. Cached for 30 min."""
        cache_key = (self.user_email, 'pages', property_url, days)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Cache HIT: pages {property_url}")
            return cached

        try:
            from datetime import datetime, timedelta

            end_date = datetime.now().date()
            start_date = end_date - timedelta(days=days)

            request = {
                'startDate': start_date.strftime('%Y-%m-%d'),
                'endDate': end_date.strftime('%Y-%m-%d'),
                'dimensions': ['page', 'query'],
                'rowLimit': 25000,
                'startRow': 0,
                'dataState': 'all'
            }

            response = self.service.searchanalytics().query(
                siteUrl=property_url,
                body=request
            ).execute()

            pages_data = {}
            rows = response.get('rows', [])

            for row in rows:
                page = row['keys'][0]
                query = row['keys'][1]
                clicks = row.get('clicks', 0)
                impressions = row.get('impressions', 0)
                position = row.get('position', 0)
                ctr = row.get('ctr', 0)

                if page not in pages_data:
                    pages_data[page] = {
                        'url': page,
                        'total_clicks': 0,
                        'total_impressions': 0,
                        'avg_position': 0,
                        'queries': []
                    }

                pages_data[page]['total_clicks'] += clicks
                pages_data[page]['total_impressions'] += impressions
                pages_data[page]['queries'].append({
                    'query': query,
                    'clicks': clicks,
                    'impressions': impressions,
                    'position': round(position, 1),
                    'ctr': round(ctr * 100, 2)
                })

            for page_url, data in pages_data.items():
                if data['queries']:
                    total_position = sum(q['position'] for q in data['queries'])
                    data['avg_position'] = round(total_position / len(data['queries']), 1)
                    data['queries'].sort(key=lambda x: x['clicks'], reverse=True)

            pages_list = list(pages_data.values())
            pages_list.sort(key=lambda x: x['total_clicks'], reverse=True)

            logger.info(f"Fetched {len(pages_list)} pages with queries from {property_url}")
            _cache_set(cache_key, pages_list, _TTL_PAGES)
            return pages_list

        except HttpError as e:
            logger.error(f"HTTP Error {e.resp.status} fetching pages: {str(e)}")
            raise Exception(f"Failed to fetch pages from Search Console: HTTP {e.resp.status}")
        except Exception as e:
            logger.error(f"Unexpected error fetching pages: {str(e)}")
            raise Exception(f"Failed to fetch pages: {str(e)}")

    async def get_search_analytics(self, property_url: str, days: int = 365, group_by: str = 'daily') -> Dict:
        """Fetch search analytics time-series data for charts, totals, and period-over-period deltas. Cached for 15 min."""
        cache_key = (self.user_email, 'analytics', property_url, days, group_by)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Cache HIT: analytics {property_url}")
            return cached
        try:
            from datetime import datetime, timedelta
            from collections import defaultdict

            def _fetch_period(start: 'date', end: 'date') -> Dict:
                """Helper: query GSC for a single date range and return aggregated totals."""
                response = self.service.searchanalytics().query(
                    siteUrl=property_url,
                    body={
                        'startDate': start.strftime('%Y-%m-%d'),
                        'endDate': end.strftime('%Y-%m-%d'),
                        'dimensions': ['date'],
                        'rowLimit': 25000,
                        'dataState': 'all'
                    }
                ).execute()
                rows = response.get('rows', [])
                t_clicks, t_impressions, t_position = 0, 0, 0
                grouped = defaultdict(lambda: {'clicks': 0, 'impressions': 0, 'total_position': 0})
                for row in rows:
                    date_str = row['keys'][0]
                    date_obj = datetime.strptime(date_str, '%Y-%m-%d')
                    if group_by == 'monthly':
                        day_key = date_str[:7]
                    elif group_by == 'weekly':
                        start_of_week = date_obj - timedelta(days=date_obj.weekday())
                        day_key = start_of_week.strftime('%Y-%m-%d')
                    else:
                        day_key = date_str
                    clicks = row.get('clicks', 0)
                    impressions = row.get('impressions', 0)
                    position = row.get('position', 0)
                    t_clicks += clicks
                    t_impressions += impressions
                    t_position += position * impressions
                    grouped[day_key]['clicks'] += clicks
                    grouped[day_key]['impressions'] += impressions
                    grouped[day_key]['total_position'] += position * impressions
                avg_pos = (t_position / t_impressions) if t_impressions > 0 else 0
                avg_ctr = (t_clicks / t_impressions * 100) if t_impressions > 0 else 0
                return {
                    'totals': {
                        'clicks': t_clicks,
                        'impressions': t_impressions,
                        'ctr': round(avg_ctr, 2),
                        'position': round(avg_pos, 2)
                    },
                    'grouped': grouped
                }

            # ── Current period ──────────────────────────────────────────
            end_date = datetime.now().date()
            start_date = end_date - timedelta(days=days)
            current = _fetch_period(start_date, end_date)

            # ── Previous period (same length, immediately before) ───────
            prev_end = start_date - timedelta(days=1)
            prev_start = prev_end - timedelta(days=days)
            previous = _fetch_period(prev_start, prev_end)

            # ── Build chart data from current period ────────────────────
            grouped_by_date = current['grouped']
            chart_data = []
            for day_key in sorted(grouped_by_date.keys()):
                if group_by == 'monthly':
                    m_abbr = datetime.strptime(day_key, '%Y-%m').strftime('%b')
                else:
                    m_abbr = datetime.strptime(day_key, '%Y-%m-%d').strftime('%b %d')
                m_clicks = grouped_by_date[day_key]['clicks']
                m_impressions = grouped_by_date[day_key]['impressions']
                m_tot_pos = grouped_by_date[day_key].get('total_position', 0)
                m_ctr = (m_clicks / m_impressions * 100) if m_impressions > 0 else 0
                m_pos = (m_tot_pos / m_impressions) if m_impressions > 0 else 0
                chart_data.append({
                    'month': m_abbr,
                    'clicks': m_clicks,
                    'impressions': m_impressions,
                    'ctr': round(m_ctr, 2),
                    'position': round(m_pos, 2)
                })

            # ── Compute deltas ──────────────────────────────────────────
            def pct_change(curr, prev):
                """Percentage change; None when no previous data."""
                if prev == 0:
                    return None
                return round(((curr - prev) / abs(prev)) * 100, 1)

            def pp_change(curr, prev):
                """Percentage-point change (used for CTR and position)."""
                return round(curr - prev, 2)

            cur_t = current['totals']
            prv_t = previous['totals']

            deltas = {
                'clicks': pct_change(cur_t['clicks'], prv_t['clicks']),
                'impressions': pct_change(cur_t['impressions'], prv_t['impressions']),
                'ctr': pp_change(cur_t['ctr'], prv_t['ctr']),       # pp difference
                'position': pp_change(cur_t['position'], prv_t['position']),  # lower is better
            }

            window = 30 if group_by == 'daily' else 14 if group_by == 'weekly' else 12
            result = {
                'totals': cur_t,
                'previous_totals': prv_t,
                'deltas': deltas,
                'chart_data': chart_data[-window:]
            }
            _cache_set(cache_key, result, _TTL_ANALYTICS)
            return result
        except Exception as e:
            logger.error(f"Error fetching analytics chart data: {str(e)}")
            raise Exception(f"Failed to fetch analytics: {str(e)}")


    async def get_countries(self, property_url: str, days: int = 28) -> List[Dict]:
        """Fetch clicks/impressions/ctr/position broken down by country. Cached 15 min."""
        cache_key = (self.user_email, 'countries', property_url, days)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Cache HIT: countries {property_url}")
            return cached

        try:
            from datetime import datetime, timedelta

            end_date = datetime.now().date()
            start_date = end_date - timedelta(days=days)
            prev_end = start_date - timedelta(days=1)
            prev_start = prev_end - timedelta(days=days)

            def _fetch(start, end):
                resp = self.service.searchanalytics().query(
                    siteUrl=property_url,
                    body={
                        'startDate': start.strftime('%Y-%m-%d'),
                        'endDate': end.strftime('%Y-%m-%d'),
                        'dimensions': ['country'],
                        'rowLimit': 250,
                        'dataState': 'all'
                    }
                ).execute()
                result = {}
                for row in resp.get('rows', []):
                    country = row['keys'][0]
                    result[country] = {
                        'clicks': row.get('clicks', 0),
                        'impressions': row.get('impressions', 0),
                        'ctr': round(row.get('ctr', 0) * 100, 2),
                        'position': round(row.get('position', 0), 1),
                    }
                return result

            current = _fetch(start_date, end_date)
            previous = _fetch(prev_start, prev_end)

            result = []
            for country, cur in current.items():
                prev = previous.get(country, {})
                prev_clicks = prev.get('clicks', 0)
                clicks_delta = None
                if prev_clicks > 0:
                    clicks_delta = round(((cur['clicks'] - prev_clicks) / prev_clicks) * 100, 1)
                result.append({
                    'name': country,
                    'clicks': cur['clicks'],
                    'impressions': cur['impressions'],
                    'ctr': cur['ctr'],
                    'position': cur['position'],
                    'clicks_delta': clicks_delta,
                    'impressions_delta': round(cur['impressions'] - prev.get('impressions', 0), 0) if prev else None,
                })

            result.sort(key=lambda x: x['clicks'], reverse=True)
            _cache_set(cache_key, result, _TTL_ANALYTICS)
            return result

        except HttpError as e:
            logger.error(f"HTTP Error {e.resp.status} fetching countries: {str(e)}")
            raise Exception(f"Failed to fetch countries: HTTP {e.resp.status}")
        except Exception as e:
            logger.error(f"Unexpected error fetching countries: {str(e)}")
            raise Exception(f"Failed to fetch countries: {str(e)}")

    async def get_devices(self, property_url: str, days: int = 28) -> List[Dict]:
        """Fetch clicks/impressions/ctr/position broken down by device. Cached 15 min."""
        cache_key = (self.user_email, 'devices', property_url, days)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Cache HIT: devices {property_url}")
            return cached

        try:
            from datetime import datetime, timedelta

            end_date = datetime.now().date()
            start_date = end_date - timedelta(days=days)
            prev_end = start_date - timedelta(days=1)
            prev_start = prev_end - timedelta(days=days)

            def _fetch(start, end):
                resp = self.service.searchanalytics().query(
                    siteUrl=property_url,
                    body={
                        'startDate': start.strftime('%Y-%m-%d'),
                        'endDate': end.strftime('%Y-%m-%d'),
                        'dimensions': ['device'],
                        'rowLimit': 10,
                        'dataState': 'all'
                    }
                ).execute()
                result = {}
                for row in resp.get('rows', []):
                    device = row['keys'][0].upper()
                    result[device] = {
                        'clicks': row.get('clicks', 0),
                        'impressions': row.get('impressions', 0),
                        'ctr': round(row.get('ctr', 0) * 100, 2),
                        'position': round(row.get('position', 0), 1),
                    }
                return result

            current = _fetch(start_date, end_date)
            previous = _fetch(prev_start, prev_end)

            result = []
            for device, cur in current.items():
                prev = previous.get(device, {})
                prev_clicks = prev.get('clicks', 0)
                clicks_delta = None
                if prev_clicks > 0:
                    clicks_delta = round(((cur['clicks'] - prev_clicks) / prev_clicks) * 100, 1)
                prev_imp = prev.get('impressions', 0)
                imp_delta = None
                if prev_imp > 0:
                    imp_delta = round(((cur['impressions'] - prev_imp) / prev_imp) * 100, 1)
                result.append({
                    'name': device,
                    'clicks': cur['clicks'],
                    'impressions': cur['impressions'],
                    'ctr': cur['ctr'],
                    'position': cur['position'],
                    'clicks_delta': clicks_delta,
                    'impressions_delta': imp_delta,
                })

            result.sort(key=lambda x: x['clicks'], reverse=True)
            _cache_set(cache_key, result, _TTL_ANALYTICS)
            return result

        except HttpError as e:
            logger.error(f"HTTP Error {e.resp.status} fetching devices: {str(e)}")
            raise Exception(f"Failed to fetch devices: HTTP {e.resp.status}")
        except Exception as e:
            logger.error(f"Unexpected error fetching devices: {str(e)}")
            raise Exception(f"Failed to fetch devices: {str(e)}")


async def get_user_properties(stored_token: str, is_refresh_token: bool = False) -> List[Dict[str, str]]:
    """
    Helper: get user's Search Console properties from stored credentials.
    
    Args:
        stored_token: Token string from the database.
        is_refresh_token: True if the token is a refresh token.
    """
    service = GSCService.from_stored_token(stored_token, is_refresh_token=is_refresh_token)
    return await service.get_properties()
