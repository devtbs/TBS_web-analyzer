"""Technical-SEO audit routes: kick off a crawl, fetch results, list history.

Progress streams through the shared /api/progress/{id} SSE endpoint (the
audit_id is used as the progress key), so no separate stream route is needed.
"""
import uuid
from datetime import datetime

import pytz
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth.auth import get_current_user
from models.schemas import UserInfo
from database import get_db, Audit
from services.audit_service import run_audit

router = APIRouter()

_BANGKOK = pytz.timezone("Asia/Bangkok")


class AuditRequest(BaseModel):
    property_url: str
    max_pages: int = 100


def _to_local(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = pytz.utc.localize(dt)
    return dt.astimezone(_BANGKOK).isoformat()


@router.post("/api/audit")
async def start_audit(
    body: AuditRequest,
    background_tasks: BackgroundTasks,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not body.property_url:
        raise HTTPException(status_code=422, detail="property_url is required")
    audit_id = str(uuid.uuid4())
    db.add(Audit(
        audit_id=audit_id,
        user_email=current_user.email,
        property_url=body.property_url,
        status="processing",
    ))
    db.commit()

    max_pages = max(1, min(body.max_pages, 300))
    background_tasks.add_task(run_audit, audit_id, body.property_url, max_pages)
    return {"audit_id": audit_id, "status": "processing"}


@router.get("/api/audit/{audit_id}")
async def get_audit(
    audit_id: str,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    a = db.query(Audit).filter(
        Audit.audit_id == audit_id, Audit.user_email == current_user.email
    ).first()
    if not a:
        raise HTTPException(status_code=404, detail="Audit not found")
    return {
        "audit_id": a.audit_id,
        "property_url": a.property_url,
        "status": a.status,
        "created_at": _to_local(a.created_at),
        "summary": a.summary,
        "issues": a.issues,
        "error": a.error,
    }


@router.get("/api/audits")
async def list_audits(
    limit: int = 20,
    offset: int = 0,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limit = max(1, min(limit, 100))
    q = db.query(Audit).filter(Audit.user_email == current_user.email)
    total = q.count()
    rows = q.order_by(Audit.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "audits": [
            {
                "audit_id": a.audit_id,
                "property_url": a.property_url,
                "status": a.status,
                "created_at": _to_local(a.created_at),
                "score": (a.summary or {}).get("score") if a.summary else None,
            }
            for a in rows
        ],
        "total": total,
    }
