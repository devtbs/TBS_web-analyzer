"""Recurring AI-presentation generation.

A schedule says "build this deck for this site on these days of the month, at this local time".
The APScheduler tick in main.py calls run_due() every 15 minutes; anything whose local time has
passed today and that has not already run today fires once.

Why a 15-minute tick rather than one cron job per schedule: schedules are user data that changes at
runtime, so registering/unregistering APScheduler jobs would have to stay in sync with the table
through every create, edit, delete and restart. Polling a table is far harder to get wrong, and for
a report that lands at 5am, firing within 15 minutes is indistinguishable from exact.
"""
import logging
import uuid
from datetime import datetime, timezone as _tz
from calendar import monthrange
from typing import List, Optional

from database import SessionLocal, DeckSchedule

logger = logging.getLogger(__name__)

SOURCES = ("gsc", "ga4", "ads", "bing", "combined")
TICK_MINUTES = 15


def _zone(name: str):
    from zoneinfo import ZoneInfo
    try:
        return ZoneInfo(name or "UTC")
    except Exception:
        logger.warning("unknown timezone %r — falling back to UTC", name)
        return ZoneInfo("UTC")


def is_due(sched: DeckSchedule, now_utc: Optional[datetime] = None) -> bool:
    """True when this schedule should fire right now.

    Fires at the first tick AT OR AFTER the local time on a chosen day, at most once per local day.
    "At or after" (not "equals") is deliberate: a restart or slow tick must delay the deck, never
    skip it entirely.
    """
    if not sched.active or not sched.days_of_month:
        return False
    now = (now_utc or datetime.now(_tz.utc)).astimezone(_zone(sched.timezone))

    days = [int(d) for d in sched.days_of_month if str(d).isdigit()]
    last_day = monthrange(now.year, now.month)[1]
    # A "31st" schedule must still fire in a 30-day month — clamp overflow onto the last day
    # rather than silently never running in February.
    due_today = now.day in days or (now.day == last_day and any(d > last_day for d in days))
    if not due_today:
        return False

    scheduled = now.replace(hour=int(sched.hour or 0), minute=int(sched.minute or 0),
                            second=0, microsecond=0)
    if now < scheduled:
        return False
    return sched.last_run_on != now.date()


def local_today(sched: DeckSchedule, now_utc: Optional[datetime] = None):
    return (now_utc or datetime.now(_tz.utc)).astimezone(_zone(sched.timezone)).date()


async def run_schedule(db, sched: DeckSchedule) -> dict:
    """Generate one deck for this schedule, headlessly, and file it against the client.

    Mirrors the manual endpoints exactly — same generators, same placeholder document, same
    finalisation — with a no-op progress callback in place of the SSE stream.
    """
    from api.routers._shared import (_create_deck_placeholder, _gsc_service_for,
                                     _ga4_service_for, _ads_service_for)
    from api.routers.decks import _finalize_and_preview
    from services.image_service import images_enabled

    p = dict(sched.params or {})
    email = sched.user_email
    acct = p.get("account_id")
    days = int(p.get("days") or 28)
    from config import settings
    provider = p.get("provider") or settings.DEFAULT_AI_PROVIDER
    images = bool(p.get("images", True)) and images_enabled()
    common = {
        "provider": provider, "images": images,
        "notes": p.get("notes") or "", "creativity": p.get("creativity") or "balanced",
        "pipeline": p.get("pipeline") or "single", "models": p.get("models"),
        "theme_mode": p.get("theme_mode") or "tbs", "custom_color": p.get("custom_color"),
        "style": p.get("style") or "tbs",
    }

    async def _noop(*_a, **_kw):
        return None

    doc_id = _create_deck_placeholder(email, source=sched.source, label=sched.name,
                                      provider=provider, client_id=sched.client_id)
    if sched.source == "gsc":
        from services.report_generator import generate_ai_gsc_deck
        result = await generate_ai_gsc_deck(
            _gsc_service_for(db, email, acct), p.get("property"), days,
            brand_terms=p.get("brand_terms") or "", on_progress=_noop, **common)

    elif sched.source == "ga4":
        from services.report_generator import generate_ai_ga4_deck
        result = await generate_ai_ga4_deck(
            _ga4_service_for(db, email, acct), p.get("property_id"), days,
            label=p.get("label") or "", on_progress=_noop, **common)
    elif sched.source == "ads":
        from services.report_generator import generate_ai_ads_deck
        result = await generate_ai_ads_deck(
            _ads_service_for(db, email, acct, required=True), p.get("customer_id"), days,
            label=p.get("label") or "", on_progress=_noop, **common)
    elif sched.source == "bing":
        # Bing takes a live access token, not a service object — mint one from the stored refresh
        # token exactly as the manual endpoint does.
        from services.report_generator import generate_ai_bing_deck
        from api.routers._shared import refresh_bing_token
        from utils.user_manager import get_bing_account_token
        bing_acct = int(p.get("bing_account_id") or 0)
        refresh = get_bing_account_token(db, email, bing_acct)
        if not refresh:
            raise ValueError("connected Bing account not found — reconnect it to keep this schedule running")
        result = await generate_ai_bing_deck(
            refresh_bing_token(refresh), p.get("site"), days,
            label=p.get("label") or "", on_progress=_noop, **common)
    elif sched.source == "combined":
        # Every argument is keyword-only here, and each platform is optional — a schedule with only
        # GSC linked still produces a deck, minus the sections it has no data for.
        from services.report_generator import generate_ai_combined_deck
        result = await generate_ai_combined_deck(
            days=days,
            gsc_service=_gsc_service_for(db, email, acct) if p.get("property") else None,
            property_url=p.get("property") or "",
            ga4_service=_ga4_service_for(db, email, acct) if p.get("property_id") else None,
            ga4_property_id=p.get("property_id") or "",
            ads_service=(_ads_service_for(db, email, acct, required=False)
                         if p.get("customer_id") else None),
            ads_customer_id=p.get("customer_id") or "", ads_label=p.get("label") or "",
            brand_terms=p.get("brand_terms") or None, on_progress=_noop, **common)
    else:
        raise ValueError(f"unknown deck source {sched.source!r}")

    await _finalize_and_preview(doc_id, result["html"], _noop, artifacts=result.get("artifacts"))
    return {"document_id": doc_id, "label": result.get("domain") or sched.name}


async def run_due(now_utc: Optional[datetime] = None) -> int:
    """Scheduler entry point — fire everything that is due. Never raises; one bad schedule must not
    stop the others. Opens its own session because APScheduler has no request context."""
    db = SessionLocal()
    fired = 0
    try:
        for sched in db.query(DeckSchedule).filter(DeckSchedule.active.is_(True)).all():
            try:
                if not is_due(sched, now_utc):
                    continue
                # Claim the day BEFORE generating. A deck takes minutes; without claiming first, the
                # next 15-minute tick would start a second copy of the same report.
                sched.last_run_on = local_today(sched, now_utc)
                sched.last_run_at = datetime.utcnow()
                db.commit()
                logger.info("deck schedule %s (%s) firing", sched.id, sched.name)
                res = await run_schedule(db, sched)
                sched.last_status, sched.last_error = "ok", None
                sched.last_document_id = res["document_id"]
                fired += 1
            except Exception as e:
                logger.error("deck schedule %s failed: %s", getattr(sched, "id", "?"), str(e)[:300])
                try:
                    sched.last_status, sched.last_error = "error", str(e)[:500]
                except Exception:
                    pass
            finally:
                try:
                    db.commit()
                except Exception:
                    db.rollback()
    finally:
        db.close()
    return fired


def create(db, email: str, body: dict) -> DeckSchedule:
    sched = DeckSchedule(
        id=str(uuid.uuid4()), user_email=email, client_id=body.get("client_id"),
        name=(body.get("name") or "Scheduled deck").strip(),
        source=body.get("source") or "gsc", params=body.get("params") or {},
        days_of_month=sorted({int(d) for d in (body.get("days_of_month") or []) if 1 <= int(d) <= 31}),
        hour=int(body.get("hour", 5)), minute=int(body.get("minute", 0)),
        timezone=body.get("timezone") or "Asia/Bangkok",
        active=bool(body.get("active", True)),
    )
    db.add(sched)
    db.commit()
    return sched


def to_dict(sched: DeckSchedule, now_utc: Optional[datetime] = None) -> dict:
    return {
        "id": sched.id, "name": sched.name, "source": sched.source,
        "client_id": sched.client_id, "params": sched.params or {},
        "days_of_month": sched.days_of_month or [], "hour": sched.hour, "minute": sched.minute,
        "timezone": sched.timezone, "active": sched.active,
        "last_run_at": sched.last_run_at.isoformat() if sched.last_run_at else None,
        "last_status": sched.last_status, "last_error": sched.last_error,
        "last_document_id": sched.last_document_id,
        "next_run": next_run_iso(sched, now_utc),
    }


def next_run_iso(sched: DeckSchedule, now_utc: Optional[datetime] = None) -> Optional[str]:
    """When this will next fire, in its own timezone — shown in the UI so a schedule is never a
    guess. Scans forward a couple of months so a 29th/30th/31st schedule still resolves."""
    if not sched.active or not sched.days_of_month:
        return None
    from datetime import timedelta
    zone = _zone(sched.timezone)
    now = (now_utc or datetime.now(_tz.utc)).astimezone(zone)
    days = [int(d) for d in sched.days_of_month if str(d).isdigit()]
    for offset in range(0, 70):
        day = (now + timedelta(days=offset)).replace(
            hour=int(sched.hour or 0), minute=int(sched.minute or 0), second=0, microsecond=0)
        last_day = monthrange(day.year, day.month)[1]
        if not (day.day in days or (day.day == last_day and any(d > last_day for d in days))):
            continue
        if day <= now or sched.last_run_on == day.date():
            continue
        return day.isoformat()
    return None
