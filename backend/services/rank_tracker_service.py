"""Self-hosted keyword rank tracker — replaces the SE Ranking dependency.

Stores a daily position reading per tracked keyword using the SerpAPI we already pay for, and reads
history back for the UI. The daily collector is claimed by a single worker (RankRunMarker) so
gunicorn's -w 4 doesn't quadruple SerpAPI spend.
"""
import asyncio
import logging
from datetime import date, timedelta
from typing import List, Optional

from sqlalchemy.exc import IntegrityError

from database import SessionLocal, TrackedKeyword, RankSnapshot, RankRunMarker
from services.serp_service import serp_service

logger = logging.getLogger(__name__)

# Cap concurrent SerpAPI calls during a collection run so a big keyword set doesn't burst. Created
# lazily PER EVENT LOOP — a module-level asyncio.Semaphore binds to the first loop that uses it and
# breaks if a second loop ever touches it; one per loop stays correct and loop-safe.
import weakref
_SEM_BY_LOOP: "weakref.WeakKeyDictionary" = weakref.WeakKeyDictionary()
_SEM_LIMIT = 5


def _sem() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    s = _SEM_BY_LOOP.get(loop)
    if s is None:
        s = asyncio.Semaphore(_SEM_LIMIT)
        _SEM_BY_LOOP[loop] = s
    return s


def add_keywords(db, email: str, client_id: Optional[str], domain: str,
                 keywords: List[str], gl: Optional[str], location_id: Optional[int]) -> int:
    """Idempotent bulk insert. Returns how many new keywords were added."""
    domain = (domain or "").lower().replace("www.", "").strip("/")
    added = 0
    for kw in keywords:
        kw = (kw or "").strip()
        if not kw or not domain:
            continue
        row = TrackedKeyword(user_email=email, client_id=client_id, domain=domain,
                             keyword=kw, gl=gl, location_id=location_id, active=True)
        db.add(row)
        try:
            db.commit()
            added += 1
        except IntegrityError:
            db.rollback()   # already tracked (unique constraint) — skip
    return added


def remove_keyword(db, email: str, kw_id: int) -> bool:
    row = (db.query(TrackedKeyword)
           .filter(TrackedKeyword.id == kw_id, TrackedKeyword.user_email == email).first())
    if not row:
        return False
    # Drop its snapshots too so history doesn't linger for a removed keyword.
    db.query(RankSnapshot).filter(RankSnapshot.tracked_keyword_id == kw_id).delete()
    db.delete(row)
    db.commit()
    return True


def list_tracked(db, email: str, client_id: Optional[str] = None) -> List[dict]:
    """Each tracked keyword + latest position, delta vs the previous check, best-ever, and a
    last-30-reading sparkline (oldest→newest)."""
    q = db.query(TrackedKeyword).filter(TrackedKeyword.user_email == email)
    if client_id:
        q = q.filter(TrackedKeyword.client_id == client_id)
    out = []
    for tk in q.order_by(TrackedKeyword.created_at.desc()).all():
        snaps = (db.query(RankSnapshot)
                 .filter(RankSnapshot.tracked_keyword_id == tk.id)
                 .order_by(RankSnapshot.checked_on.desc()).limit(30).all())
        latest = snaps[0] if snaps else None
        prev = snaps[1] if len(snaps) > 1 else None
        positions = [s.position for s in snaps if s.position is not None]
        best = min(positions) if positions else None
        delta = None
        if latest and prev and latest.position is not None and prev.position is not None:
            delta = prev.position - latest.position   # +ve = improved (moved up)
        out.append({
            "id": tk.id, "keyword": tk.keyword, "domain": tk.domain,
            "client_id": tk.client_id, "gl": tk.gl, "location_id": tk.location_id,
            "position": latest.position if latest else None,
            "url": latest.url if latest else None,
            "checked_on": latest.checked_on.isoformat() if latest else None,
            "delta": delta, "best": best,
            "sparkline": [s.position for s in reversed(snaps)],
        })
    return out


def history(db, email: str, kw_id: int, days: int = 90) -> Optional[dict]:
    tk = (db.query(TrackedKeyword)
          .filter(TrackedKeyword.id == kw_id, TrackedKeyword.user_email == email).first())
    if not tk:
        return None
    since = date.today() - timedelta(days=days)
    snaps = (db.query(RankSnapshot)
             .filter(RankSnapshot.tracked_keyword_id == kw_id, RankSnapshot.checked_on >= since)
             .order_by(RankSnapshot.checked_on.asc()).all())
    return {
        "id": tk.id, "keyword": tk.keyword, "domain": tk.domain,
        "series": [{"date": s.checked_on.isoformat(), "position": s.position, "url": s.url}
                   for s in snaps],
    }


async def _check_one(db, tk: TrackedKeyword, on: date) -> None:
    async with _sem():
        res = await serp_service.get_rank(tk.keyword, tk.domain, location=tk.gl)
    # Upsert today's snapshot (unique on tracked_keyword_id + checked_on).
    snap = (db.query(RankSnapshot)
            .filter(RankSnapshot.tracked_keyword_id == tk.id, RankSnapshot.checked_on == on).first())
    if snap:
        snap.position, snap.url = res.get("position"), res.get("url")
    else:
        db.add(RankSnapshot(tracked_keyword_id=tk.id, checked_on=on,
                            position=res.get("position"), url=res.get("url")))
    db.commit()


async def collect(db, keywords: List[TrackedKeyword], on: Optional[date] = None) -> int:
    """Check a specific list of keywords now (used by the manual refresh). Returns count checked."""
    on = on or date.today()
    checked = 0
    for tk in keywords:
        try:
            await _check_one(db, tk, on)
            checked += 1
        except Exception as e:
            logger.warning("rank check failed for '%s': %s", tk.keyword, str(e)[:120])
    return checked


async def collect_due() -> None:
    """Daily scheduler entrypoint. Claims today's run marker (single worker wins), then checks every
    active tracked keyword. Opens its own DB session — it runs outside a request."""
    db = SessionLocal()
    try:
        today = date.today()
        # Multi-worker guard: whoever inserts today's marker first does the run; the rest bail.
        db.add(RankRunMarker(run_on=today))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            logger.info("rank collect: today's run already claimed — skipping")
            return
        kws = db.query(TrackedKeyword).filter(TrackedKeyword.active.is_(True)).all()
        if not kws:
            return
        logger.info("rank collect: checking %d keywords", len(kws))
        n = await collect(db, kws, today)
        logger.info("rank collect: done, %d checked", n)
    except Exception as e:
        logger.warning("rank collect_due failed: %s", str(e)[:150])
    finally:
        db.close()
