"""Google Search Console routes: connect/disconnect, core analytics, and the
wizard-style insight tools (all computed from existing GSC data)."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from models.schemas import UserInfo
from auth.auth import get_current_user
from database import get_db
from config import settings
from api.routers._shared import _gsc_service_for, _ga4_service_for, get_account_id
from typing import Optional

router = APIRouter()


@router.post("/auth/gsc/connect")
async def connect_gsc(
    request: dict,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Connect Google Search Console using OAuth authorization code.
    Exchanges the code for access + refresh tokens and stores the refresh token.
    The refresh token allows permanent access without re-authentication.
    """
    from services.gsc_service import GSCService
    from utils.user_manager import update_gsc_token, get_or_create_user
    from api.routers._shared import exchange_google_code

    gsc_code = request.get('gsc_code')
    if not gsc_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GSC authorization code is required"
        )

    # Exchange the authorization code for access + refresh tokens
    try:
        token_data = exchange_google_code(gsc_code)

        refresh_token = token_data.get('refresh_token')
        access_token = token_data.get('access_token')

        if not refresh_token and not access_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No tokens received from Google. Ensure the app is configured for offline access."
            )

        # Prefer refresh token (permanent); fall back to access token (short-lived)
        token_to_store = refresh_token if refresh_token else access_token
        is_refresh = bool(refresh_token)

        # Verify the token works by trying to fetch properties
        service = GSCService(access_token=access_token, refresh_token=refresh_token)
        properties = await service.get_properties()

        # Ensure the user row exists before storing the token. The JWT can outlive a
        # user row (e.g. after a DB reset), so create it from the authenticated identity
        # rather than failing with "User not found".
        get_or_create_user(db, current_user.email, current_user.name, current_user.picture)

        # Store the token in database
        update_gsc_token(db, current_user.email, token_to_store, is_refresh_token=is_refresh)

        return {
            "message": "Successfully connected to Google Search Console",
            "properties_count": len(properties),
            "connected": True,
            "token_type": "refresh" if is_refresh else "access"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to connect to Google Search Console: {str(e)}"
        )


@router.get("/auth/gsc/properties")
async def get_gsc_properties(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get list of Search Console properties accessible by the user
    Uses the stored GSC token from database
    """
    from services.gsc_service import get_user_properties
    from utils.user_manager import get_user_gsc_token

    # Get token from database (returns tuple: token, is_refresh_token)
    gsc_token, is_refresh = get_user_gsc_token(db, current_user.email)

    if not gsc_token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="GSC not connected. Please connect your Google Search Console account first."
        )

    try:
        properties = await get_user_properties(gsc_token, is_refresh_token=is_refresh, user_email=current_user.email)
        return {"properties": properties}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch properties: {str(e)}"
        )


@router.get("/auth/gsc/properties/all")
async def get_gsc_properties_all(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Aggregate GSC properties across ALL connected Google accounts, grouped by
    account, so every client is visible in one list without switching."""
    import asyncio
    from services.gsc_service import get_user_properties
    from api.routers._shared import iter_google_accounts

    accounts = iter_google_accounts(db, current_user.email)
    if not accounts:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Google accounts connected. Please connect your Google account first.",
        )

    async def _one(acct):
        # Distinct cache identity per Google account so one account's property
        # list can't be served from another account's cached entry.
        props = await get_user_properties(
            acct["token"], is_refresh_token=acct["is_refresh"],
            user_email=f"{current_user.email}|{acct['google_email']}",
        )
        return props

    results = await asyncio.gather(*[_one(a) for a in accounts], return_exceptions=True)

    groups, errors = [], []
    for acct, res in zip(accounts, results):
        if isinstance(res, Exception):
            errors.append({"account_id": acct["account_id"], "google_email": acct["google_email"], "error": str(res)})
            continue
        groups.append({
            "account_id": acct["account_id"],
            "google_email": acct["google_email"],
            "properties": res or [],
        })
    return {"groups": groups, "errors": errors}


@router.post("/auth/gsc/disconnect")
async def disconnect_gsc(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Disconnect Google Search Console"""
    from utils.user_manager import clear_gsc_token
    from services.gsc_service import invalidate_cache

    try:
        clear_gsc_token(db, current_user.email)
        invalidate_cache(user_email=current_user.email)  # ← clear stale cached properties
        return {"message": "Successfully disconnected from Google Search Console"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to disconnect: {str(e)}"
        )


# ============= Analytics =============

@router.get("/auth/gsc/analytics/{property_url:path}")
async def get_gsc_analytics(
    property_url: str,
    days: int = 365,
    group_by: str = 'daily',
    filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get complete search analytics including time-series and page data"""
    from services.gsc_service import GSCService
    from utils.user_manager import get_user_gsc_token
    from urllib.parse import unquote

    property_url = unquote(property_url)

    # Get token from database (returns tuple: token, is_refresh_token)
    gsc_token, is_refresh = get_user_gsc_token(db, current_user.email)

    if not gsc_token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="GSC not connected. Please connect your Google Search Console account first."
        )

    try:
        service = GSCService.from_stored_token(gsc_token, is_refresh_token=is_refresh, user_email=current_user.email)
        # Fetch chart data and totals
        analytics_data = await service.get_search_analytics(
            property_url, days, group_by, filters_json
        )
        # Fetch pages using the same days window as analytics
        pages = await service.get_pages_with_queries(
            property_url, days, filters_json
        )

        return {
            "property_url": property_url,
            "analytics": analytics_data,
            "pages": pages
        }
    except Exception as e:
        error_msg = str(e)
        if "403" in error_msg or "sufficient permission" in error_msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"You do not have permission to access {property_url}.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch analytics: {error_msg}"
        )


# ============= Cache Management =============

@router.post("/auth/gsc/cache/invalidate")
async def invalidate_gsc_cache(
    current_user: UserInfo = Depends(get_current_user)
):
    """Invalidate the GSC data cache for the current user (forces a fresh fetch)."""
    from services.gsc_service import invalidate_cache
    invalidate_cache(user_email=current_user.email)
    return {"message": "Cache cleared. Next request will fetch fresh data."}


@router.get("/auth/gsc/countries/{property_url:path}")
async def get_gsc_countries(
    property_url: str,
    days: int = 28,
    filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get clicks/impressions/ctr/position breakdown by country for a GSC property."""
    from services.gsc_service import GSCService
    from utils.user_manager import get_user_gsc_token
    from urllib.parse import unquote

    property_url = unquote(property_url)
    gsc_token, is_refresh = get_user_gsc_token(db, current_user.email)
    if not gsc_token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="GSC not connected. Please connect your Google Search Console account first."
        )
    try:
        service = GSCService.from_stored_token(gsc_token, is_refresh_token=is_refresh, user_email=current_user.email)
        countries = await service.get_countries(
            property_url, days, filters_json
        )
        return {"countries": countries, "total": len(countries)}
    except Exception as e:
        error_msg = str(e)
        if "403" in error_msg or "sufficient permission" in error_msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"You do not have permission to access {property_url}.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch countries: {error_msg}"
        )


@router.get("/auth/gsc/pages/{property_url:path}")
async def get_gsc_pages(
    property_url: str,
    days: int = 28,
    filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return top pages with clicks/impressions/ctr/position for a GSC property."""
    from services.gsc_service import GSCService
    from utils.user_manager import get_user_gsc_token
    from urllib.parse import unquote
    property_url = unquote(property_url)
    gsc_token, is_refresh = get_user_gsc_token(db, current_user.email)
    if not gsc_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="GSC not connected.")
    try:
        service = GSCService.from_stored_token(gsc_token, is_refresh_token=is_refresh, user_email=current_user.email)
        pages = await service.get_top_pages(
            property_url, days, filters_json
        )
        return {"pages": pages, "total": len(pages)}
    except Exception as e:
        error_msg = str(e)
        if "403" in error_msg or "sufficient permission" in error_msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"You do not have permission to access {property_url}.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch pages: {error_msg}")


@router.get("/auth/gsc/pages-with-queries/{property_url:path}")
async def get_gsc_pages_with_queries(
    property_url: str,
    days: int = 28,
    filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return pages with their ranking queries for the PageSelector."""
    from services.gsc_service import GSCService
    from utils.user_manager import get_user_gsc_token
    from urllib.parse import unquote
    property_url = unquote(property_url)
    gsc_token, is_refresh = get_user_gsc_token(db, current_user.email)
    if not gsc_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="GSC not connected.")
    try:
        service = GSCService.from_stored_token(gsc_token, is_refresh_token=is_refresh, user_email=current_user.email)
        pages = await service.get_pages_with_queries(
            property_url, days, filters_json
        )
        return {"pages": pages, "total": len(pages)}
    except Exception as e:
        error_msg = str(e)
        if "403" in error_msg or "sufficient permission" in error_msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"You do not have permission to access {property_url}.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch pages with queries: {error_msg}")


@router.get("/auth/gsc/queries/{property_url:path}")
async def get_gsc_queries(
    property_url: str,
    days: int = 28,
    filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return top queries with clicks/impressions/ctr/position for a GSC property."""
    from services.gsc_service import GSCService
    from utils.user_manager import get_user_gsc_token
    from urllib.parse import unquote
    property_url = unquote(property_url)
    gsc_token, is_refresh = get_user_gsc_token(db, current_user.email)
    if not gsc_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="GSC not connected.")
    try:
        service = GSCService.from_stored_token(gsc_token, is_refresh_token=is_refresh, user_email=current_user.email)
        queries = await service.get_top_queries(
            property_url, days, filters_json
        )
        return {"queries": queries, "total": len(queries)}
    except Exception as e:
        error_msg = str(e)
        if "403" in error_msg or "sufficient permission" in error_msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"You do not have permission to access {property_url}.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch queries: {error_msg}")


@router.get("/auth/gsc/devices/{property_url:path}")
async def get_gsc_devices(
    property_url: str,
    days: int = 28,
    filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get clicks/impressions/ctr/position breakdown by device for a GSC property."""
    from services.gsc_service import GSCService
    from utils.user_manager import get_user_gsc_token
    from urllib.parse import unquote

    property_url = unquote(property_url)
    gsc_token, is_refresh = get_user_gsc_token(db, current_user.email)
    if not gsc_token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="GSC not connected. Please connect your Google Search Console account first."
        )
    try:
        service = GSCService.from_stored_token(gsc_token, is_refresh_token=is_refresh, user_email=current_user.email)
        devices = await service.get_devices(
            property_url, days, filters_json
        )
        return {"devices": devices}
    except Exception as e:
        error_msg = str(e)
        if "403" in error_msg or "sufficient permission" in error_msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"You do not have permission to access {property_url}.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch devices: {error_msg}"
        )


@router.get("/auth/gsc/daily-stats/{property_url:path}")
async def get_gsc_daily_stats(
    property_url: str,
    days: int = 28,
    filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get per-day unique query/page counts and position-bucket impressions for charts."""
    from services.gsc_service import GSCService
    from utils.user_manager import get_user_gsc_token
    from urllib.parse import unquote

    property_url = unquote(property_url)
    gsc_token, is_refresh = get_user_gsc_token(db, current_user.email)
    if not gsc_token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="GSC not connected. Please connect your Google Search Console account first."
        )
    try:
        service = GSCService.from_stored_token(gsc_token, is_refresh_token=is_refresh, user_email=current_user.email)
        daily_stats = await service.get_daily_stats(
            property_url, days, filters_json
        )
        return {"daily_stats": daily_stats}
    except Exception as e:
        error_msg = str(e)
        if "403" in error_msg or "sufficient permission" in error_msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"You do not have permission to access {property_url}.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch daily stats: {error_msg}"
        )


@router.get("/auth/gsc/new-lost-rankings/{property_url:path}")
async def get_gsc_new_lost_rankings(
    property_url: str,
    days: int = 28,
    filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Compare current vs previous period to return new and lost queries/pages."""
    from services.gsc_service import GSCService
    from utils.user_manager import get_user_gsc_token
    from urllib.parse import unquote

    property_url = unquote(property_url)
    gsc_token, is_refresh = get_user_gsc_token(db, current_user.email)
    if not gsc_token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="GSC not connected."
        )
    try:
        service = GSCService.from_stored_token(gsc_token, is_refresh_token=is_refresh, user_email=current_user.email)
        data = await service.get_new_lost_rankings(
            property_url, days, filters_json
        )
        return data
    except Exception as e:
        error_msg = str(e)
        if "403" in error_msg or "sufficient permission" in error_msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"You do not have permission to access {property_url}.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch new/lost rankings: {error_msg}"
        )


# ============= GSC Insight Tools (Wizard-style) =============
# All computed from existing Search Console data — no new data source needed.

@router.get("/auth/gsc/striking-distance/{property_url:path}")
async def gsc_striking_distance(
    property_url: str, days: int = 28, filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user), db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id)
):
    """Keywords at positions 4–20 — the quickest page-1 wins."""
    from urllib.parse import unquote
    property_url = unquote(property_url)
    try:
        service = _gsc_service_for(db, current_user.email, account_id)
        data = await service.get_striking_distance(property_url, days, filters_json=filters_json)
        return {"keywords": data, "total": len(data)}
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        if "403" in msg or "sufficient permission" in msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"No permission for {property_url}.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed: {msg}")


@router.get("/auth/gsc/ctr-opportunities/{property_url:path}")
async def gsc_ctr_opportunities(
    property_url: str, days: int = 28, filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user), db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id)
):
    """Full CTR analysis: site CTR curve (1–20) + every query vs benchmark."""
    from urllib.parse import unquote
    property_url = unquote(property_url)
    try:
        service = _gsc_service_for(db, current_user.email, account_id)
        data = await service.get_ctr_analysis(property_url, days, filters_json=filters_json)
        return data
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        if "403" in msg or "sufficient permission" in msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"No permission for {property_url}.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed: {msg}")


@router.get("/auth/gsc/query-decay/{property_url:path}")
async def gsc_query_decay(
    property_url: str, periods: int = 16, granularity: str = "month", filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user), db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id)
):
    """Per-query performance over time (month/week buckets) for the decay heatmap."""
    from urllib.parse import unquote
    property_url = unquote(property_url)
    try:
        service = _gsc_service_for(db, current_user.email, account_id)
        data = await service.get_query_decay(property_url, periods, granularity, filters_json=filters_json)
        return data
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        if "403" in msg or "sufficient permission" in msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"No permission for {property_url}.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed: {msg}")


@router.get("/auth/gsc/cannibalization/{property_url:path}")
async def gsc_cannibalization(
    property_url: str, days: int = 28, min_impressions_pct: float = 20.0,
    brand: str = None, topic: str = None, filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user), db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id)
):
    """URLs competing against each other for the same keywords in search.

    - ``min_impressions_pct``: a page counts as competing only if its impressions
      are at least this percent of the top page's for the query.
    - ``brand``: comma-separated brand terms; queries containing any are excluded.
    - ``topic``: restrict to queries anchored on this topic cluster term.
    """
    from urllib.parse import unquote
    property_url = unquote(property_url)
    brand_keywords = [b for b in (brand or '').split(',') if b.strip()]
    try:
        service = _gsc_service_for(db, current_user.email, account_id)
        data = await service.get_cannibalization(
            property_url, days, min_impressions_pct=min_impressions_pct,
            brand_keywords=brand_keywords, topic=topic, filters_json=filters_json)
        return {"urls": data, "total": len(data)}
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        if "403" in msg or "sufficient permission" in msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"No permission for {property_url}.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed: {msg}")


@router.get("/auth/gsc/query-insights/{property_url:path}")
async def gsc_query_insights(
    property_url: str, days: int = 28, history_months: int = 6, filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user), db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id)
):
    """Per-query deltas + monthly time-series (powers user-defined Topic Clusters)."""
    from urllib.parse import unquote
    property_url = unquote(property_url)
    try:
        service = _gsc_service_for(db, current_user.email, account_id)
        data = await service.get_query_insights(property_url, days, history_months, filters_json=filters_json)
        return data
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        if "403" in msg or "sufficient permission" in msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"No permission for {property_url}.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed: {msg}")


@router.get("/auth/gsc/topic-clusters/{property_url:path}")
async def gsc_topic_clusters(
    property_url: str, days: int = 28, filters_json: str = None,
    current_user: UserInfo = Depends(get_current_user), db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id)
):
    """Group queries into topic clusters with aggregate metrics."""
    from urllib.parse import unquote
    property_url = unquote(property_url)
    try:
        service = _gsc_service_for(db, current_user.email, account_id)
        data = await service.get_topic_clusters(property_url, days, filters_json=filters_json)
        return {"clusters": data, "total": len(data)}
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        if "403" in msg or "sufficient permission" in msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"No permission for {property_url}.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed: {msg}")


# ============= Looker Studio export =============

@router.get("/auth/gsc/looker-export/{property_url:path}")
async def gsc_looker_export(
    property_url: str,
    days: int = 30,
    brand_regex: str = None,
    cluster_rules_json: str = None,
    filters_json: str = None,
    ga4_property_id: str = None,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id),
):
    """Flat, Looker-Studio-ready export for one property.

    Returns every table (GSC: queries, pages, movers, striking_distance, ctr_gaps,
    position_buckets, gsc_monthly, gsc_kpis, gsc_timeseries, gsc_brand_generic,
    gsc_position_buckets_summary, gsc_keyword_bubble, + technical-health stubs; and — when
    `ga4_property_id` is supplied — GA4: ga4_kpis, ga4_sessions_timeseries, ga4_channels,
    ga4_countries, ga4_devices) as flat list[dict] alongside a column→type schema and an
    LLM-readable summary. This single JSON feeds a Looker Community Connector, a Sheets
    import, or a BigQuery load with no schema mapping.

    Query params:
      • brand_regex        — e.g. "brandname|brand name" to tag Branded vs Generic.
      • cluster_rules_json — JSON list [{"label","pattern"}, ...] for topic clustering.
      • ga4_property_id    — GA4 property id (e.g. "123456789") to include the GA4 section.
    """
    import json
    from urllib.parse import unquote
    from services.looker_export_service import build_export

    property_url = unquote(property_url)
    cluster_rules = None
    if cluster_rules_json:
        try:
            cluster_rules = json.loads(cluster_rules_json)
        except json.JSONDecodeError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="cluster_rules_json must be valid JSON.")
    try:
        service = _gsc_service_for(db, current_user.email, account_id)
        ga4_service = _ga4_service_for(db, current_user.email, account_id) if ga4_property_id else None
        return await build_export(
            service, property_url, days=days, brand_regex=brand_regex,
            cluster_rules=cluster_rules, filters_json=filters_json,
            ga4_service=ga4_service, ga4_property_id=ga4_property_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        if "403" in msg or "sufficient permission" in msg:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"No permission for {property_url}.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed: {msg}")
