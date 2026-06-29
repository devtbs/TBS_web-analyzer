"""Alerting routes: list/read fired alert events and manage alert rules."""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth.auth import get_current_user
from models.schemas import UserInfo
from database import get_db, AlertEvent, AlertRule
from services.alert_service import evaluate_user, DEFAULT_RULES

router = APIRouter()


def _event_dict(e: AlertEvent) -> dict:
    return {
        "id": e.id,
        "property_url": e.property_url,
        "type": e.type,
        "metric": e.metric,
        "severity": e.severity,
        "message": e.message,
        "data": e.data,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "read": e.read_at is not None,
    }


@router.get("/api/alerts")
async def list_alerts(
    limit: int = 50,
    offset: int = 0,
    unread_only: bool = False,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List a user's alert events, newest first; unread first when not filtered."""
    limit = max(1, min(limit, 200))
    q = db.query(AlertEvent).filter(AlertEvent.user_email == current_user.email)
    if unread_only:
        q = q.filter(AlertEvent.read_at.is_(None))
    total = q.count()
    unread = db.query(AlertEvent).filter(
        AlertEvent.user_email == current_user.email, AlertEvent.read_at.is_(None)
    ).count()
    rows = (q.order_by(AlertEvent.created_at.desc())
             .offset(offset).limit(limit).all())
    return {
        "alerts": [_event_dict(e) for e in rows],
        "total": total,
        "unread": unread,
    }


@router.post("/api/alerts/{alert_id}/read")
async def mark_read(
    alert_id: str,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    e = db.query(AlertEvent).filter(
        AlertEvent.id == alert_id, AlertEvent.user_email == current_user.email
    ).first()
    if not e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    if e.read_at is None:
        e.read_at = datetime.utcnow()
        db.commit()
    return {"ok": True}


@router.post("/api/alerts/read-all")
async def mark_all_read(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.utcnow()
    db.query(AlertEvent).filter(
        AlertEvent.user_email == current_user.email, AlertEvent.read_at.is_(None)
    ).update({AlertEvent.read_at: now})
    db.commit()
    return {"ok": True}


# ── Rules ────────────────────────────────────────────────────────────────
class AlertRuleIn(BaseModel):
    metric: str           # clicks | impressions | ctr | position
    direction: str        # drop | spike | worsen
    threshold_pct: float
    property_url: Optional[str] = None
    enabled: bool = True


def _rule_dict(r: AlertRule) -> dict:
    return {
        "id": r.id,
        "metric": r.metric,
        "direction": r.direction,
        "threshold_pct": float(r.threshold_pct),
        "property_url": r.property_url,
        "enabled": r.enabled,
    }


@router.get("/api/alert-rules")
async def list_rules(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the user's rules, or the built-in defaults if they have none."""
    rows = db.query(AlertRule).filter(AlertRule.user_email == current_user.email).all()
    if rows:
        return {"rules": [_rule_dict(r) for r in rows], "using_defaults": False}
    defaults = [
        {"id": None, "metric": m, "direction": d, "threshold_pct": t,
         "property_url": None, "enabled": True}
        for (m, d, t, _sev) in DEFAULT_RULES
    ]
    return {"rules": defaults, "using_defaults": True}


@router.post("/api/alert-rules")
async def create_rule(
    body: AlertRuleIn,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.metric not in ("clicks", "impressions", "ctr", "position"):
        raise HTTPException(status_code=422, detail="Invalid metric")
    if body.direction not in ("drop", "spike", "worsen"):
        raise HTTPException(status_code=422, detail="Invalid direction")
    rule = AlertRule(
        id=str(uuid.uuid4()),
        user_email=current_user.email,
        property_url=body.property_url,
        metric=body.metric,
        direction=body.direction,
        threshold_pct=str(body.threshold_pct),
        enabled=body.enabled,
    )
    db.add(rule)
    db.commit()
    return _rule_dict(rule)


@router.put("/api/alert-rules/{rule_id}")
async def update_rule(
    rule_id: str,
    body: AlertRuleIn,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    r = db.query(AlertRule).filter(
        AlertRule.id == rule_id, AlertRule.user_email == current_user.email
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Rule not found")
    r.metric = body.metric
    r.direction = body.direction
    r.threshold_pct = str(body.threshold_pct)
    r.property_url = body.property_url
    r.enabled = body.enabled
    db.commit()
    return _rule_dict(r)


@router.delete("/api/alert-rules/{rule_id}")
async def delete_rule(
    rule_id: str,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    r = db.query(AlertRule).filter(
        AlertRule.id == rule_id, AlertRule.user_email == current_user.email
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.post("/api/alerts/evaluate")
async def evaluate_now(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Run the evaluator for the current user immediately (manual trigger / testing)."""
    created = await evaluate_user(db, current_user.email)
    return {"created": created}
