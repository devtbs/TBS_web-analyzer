"""Google Analytics (GA4) routes.

GA4 reuses the SAME stored Google refresh token as GSC — the OAuth consent now
also requests the analytics.readonly scope, so one sign-in covers both. Users who
connected before this change must reconnect once to grant Analytics access.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from models.schemas import UserInfo
from auth.auth import get_current_user
from database import get_db

router = APIRouter()


@router.get("/auth/ga4/properties")
async def get_ga4_properties(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List the GA4 properties accessible by the user."""
    from services.analytics_service import get_user_ga4_properties
    from utils.user_manager import get_user_gsc_token

    google_token, is_refresh = get_user_gsc_token(db, current_user.email)
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
        if "403" in error_msg or "sufficient permission" in error_msg or "insufficient" in error_msg.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No Analytics access. Reconnect your Google account to grant Analytics permission."
            )
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch GA4 properties: {error_msg}")


@router.get("/auth/ga4/overview/{property_id}")
async def get_ga4_overview(
    property_id: str,
    days: int = 28,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get headline GA4 metrics, daily time-series, deltas and traffic-by-channel."""
    from services.analytics_service import AnalyticsService
    from utils.user_manager import get_user_gsc_token

    google_token, is_refresh = get_user_gsc_token(db, current_user.email)
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


@router.post("/auth/ga4/cache/invalidate")
async def invalidate_ga4_cache(current_user: UserInfo = Depends(get_current_user)):
    """Force a fresh fetch of GA4 data for the current user."""
    from services.analytics_service import invalidate_cache
    invalidate_cache(user_email=current_user.email)
    return {"message": "GA4 cache cleared. Next request will fetch fresh data."}
