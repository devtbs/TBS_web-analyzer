"""Google Analytics (GA4) routes.

GA4 reuses the SAME stored Google refresh token as GSC — the OAuth consent now
also requests the analytics.readonly scope, so one sign-in covers both. Users who
connected before this change must reconnect once to grant Analytics access.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from models.schemas import UserInfo
from auth.auth import get_current_user
from database import get_db
from api.routers._shared import get_account_id, _ga4_service_for

router = APIRouter()


def _get_token(db, email, account_id):
    """Resolve token for primary or secondary Google account."""
    from utils.user_manager import get_user_gsc_token, get_google_account_token
    if account_id is not None:
        token = get_google_account_token(db, email, account_id)
        if not token:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="Connected Google account not found.")
        return token, True
    return get_user_gsc_token(db, email)


@router.get("/auth/ga4/properties")
async def get_ga4_properties(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id)
):
    """List the GA4 properties accessible by the user."""
    from services.analytics_service import get_user_ga4_properties

    google_token, is_refresh = _get_token(db, current_user.email, account_id)
    if not google_token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Google account not connected. Please connect your Google account first."
        )
    try:
        properties = await get_user_ga4_properties(google_token, is_refresh_token=is_refresh, user_email=current_user.email)
        return {"properties": properties}
    except Exception as e:
        error_msg = str(e)
        if "SERVICE_DISABLED" in error_msg or "has not been used in project" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="The Google Analytics Admin & Data APIs are not enabled in this project's Google Cloud console. Enable them, wait a few minutes, then retry."
            )
        if "403" in error_msg or "sufficient permission" in error_msg or "insufficient" in error_msg.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No Analytics access. Reconnect your Google account to grant Analytics permission."
            )
        if "invalid_scope" in error_msg or "invalid_grant" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your Google connection predates Analytics access. Reconnect your Google account to grant Analytics permission."
            )
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch GA4 properties: {error_msg}")


@router.get("/auth/ga4/match")
async def match_ga4_property(
    domain: str,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id)
):
    """Resolve which GA4 property matches a given site domain (from the sidebar picker)."""
    from services.analytics_service import AnalyticsService

    google_token, is_refresh = _get_token(db, current_user.email, account_id)
    if not google_token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Google account not connected. Please connect your Google account first."
        )
    try:
        service = AnalyticsService.from_stored_token(google_token, is_refresh_token=is_refresh, user_email=current_user.email)
        prop = await service.find_property_for_domain(domain)
        return {"property": prop}
    except Exception as e:
        error_msg = str(e)
        if "SERVICE_DISABLED" in error_msg or "has not been used in project" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="The Google Analytics Admin & Data APIs are not enabled in this project's Google Cloud console. Enable them, wait a few minutes, then retry."
            )
        if "403" in error_msg or "permission" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No Analytics access.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to match GA4 property: {error_msg}")


@router.get("/auth/ga4/overview/{property_id}")
async def get_ga4_overview(
    property_id: str,
    days: int = 28,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id)
):
    """Get headline GA4 metrics, daily time-series, deltas and traffic-by-channel."""
    from services.analytics_service import AnalyticsService

    google_token, is_refresh = _get_token(db, current_user.email, account_id)
    if not google_token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Google account not connected. Please connect your Google account first."
        )
    try:
        service = AnalyticsService.from_stored_token(google_token, is_refresh_token=is_refresh, user_email=current_user.email)
        overview = await service.get_overview(property_id, days)
        return overview
    except Exception as e:
        error_msg = str(e)
        if "403" in error_msg or "sufficient permission" in error_msg or "insufficient" in error_msg.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No Analytics access for this property. Reconnect Google or check property permissions."
            )
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch GA4 overview: {error_msg}")


@router.get("/auth/ga4/geo/{property_id}")
async def get_ga4_geo(
    property_id: str,
    days: int = 28,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id)
):
    """Sessions by country with period-over-period deltas for the world map."""
    from services.analytics_service import AnalyticsService

    google_token, is_refresh = _get_token(db, current_user.email, account_id)
    if not google_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Google account not connected.")
    try:
        service = AnalyticsService.from_stored_token(google_token, is_refresh_token=is_refresh, user_email=current_user.email)
        rows = await service.get_geo_with_deltas(property_id, days)
        return {"rows": rows}
    except Exception as e:
        error_msg = str(e)
        if "403" in error_msg or "permission" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No Analytics access for this property.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch geo data: {error_msg}")


@router.get("/auth/ga4/devices/{property_id}")
async def get_ga4_devices(
    property_id: str,
    days: int = 28,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id)
):
    """Sessions by device category (desktop / mobile / tablet) with % share and delta."""
    from services.analytics_service import AnalyticsService

    google_token, is_refresh = _get_token(db, current_user.email, account_id)
    if not google_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Google account not connected.")
    try:
        service = AnalyticsService.from_stored_token(google_token, is_refresh_token=is_refresh, user_email=current_user.email)
        rows = await service.get_devices(property_id, days)
        return {"rows": rows}
    except Exception as e:
        error_msg = str(e)
        if "403" in error_msg or "permission" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No Analytics access for this property.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch device data: {error_msg}")


@router.get("/auth/ga4/pages/{property_id}")
async def get_ga4_pages(
    property_id: str,
    days: int = 28,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id)
):
    """Top pages by views with users, avg engagement time and bounce rate."""
    from services.analytics_service import AnalyticsService

    google_token, is_refresh = _get_token(db, current_user.email, account_id)
    if not google_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Google account not connected.")
    try:
        service = AnalyticsService.from_stored_token(google_token, is_refresh_token=is_refresh, user_email=current_user.email)
        rows = await service.get_top_pages(property_id, days)
        return {"rows": rows}
    except Exception as e:
        error_msg = str(e)
        if "403" in error_msg or "permission" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No Analytics access for this property.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch pages data: {error_msg}")


@router.post("/auth/ga4/cache/invalidate")
async def invalidate_ga4_cache(current_user: UserInfo = Depends(get_current_user)):
    """Force a fresh fetch of GA4 data for the current user."""
    from services.analytics_service import invalidate_cache
    invalidate_cache(user_email=current_user.email)
    return {"message": "GA4 cache cleared. Next request will fetch fresh data."}
