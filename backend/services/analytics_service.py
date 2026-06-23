"""Google Analytics (GA4) service for fetching properties and on-site behaviour data.

Mirrors the structure of gsc_service.GSCService so the frontend can consume the two
the same way. Uses the google-api-python-client discovery build (same dependency the
GSC service already uses) — no extra packages required.

GA4 answers "what people do ON the site" (sessions, users, engagement, conversions,
traffic sources), complementing GSC which only covers Google Search discovery.
"""
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from typing import List, Dict, Optional
import asyncio
import logging
import time

logger = logging.getLogger(__name__)

# ── Module-level in-memory TTL cache ──────────────────────────────────────
_CACHE: Dict[tuple, tuple] = {}

_TTL_PROPERTIES = 5 * 60    #  5 min – property list rarely changes
_TTL_REPORT     = 15 * 60   # 15 min – metrics / chart data

# GA4 finalizes "today" as data trickles in; end ranges on the last COMPLETE day
# so client-facing totals are not dragged down by a partial current day.
GA4_DATA_LAG_DAYS = 1

# Core metrics every GA4 property supports. `conversions` is added on top but some
# properties without configured key events can reject it — we fall back gracefully.
_CORE_METRICS = [
    'sessions', 'totalUsers', 'newUsers', 'screenPageViews',
    'averageSessionDuration', 'engagementRate', 'bounceRate',
]


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
    keys = [k for k in _CACHE if user_email is None or k[0] == user_email]
    for k in keys:
        del _CACHE[k]
    logger.info(f"GA4 cache invalidated: {len(keys)} entries removed")


class AnalyticsService:
    """Service for interacting with the Google Analytics (GA4) APIs."""

    SCOPES = ['https://www.googleapis.com/auth/analytics.readonly']

    def __init__(self, access_token: str = None, refresh_token: str = None, user_email: str = 'default'):
        from config import settings
        self.user_email = user_email

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

        # GA4 has two APIs: Admin (list properties) and Data (run reports).
        self.admin = build('analyticsadmin', 'v1beta', credentials=self.credentials)
        self.data = build('analyticsdata', 'v1beta', credentials=self.credentials)

    async def _aexecute(self, request):
        """Run a built googleapiclient request off the event loop (blocking .execute()).

        Gated by the shared process-wide semaphore so concurrent Google calls across GSC
        and GA4 stay bounded (the HTTP/SSL transport crashes under heavy concurrency).
        """
        from services.gsc_service import GOOGLE_CALL_GATE
        async with GOOGLE_CALL_GATE:
            return await asyncio.to_thread(request.execute)

    @classmethod
    def from_stored_token(cls, stored_token: str, is_refresh_token: bool = False, user_email: str = 'default'):
        if is_refresh_token:
            return cls(refresh_token=stored_token, user_email=user_email)
        return cls(access_token=stored_token, user_email=user_email)

    @staticmethod
    def _norm_domain(v: str) -> str:
        from urllib.parse import urlparse
        s = (v or '').strip().lower()
        s = s.replace('sc-domain:', '')
        if '://' not in s:
            s = 'http://' + s
        host = urlparse(s).hostname or ''
        return host.replace('www.', '')

    async def _property_hosts(self, property_id: str) -> List[str]:
        """Return the website hostnames on a property's web data streams (cached per id).

        Used to match a GA4 property to a Search Console site (a domain). The defaultUri
        on a web stream looks like "https://www.example.com". Cached individually so the
        on-demand domain resolver stays cheap on repeat calls.
        """
        cache_key = (self.user_email, 'ga4_hosts', property_id)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        from urllib.parse import urlparse
        try:
            resp = await self._aexecute(
                self.admin.properties().dataStreams().list(parent=f"properties/{property_id}")
            )
        except Exception:
            return []
        hosts = []
        for stream in resp.get('dataStreams', []):
            uri = (stream.get('webStreamData') or {}).get('defaultUri')
            if not uri:
                continue
            try:
                host = (urlparse(uri).hostname or '').lower().replace('www.', '')
                if host:
                    hosts.append(host)
            except Exception:
                pass
        _cache_set(cache_key, hosts, _TTL_PROPERTIES)
        return hosts

    async def find_property_for_domain(self, domain: str) -> Optional[Dict]:
        """Find the GA4 property whose data-stream host matches a site domain.

        Kept cheap: lists properties (1 call), then resolves stream hosts lazily,
        short-circuiting on the first match. Falls back to a display-name match.
        """
        target = self._norm_domain(domain)
        if not target:
            return None
        properties = await self.get_properties()

        # Cheap name-first ordering: check properties whose name mentions the domain first.
        ordered = sorted(
            properties,
            key=lambda p: target not in (p.get('display', '') or '').lower()
        )
        for p in ordered:
            hosts = await self._property_hosts(p['property_id'])
            if any(self._norm_domain(h) == target for h in hosts):
                return p
        # Fallback: name contains the domain (less reliable, but better than nothing).
        for p in properties:
            if target in (p.get('display', '') or '').lower():
                return p
        return None

    async def get_properties(self) -> List[Dict]:
        """List all GA4 properties the user can access, grouped under their account.

        Cheap: a single accountSummaries call. Domain→property matching is handled
        separately by find_property_for_domain so this stays fast under load.
        """
        cache_key = (self.user_email, 'ga4_properties')
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info("GA4 cache HIT: properties")
            return cached

        try:
            properties = []
            summaries = await self._aexecute(self.admin.accountSummaries().list(pageSize=200))
            for account in summaries.get('accountSummaries', []):
                account_name = account.get('displayName', '')
                for prop in account.get('propertySummaries', []):
                    # prop['property'] looks like "properties/123456789"
                    resource = prop.get('property', '')
                    property_id = resource.split('/')[-1] if resource else ''
                    properties.append({
                        'property_id': property_id,
                        'display': prop.get('displayName', resource),
                        'account': account_name,
                    })

            logger.info(f"Found {len(properties)} GA4 properties")
            _cache_set(cache_key, properties, _TTL_PROPERTIES)
            return properties

        except HttpError as e:
            logger.error(f"HTTP Error {e.resp.status} fetching GA4 properties: {str(e)}")
            raise Exception(f"Failed to fetch Analytics properties: HTTP {e.resp.status}")
        except Exception as e:
            logger.error(f"Unexpected error fetching GA4 properties: {str(e)}")
            raise Exception(f"Failed to fetch Analytics properties: {str(e)}")

    async def _run_report(self, property_id: str, body: dict) -> dict:
        """Run a GA4 report, retrying without `conversions` if the metric is rejected."""
        try:
            return await self._aexecute(self.data.properties().runReport(
                property=f"properties/{property_id}", body=body
            ))
        except HttpError as e:
            # Some properties have no key events configured → `conversions` is invalid.
            metrics = body.get('metrics', [])
            if any(m.get('name') == 'conversions' for m in metrics):
                body = {**body, 'metrics': [m for m in metrics if m.get('name') != 'conversions']}
                return await self._aexecute(self.data.properties().runReport(
                    property=f"properties/{property_id}", body=body
                ))
            raise

    async def get_overview(self, property_id: str, days: int = 28) -> Dict:
        """
        Fetch headline GA4 metrics + a daily time series + period-over-period deltas,
        plus a traffic-by-channel breakdown. Shape intentionally echoes GSCService
        (totals / previous_totals / deltas / chart_data) for a consistent frontend.
        """
        cache_key = (self.user_email, 'ga4_overview', property_id, days)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"GA4 cache HIT: overview {property_id}")
            return cached

        try:
            from datetime import datetime, timedelta

            end_date = datetime.now().date() - timedelta(days=GA4_DATA_LAG_DAYS)
            start_date = end_date - timedelta(days=days)
            prev_end = start_date - timedelta(days=1)
            prev_start = prev_end - timedelta(days=days)

            metrics = [{'name': m} for m in _CORE_METRICS] + [{'name': 'conversions'}]

            async def _totals(start, end) -> Dict[str, float]:
                body = {
                    'dateRanges': [{'startDate': start.strftime('%Y-%m-%d'),
                                    'endDate': end.strftime('%Y-%m-%d')}],
                    'metrics': metrics,
                }
                resp = await self._run_report(property_id, body)
                headers = [h['name'] for h in resp.get('metricHeaders', [])]
                row = resp.get('rows', [{}])
                values = row[0].get('metricValues', []) if row else []
                out = {}
                for name, val in zip(headers, values):
                    try:
                        out[name] = float(val.get('value', 0))
                    except (TypeError, ValueError):
                        out[name] = 0.0
                return out

            current = await _totals(start_date, end_date)
            previous = await _totals(prev_start, prev_end)

            # ── Daily time series for the chart ─────────────────────────
            series_body = {
                'dateRanges': [{'startDate': start_date.strftime('%Y-%m-%d'),
                                'endDate': end_date.strftime('%Y-%m-%d')}],
                'dimensions': [{'name': 'date'}],
                'metrics': [{'name': 'sessions'}, {'name': 'totalUsers'}, {'name': 'conversions'}],
                'orderBys': [{'dimension': {'dimensionName': 'date'}}],
            }
            series_resp = await self._run_report(property_id, series_body)
            chart_data = []
            for row in series_resp.get('rows', []):
                raw = row['keys'][0] if 'keys' in row else row['dimensionValues'][0]['value']
                vals = [v.get('value', 0) for v in row.get('metricValues', [])]
                try:
                    label = datetime.strptime(raw, '%Y%m%d').strftime('%b %d')
                except Exception:
                    label = raw
                chart_data.append({
                    'date': raw,
                    'name': label,
                    'sessions': int(float(vals[0])) if len(vals) > 0 else 0,
                    'users': int(float(vals[1])) if len(vals) > 1 else 0,
                    'conversions': int(float(vals[2])) if len(vals) > 2 else 0,
                })

            # ── Traffic by channel ──────────────────────────────────────
            channel_body = {
                'dateRanges': [{'startDate': start_date.strftime('%Y-%m-%d'),
                                'endDate': end_date.strftime('%Y-%m-%d')}],
                'dimensions': [{'name': 'sessionDefaultChannelGroup'}],
                'metrics': [{'name': 'sessions'}, {'name': 'totalUsers'}, {'name': 'conversions'}],
                'orderBys': [{'metric': {'metricName': 'sessions'}, 'desc': True}],
                'limit': 25,
            }
            channel_resp = await self._run_report(property_id, channel_body)
            channels = []
            for row in channel_resp.get('rows', []):
                name = (row['dimensionValues'][0]['value']
                        if 'dimensionValues' in row else row['keys'][0])
                vals = [v.get('value', 0) for v in row.get('metricValues', [])]
                channels.append({
                    'channel': name,
                    'sessions': int(float(vals[0])) if len(vals) > 0 else 0,
                    'users': int(float(vals[1])) if len(vals) > 1 else 0,
                    'conversions': int(float(vals[2])) if len(vals) > 2 else 0,
                })

            def pct_change(curr, prev):
                if not prev:
                    return None
                return round(((curr - prev) / abs(prev)) * 100, 1)

            def fmt(d: Dict[str, float]) -> Dict:
                return {
                    'sessions': int(d.get('sessions', 0)),
                    'users': int(d.get('totalUsers', 0)),
                    'new_users': int(d.get('newUsers', 0)),
                    'pageviews': int(d.get('screenPageViews', 0)),
                    'avg_session_duration': round(d.get('averageSessionDuration', 0), 1),
                    'engagement_rate': round(d.get('engagementRate', 0) * 100, 1),
                    'bounce_rate': round(d.get('bounceRate', 0) * 100, 1),
                    'conversions': int(d.get('conversions', 0)),
                }

            cur_t = fmt(current)
            prv_t = fmt(previous)
            deltas = {k: pct_change(cur_t[k], prv_t[k]) for k in cur_t}

            result = {
                'property_id': property_id,
                'totals': cur_t,
                'previous_totals': prv_t,
                'deltas': deltas,
                'chart_data': chart_data,
                'channels': channels,
                'period': {
                    'start': start_date.strftime('%Y-%m-%d'),
                    'end': end_date.strftime('%Y-%m-%d'),
                },
            }
            _cache_set(cache_key, result, _TTL_REPORT)
            return result

        except HttpError as e:
            logger.error(f"HTTP Error {e.resp.status} fetching GA4 overview: {str(e)}")
            raise Exception(f"Failed to fetch Analytics data: HTTP {e.resp.status}")
        except Exception as e:
            logger.error(f"Unexpected error fetching GA4 overview: {str(e)}")
            raise Exception(f"Failed to fetch Analytics data: {str(e)}")

    async def get_geo(self, property_id: str, days: int = 28, limit: int = 20) -> List[Dict]:
        """Sessions/users broken down by country for a choropleth map. Uses the `country`
        dimension (full English names, e.g. 'Thailand') so it maps via Plotly
        locationmode 'country names'. Cached 15 min."""
        cache_key = (self.user_email, 'ga4_geo', property_id, days, limit)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"GA4 cache HIT: geo {property_id}")
            return cached

        from datetime import datetime, timedelta
        end_date = datetime.now().date() - timedelta(days=GA4_DATA_LAG_DAYS)
        start_date = end_date - timedelta(days=days)
        body = {
            'dateRanges': [{'startDate': start_date.strftime('%Y-%m-%d'),
                            'endDate': end_date.strftime('%Y-%m-%d')}],
            'dimensions': [{'name': 'country'}],
            'metrics': [{'name': 'sessions'}, {'name': 'totalUsers'}],
            'orderBys': [{'metric': {'metricName': 'sessions'}, 'desc': True}],
            'limit': limit,
        }
        resp = await self._run_report(property_id, body)
        rows = []
        for row in resp.get('rows', []):
            name = (row['dimensionValues'][0]['value']
                    if 'dimensionValues' in row else row['keys'][0])
            vals = [v.get('value', 0) for v in row.get('metricValues', [])]
            rows.append({
                'country': name,
                'sessions': int(float(vals[0])) if len(vals) > 0 else 0,
                'users': int(float(vals[1])) if len(vals) > 1 else 0,
            })
        _cache_set(cache_key, rows, _TTL_REPORT)
        return rows


async def get_user_ga4_properties(stored_token: str, is_refresh_token: bool = False, user_email: str = 'default') -> List[Dict[str, str]]:
    """Helper: list a user's GA4 properties from stored Google credentials."""
    service = AnalyticsService.from_stored_token(stored_token, is_refresh_token=is_refresh_token, user_email=user_email)
    return await service.get_properties()
