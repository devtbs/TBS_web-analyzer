"""Shared helpers and constants used across multiple routers.

These were previously module-level helpers inside the monolithic routes.py.
"""
import base64
import json
import uuid
import asyncio
from datetime import datetime

from fastapi import HTTPException, status

from database import Document

# Media types for streamed file downloads.
PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
PDF_MEDIA_TYPE = "application/pdf"

# Headers for Server-Sent Event responses (disable caching / proxy buffering).
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _gsc_service_for(db, email):
    """Helper: build a GSCService from the user's stored token, or raise 404."""
    from services.gsc_service import GSCService
    from utils.user_manager import get_user_gsc_token
    gsc_token, is_refresh = get_user_gsc_token(db, email)
    if not gsc_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="GSC not connected.")
    return GSCService.from_stored_token(gsc_token, is_refresh_token=is_refresh, user_email=email)


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
