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
from api.routers._shared import get_account_id, _resolve_token

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
    if ('developer_token_not_approved' in m or 'not approved to access' in m
            or 'test account' in m):
        return ("This developer token only has Test access, which can't read real "
                "Google Ads accounts — only empty test accounts return data. Apply "
                "for Basic access in your MCC's API Center (it's free), then retry.")
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
    account_id: Optional[int] = Depends(get_account_id),
):
    """List the Google Ads accounts the user can access."""
    from services.ads_service import ads_is_configured, get_user_ads_customers

    if not ads_is_configured():
        return {"configured": False, "customers": []}

    google_token, is_refresh = _resolve_token(db, current_user.email, account_id)
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


@router.get("/auth/ads/customers/all")
async def get_ads_customers_all(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Aggregate Google Ads customers across ALL connected Google accounts, grouped by account."""
    import asyncio
    from services.ads_service import ads_is_configured, get_user_ads_customers
    from api.routers._shared import iter_google_accounts

    if not ads_is_configured():
        return {"configured": False, "groups": [], "errors": []}

    accounts = iter_google_accounts(db, current_user.email)
    accounts = [a for a in accounts if a["is_refresh"]]  # Ads needs a refresh token
    if not accounts:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Google accounts connected. Please connect your Google account first.",
        )

    async def _one(acct):
        # Distinct cache identity per Google account so one account's customer
        # list can't be served from another account's cached entry.
        return await get_user_ads_customers(
            acct["token"], is_refresh_token=acct["is_refresh"],
            user_email=f"{current_user.email}|{acct['google_email']}",
        )

    results = await asyncio.gather(*[_one(a) for a in accounts], return_exceptions=True)

    groups, errors = [], []
    for acct, res in zip(accounts, results):
        if isinstance(res, Exception):
            detail = _classify_ads_error(str(res)) or str(res)
            errors.append({"account_id": acct["account_id"], "google_email": acct["google_email"], "error": detail})
            continue
        groups.append({
            "account_id": acct["account_id"],
            "google_email": acct["google_email"],
            "customers": res or [],
        })
    return {"configured": True, "groups": groups, "errors": errors}


@router.get("/auth/ads/overview/{customer_id}")
async def get_ads_overview(
    customer_id: str,
    days: int = 28,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id),
):
    """Get headline Google Ads metrics, daily time-series, deltas and top campaigns."""
    from services.ads_service import ads_is_configured, AdsService

    if not ads_is_configured():
        return {"configured": False}

    google_token, is_refresh = _resolve_token(db, current_user.email, account_id)
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


@router.get("/auth/ads/deep-dive/{customer_id}")
async def get_ads_deep_dive(
    customer_id: str,
    days: int = 28,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[int] = Depends(get_account_id),
):
    """Granular performance breakdowns: keywords, search terms, device, network, demographics, geo, scheduling."""
    from services.ads_service import ads_is_configured, AdsService

    if not ads_is_configured():
        return {"configured": False}

    google_token, is_refresh = _resolve_token(db, current_user.email, account_id)
    if not google_token or not is_refresh:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Google account not connected. Please connect your Google account first."
        )
    try:
        service = AdsService.from_stored_token(google_token, is_refresh_token=is_refresh, user_email=current_user.email)
        return await service.get_deep_dive(customer_id, days)
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        detail = _classify_ads_error(error_msg)
        if detail:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch deep-dive data: {error_msg}")


@router.post("/auth/ads/cache/invalidate")
async def invalidate_ads_cache(current_user: UserInfo = Depends(get_current_user)):
    """Force a fresh fetch of Google Ads data for the current user."""
    from services.ads_service import invalidate_cache
    invalidate_cache(user_email=current_user.email)
    return {"message": "Google Ads cache cleared. Next request will fetch fresh data."}
