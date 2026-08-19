"""Persistence for assistant conversations.

The widget used to hold messages in React state only, so a refresh lost the thread and there was
no way to revisit what the assistant said last week. Sessions live here instead; the chat endpoint
appends each turn as it happens.
"""
import uuid
from datetime import datetime
from typing import List, Optional

from database import ChatSession, ChatMessage

TITLE_LEN = 80
LIST_LIMIT = 30
HISTORY_LIMIT = 200


def ensure_session(db, email: str, session_id: Optional[str], first_text: str = "") -> str:
    """Return an existing session id (validated against this user) or create a new one."""
    if session_id:
        row = db.query(ChatSession).filter(
            ChatSession.id == session_id, ChatSession.user_email == email).first()
        if row:
            return row.id
    sid = session_id or str(uuid.uuid4())
    db.add(ChatSession(id=sid, user_email=email,
                       title=(first_text or "New chat").strip()[:TITLE_LEN] or "New chat"))
    db.commit()
    return sid


def append(db, email: str, session_id: str, role: str, content: str) -> None:
    """Append one turn. Silently no-ops on empty content so a failed reply doesn't leave a blank."""
    if not content or not content.strip():
        return
    db.add(ChatMessage(session_id=session_id, role=role, content=content))
    row = db.query(ChatSession).filter(
        ChatSession.id == session_id, ChatSession.user_email == email).first()
    if row:
        row.updated_at = datetime.utcnow()
        if not row.title or row.title == "New chat":
            row.title = content.strip()[:TITLE_LEN]
    db.commit()


def list_sessions(db, email: str, limit: int = LIST_LIMIT) -> List[dict]:
    rows = (db.query(ChatSession)
              .filter(ChatSession.user_email == email)
              .order_by(ChatSession.updated_at.desc())
              .limit(limit).all())
    return [{"id": r.id, "title": r.title, "updated_at": r.updated_at.isoformat()} for r in rows]


def get_messages(db, email: str, session_id: str) -> List[dict]:
    owned = db.query(ChatSession).filter(
        ChatSession.id == session_id, ChatSession.user_email == email).first()
    if not owned:
        return []
    rows = (db.query(ChatMessage)
              .filter(ChatMessage.session_id == session_id)
              .order_by(ChatMessage.id.asc())
              .limit(HISTORY_LIMIT).all())
    return [{"role": r.role, "content": r.content} for r in rows]


def delete_session(db, email: str, session_id: str) -> bool:
    row = db.query(ChatSession).filter(
        ChatSession.id == session_id, ChatSession.user_email == email).first()
    if not row:
        return False
    db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
    db.delete(row)
    db.commit()
    return True
