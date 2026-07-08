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
    context = body.get("context") or {}
    approved_action = body.get("approved_action")

    ctx = ToolContext(
        db=db,
        user_email=current_user.email,
        account_id=account_id,
        selected_property=context.get("selected_property"),
        selected_customer=context.get("selected_customer"),
        selected_ga4_property=context.get("selected_ga4_property"),
    )

    async def stream():
        try:
            async for event in run_assistant(ctx, messages, approved_action=approved_action):
                etype = event.pop("type", "message")
                yield _sse(etype, event)
        except Exception as e:  # noqa: BLE001
            yield _sse("error", {"detail": str(e)})

    return StreamingResponse(stream(), media_type="text/event-stream", headers=_SSE_HEADERS)
