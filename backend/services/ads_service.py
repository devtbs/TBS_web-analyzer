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
    # Aggregate ("/all") list endpoints cache each account under a composite identity
    # f"{user_email}|{google_email}", so match both the plain email and that prefix —
    # otherwise per-account list entries survive invalidation and stay stale until TTL.
    def _matches(k0):
        return user_email is None or k0 == user_email or str(k0).startswith(user_email + "|")
    keys = [k for k in _CACHE if _matches(k[0])]
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
        """List Google Ads accounts under the configured MCC, or all accessible accounts
        if no MCC login_customer_id is set."""
        cache_key = (self.user_email, 'ads_customers')
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info("Ads cache HIT: customers")
            return cached

        from services.gsc_service import GOOGLE_CALL_GATE
        from config import settings

        login_cid = (settings.GOOGLE_ADS_LOGIN_CUSTOMER_ID or '').replace('-', '').strip()

        customers: List[Dict] = []

        if login_cid:
            # Query child accounts directly from the MCC — avoids list_accessible_customers()
            # which returns every account the Google identity can reach (ignores login_customer_id).
            # No `level = 1` filter: customer_client returns the MCC's full descendant tree,
            # so dropping it also surfaces client accounts nested under a sub-manager
            # (level 2+). manager = FALSE still excludes the sub-managers themselves.
            rows = await self._asearch(login_cid, (
                "SELECT customer_client.id, customer_client.descriptive_name, "
                "customer_client.currency_code, customer_client.manager, "
                "customer_client.level "
                "FROM customer_client "
                "WHERE customer_client.manager = FALSE"
            ))
            for row in rows:
                c = row.customer_client
                customers.append({
                    'customer_id': str(c.id),
                    'display': c.descriptive_name or f"Account {c.id}",
                    'currency': c.currency_code or '',
                })
        else:
            # Fallback: no MCC configured — list everything the token can reach.
            def _list_resource_names():
                customer_service = self.client.get_service("CustomerService")
                return list(customer_service.list_accessible_customers().resource_names)

            async with GOOGLE_CALL_GATE:
                resource_names = await asyncio.to_thread(_list_resource_names)

            for resource_name in resource_names:
                cid = resource_name.split('/')[-1]
                try:
                    rows = await self._asearch(cid, (
                        "SELECT customer.id, customer.descriptive_name, "
                        "customer.currency_code, customer.manager "
                        "FROM customer LIMIT 1"
                    ))
                    if rows:
                        c = rows[0].customer
                        if getattr(c, 'manager', False):
                            continue
                        customers.append({
                            'customer_id': str(c.id),
                            'display': c.descriptive_name or f"Account {c.id}",
                            'currency': c.currency_code or '',
                        })
                except Exception as e:
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
            "SELECT segments.date, metrics.impressions, metrics.clicks, "
            "metrics.cost_micros, metrics.conversions FROM customer "
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
                'impressions': int(r.metrics.impressions),
                'clicks': int(r.metrics.clicks),
                'cost': round(r.metrics.cost_micros / 1e6, 2),
                'conversions': round(float(r.metrics.conversions), 1),
            })

        # ── Top campaigns by cost ───────────────────────────────────
        campaign_rows = await self._asearch(customer_id, (
            "SELECT campaign.name, campaign.status, metrics.impressions, "
            "metrics.clicks, metrics.ctr, metrics.cost_micros, metrics.conversions, "
            "metrics.conversions_value "
            "FROM campaign "
            f"WHERE segments.date BETWEEN '{_d(start_date)}' AND '{_d(end_date)}' "
            "ORDER BY metrics.cost_micros DESC LIMIT 25"
        ))
        campaigns = []
        for r in campaign_rows:
            c_cost = round(r.metrics.cost_micros / 1e6, 2)
            c_conv_val = round(float(r.metrics.conversions_value), 2)
            campaigns.append({
                'name': r.campaign.name,
                'status': r.campaign.status.name if hasattr(r.campaign.status, 'name') else str(r.campaign.status),
                'impressions': int(r.metrics.impressions),
                'clicks': int(r.metrics.clicks),
                'ctr': round(float(r.metrics.ctr) * 100, 2),
                'cost': c_cost,
                'conversions': round(float(r.metrics.conversions), 1),
                'conversions_value': c_conv_val,
                'roas': round(c_conv_val / c_cost, 2) if c_cost else 0,
            })

        def derive(d: Dict[str, float]) -> Dict:
            imp = d['impressions']
            clicks = d['clicks']
            cost = d['cost']
            conv = d['conversions']
            conv_val = d['conversions_value']
            return {
                'impressions': int(imp),
                'clicks': int(clicks),
                'ctr': round((clicks / imp * 100) if imp else 0, 2),
                'avg_cpc': round((cost / clicks) if clicks else 0, 2),
                'cost': round(cost, 2),
                'conversions': round(conv, 1),
                'conversion_rate': round((conv / clicks * 100) if clicks else 0, 2),
                'cost_per_conversion': round((cost / conv) if conv else 0, 2),
                'conversions_value': round(conv_val, 2),
                'roas': round(conv_val / cost, 2) if cost else 0,
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

    async def get_deep_dive(self, customer_id: str, days: int = 28) -> Dict:
        """Granular performance breakdowns for the Fold-2 deep-dive section."""
        customer_id = customer_id.replace('-', '').strip()
        cache_key = (self.user_email, 'ads_deepdive', customer_id, days)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(f"Ads cache HIT: deep_dive {customer_id}")
            return cached

        from datetime import datetime, timedelta

        end_date = datetime.now().date() - timedelta(days=ADS_DATA_LAG_DAYS)
        start_date = end_date - timedelta(days=days)

        def _d(d):
            return d.strftime('%Y-%m-%d')

        date_clause = f"segments.date BETWEEN '{_d(start_date)}' AND '{_d(end_date)}'"

        def _m(r):
            cost = round(r.metrics.cost_micros / 1e6, 2)
            conv_val = round(float(r.metrics.conversions_value), 2)
            return {
                'impressions': int(r.metrics.impressions),
                'clicks': int(r.metrics.clicks),
                'ctr': round(float(r.metrics.ctr) * 100, 2),
                'cost': cost,
                'conversions': round(float(r.metrics.conversions), 1),
                'conversions_value': conv_val,
                'roas': round(conv_val / cost, 2) if cost else 0,
            }

        # Keywords
        kw_rows = await self._asearch(customer_id, (
            "SELECT ad_group_criterion.keyword.text, "
            "ad_group_criterion.keyword.match_type, "
            "metrics.impressions, metrics.clicks, metrics.ctr, "
            "metrics.cost_micros, metrics.conversions, metrics.conversions_value "
            "FROM keyword_view "
            f"WHERE {date_clause} "
            "ORDER BY metrics.conversions DESC LIMIT 20"
        ))
        keywords = []
        for r in kw_rows:
            kw = r.ad_group_criterion.keyword
            entry = _m(r)
            entry['keyword'] = kw.text
            match_type = kw.match_type
            entry['match_type'] = match_type.name if hasattr(match_type, 'name') else str(match_type)
            keywords.append(entry)

        # Search terms
        st_rows = await self._asearch(customer_id, (
            "SELECT search_term_view.search_term, "
            "metrics.impressions, metrics.clicks, metrics.ctr, "
            "metrics.cost_micros, metrics.conversions, metrics.conversions_value "
            "FROM search_term_view "
            f"WHERE {date_clause} "
            "ORDER BY metrics.clicks DESC LIMIT 20"
        ))
        search_terms = [dict({'term': r.search_term_view.search_term}, **_m(r)) for r in st_rows]

        # Network split
        net_rows = await self._asearch(customer_id, (
            "SELECT segments.ad_network_type, "
            "metrics.impressions, metrics.clicks, metrics.ctr, "
            "metrics.cost_micros, metrics.conversions, metrics.conversions_value "
            "FROM campaign "
            f"WHERE {date_clause}"
        ))
        net_agg: Dict[str, Dict] = {}
        for r in net_rows:
            net = r.segments.ad_network_type
            key = net.name if hasattr(net, 'name') else str(net)
            m = r.metrics
            if key not in net_agg:
                net_agg[key] = {'network': key, 'impressions': 0, 'clicks': 0, 'cost': 0.0, 'conversions': 0.0, 'conversions_value': 0.0}
            net_agg[key]['impressions'] += int(m.impressions)
            net_agg[key]['clicks'] += int(m.clicks)
            net_agg[key]['cost'] += m.cost_micros / 1e6
            net_agg[key]['conversions'] += float(m.conversions)
            net_agg[key]['conversions_value'] += float(m.conversions_value)
        networks = list(net_agg.values())

        # Device split
        dev_rows = await self._asearch(customer_id, (
            "SELECT segments.device, "
            "metrics.impressions, metrics.clicks, metrics.ctr, "
            "metrics.cost_micros, metrics.conversions, metrics.conversions_value "
            "FROM campaign "
            f"WHERE {date_clause}"
        ))
        dev_agg: Dict[str, Dict] = {}
        for r in dev_rows:
            dev = r.segments.device
            key = dev.name if hasattr(dev, 'name') else str(dev)
            m = r.metrics
            if key not in dev_agg:
                dev_agg[key] = {'device': key, 'impressions': 0, 'clicks': 0, 'cost': 0.0, 'conversions': 0.0, 'conversions_value': 0.0}
            dev_agg[key]['impressions'] += int(m.impressions)
            dev_agg[key]['clicks'] += int(m.clicks)
            dev_agg[key]['cost'] += m.cost_micros / 1e6
            dev_agg[key]['conversions'] += float(m.conversions)
            dev_agg[key]['conversions_value'] += float(m.conversions_value)
        devices = list(dev_agg.values())

        # Age ranges
        age_rows = await self._asearch(customer_id, (
            "SELECT ad_group_criterion.age_range.type, "
            "metrics.impressions, metrics.clicks, metrics.ctr, "
            "metrics.cost_micros, metrics.conversions, metrics.conversions_value "
            "FROM age_range_view "
            f"WHERE {date_clause}"
        ))
        age_agg: Dict[str, Dict] = {}
        for r in age_rows:
            at = r.ad_group_criterion.age_range.type_
            key = at.name if hasattr(at, 'name') else str(at)
            m = r.metrics
            if key not in age_agg:
                age_agg[key] = {'age_range': key, 'impressions': 0, 'clicks': 0, 'cost': 0.0, 'conversions': 0.0, 'conversions_value': 0.0}
            age_agg[key]['impressions'] += int(m.impressions)
            age_agg[key]['clicks'] += int(m.clicks)
            age_agg[key]['cost'] += m.cost_micros / 1e6
            age_agg[key]['conversions'] += float(m.conversions)
            age_agg[key]['conversions_value'] += float(m.conversions_value)
        age_ranges = list(age_agg.values())

        # Gender
        gen_rows = await self._asearch(customer_id, (
            "SELECT ad_group_criterion.gender.type, "
            "metrics.impressions, metrics.clicks, metrics.ctr, "
            "metrics.cost_micros, metrics.conversions, metrics.conversions_value "
            "FROM gender_view "
            f"WHERE {date_clause}"
        ))
        gen_agg: Dict[str, Dict] = {}
        for r in gen_rows:
            gt = r.ad_group_criterion.gender.type_
            key = gt.name if hasattr(gt, 'name') else str(gt)
            m = r.metrics
            if key not in gen_agg:
                gen_agg[key] = {'gender': key, 'impressions': 0, 'clicks': 0, 'cost': 0.0, 'conversions': 0.0, 'conversions_value': 0.0}
            gen_agg[key]['impressions'] += int(m.impressions)
            gen_agg[key]['clicks'] += int(m.clicks)
            gen_agg[key]['cost'] += m.cost_micros / 1e6
            gen_agg[key]['conversions'] += float(m.conversions)
            gen_agg[key]['conversions_value'] += float(m.conversions_value)
        genders = list(gen_agg.values())

        # Geographic (country/region level)
        geo_rows = await self._asearch(customer_id, (
            "SELECT geographic_view.country_criterion_id, geographic_view.location_type, "
            "campaign.name, "
            "metrics.impressions, metrics.clicks, metrics.ctr, "
            "metrics.cost_micros, metrics.conversions, metrics.conversions_value "
            "FROM geographic_view "
            f"WHERE {date_clause} "
            "ORDER BY metrics.cost_micros DESC LIMIT 20"
        ))
        geo = []
        for r in geo_rows:
            entry = _m(r)
            entry['country_criterion_id'] = r.geographic_view.country_criterion_id
            loc_type = r.geographic_view.location_type
            entry['location_type'] = loc_type.name if hasattr(loc_type, 'name') else str(loc_type)
            geo.append(entry)

        # Day of week
        dow_rows = await self._asearch(customer_id, (
            "SELECT segments.day_of_week, "
            "metrics.impressions, metrics.clicks, metrics.ctr, "
            "metrics.cost_micros, metrics.conversions, metrics.conversions_value "
            "FROM campaign "
            f"WHERE {date_clause}"
        ))
        dow_agg: Dict[str, Dict] = {}
        for r in dow_rows:
            dow = r.segments.day_of_week
            key = dow.name if hasattr(dow, 'name') else str(dow)
            m = r.metrics
            if key not in dow_agg:
                dow_agg[key] = {'day': key, 'impressions': 0, 'clicks': 0, 'cost': 0.0, 'conversions': 0.0}
            dow_agg[key]['impressions'] += int(m.impressions)
            dow_agg[key]['clicks'] += int(m.clicks)
            dow_agg[key]['cost'] += round(m.cost_micros / 1e6, 2)
            dow_agg[key]['conversions'] += float(m.conversions)
        DOW_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
        by_day_of_week = sorted(dow_agg.values(), key=lambda x: DOW_ORDER.index(x['day']) if x['day'] in DOW_ORDER else 99)

        # Hour of day
        hour_rows = await self._asearch(customer_id, (
            "SELECT segments.hour, "
            "metrics.impressions, metrics.clicks, metrics.ctr, "
            "metrics.cost_micros, metrics.conversions, metrics.conversions_value "
            "FROM campaign "
            f"WHERE {date_clause}"
        ))
        hour_agg: Dict[int, Dict] = {}
        for r in hour_rows:
            h = int(r.segments.hour)
            m = r.metrics
            if h not in hour_agg:
                hour_agg[h] = {'hour': h, 'impressions': 0, 'clicks': 0, 'cost': 0.0, 'conversions': 0.0}
            hour_agg[h]['impressions'] += int(m.impressions)
            hour_agg[h]['clicks'] += int(m.clicks)
            hour_agg[h]['cost'] += round(m.cost_micros / 1e6, 2)
            hour_agg[h]['conversions'] += float(m.conversions)
        by_hour = [hour_agg.get(h, {'hour': h, 'impressions': 0, 'clicks': 0, 'cost': 0.0, 'conversions': 0.0}) for h in range(24)]

        result = {
            'keywords': keywords,
            'search_terms': search_terms,
            'networks': networks,
            'devices': devices,
            'age_ranges': age_ranges,
            'genders': genders,
            'geo': geo,
            'by_day_of_week': by_day_of_week,
            'by_hour': by_hour,
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
