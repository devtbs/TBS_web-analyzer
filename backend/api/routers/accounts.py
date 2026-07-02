"""Multi-Google-account management.

Allows one TBS app user to connect several Google accounts (Gmails) so all
clients across different accounts are visible without switching logins.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth.auth import get_current_user, verify_google_token
from database import get_db
from models.schemas import UserInfo
from config import settings
from utils.user_manager import (
    get_google_accounts,
    upsert_google_account,
    delete_google_account,
    get_google_account_token,
)

router = APIRouter()


@router.get("/auth/accounts")
async def list_accounts(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all Google accounts connected to the current TBS user."""
    return {"accounts": get_google_accounts(db, current_user.email)}


@router.post("/auth/accounts/connect")
async def connect_account(
    request: dict,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Connect an additional Google account via authorization-code flow.

    The frontend runs the same OAuth consent (webmasters + analytics + adwords
    scopes) for the new Gmail and sends the resulting `code` here.
    """
    import requests as http_requests

    code = request.get("code")
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="'code' is required.")

    token_response = http_requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": "postmessage",
            "grant_type": "authorization_code",
        },
    )
    token_data = token_response.json()
    if "error" in token_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Google token exchange failed: {token_data.get('error_description', token_data['error'])}",
        )

    refresh_token = token_data.get("refresh_token")
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No refresh token returned. Ask the user to revoke app access in Google account settings and try again.",
        )

    id_tok = token_data.get("id_token")
    if not id_tok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No id_token returned.")

    google_user = await verify_google_token(id_tok)

    acct = upsert_google_account(
        db,
        user_email=current_user.email,
        google_email=google_user.email,
        refresh_token=refresh_token,
        display_name=google_user.name,
        picture=google_user.picture,
    )

    return {
        "id": acct.id,
        "google_email": acct.google_email,
        "display_name": acct.display_name,
        "picture": acct.picture,
        "connected_at": acct.connected_at.isoformat() if acct.connected_at else None,
    }


@router.delete("/auth/accounts/{account_id}")
async def disconnect_account(
    account_id: int,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Disconnect (remove) a connected Google account."""
    deleted = delete_google_account(db, current_user.email, account_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
    return {"ok": True}
