"""Anomaly-detection evaluator.

Evaluates each user's GSC properties against their alert rules (or sensible
defaults) using the period-over-period deltas already produced by
GSCService.get_search_analytics, and writes AlertEvent rows on breach.

Designed to be called from a scheduled daily job (see main.py) and on demand
from the alerts router for testing.
"""
import logging
import uuid
from datetime import datetime, timedelta
from typing import List

from sqlalchemy.orm import Session

from database import SessionLocal, User, AlertRule, AlertEvent
from api.routers._shared import _gsc_service_for

logger = logging.getLogger(__name__)

# Built-in defaults applied to every property when a user has no custom rules.
# (metric, direction, threshold_pct, severity)
DEFAULT_RULES = [
    ("clicks", "drop", 25.0, "warning"),
    ("impressions", "drop", 30.0, "warning"),
    ("position", "worsen", 20.0, "warning"),   # avg position got 20%+ worse
    ("clicks", "spike", 100.0, "info"),
]

# Don't refire the same (property, type) within this window.
_DEDUPE_HOURS = 20


def _effective_rules(db: Session, email: str):
    """User's enabled rules, or the built-in defaults if they have none."""
    rows = db.query(AlertRule).filter(
        AlertRule.user_email == email, AlertRule.enabled == True  # noqa: E712
    ).all()
    if rows:
        return [(r.metric, r.direction, float(r.threshold_pct),
                 getattr(r, "severity", None) or "warning", r.property_url) for r in rows]
    return [(m, d, t, sev, None) for (m, d, t, sev) in DEFAULT_RULES]


def _breached(direction: str, delta_pct, threshold: float) -> bool:
    """delta_pct is signed % change (positive = up). position 'worsen' = delta up."""
    if delta_pct is None:
        return False
    if direction == "drop":
        return delta_pct <= -abs(threshold)
    if direction in ("spike", "worsen"):
        return delta_pct >= abs(threshold)
    return False


def _recent_event_exists(db: Session, email: str, prop: str, etype: str) -> bool:
    cutoff = datetime.utcnow() - timedelta(hours=_DEDUPE_HOURS)
    return db.query(AlertEvent).filter(
        AlertEvent.user_email == email,
        AlertEvent.property_url == prop,
        AlertEvent.type == etype,
        AlertEvent.created_at >= cutoff,
    ).first() is not None


async def evaluate_user(db: Session, email: str) -> int:
    """Evaluate all of a user's properties; return number of new events created."""
    try:
        gsc = _gsc_service_for(db, email)
    except Exception:
        return 0  # not connected

    try:
        properties = await gsc.get_properties()
    except Exception as e:
        logger.warning(f"alerts: could not list properties for {email}: {e}")
        return 0

    created = 0
    for p in properties:
        prop = p.get("url")
        if not prop:
            continue
        try:
            data = await gsc.get_search_analytics(prop, days=28, group_by="daily")
        except Exception as e:
            logger.warning(f"alerts: analytics failed for {prop}: {e}")
            continue

        totals = data.get("totals", {})
        prev = data.get("previous_totals", {})
        deltas = data.get("deltas", {})

        for metric, direction, threshold, severity, rule_prop in _effective_rules(db, email):
            if rule_prop and rule_prop != prop:
                continue
            delta = deltas.get(metric)
            # position uses percentage-point delta; treat increase as 'worsen'
            if not _breached(direction, delta, threshold):
                continue
            etype = f"{metric}_{direction}"
            if _recent_event_exists(db, email, prop, etype):
                continue
            cur = totals.get(metric)
            pv = prev.get(metric)
            msg = _message(metric, direction, prop, delta, cur, pv)
            db.add(AlertEvent(
                id=str(uuid.uuid4()),
                user_email=email,
                property_url=prop,
                type=etype,
                metric=metric,
                severity=severity,
                message=msg,
                data={"current": cur, "previous": pv, "delta_pct": delta},
            ))
            created += 1

    if created:
        db.commit()
    logger.info(f"alerts: {email} -> {created} new events")
    return created


def _message(metric, direction, prop, delta, cur, pv) -> str:
    name = prop.replace("sc-domain:", "")
    verb = {"drop": "fell", "spike": "jumped", "worsen": "worsened"}.get(direction, "changed")
    return (f"{metric.capitalize()} {verb} {abs(delta):.0f}% on {name} "
            f"(now {cur}, was {pv}) over the last 28 days vs the prior 28.")


async def evaluate_all_users() -> int:
    """Scheduled entry point: evaluate every connected user. Own DB session."""
    db = SessionLocal()
    total = 0
    emails = []
    try:
        emails = [u.email for u in db.query(User).filter(User.gsc_token.isnot(None)).all()]
        for email in emails:
            total += await evaluate_user(db, email)
    finally:
        db.close()
    logger.info(f"alerts: scheduled run created {total} events across {len(emails)} users")
    return total
