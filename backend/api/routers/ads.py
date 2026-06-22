"""Google Ads routes.

Google Ads reuses the SAME stored Google refresh token as GSC/GA4 — the OAuth consent
also requests the adwords scope, so one sign-in covers all three. Users who connected
before this change must reconnect once to grant Ads access.

Unlike GSC/GA4, Google Ads also needs a Google-approved developer token. When that token
is not configured every endpoint reports {configured: false} (HTTP 200) instead of
erroring, so the frontend can render a clear "not configured yet" state.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from models.schemas import UserInfo
from auth.auth import get_current_user
from database import get_db

router = APIRouter()


def _classify_ads_error(msg: str) -> Optional[str]:
    """Map a raw Ads API error to a clear, actionable user message.

    Returns the message for a 403, or None if it's not a recognised
    permission/config error (caller should then raise a generic 500).
    """
    m = msg.lower()
    if 'service_disabled' in m or 'has not been used' in m or 'is disabled' in m:
        return ("The Google Ads API is not enabled in this project's Google Cloud "
                "console. Enable it, wait a few minutes, then retry.")
    if 'developer token' in m or 'developer_token' in m:
        return ("The Google Ads developer token is invalid or not approved. "
                "Check GOOGLE_ADS_DEVELOPER_TOKEN (it must come from a Google Ads "
                "Manager account's API Center and have at least Basic access).")
    if ('permission_denied' in m or '403' in m or 'unauthenticated' in m
            or 'permission' in m):
        return ("No Google Ads access. Reconnect your Google account to grant Ads "
                "permission, or check that the account is shared with you.")
    return None


@router.get("/auth/ads/status")
async def get_ads_status(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Report whether Ads is configured (dev token present) and connected (Google linked)."""
    from services.ads_service import ads_is_configured
    from utils.user_manager import get_user_gsc_token

    google_token, is_refresh = get_user_gsc_token(db, current_user.email)
    return {
        "configured": ads_is_configured(),
        "connected": bool(google_token and is_refresh),
    }


@router.get("/auth/ads/customers")
async def get_ads_customers(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List the Google Ads accounts the user can access."""
    from services.ads_service import ads_is_configured, get_user_ads_customers
    from utils.user_manager import get_user_gsc_token

    if not ads_is_configured():
        return {"configured": False, "customers": []}

    google_token, is_refresh = get_user_gsc_token(db, current_user.email)
    if not google_token or not is_refresh:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Google account not connected. Please connect your Google account first."
        )
    try:
        customers = await get_user_ads_customers(google_token, is_refresh_token=is_refresh, user_email=current_user.email)
        return {"configured": True, "customers": customers}
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        detail = _classify_ads_error(error_msg)
        if detail:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch Google Ads accounts: {error_msg}")


@router.get("/auth/ads/overview/{customer_id}")
async def get_ads_overview(
    customer_id: str,
    days: int = 28,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get headline Google Ads metrics, daily time-series, deltas and top campaigns."""
    from services.ads_service import ads_is_configured, AdsService
    from utils.user_manager import get_user_gsc_token

    if not ads_is_configured():
        return {"configured": False}

    google_token, is_refresh = get_user_gsc_token(db, current_user.email)
    if not google_token or not is_refresh:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Google account not connected. Please connect your Google account first."
        )
    try:
        service = AdsService.from_stored_token(google_token, is_refresh_token=is_refresh, user_email=current_user.email)
        return await service.get_overview(customer_id, days)
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        detail = _classify_ads_error(error_msg)
        if detail:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch Google Ads data: {error_msg}")


@router.post("/auth/ads/cache/invalidate")
async def invalidate_ads_cache(current_user: UserInfo = Depends(get_current_user)):
    """Force a fresh fetch of Google Ads data for the current user."""
    from services.ads_service import invalidate_cache
    invalidate_cache(user_email=current_user.email)
    return {"message": "Google Ads cache cleared. Next request will fetch fresh data."}
