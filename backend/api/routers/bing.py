"""Bing Webmaster Tools routes.

Bing runs its own OAuth 2.0 server (not Azure). A user connects one or more Bing accounts
(often Google-based logins) via the auth-code flow; we store each account's refresh token
and query the Bing Webmaster JSON API on their behalf. When no OAuth client is configured
every endpoint reports {configured: false} (HTTP 200) so the frontend can render a clear
"connect Bing" state instead of erroring — same pattern as the Google Ads router.
"""
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from models.schemas import UserInfo
from auth.auth import get_current_user
from database import get_db
from config import settings
from api.routers._shared import exchange_bing_code, refresh_bing_token
from services.bing_service import (
    bing_is_configured,
    get_verified_sites,
    get_rank_and_traffic,
    get_query_stats,
    get_page_stats,
    _cache_get,
    _cache_set,
    _TTL_SITES,
    _TTL_REPORT,
)
from utils.user_manager import (
    upsert_bing_account,
    get_bing_accounts,
    get_bing_account_token,
    delete_bing_account,
)

router = APIRouter()

BING_SCOPE = "webmaster.read"
BING_AUTHORIZE_URL = "https://www.bing.com/webmasters/oauth/authorize"


def _label_from_sites(sites: list) -> str:
    """Derive a human-facing label for a newly connected Bing account from its sites.
    Bing's token response has no email/profile, so name it after a representative site."""
    if not sites:
        return "Bing account (no verified sites)"
    first = (sites[0].get("url") or "").replace("https://", "").replace("http://", "").strip("/")
    extra = len(sites) - 1
    return f"{first}" + (f" +{extra} more" if extra > 0 else "")


@router.get("/auth/bing/status")
async def bing_status(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Report whether Bing OAuth is configured and how many accounts are connected."""
    accounts = get_bing_accounts(db, current_user.email) if bing_is_configured() else []
    return {
        "configured": bing_is_configured(),
        "client_id": settings.BING_CLIENT_ID if bing_is_configured() else None,
        "accounts": len(accounts),
    }


@router.get("/auth/bing/authorize-url")
async def bing_authorize_url(
    redirect_uri: str,
    current_user: UserInfo = Depends(get_current_user),
):
    """Build the Bing OAuth authorize URL the frontend opens in a popup."""
    if not bing_is_configured():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bing OAuth is not configured.")
    qs = urlencode({
        "client_id": settings.BING_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": BING_SCOPE,
    })
    return {"url": f"{BING_AUTHORIZE_URL}?{qs}"}


@router.post("/auth/bing/connect")
async def bing_connect(
    request: dict,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Exchange an authorization code for tokens and store the Bing account."""
    if not bing_is_configured():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bing OAuth is not configured.")

    code = request.get("code")
    redirect_uri = request.get("redirect_uri")
    if not code or not redirect_uri:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="'code' and 'redirect_uri' are required.")

    token_data = exchange_bing_code(code, redirect_uri)
    refresh_token = token_data.get("refresh_token")
    access_token = token_data.get("access_token")
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No refresh token returned by Bing. Revoke the app's access in Bing Webmaster settings and try again.",
        )

    # Name the account after its verified sites (Bing gives no email/profile).
    try:
        sites = await get_verified_sites(access_token)
    except Exception:
        sites = []
    label = _label_from_sites(sites)

    acct = upsert_bing_account(db, user_email=current_user.email, label=label, refresh_token=refresh_token)
    return {"id": acct.id, "label": acct.label, "sites": len(sites)}


@router.get("/auth/bing/accounts")
async def bing_list_accounts(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all connected Bing accounts for the current user."""
    return {"accounts": get_bing_accounts(db, current_user.email)}


@router.delete("/auth/bing/accounts/{account_id}")
async def bing_disconnect(
    account_id: int,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Disconnect (remove) a connected Bing account."""
    if not delete_bing_account(db, current_user.email, account_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bing account not found.")
    from services.bing_service import invalidate_cache
    invalidate_cache(current_user.email)
    return {"ok": True}


@router.get("/api/bing/sites")
async def bing_sites(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Merged verified sites across all connected Bing accounts, tagged by account."""
    if not bing_is_configured():
        return {"configured": False, "sites": [], "errors": []}

    accounts = get_bing_accounts(db, current_user.email)
    sites, errors = [], []
    for a in accounts:
        cache_key = (current_user.email, a["id"], "sites")
        cached = _cache_get(cache_key)
        if cached is not None:
            sites.extend(cached)
            continue
        try:
            refresh = get_bing_account_token(db, current_user.email, a["id"])
            access_token = refresh_bing_token(refresh)
            acct_sites = await get_verified_sites(access_token)
            tagged = [{**s, "account_id": a["id"], "account_label": a["label"]} for s in acct_sites]
            _cache_set(cache_key, tagged, _TTL_SITES)
            sites.extend(tagged)
        except Exception as e:
            errors.append({"account_id": a["id"], "label": a["label"], "error": str(e)})

    return {"configured": True, "sites": sites, "errors": errors}


@router.get("/api/bing/performance")
async def bing_performance(
    site: str,
    account_id: int,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search-performance data for one site under one connected Bing account."""
    if not bing_is_configured():
        return {"configured": False}

    cache_key = (current_user.email, account_id, "perf", site)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    refresh = get_bing_account_token(db, current_user.email, account_id)
    if not refresh:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connected Bing account not found.")

    try:
        access_token = refresh_bing_token(refresh)
        traffic = await get_rank_and_traffic(access_token, site)
        queries = await get_query_stats(access_token, site)
        pages = await get_page_stats(access_token, site)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to fetch Bing data: {e}")

    totals = {
        "clicks": sum(t["clicks"] for t in traffic),
        "impressions": sum(t["impressions"] for t in traffic),
    }
    result = {
        "configured": True,
        "site": site,
        "totals": totals,
        "traffic": traffic,
        "queries": sorted(queries, key=lambda q: q["clicks"], reverse=True),
        "pages": sorted(pages, key=lambda p: p["clicks"], reverse=True),
    }
    _cache_set(cache_key, result, _TTL_REPORT)
    return result
