"""Shared helpers and constants used across multiple routers.

These were previously module-level helpers inside the monolithic routes.py.
"""
import base64
import json
import time
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


def _save_deck_document(user_email: str, *, html: str, source: str, label: str,
                        provider: str) -> str:
    """Persist a generated AI deck as a Document so it shows in the Documents history
    and can be re-downloaded. Stores the HTML only; the file is re-rendered on download.

    Opens its OWN short-lived session rather than a request-scoped one: deck generation runs
    as a detached background job that can outlive the request (client reloaded/left), by which
    point the request's DB session is already closed."""
    from database import SessionLocal
    doc_id = str(uuid.uuid4())
    date_label = datetime.now().strftime("%Y-%m-%d")
    with SessionLocal() as db:
        db.add(Document(
            id=doc_id,
            user_email=user_email,
            title=f"AI Deck — {label} ({date_label})",
            content_type="AI Deck",
            content={"html": html, "source": source, "label": label, "provider": provider},
        ))
        db.commit()
    return doc_id


def _slides_payload(imgs) -> list:
    """JPEG bytes -> data URLs for the in-app preview carousel."""
    return ["data:image/jpeg;base64," + base64.b64encode(b).decode() for b in imgs]


def _sse(event: str, data: dict) -> str:
    """Format one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# ── Background deck-job registry ──────────────────────────────────────────────
# Deck generation runs detached from the request so it survives a reload / tab close
# (single uvicorn process on prod ⇒ in-memory is fine; move to Redis/DB if scaled out).
# Each entry: {status: running|done|error, message, document_id, slides, label, error,
#              user_email, task, ts}.
_DECK_JOBS: dict = {}
_DECK_JOB_TTL = 60 * 60  # keep finished jobs 1h so a returning client can still read them


def _evict_stale_jobs():
    now = time.time()
    for jid in [j for j, v in _DECK_JOBS.items()
                if v.get("status") != "running" and now - v.get("ts", now) > _DECK_JOB_TTL]:
        _DECK_JOBS.pop(jid, None)


def _deck_job_public(job: dict) -> dict:
    """The client-safe view of a job (no task handle / internal fields)."""
    return {k: job.get(k) for k in
            ("status", "message", "document_id", "slides", "label", "error")}


async def _stream_deck_generation(run, user_email: str = ""):
    """Run a deck-building coroutine detached from the request, streaming its progress as SSE.

    `run` is an async callable taking an `on_progress(message)` callback and returning the
    final result dict (document_id, slides, label). The work runs as a background task that
    is registered in `_DECK_JOBS` and is NOT cancelled when the client disconnects — so a
    reload/close no longer kills the deck; the finished deck is saved either way. The stream
    emits a `job` event (job_id) first, then `progress`/`heartbeat`, then `result` or `error`.
    A returning client re-attaches via GET /api/presentation/deck-job/{job_id}.
    """
    _evict_stale_jobs()
    job_id = uuid.uuid4().hex
    job = _DECK_JOBS[job_id] = {
        "status": "running", "message": "Starting…", "document_id": None,
        "slides": None, "label": None, "error": None,
        "user_email": user_email, "task": None, "ts": time.time(),
    }

    async def on_progress(message: str):
        job["message"] = message

    async def worker():
        try:
            result = await run(on_progress)  # {document_id, slides, label}
            job.update(status="done", ts=time.time(), **{
                k: result.get(k) for k in ("document_id", "slides", "label")})
        except Exception as e:
            job.update(status="error", error=str(e), ts=time.time())

    job["task"] = asyncio.create_task(worker())

    yield _sse("job", {"job_id": job_id})
    last_msg = None
    while job["status"] == "running":
        if job["message"] != last_msg:
            last_msg = job["message"]
            yield _sse("progress", {"message": last_msg})
        # Heartbeat: reasoning models (GLM, DeepSeek-V4, Kimi) "think" silently for 30-60s+; a
        # keepalive stops the proxy/browser dropping the idle SSE stream ("bad connection").
        yield _sse("heartbeat", {})
        await asyncio.sleep(2)
    # Flush any final progress message, then the terminal event.
    if job["message"] != last_msg:
        yield _sse("progress", {"message": job["message"]})
    if job["status"] == "done":
        yield _sse("result", {k: job[k] for k in ("document_id", "slides", "label")})
    else:
        yield _sse("error", {"detail": job.get("error") or "Generation failed."})
