"""Google Ads service for fetching ad accounts and campaign performance.

Mirrors the structure of analytics_service.AnalyticsService / gsc_service.GSCService so
the frontend can consume all three the same way (totals / previous_totals / deltas /
chart_data). Google Ads answers "what the paid campaigns delivered" (impressions,
clicks, cost, conversions), complementing GSC (organic search) and GA4 (on-site behaviour).

Unlike GSC/GA4 — which use the discovery-built google-api-python-client — Google Ads uses
its own gRPC client (`google-ads`) with the GAQL query language, AND requires a
Google-approved developer token. When that token is not configured the integration
reports "not configured" rather than crashing, so the rest of the app is unaffected.
"""
from typing import List, Dict, Optional
import asyncio
import logging
import time

logger = logging.getLogger(__name__)

# Google Ads API version (matches google-ads==31.x default). Older versions get
# sunset server-side and return 501 "GRPC target method can't be resolved".
ADS_API_VERSION = "v24"

# ── Module-level in-memory TTL cache (same pattern as analytics_service) ──
_CACHE: Dict[tuple, tuple] = {}

_TTL_CUSTOMERS = 5 * 60    #  5 min – account list rarely changes
_TTL_REPORT    = 15 * 60   # 15 min – metrics / chart data

# Google Ads finalizes recent days as data settles. End ranges on the last
# complete day so client-facing totals are not dragged down by a partial day.
ADS_DATA_LAG_DAYS = 1

SCOPES = ['https://www.googleapis.com/auth/adwords']


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
    logger.info(f"Ads cache invalidated: {len(keys)} entries removed")


def ads_is_configured() -> bool:
    """True only when a Google Ads developer token is present in config."""
    from config import settings
    return bool((settings.GOOGLE_ADS_DEVELOPER_TOKEN or '').strip())


class AdsService:
    """Service for interacting with the Google Ads API."""

    def __init__(self, access_token: str = None, refresh_token: str = None, user_email: str = 'default'):
        from config import settings
        from google.ads.googleads.client import GoogleAdsClient

        self.user_email = user_email

        if not ads_is_configured():
            raise RuntimeError("Google Ads developer token is not configured.")
        if not refresh_token:
            # The Ads API only accepts a refresh token (offline access), not a bare
            # access token, so a long-lived stored credential is required.
            raise ValueError("Google Ads requires a stored refresh token.")

        config = {
            "developer_token": settings.GOOGLE_ADS_DEVELOPER_TOKEN.strip(),
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "use_proto_plus": True,
        }
        login_cid = (settings.GOOGLE_ADS_LOGIN_CUSTOMER_ID or '').replace('-', '').strip()
        if login_cid:
            config["login_customer_id"] = login_cid

        self.client = GoogleAdsClient.load_from_dict(config, version=ADS_API_VERSION)

    @classmethod
    def from_stored_token(cls, stored_token: str, is_refresh_token: bool = False, user_email: str = 'default'):
        """Factory matching the GSC/GA4 signature. Ads needs a refresh token."""
        if not is_refresh_token:
            raise ValueError("Google Ads requires a refresh token (offline access).")
        return cls(refresh_token=stored_token, user_email=user_email)

    async def _asearch(self, customer_id: str, query: str):
        """Run a blocking GAQL search off the event loop, gated by the shared semaphore.

        Reuses GOOGLE_CALL_GATE so the total in-flight Google call count stays bounded
        across GSC, GA4 and Ads (the underlying transports crash under heavy concurrency).
        Returns a list of result rows.
        """
        from services.gsc_service import GOOGLE_CALL_GATE

        def _run():
            ga_service = self.client.get_service("GoogleAdsService")
            return list(ga_service.search(customer_id=customer_id, query=query))

        async with GOOGLE_CALL_GATE:
            return await asyncio.to_thread(_run)

    async def get_customers(self) -> List[Dict]:
        """List the Google Ads accounts the authenticated user can access."""
        cache_key = (self.user_email, 'ads_customers')
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info("Ads cache HIT: customers")
            return cached

        def _list_resource_names():
            customer_service = self.client.get_service("CustomerService")
            return list(customer_service.list_accessible_customers().resource_names)

        from services.gsc_service import GOOGLE_CALL_GATE
        async with GOOGLE_CALL_GATE:
            resource_names = await asyncio.to_thread(_list_resource_names)

        customers: List[Dict] = []
        for resource_name in resource_names:
            # resource_name looks like "customers/1234567890"
            cid = resource_name.split('/')[-1]
            try:
                rows = await self._asearch(cid, (
                    "SELECT customer.id, customer.descriptive_name, "
                    "customer.currency_code, customer.manager "
                    "FROM customer LIMIT 1"
                ))
                if rows:
                    c = rows[0].customer
                    # Skip manager (MCC) accounts — they hold no campaign data themselves.
                    if getattr(c, 'manager', False):
                        continue
                    customers.append({
                        'customer_id': str(c.id),
                        'display': c.descriptive_name or f"Account {c.id}",
                        'currency': c.currency_code or '',
                    })
            except Exception as e:
                # An individual account may be inaccessible (e.g. cancelled); skip it.
                logger.warning(f"Ads: could not read customer {cid}: {e}")
                continue

        customers.sort(key=lambda x: x['display'].lower())
        _cache_set(cache_key, customers, _TTL_CUSTOMERS)
        logger.info(f"Found {len(customers)} Google Ads accounts")
        return customers

    async def get_overview(self, customer_id: str, days: int = 28) -> Dict:
        """Headline Ads metrics + daily time-series + period deltas + top campaigns.

        Shape echoes GA4's get_overview for a consistent frontend.
        """
        customer_id = customer_id.replace('-', '').strip()
        cache_key = (self.user_email, 'ads_overview', customer_id, days)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Ads cache HIT: overview {customer_id}")
            return cached

        from datetime import datetime, timedelta

        end_date = datetime.now().date() - timedelta(days=ADS_DATA_LAG_DAYS)
        start_date = end_date - timedelta(days=days)
        prev_end = start_date - timedelta(days=1)
        prev_start = prev_end - timedelta(days=days)

        def _d(d):
            return d.strftime('%Y-%m-%d')

        async def _totals(start, end) -> Dict[str, float]:
            rows = await self._asearch(customer_id, (
                "SELECT metrics.impressions, metrics.clicks, metrics.ctr, "
                "metrics.average_cpc, metrics.cost_micros, metrics.conversions, "
                "metrics.conversions_value, metrics.cost_per_conversion "
                "FROM customer "
                f"WHERE segments.date BETWEEN '{_d(start)}' AND '{_d(end)}'"
            ))
            agg = {
                'impressions': 0, 'clicks': 0, 'cost': 0.0,
                'conversions': 0.0, 'conversions_value': 0.0,
            }
            for r in rows:
                m = r.metrics
                agg['impressions'] += int(m.impressions)
                agg['clicks'] += int(m.clicks)
                agg['cost'] += m.cost_micros / 1e6
                agg['conversions'] += float(m.conversions)
                agg['conversions_value'] += float(m.conversions_value)
            return agg

        current = await _totals(start_date, end_date)
        previous = await _totals(prev_start, prev_end)

        # ── Daily time series for the chart ─────────────────────────
        series_rows = await self._asearch(customer_id, (
            "SELECT segments.date, metrics.clicks, metrics.cost_micros, "
            "metrics.conversions FROM customer "
            f"WHERE segments.date BETWEEN '{_d(start_date)}' AND '{_d(end_date)}' "
            "ORDER BY segments.date"
        ))
        chart_data = []
        for r in series_rows:
            raw = r.segments.date  # 'YYYY-MM-DD'
            try:
                label = datetime.strptime(raw, '%Y-%m-%d').strftime('%b %d')
            except Exception:
                label = raw
            chart_data.append({
                'date': raw,
                'name': label,
                'clicks': int(r.metrics.clicks),
                'cost': round(r.metrics.cost_micros / 1e6, 2),
                'conversions': round(float(r.metrics.conversions), 1),
            })

        # ── Top campaigns by cost ───────────────────────────────────
        campaign_rows = await self._asearch(customer_id, (
            "SELECT campaign.name, campaign.status, metrics.impressions, "
            "metrics.clicks, metrics.cost_micros, metrics.conversions "
            "FROM campaign "
            f"WHERE segments.date BETWEEN '{_d(start_date)}' AND '{_d(end_date)}' "
            "ORDER BY metrics.cost_micros DESC LIMIT 25"
        ))
        campaigns = []
        for r in campaign_rows:
            campaigns.append({
                'name': r.campaign.name,
                'status': r.campaign.status.name if hasattr(r.campaign.status, 'name') else str(r.campaign.status),
                'impressions': int(r.metrics.impressions),
                'clicks': int(r.metrics.clicks),
                'cost': round(r.metrics.cost_micros / 1e6, 2),
                'conversions': round(float(r.metrics.conversions), 1),
            })

        def derive(d: Dict[str, float]) -> Dict:
            imp = d['impressions']
            clicks = d['clicks']
            cost = d['cost']
            conv = d['conversions']
            return {
                'impressions': int(imp),
                'clicks': int(clicks),
                'ctr': round((clicks / imp * 100) if imp else 0, 2),
                'avg_cpc': round((cost / clicks) if clicks else 0, 2),
                'cost': round(cost, 2),
                'conversions': round(conv, 1),
                'conversion_rate': round((conv / clicks * 100) if clicks else 0, 2),
                'cost_per_conversion': round((cost / conv) if conv else 0, 2),
            }

        cur_t = derive(current)
        prv_t = derive(previous)

        def pct_change(curr, prev):
            if not prev:
                return None
            return round(((curr - prev) / abs(prev)) * 100, 1)

        deltas = {k: pct_change(cur_t[k], prv_t[k]) for k in cur_t}

        result = {
            'customer_id': customer_id,
            'currency': await self._currency(customer_id),
            'totals': cur_t,
            'previous_totals': prv_t,
            'deltas': deltas,
            'chart_data': chart_data,
            'campaigns': campaigns,
            'period': {'start': _d(start_date), 'end': _d(end_date)},
        }
        _cache_set(cache_key, result, _TTL_REPORT)
        return result

    async def _currency(self, customer_id: str) -> str:
        """Cheap cached lookup of an account's currency code (for cost formatting)."""
        cache_key = (self.user_email, 'ads_currency', customer_id)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        try:
            rows = await self._asearch(customer_id, "SELECT customer.currency_code FROM customer LIMIT 1")
            code = rows[0].customer.currency_code if rows else ''
        except Exception:
            code = ''
        _cache_set(cache_key, code, _TTL_CUSTOMERS)
        return code


async def get_user_ads_customers(stored_token: str, is_refresh_token: bool = False, user_email: str = 'default') -> List[Dict]:
    """Helper: list a user's Google Ads accounts from stored Google credentials."""
    service = AdsService.from_stored_token(stored_token, is_refresh_token=is_refresh_token, user_email=user_email)
    return await service.get_customers()
