"""Shared helpers and constants used across multiple routers.

These were previously module-level helpers inside the monolithic routes.py.
"""
import base64
import json
import uuid
import asyncio
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, Request, status

from database import Document


def get_account_id(request: Request) -> Optional[int]:
    """FastAPI dependency: read the selected Google account id from the
    X-Account-Id request header. Returns None if the header is absent,
    which means use the primary token stored on the User row."""
    raw = request.headers.get("X-Account-Id")
    if raw:
        try:
            return int(raw)
        except ValueError:
            pass
    return None


def exchange_google_code(code: str) -> dict:
    """Exchange a Google OAuth authorization code for tokens.

    Shared by the three consent flows (primary login, connect-additional-account, and
    the standalone GSC connect) so the token-exchange request lives in one place.
    Uses redirect_uri='postmessage' (required for popup/ux_mode flows). Raises a 400
    HTTPException on a Google `error`. Callers handle id_token verification / storage.
    """
    import requests as http_requests
    from config import settings

    resp = http_requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": "postmessage",
            "grant_type": "authorization_code",
        },
    )
    token_data = resp.json()
    if "error" in token_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Google token exchange failed: {token_data.get('error_description', token_data['error'])}",
        )
    return token_data


def exchange_bing_code(code: str, redirect_uri: str) -> dict:
    """Exchange a Bing Webmaster OAuth authorization code for tokens.

    Bing runs its own OAuth server (not Azure): POST form-encoded to /oauth/token.
    redirect_uri must exactly match the one used in the authorize request AND registered
    on the BWT OAuth client. Returns the token JSON (access_token, refresh_token,
    expires_in). Raises 400 on a Bing `error`.
    """
    import requests as http_requests
    from config import settings

    resp = http_requests.post(
        "https://www.bing.com/webmasters/oauth/token",
        data={
            "code": code,
            "client_id": settings.BING_CLIENT_ID,
            "client_secret": settings.BING_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
    )
    token_data = resp.json()
    if "error" in token_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Bing token exchange failed: {token_data.get('error_description', token_data['error'])}",
        )
    return token_data


def refresh_bing_token(refresh_token: str) -> str:
    """Exchange a stored Bing refresh token for a fresh short-lived access token.

    Returns the access_token string. Raises 400 on a Bing `error` (e.g. revoked access).
    """
    import requests as http_requests
    from config import settings

    resp = http_requests.post(
        "https://www.bing.com/webmasters/oauth/token",
        data={
            "client_id": settings.BING_CLIENT_ID,
            "client_secret": settings.BING_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    )
    token_data = resp.json()
    if "error" in token_data or "access_token" not in token_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Bing token refresh failed: {token_data.get('error_description', token_data.get('error', 'no access_token'))}",
        )
    return token_data["access_token"]


def iter_google_accounts(db, email) -> list:
    """Return every connected Google account for `email` as a list of dicts:
    {account_id, google_email, token, is_refresh}.

    Sources both the multi-account `google_accounts` rows (each an explicit
    account_id, always refresh tokens) and — for users who only ever connected
    via the standalone GSC flow — the primary `users.gsc_token` (account_id=None).
    Used by the aggregate "/all" list endpoints to show every client across
    every connected Gmail at once.
    """
    from utils.user_manager import get_google_accounts, get_google_account_token, get_user_gsc_token

    accounts = []
    seen_emails = set()
    for a in get_google_accounts(db, email):
        token = get_google_account_token(db, email, a["id"])
        if not token:
            continue
        accounts.append({
            "account_id": a["id"],
            "google_email": a["google_email"],
            "token": token,
            "is_refresh": True,
        })
        seen_emails.add(a["google_email"])

    # Include the primary token when it isn't already represented above (e.g. the
    # user connected GSC via the standalone selector, which only fills users.gsc_token).
    primary_token, primary_is_refresh = get_user_gsc_token(db, email)
    if primary_token and email not in seen_emails:
        accounts.append({
            "account_id": None,
            "google_email": email,
            "token": primary_token,
            "is_refresh": primary_is_refresh,
        })

    return accounts

# Media types for streamed file downloads.
PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
PDF_MEDIA_TYPE = "application/pdf"

# Headers for Server-Sent Event responses (disable caching / proxy buffering).
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _resolve_token(db, email, account_id=None):
    """Return (token, is_refresh) for the given account_id, or fall back to the
    primary token stored on the User row when account_id is None."""
    from utils.user_manager import get_user_gsc_token, get_google_account_token
    if account_id is not None:
        token = get_google_account_token(db, email, account_id)
        if not token:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="Connected Google account not found.")
        return token, True  # extra accounts always store a refresh token
    return get_user_gsc_token(db, email)


def _gsc_service_for(db, email, account_id=None):
    """Helper: build a GSCService from the user's stored token, or raise 404."""
    from services.gsc_service import GSCService
    token, is_refresh = _resolve_token(db, email, account_id)
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="GSC not connected.")
    return GSCService.from_stored_token(token, is_refresh_token=is_refresh, user_email=email)


def _ga4_service_for(db, email, account_id=None):
    """Helper: build an AnalyticsService (GA4) from the user's stored token, or raise 404."""
    from services.analytics_service import AnalyticsService
    token, is_refresh = _resolve_token(db, email, account_id)
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Google account not connected.")
    return AnalyticsService.from_stored_token(token, is_refresh_token=is_refresh, user_email=email)


def _save_deck_document(db, user_email: str, *, html: str, source: str, label: str,
                        provider: str) -> str:
    """Persist a generated AI deck as a Document so it shows in the Documents history
    and can be re-downloaded. Stores the HTML only; the file is re-rendered on download."""
    doc_id = str(uuid.uuid4())
    date_label = datetime.now().strftime("%Y-%m-%d")
    doc = Document(
        id=doc_id,
        user_email=user_email,
        title=f"AI Deck — {label} ({date_label})",
        content_type="AI Deck",
        content={"html": html, "source": source, "label": label,
                 "provider": provider},
    )
    db.add(doc)
    db.commit()
    return doc_id


def _slides_payload(imgs) -> list:
    """JPEG bytes -> data URLs for the in-app preview carousel."""
    return ["data:image/jpeg;base64," + base64.b64encode(b).decode() for b in imgs]


def _sse(event: str, data: dict) -> str:
    """Format one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def _stream_deck_generation(run):
    """Run a deck-building coroutine while streaming its progress as SSE.

    `run` is an async callable that takes an `on_progress(message)` callback and returns
    the final result dict (document_id, slides, label). Emits `progress` events as the
    pipeline reports phases, then a final `result` event — or an `error` event on failure.
    """
    queue: asyncio.Queue = asyncio.Queue()
    _DONE = object()

    async def on_progress(message: str):
        await queue.put(_sse("progress", {"message": message}))

    async def worker():
        try:
            result = await run(on_progress)
            await queue.put(_sse("result", result))
        except Exception as e:
            await queue.put(_sse("error", {"detail": str(e)}))
        finally:
            await queue.put(_DONE)

    task = asyncio.create_task(worker())
    try:
        while True:
            item = await queue.get()
            if item is _DONE:
                break
            yield item
    finally:
        if not task.done():
            task.cancel()
