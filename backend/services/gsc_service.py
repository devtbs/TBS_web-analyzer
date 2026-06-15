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

# Google Search Console finalizes data ~2–3 days behind real time. Querying up to
# "today" pulls in incomplete partial days and makes our totals read LOW versus the
# GSC UI (which ends its default range ~3 days ago). We offset every range end by
# this many days so our numbers match what clients see in Search Console.
GSC_DATA_LAG_DAYS = 3

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
                if not site_url:
                    continue
                # Include BOTH URL-prefix and Domain (sc-domain:) properties. Domain
                # properties were previously dropped, which hid traffic for any client
                # set up that way in GSC. Keep the raw `url` (required for API calls) and
                # add a human-friendly `display` + a `type` tag for the frontend.
                is_domain = site_url.startswith('sc-domain:')
                properties.append({
                    'url': site_url,
                    'display': site_url.replace('sc-domain:', '') if is_domain else site_url,
                    'type': 'domain' if is_domain else 'url-prefix',
                    'permission_level': site.get('permissionLevel'),
                })

            logger.info(f"Found {len(properties)} properties ({sum(1 for p in properties if p['type'] == 'domain')} domain, {sum(1 for p in properties if p['type'] == 'url-prefix')} url-prefix)")
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

    def _apply_filter(self, request: dict, filters_json: str):
        """Helper to append dimension filter group to a GSC query request.

        GSC API operator values (case-sensitive, lowercase):
          equals | notEquals | contains | notContains | includingRegex | excludingRegex
        """
        if not filters_json:
            return
        import json

        # Frontend name -> GSC API operator string (all lowercase)
        OPERATOR_MAP = {
            'contains':       'contains',
            'notContains':    'notContains',
            'includingRegex': 'includingRegex',
            'equals':         'equals',
            # Numeric filters are handled client-side only
            'greaterThan':    None,
            'lessThan':       None,
        }
        TEXT_DIMS = {'query', 'page', 'country', 'device'}

        try:
            filters_list = json.loads(filters_json)
            gsc_filters = []
            for f in filters_list:
                dim = f.get('dimension', '')
                op  = f.get('operator', 'equals')
                exp = f.get('expression', '').strip()

                if not exp:
                    continue

                # Only text-based dimensions go to the GSC API
                if dim not in TEXT_DIMS:
                    continue

                # country and device always use equals
                if dim in ('country', 'device'):
                    gsc_op = 'equals'
                else:
                    gsc_op = OPERATOR_MAP.get(op)
                    if gsc_op is None:
                        continue  # numeric operator — skip

                gsc_filters.append({
                    'dimension':  dim,
                    'operator':   gsc_op,
                    'expression': exp,
                })

            if gsc_filters:
                request['dimensionFilterGroups'] = [{'filters': gsc_filters}]
        except (json.JSONDecodeError, KeyError):
            pass


    async def get_pages_with_queries(
        self, property_url: str, days: int = 90, 
        filters_json: str = None
    ) -> List[Dict]:
        """Fetch all pages from a property with their ranking queries. Cached for 30 min."""
        cache_key = (self.user_email, 'pages', property_url, days, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Cache HIT: pages {property_url}")
            return cached

        try:
            from datetime import datetime, timedelta

            end_date = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
            start_date = end_date - timedelta(days=days)

            request = {
                'startDate': start_date.strftime('%Y-%m-%d'),
                'endDate': end_date.strftime('%Y-%m-%d'),
                'dimensions': ['page', 'query'],
                'rowLimit': 25000,
                'startRow': 0,
                'dataState': 'all'
            }
            self._apply_filter(request, filters_json)

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
                    # Impression-weighted average position — matches how GSC (and our own
                    # get_search_analytics) computes it. A plain mean over queries
                    # over-weights low-impression long-tail terms and disagrees with the
                    # position shown elsewhere in the app.
                    total_imp = sum(q['impressions'] for q in data['queries'])
                    weighted_pos = sum(q['position'] * q['impressions'] for q in data['queries'])
                    data['avg_position'] = round(weighted_pos / total_imp, 1) if total_imp else 0
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

    async def get_search_analytics(
        self, property_url: str, days: int = 365, group_by: str = 'daily',
        filters_json: str = None
    ) -> Dict:
        """Fetch search analytics time-series data for charts, totals, and period-over-period deltas. Cached for 15 min."""
        cache_key = (self.user_email, 'analytics', property_url, days, group_by, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Cache HIT: analytics {property_url}")
            return cached
        try:
            from datetime import datetime, timedelta
            from collections import defaultdict

            def _fetch_period(start: 'date', end: 'date') -> Dict:
                """Helper: query GSC for a single date range and return aggregated totals."""
                req_body = {
                    'startDate': start.strftime('%Y-%m-%d'),
                    'endDate': end.strftime('%Y-%m-%d'),
                    'dimensions': ['date'],
                    'rowLimit': 25000,
                    'dataState': 'all'
                }
                self._apply_filter(req_body, filters_json)
                
                response = self.service.searchanalytics().query(
                    siteUrl=property_url,
                    body=req_body
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
            end_date = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
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


    async def get_countries(
        self, property_url: str, days: int = 28,
        filters_json: str = None
    ) -> List[Dict]:
        """Fetch clicks/impressions/ctr/position broken down by country. Cached 15 min."""
        cache_key = (self.user_email, 'countries', property_url, days, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Cache HIT: countries {property_url}")
            return cached

        try:
            from datetime import datetime, timedelta

            end_date = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
            start_date = end_date - timedelta(days=days)
            prev_end = start_date - timedelta(days=1)
            prev_start = prev_end - timedelta(days=days)

            def _fetch(start, end):
                req_body = {
                    'startDate': start.strftime('%Y-%m-%d'),
                    'endDate': end.strftime('%Y-%m-%d'),
                    'dimensions': ['country'],
                    'rowLimit': 250,
                    'dataState': 'all'
                }
                self._apply_filter(req_body, filters_json)
                resp = self.service.searchanalytics().query(
                    siteUrl=property_url,
                    body=req_body
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

    async def get_top_pages(
        self, property_url: str, days: int = 28,
        filters_json: str = None
    ) -> List[Dict]:
        """Return top pages with clicks/impressions/ctr/position + delta vs prior period. Cached 15 min."""
        cache_key = (self.user_email, 'top_pages', property_url, days, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Cache HIT: top_pages {property_url}")
            return cached
    
        try:
            from datetime import datetime, timedelta
            end_date   = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
            start_date = end_date - timedelta(days=days)
            prev_end   = start_date - timedelta(days=1)
            prev_start = prev_end - timedelta(days=days)

            def _fetch(start, end):
                req_body = {
                    'startDate': start.strftime('%Y-%m-%d'),
                    'endDate':   end.strftime('%Y-%m-%d'),
                    'dimensions': ['page'],
                    'rowLimit':   100,
                    'dataState':  'all',
                }
                self._apply_filter(req_body, filters_json)
                resp = self.service.searchanalytics().query(
                    siteUrl=property_url,
                    body=req_body
                ).execute()
                result = {}
                for row in resp.get('rows', []):
                    key = row['keys'][0].rstrip('/')
                    result[key] = {
                        'clicks':      row.get('clicks', 0),
                        'impressions': row.get('impressions', 0),
                        'ctr':         round(row.get('ctr', 0) * 100, 2),
                        'position':    round(row.get('position', 0), 1),
                    }
                return result

            current  = _fetch(start_date, end_date)
            previous = _fetch(prev_start, prev_end)

            result = []
            for url, cur in current.items():
                prev = previous.get(url, {})
                prev_clicks = prev.get('clicks', 0)
                clicks_delta = None
                if prev_clicks > 0:
                    clicks_delta = round(((cur['clicks'] - prev_clicks) / prev_clicks) * 100, 1)
                result.append({
                    'url':          url,
                    'clicks':       cur['clicks'],
                    'impressions':  cur['impressions'],
                    'ctr':          cur['ctr'],
                    'position':     cur['position'],
                    'clicks_delta': clicks_delta,
                })

            result.sort(key=lambda x: x['clicks'], reverse=True)
            _cache_set(cache_key, result, _TTL_ANALYTICS)
            return result

        except HttpError as e:
            logger.error(f"HTTP Error {e.resp.status} fetching top_pages: {str(e)}")
            raise Exception(f"Failed to fetch pages: HTTP {e.resp.status}")
        except Exception as e:
            logger.error(f"Unexpected error fetching top_pages: {str(e)}")
            raise Exception(f"Failed to fetch pages: {str(e)}")

    async def get_top_queries(
        self, property_url: str, days: int = 28,
        filters_json: str = None
    ) -> List[Dict]:
        """Return top queries with clicks/impressions/ctr/position + delta vs prior period. Cached 15 min."""
        cache_key = (self.user_email, 'top_queries', property_url, days, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Cache HIT: top_queries {property_url}")
            return cached

        try:
            from datetime import datetime, timedelta
            end_date   = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
            start_date = end_date - timedelta(days=days)
            prev_end   = start_date - timedelta(days=1)
            prev_start = prev_end - timedelta(days=days)

            def _fetch(start, end):
                req_body = {
                    'startDate': start.strftime('%Y-%m-%d'),
                    'endDate':   end.strftime('%Y-%m-%d'),
                    'dimensions': ['query'],
                    'rowLimit':   25000,
                    'dataState':  'all',
                }
                self._apply_filter(req_body, filters_json)
                resp = self.service.searchanalytics().query(
                    siteUrl=property_url,
                    body=req_body
                ).execute()
                result = {}
                for row in resp.get('rows', []):
                    # Use the raw query string as key — do NOT normalize to lowercase.
                    # GSC already returns normalized queries; applying .lower() here merges
                    # distinct queries that differ only by case/unicode, dropping rows.
                    key = row['keys'][0]
                    result[key] = {
                        'clicks':      row.get('clicks', 0),
                        'impressions': row.get('impressions', 0),
                        'ctr':         round(row.get('ctr', 0) * 100, 2),
                        'position':    round(row.get('position', 0), 1),
                    }
                return result

            current  = _fetch(start_date, end_date)
            previous = _fetch(prev_start, prev_end)

            result = []
            for query_text, cur in current.items():
                prev = previous.get(query_text, {})
                prev_clicks = prev.get('clicks', 0)
                clicks_delta = None
                if prev_clicks > 0:
                    clicks_delta = round(((cur['clicks'] - prev_clicks) / prev_clicks) * 100, 1)
                result.append({
                    'query':        query_text,
                    'clicks':       cur['clicks'],
                    'impressions':  cur['impressions'],
                    'ctr':          cur['ctr'],
                    'position':     cur['position'],
                    'clicks_delta': clicks_delta,
                })

            result.sort(key=lambda x: x['clicks'], reverse=True)
            _cache_set(cache_key, result, _TTL_ANALYTICS)
            return result

        except HttpError as e:
            logger.error(f"HTTP Error {e.resp.status} fetching top_queries: {str(e)}")
            raise Exception(f"Failed to fetch queries: HTTP {e.resp.status}")
        except Exception as e:
            logger.error(f"Unexpected error fetching top_queries: {str(e)}")
            raise Exception(f"Failed to fetch queries: {str(e)}")

    async def get_devices(
        self, property_url: str, days: int = 28,
        filters_json: str = None
    ) -> List[Dict]:
        """Fetch clicks/impressions/ctr/position broken down by device. Cached 15 min."""
        cache_key = (self.user_email, 'devices', property_url, days, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Cache HIT: devices {property_url}")
            return cached

        try:
            from datetime import datetime, timedelta

            end_date = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
            start_date = end_date - timedelta(days=days)
            prev_end = start_date - timedelta(days=1)
            prev_start = prev_end - timedelta(days=days)

            def _fetch(start, end):
                req_body = {
                    'startDate': start.strftime('%Y-%m-%d'),
                    'endDate': end.strftime('%Y-%m-%d'),
                    'dimensions': ['device'],
                    'rowLimit': 10,
                    'dataState': 'all'
                }
                self._apply_filter(req_body, filters_json)
                resp = self.service.searchanalytics().query(
                    siteUrl=property_url,
                    body=req_body
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

    async def get_daily_stats(
        self, property_url: str, days: int = 28,
        filters_json: str = None
    ) -> List[Dict]:
        """
        Return per-day unique query counts, page counts, and position-bucket impressions.
        Used to power the Query Counting and Pages Ranking charts.
        Cached 15 min.
        """
        cache_key = (self.user_email, 'daily_stats', property_url, days, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Cache HIT: daily_stats {property_url}")
            return cached

        try:
            from datetime import datetime, timedelta

            end_date = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
            start_date = end_date - timedelta(days=days)

            # --- Query-level rows (date × query) to count unique queries/day and position buckets ---
            query_req = {
                'startDate': start_date.strftime('%Y-%m-%d'),
                'endDate': end_date.strftime('%Y-%m-%d'),
                'dimensions': ['date', 'query'],
                'rowLimit': 25000,
                'dataState': 'all',
            }
            self._apply_filter(query_req, filters_json)
            query_resp = self.service.searchanalytics().query(
                siteUrl=property_url,
                body=query_req
            ).execute()

            # --- Page-level rows (date × page) to count unique pages/day ---
            page_req = {
                'startDate': start_date.strftime('%Y-%m-%d'),
                'endDate': end_date.strftime('%Y-%m-%d'),
                'dimensions': ['date', 'page'],
                'rowLimit': 25000,
                'dataState': 'all',
            }
            self._apply_filter(page_req, filters_json)
            page_resp = self.service.searchanalytics().query(
                siteUrl=property_url,
                body=page_req
            ).execute()

            # Aggregate by date
            date_map: Dict[str, Dict] = {}

            for row in query_resp.get('rows', []):
                date_str = row['keys'][0]
                position = row.get('position', 0)
                impressions = row.get('impressions', 0)
                if date_str not in date_map:
                    date_map[date_str] = {
                        'totalQueries': 0, 'totalPages': 0,
                        'pos_1_3': 0, 'pos_4_10': 0, 'pos_11_20': 0, 'pos_21_plus': 0,
                    }
                date_map[date_str]['totalQueries'] += 1
                if position <= 3:
                    date_map[date_str]['pos_1_3'] += impressions
                elif position <= 10:
                    date_map[date_str]['pos_4_10'] += impressions
                elif position <= 20:
                    date_map[date_str]['pos_11_20'] += impressions
                else:
                    date_map[date_str]['pos_21_plus'] += impressions

            for row in page_resp.get('rows', []):
                date_str = row['keys'][0]
                if date_str not in date_map:
                    date_map[date_str] = {
                        'totalQueries': 0, 'totalPages': 0,
                        'pos_1_3': 0, 'pos_4_10': 0, 'pos_11_20': 0, 'pos_21_plus': 0,
                    }
                date_map[date_str]['totalPages'] += 1

            # Sort by date and format for the chart
            result = []
            for date_str in sorted(date_map.keys()):
                d = date_map[date_str]
                # Format date as "Apr 10" style for X-axis labels
                try:
                    dt = datetime.strptime(date_str, '%Y-%m-%d')
                    label = dt.strftime('%b %-d')  # e.g. "Apr 10"
                except Exception:
                    label = date_str
                result.append({
                    'date': date_str,
                    'name': label,
                    'totalQueries': d['totalQueries'],
                    'totalPages': d['totalPages'],
                    '1-3': d['pos_1_3'],
                    '4-10': d['pos_4_10'],
                    '11-20': d['pos_11_20'],
                    '21+': d['pos_21_plus'],
                })

            _cache_set(cache_key, result, _TTL_ANALYTICS)
            return result

        except HttpError as e:
            logger.error(f"HTTP Error {e.resp.status} fetching daily_stats: {str(e)}")
            raise Exception(f"Failed to fetch daily stats: HTTP {e.resp.status}")
        except Exception as e:
            logger.error(f"Unexpected error fetching daily_stats: {str(e)}")
            raise Exception(f"Failed to fetch daily stats: {str(e)}")

    async def get_new_lost_rankings(
        self, property_url: str, days: int = 28,
        filters_json: str = None
    ) -> Dict:
        """
        Compare current vs previous period to find:
        - New queries/pages  (appear in current, absent in previous)
        - Lost queries/pages (appear in previous, absent in current)
        Cached 15 min.
        """
        cache_key = (self.user_email, 'new_lost_rankings', property_url, days, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Cache HIT: new_lost_rankings {property_url}")
            return cached

        try:
            from datetime import datetime, timedelta

            end_date   = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
            start_date = end_date - timedelta(days=days)
            prev_end   = start_date - timedelta(days=1)
            prev_start = prev_end - timedelta(days=days)

            def _fetch(dimension: str, start, end) -> Dict[str, Dict]:
                req_body = {
                    'startDate': start.strftime('%Y-%m-%d'),
                    'endDate':   end.strftime('%Y-%m-%d'),
                    'dimensions': [dimension],
                    'rowLimit':   25000,
                    'dataState':  'all',
                }
                self._apply_filter(req_body, filters_json)
                resp = self.service.searchanalytics().query(
                    siteUrl=property_url,
                    body=req_body
                ).execute()
                result = {}
                for row in resp.get('rows', []):
                    raw_key = row['keys'][0]
                    # Normalize to avoid false new/lost due to trailing slash differences
                    if dimension == 'page':
                        norm_key = raw_key.rstrip('/')
                    else:
                        norm_key = raw_key.strip().lower()
                    cur_clicks = row.get('clicks', 0)
                    # On normalization collision keep the entry with more clicks
                    existing = result.get(norm_key)
                    if existing and existing['clicks'] >= cur_clicks:
                        continue
                    result[norm_key] = {
                        'name':        raw_key,
                        'clicks':      cur_clicks,
                        'impressions': row.get('impressions', 0),
                        'position':    round(row.get('position', 0), 1),
                    }
                return result

            # Fetch current & previous periods for both dimensions
            cur_queries  = _fetch('query', start_date, end_date)
            prev_queries = _fetch('query', prev_start,  prev_end)
            cur_pages    = _fetch('page',  start_date, end_date)
            prev_pages   = _fetch('page',  prev_start,  prev_end)

            def _classify(current: Dict, previous: Dict):
                new_items  = []
                lost_items = []
                for norm_key, data in current.items():
                    if norm_key not in previous:
                        new_items.append(data)
                for norm_key, data in previous.items():
                    if norm_key not in current:
                        lost_items.append(data)
                new_items.sort(key=lambda x: x['clicks'], reverse=True)
                lost_items.sort(key=lambda x: x['clicks'], reverse=True)
                return new_items, lost_items

            new_queries,  lost_queries  = _classify(cur_queries, prev_queries)
            new_pages,    lost_pages    = _classify(cur_pages,   prev_pages)

            result = {
                'new_queries':  new_queries,
                'lost_queries': lost_queries,
                'new_pages':    new_pages,
                'lost_pages':   lost_pages,
                'period': {
                    'current_start': start_date.strftime('%Y-%m-%d'),
                    'current_end':   end_date.strftime('%Y-%m-%d'),
                    'prev_start':    prev_start.strftime('%Y-%m-%d'),
                    'prev_end':      prev_end.strftime('%Y-%m-%d'),
                },
                'counts': {
                    'new_queries':  len(new_queries),
                    'lost_queries': len(lost_queries),
                    'new_pages':    len(new_pages),
                    'lost_pages':   len(lost_pages),
                }
            }

            _cache_set(cache_key, result, _TTL_ANALYTICS)
            return result

        except HttpError as e:
            logger.error(f"HTTP Error {e.resp.status} fetching new_lost_rankings: {str(e)}")
            raise Exception(f"Failed to fetch new/lost rankings: HTTP {e.resp.status}")
        except Exception as e:
            logger.error(f"Unexpected error fetching new_lost_rankings: {str(e)}")
            raise Exception(f"Failed to fetch new/lost rankings: {str(e)}")

    # ─────────────────────────────────────────────────────────────────────
    #  GSC Wizard-style insight tools (all computed from existing GSC data)
    # ─────────────────────────────────────────────────────────────────────

    @staticmethod
    def _expected_ctr(position: float) -> float:
        """Typical organic click-through rate for a given average position (0–1).
        Industry-standard benchmark curve; used to spot under-performing CTR."""
        p = round(position)
        table = {
            1: 0.281, 2: 0.158, 3: 0.110, 4: 0.080, 5: 0.061,
            6: 0.047, 7: 0.038, 8: 0.031, 9: 0.027, 10: 0.024,
        }
        if p <= 0:
            return 0.281
        if p in table:
            return table[p]
        if p <= 20:
            return 0.015
        return 0.005

    async def _fetch_query_page_rows(self, property_url: str, days: int, filters_json: str = None) -> List[Dict]:
        """Fetch raw query×page rows (clicks/impressions/ctr/position) for the period."""
        from datetime import datetime, timedelta
        end_date = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
        start_date = end_date - timedelta(days=days)
        req = {
            'startDate': start_date.strftime('%Y-%m-%d'),
            'endDate': end_date.strftime('%Y-%m-%d'),
            'dimensions': ['query', 'page'],
            'rowLimit': 25000,
            'dataState': 'all',
        }
        self._apply_filter(req, filters_json)
        resp = self.service.searchanalytics().query(siteUrl=property_url, body=req).execute()
        rows = []
        for row in resp.get('rows', []):
            rows.append({
                'query': row['keys'][0],
                'page': row['keys'][1],
                'clicks': row.get('clicks', 0),
                'impressions': row.get('impressions', 0),
                'ctr': row.get('ctr', 0),
                'position': row.get('position', 0),
            })
        return rows

    async def get_striking_distance(self, property_url: str, days: int = 28,
                                    min_pos: float = 4, max_pos: float = 20,
                                    filters_json: str = None) -> List[Dict]:
        """Keywords ranking just off page 1 (positions 4–20) — the quickest wins.
        Returns each with its page, metrics, and estimated extra clicks if pushed to top 3."""
        cache_key = (self.user_email, 'striking', property_url, days, min_pos, max_pos, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        try:
            rows = await self._fetch_query_page_rows(property_url, days, filters_json)
            results = []
            for r in rows:
                pos = r['position']
                if min_pos <= pos <= max_pos and r['impressions'] > 0:
                    target_ctr = self._expected_ctr(3)
                    potential = max(0, round(r['impressions'] * target_ctr) - r['clicks'])
                    results.append({
                        'query': r['query'],
                        'page': r['page'].rstrip('/'),
                        'position': round(pos, 1),
                        'clicks': r['clicks'],
                        'impressions': r['impressions'],
                        'ctr': round(r['ctr'] * 100, 2),
                        'potential_clicks': potential,
                    })
            results.sort(key=lambda x: x['impressions'], reverse=True)
            _cache_set(cache_key, results, _TTL_ANALYTICS)
            return results
        except Exception as e:
            logger.error(f"Error fetching striking distance: {str(e)}")
            raise Exception(f"Failed to fetch striking distance: {str(e)}")

    async def get_ctr_opportunities(self, property_url: str, days: int = 28,
                                    min_impressions: int = 50, filters_json: str = None) -> List[Dict]:
        """Queries whose CTR is well below the benchmark for their position —
        usually a weak title tag / meta description. Ranked by missed clicks."""
        cache_key = (self.user_email, 'ctr_opps', property_url, days, min_impressions, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        try:
            queries = await self.get_top_queries(property_url, days, filters_json)
            results = []
            for q in queries:
                if q['impressions'] < min_impressions:
                    continue
                expected = self._expected_ctr(q['position']) * 100  # as %
                actual = q['ctr']  # already %
                if expected > 0 and actual < expected * 0.7:  # 30%+ below benchmark
                    gap = expected - actual
                    missed = round(q['impressions'] * (gap / 100))
                    results.append({
                        'query': q['query'],
                        'position': q['position'],
                        'impressions': q['impressions'],
                        'clicks': q['clicks'],
                        'actual_ctr': round(actual, 2),
                        'expected_ctr': round(expected, 2),
                        'ctr_gap': round(gap, 2),
                        'missed_clicks': missed,
                    })
            results.sort(key=lambda x: x['missed_clicks'], reverse=True)
            _cache_set(cache_key, results, _TTL_ANALYTICS)
            return results
        except Exception as e:
            logger.error(f"Error fetching CTR opportunities: {str(e)}")
            raise Exception(f"Failed to fetch CTR opportunities: {str(e)}")

    async def get_ctr_analysis(self, property_url: str, days: int = 28,
                               filters_json: str = None) -> Dict:
        """Full CTR analysis: the site's real CTR at each position 1–20 (for the
        benchmark chart) plus every query with its CTR vs the position benchmark."""
        cache_key = (self.user_email, 'ctr_analysis', property_url, days, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        try:
            queries = await self.get_top_queries(property_url, days, filters_json)

            # Per-position aggregation → the site's own CTR curve (impression-weighted)
            pos_agg = {p: {'clicks': 0, 'impr': 0} for p in range(1, 21)}
            out_queries = []
            for q in queries:
                p = round(q['position'])
                if 1 <= p <= 20:
                    pos_agg[p]['clicks'] += q['clicks']
                    pos_agg[p]['impr'] += q['impressions']
                expected = round(self._expected_ctr(q['position']) * 100, 2)
                out_queries.append({
                    'query': q['query'],
                    'position': q['position'],
                    'ctr': q['ctr'],
                    'expected_ctr': expected,
                    'vs_expected': round(q['ctr'] - expected, 2),  # +ve = beating benchmark
                    'clicks': q['clicks'],
                    'impressions': q['impressions'],
                })

            curve = []
            for p in range(1, 21):
                a = pos_agg[p]
                ctr = round(a['clicks'] / a['impr'] * 100, 2) if a['impr'] > 0 else None
                curve.append({'position': p, 'ctr': ctr, 'impressions': a['impr']})

            out_queries.sort(key=lambda x: x['impressions'], reverse=True)
            result = {'curve': curve, 'queries': out_queries, 'total': len(out_queries)}
            _cache_set(cache_key, result, _TTL_ANALYTICS)
            return result
        except Exception as e:
            logger.error(f"Error fetching CTR analysis: {str(e)}")
            raise Exception(f"Failed to fetch CTR analysis: {str(e)}")

    async def get_content_decay(self, property_url: str, days: int = 28,
                                filters_json: str = None) -> List[Dict]:
        """Pages losing clicks vs the previous equal-length period — early decay signal.
        Returns declining pages sorted by clicks lost."""
        cache_key = (self.user_email, 'decay', property_url, days, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        try:
            from datetime import datetime, timedelta
            end_date = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
            start_date = end_date - timedelta(days=days)
            prev_end = start_date - timedelta(days=1)
            prev_start = prev_end - timedelta(days=days)

            def _fetch(start, end):
                req = {
                    'startDate': start.strftime('%Y-%m-%d'),
                    'endDate': end.strftime('%Y-%m-%d'),
                    'dimensions': ['page'], 'rowLimit': 25000, 'dataState': 'all',
                }
                self._apply_filter(req, filters_json)
                resp = self.service.searchanalytics().query(siteUrl=property_url, body=req).execute()
                out = {}
                for row in resp.get('rows', []):
                    key = row['keys'][0].rstrip('/')
                    out[key] = {
                        'clicks': row.get('clicks', 0),
                        'impressions': row.get('impressions', 0),
                        'position': round(row.get('position', 0), 1),
                    }
                return out

            current = _fetch(start_date, end_date)
            previous = _fetch(prev_start, prev_end)
            results = []
            for page, cur in current.items():
                prev = previous.get(page)
                if not prev or prev['clicks'] == 0:
                    continue
                clicks_delta = cur['clicks'] - prev['clicks']
                if clicks_delta < 0:  # losing clicks
                    pct = round((clicks_delta / prev['clicks']) * 100, 1)
                    results.append({
                        'page': page,
                        'clicks': cur['clicks'],
                        'prev_clicks': prev['clicks'],
                        'clicks_lost': abs(clicks_delta),
                        'clicks_change_pct': pct,
                        'position': cur['position'],
                        'prev_position': prev['position'],
                        'position_change': round(cur['position'] - prev['position'], 1),  # +ve = worse
                        'impressions': cur['impressions'],
                    })
            results.sort(key=lambda x: x['clicks_lost'], reverse=True)
            _cache_set(cache_key, results, _TTL_ANALYTICS)
            return results
        except Exception as e:
            logger.error(f"Error fetching content decay: {str(e)}")
            raise Exception(f"Failed to fetch content decay: {str(e)}")

    async def get_cannibalization(self, property_url: str, days: int = 28,
                                  min_impressions: int = 10, filters_json: str = None) -> List[Dict]:
        """Queries where 2+ of your pages compete in search, splitting clicks.
        Returns each such query with its competing pages."""
        cache_key = (self.user_email, 'cannibal', property_url, days, min_impressions, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        try:
            rows = await self._fetch_query_page_rows(property_url, days, filters_json)
            by_query: Dict[str, List[Dict]] = {}
            for r in rows:
                if r['impressions'] < min_impressions:
                    continue
                by_query.setdefault(r['query'], []).append({
                    'page': r['page'].rstrip('/'),
                    'clicks': r['clicks'],
                    'impressions': r['impressions'],
                    'position': round(r['position'], 1),
                    'ctr': round(r['ctr'] * 100, 2),
                })
            results = []
            for query, pages in by_query.items():
                if len(pages) < 2:
                    continue
                pages.sort(key=lambda x: x['impressions'], reverse=True)
                results.append({
                    'query': query,
                    'page_count': len(pages),
                    'total_clicks': sum(p['clicks'] for p in pages),
                    'total_impressions': sum(p['impressions'] for p in pages),
                    'pages': pages,
                })
            results.sort(key=lambda x: x['total_impressions'], reverse=True)
            _cache_set(cache_key, results, _TTL_ANALYTICS)
            return results
        except Exception as e:
            logger.error(f"Error fetching cannibalization: {str(e)}")
            raise Exception(f"Failed to fetch cannibalization: {str(e)}")

    async def get_topic_clusters(self, property_url: str, days: int = 28,
                                 filters_json: str = None) -> List[Dict]:
        """Group queries into topic clusters by their key term and aggregate metrics.
        Lightweight whitespace-token clustering (best for space-delimited languages)."""
        cache_key = (self.user_email, 'clusters', property_url, days, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        try:
            queries = await self.get_top_queries(property_url, days, filters_json)
            STOP = {'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'is',
                    'how', 'what', 'best', 'with', 'my', 'your', 'near', 'me', 'vs'}

            def _key_term(q: str) -> str:
                tokens = [t for t in q.lower().split() if t and t not in STOP]
                if not tokens:
                    return q.strip().lower() or '(other)'
                # Pick the longest token as the topic anchor
                return max(tokens, key=len)

            clusters: Dict[str, Dict] = {}
            for q in queries:
                key = _key_term(q['query'])
                c = clusters.setdefault(key, {
                    'topic': key, 'queries': [], 'clicks': 0, 'impressions': 0,
                    '_pos_weight': 0.0,
                })
                c['queries'].append({
                    'query': q['query'], 'clicks': q['clicks'],
                    'impressions': q['impressions'], 'position': q['position'],
                })
                c['clicks'] += q['clicks']
                c['impressions'] += q['impressions']
                c['_pos_weight'] += q['position'] * max(q['impressions'], 1)

            results = []
            for c in clusters.values():
                if len(c['queries']) < 2:  # only show real clusters
                    continue
                total_imp = max(c['impressions'], 1)
                c['queries'].sort(key=lambda x: x['clicks'], reverse=True)
                results.append({
                    'topic': c['topic'],
                    'query_count': len(c['queries']),
                    'clicks': c['clicks'],
                    'impressions': c['impressions'],
                    'avg_position': round(c['_pos_weight'] / total_imp, 1),
                    'queries': c['queries'][:50],
                })
            results.sort(key=lambda x: x['clicks'], reverse=True)
            _cache_set(cache_key, results, _TTL_ANALYTICS)
            return results
        except Exception as e:
            logger.error(f"Error fetching topic clusters: {str(e)}")
            raise Exception(f"Failed to fetch topic clusters: {str(e)}")

    async def get_query_insights(self, property_url: str, days: int = 28,
                                 history_months: int = 6, filters_json: str = None) -> Dict:
        """Per-query metrics with period-over-period deltas AND a monthly time-series.
        Powers user-defined Topic Cluster analysis (clusters matched client-side)."""
        cache_key = (self.user_email, 'query_insights', property_url, days, history_months, filters_json)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        try:
            from datetime import datetime, timedelta
            from collections import defaultdict

            end_date = datetime.now().date() - timedelta(days=GSC_DATA_LAG_DAYS)
            start_date = end_date - timedelta(days=days)
            prev_end = start_date - timedelta(days=1)
            prev_start = prev_end - timedelta(days=days)

            def _fetch_query(start, end):
                req = {
                    'startDate': start.strftime('%Y-%m-%d'),
                    'endDate': end.strftime('%Y-%m-%d'),
                    'dimensions': ['query'], 'rowLimit': 25000, 'dataState': 'all',
                }
                self._apply_filter(req, filters_json)
                resp = self.service.searchanalytics().query(siteUrl=property_url, body=req).execute()
                out = {}
                for row in resp.get('rows', []):
                    out[row['keys'][0]] = {
                        'clicks': row.get('clicks', 0),
                        'impressions': row.get('impressions', 0),
                        'ctr': round(row.get('ctr', 0) * 100, 2),
                        'position': round(row.get('position', 0), 1),
                    }
                return out

            current = _fetch_query(start_date, end_date)
            previous = _fetch_query(prev_start, prev_end)

            # ── Monthly series (date × query) over the history window ──
            first_of_month = end_date.replace(day=1)
            hist_start = first_of_month
            for _ in range(max(history_months - 1, 0)):
                hist_start = (hist_start - timedelta(days=1)).replace(day=1)

            mreq = {
                'startDate': hist_start.strftime('%Y-%m-%d'),
                'endDate': end_date.strftime('%Y-%m-%d'),
                'dimensions': ['date', 'query'], 'rowLimit': 25000, 'dataState': 'all',
            }
            self._apply_filter(mreq, filters_json)
            mresp = self.service.searchanalytics().query(siteUrl=property_url, body=mreq).execute()

            monthly = defaultdict(lambda: defaultdict(lambda: {'clicks': 0, 'impressions': 0, 'pw': 0.0}))
            months_set = set()
            for row in mresp.get('rows', []):
                date_str, q = row['keys'][0], row['keys'][1]
                ym = date_str[:7]
                months_set.add(ym)
                cell = monthly[q][ym]
                imp = row.get('impressions', 0)
                cell['clicks'] += row.get('clicks', 0)
                cell['impressions'] += imp
                cell['pw'] += row.get('position', 0) * max(imp, 1)

            months = sorted(months_set)

            queries_out = []
            for q, c in current.items():
                p = previous.get(q, {})
                m = monthly.get(q, {})
                monthly_list = []
                for ym in months:
                    cell = m.get(ym)
                    pos = round(cell['pw'] / cell['impressions'], 1) if (cell and cell['impressions']) else None
                    monthly_list.append({
                        'month': ym,
                        'clicks': cell['clicks'] if cell else 0,
                        'impressions': cell['impressions'] if cell else 0,
                        'position': pos,
                    })
                queries_out.append({
                    'query': q,
                    'clicks': c['clicks'], 'impressions': c['impressions'],
                    'ctr': c['ctr'], 'position': c['position'],
                    'prev_clicks': p.get('clicks', 0), 'prev_impressions': p.get('impressions', 0),
                    'prev_position': p.get('position', 0),
                    'monthly': monthly_list,
                })

            result = {'queries': queries_out, 'months': months}
            _cache_set(cache_key, result, _TTL_ANALYTICS)
            return result
        except Exception as e:
            logger.error(f"Error fetching query insights: {str(e)}")
            raise Exception(f"Failed to fetch query insights: {str(e)}")


async def get_user_properties(stored_token: str, is_refresh_token: bool = False, user_email: str = 'default') -> List[Dict[str, str]]:
    """
    Helper: get user's Search Console properties from stored credentials.
    
    Args:
        stored_token: Token string from the database.
        is_refresh_token: True if the token is a refresh token.
        user_email: Email of the user to isolate the cache.
    """
    service = GSCService.from_stored_token(stored_token, is_refresh_token=is_refresh_token, user_email=user_email)
    return await service.get_properties()
