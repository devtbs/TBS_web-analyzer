"""In-app AI assistant chat endpoint (Server-Sent Events).

Streams a tool-calling agent (see services/assistant_service.py) that answers questions and
runs actions over the user's GSC / GA4 / Ads data. Respects the active Google account via the
same X-Account-Id header as every other data route.
"""
import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from models.schemas import UserInfo
from auth.auth import get_current_user
from database import get_db
from api.routers._shared import get_account_id, _SSE_HEADERS, _sse
from services.assistant_service import ToolContext, run_assistant, assistant_configured
from services import chat_store

router = APIRouter()


@router.get("/api/assistant/status")
async def assistant_status(current_user: UserInfo = Depends(get_current_user)):
    """Whether the assistant is usable (MiniMax key present)."""
    return {"configured": assistant_configured()}


@router.post("/api/assistant/chat")
async def assistant_chat(
    body: dict,
    request: Request,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id=Depends(get_account_id),
):
    """Stream an assistant reply as SSE.

    Body:
      messages: [{role: 'user'|'assistant', content: str}, ...]
      context:  {selected_property?, selected_customer?, selected_ga4_property?}
      approved_action: {name, args}   # present only when the user confirms a pending action
    """
    messages = body.get("messages") or []
    session_id = body.get("session_id")
    context = body.get("context") or {}
    approved_action = body.get("approved_action")
    provider = body.get("provider")

    ctx = ToolContext(
        db=db,
        user_email=current_user.email,
        account_id=account_id,
        selected_property=context.get("selected_property"),
        selected_customer=context.get("selected_customer"),
        selected_ga4_property=context.get("selected_ga4_property"),
        selected_client_id=context.get("selected_client_id"),
        selected_analysis_id=context.get("selected_analysis_id"),
    )

    # Persist the conversation so a refresh doesn't lose it. The user turn is saved up front;
    # the assistant turn is accumulated from the token stream and saved when the stream ends.
    last_user = ""
    for m in reversed(messages):
        if m.get("role") == "user" and m.get("content"):
            last_user = str(m["content"])
            break
    sid = chat_store.ensure_session(db, current_user.email, session_id, last_user)
    if last_user and not approved_action:
        chat_store.append(db, current_user.email, sid, "user", last_user)

    async def stream():
        reply = []
        yield _sse("session", {"session_id": sid})
        try:
            async for event in run_assistant(ctx, messages, approved_action=approved_action, provider=provider):
                etype = event.pop("type", "message")
                if etype == "token" and event.get("text"):
                    reply.append(event["text"])
                yield _sse(etype, event)
        except Exception as e:  # noqa: BLE001
            yield _sse("error", {"detail": str(e)})
        finally:
            try:
                chat_store.append(db, current_user.email, sid, "assistant", "".join(reply).strip())
            except Exception:  # noqa: BLE001
                pass

    return StreamingResponse(stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/api/assistant/sessions")
async def assistant_sessions(current_user: UserInfo = Depends(get_current_user),
                             db: Session = Depends(get_db)):
    """Recent conversations, newest first."""
    return {"sessions": chat_store.list_sessions(db, current_user.email)}


@router.get("/api/assistant/sessions/{session_id}")
async def assistant_session(session_id: str,
                            current_user: UserInfo = Depends(get_current_user),
                            db: Session = Depends(get_db)):
    """Every turn in one conversation (for restoring the widget after a refresh)."""
    return {"messages": chat_store.get_messages(db, current_user.email, session_id)}


@router.delete("/api/assistant/sessions/{session_id}")
async def assistant_session_delete(session_id: str,
                                   current_user: UserInfo = Depends(get_current_user),
                                   db: Session = Depends(get_db)):
    return {"deleted": chat_store.delete_session(db, current_user.email, session_id)}
