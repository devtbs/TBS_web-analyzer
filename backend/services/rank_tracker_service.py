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

from database import SessionLocal, TrackedKeyword, RankSnapshot, RankRunMarker, SerpSnapshot
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


# ── Keyword validation ──────────────────────────────────────────────────────────────────────
# Nothing used to be rejected except the empty string, so operators, sentence fragments and stray
# text all became tracked keywords — each costing one SerpAPI credit EVERY DAY and skewing the
# "how many rank" headline. These rules reject only what cannot be a real target; anything
# arguable is a warning so the caller can still add it deliberately.

# Google search operators: they always "rank" (or never do) and measure nothing.
_OPERATORS = ("site:", "inurl:", "intitle:", "allintitle:", "allinurl:", "cache:", "filetype:",
              "related:", "link:", "define:", "ext:", "imagesize:", "before:", "after:")

# Function words. A keyword made ENTIRELY of these ("how much", "of the") carries no topic.
_STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "if", "of", "at", "by", "for", "with", "about", "to",
    "from", "in", "on", "is", "are", "was", "were", "be", "been", "it", "this", "that", "these",
    "those", "how", "what", "when", "where", "who", "which", "why", "much", "many", "do", "does",
    "did", "can", "will", "would", "should", "my", "your", "our", "their", "not", "as", "so",
}

MIN_KEYWORD_LEN = 3
MAX_KEYWORD_LEN = 80


def validate_keyword(kw: str, gl: Optional[str] = None) -> tuple:
    """Classify one keyword. Returns (verdict, reason) where verdict is 'ok' | 'warn' | 'reject'.

    'reject' = cannot possibly be a useful tracked keyword. 'warn' = suspicious but plausibly
    intentional, so it is still added and the caller surfaces the note.
    """
    k = (kw or "").strip()
    low = k.lower()

    if not k:
        return "reject", "empty"
    if any(low.startswith(op) or f" {op}" in low for op in _OPERATORS):
        return "reject", "search operator — always ranks #1 and measures nothing"
    if len(k) < MIN_KEYWORD_LEN:
        return "reject", f"too short (under {MIN_KEYWORD_LEN} characters)"
    if len(k) > MAX_KEYWORD_LEN:
        return "reject", f"too long (over {MAX_KEYWORD_LEN} characters)"
    if low.startswith(("http://", "https://", "www.")) or "@" in low:
        return "reject", "looks like a URL or email, not a search term"

    words = [w for w in low.replace("-", " ").split() if w]
    if words and all(w in _STOPWORDS for w in words):
        return "reject", "only common function words — no topic to rank for"

    # Script mismatch: CJK text tracked in a Latin-script market is usually a paste accident, but
    # a Japanese-language page targeting Thailand is legitimate — warn, never reject.
    if (gl or "").lower() in ("th", "us", "gb", "au", "ca", "sg", "in", "de", "fr"):
        if any("\u3040" <= c <= "\u30ff" or "\u4e00" <= c <= "\u9fff" or "\uac00" <= c <= "\ud7af"
               for c in k):
            return "warn", f"non-Latin script tracked in the '{gl}' market — check this is intended"

    if len(words) == 1 and len(k) <= 5:
        return "warn", "very broad single word — a small site is unlikely to rank for it"

    return "ok", ""


def add_keywords(db, email: str, client_id: Optional[str], domain: str,
                 keywords: List[str], gl: Optional[str], location_id: Optional[int]) -> int:
    """Idempotent bulk insert with validation.

    Returns {added, skipped: [{keyword, reason}], warnings: [{keyword, reason}], duplicates}.
    Rejected keywords are never stored, so they cost no SerpAPI credits on the daily run; warned
    ones ARE stored but reported so the user can reconsider.
    """
    domain = (domain or "").lower().replace("www.", "").strip("/")
    if not domain:
        return {"added": 0, "skipped": [{"keyword": k, "reason": "no domain"} for k in keywords],
                "warnings": [], "duplicates": 0}
    added, skipped, warnings, duplicates = 0, [], [], 0
    for kw in keywords:
        kw = (kw or "").strip()
        verdict, reason = validate_keyword(kw, gl)
        if verdict == "reject":
            skipped.append({"keyword": kw, "reason": reason})
            continue
        if verdict == "warn":
            warnings.append({"keyword": kw, "reason": reason})
        row = TrackedKeyword(user_email=email, client_id=client_id, domain=domain,
                             keyword=kw, gl=gl, location_id=location_id, active=True)
        db.add(row)
        try:
            db.commit()
            added += 1
        except IntegrityError:
            db.rollback()   # already tracked (unique constraint) — skip
            duplicates += 1
    return {"added": added, "skipped": skipped, "warnings": warnings, "duplicates": duplicates}


def audit_tracked(db, email: str, client_id: Optional[str] = None, stale_days: int = 30) -> dict:
    """Review the EXISTING tracked set — the validator only guards new additions, and these lists
    were built before it existed. Flags two kinds of dead weight, each of which burns one SerpAPI
    credit per day for nothing:
      invalid — would be rejected if added today (operators, fragments, URLs)
      stale   — checked for at least `stale_days` and never once inside the top 100
    Read-only; deletion is an explicit separate call.
    """
    q = db.query(TrackedKeyword).filter(TrackedKeyword.user_email == email)
    if client_id:
        q = q.filter(TrackedKeyword.client_id == client_id)
    rows = q.all()
    cutoff = date.today() - timedelta(days=stale_days)
    invalid, stale = [], []
    for tk in rows:
        verdict, reason = validate_keyword(tk.keyword, tk.gl)
        if verdict == "reject":
            invalid.append({"id": tk.id, "keyword": tk.keyword, "reason": reason})
            continue
        snaps = (db.query(RankSnapshot)
                 .filter(RankSnapshot.tracked_keyword_id == tk.id,
                         RankSnapshot.checked_on >= cutoff).all())
        # Only call it stale once we have actually looked several times — a keyword added
        # yesterday has not had a fair chance to show up yet.
        if len(snaps) >= 3 and all(s.position is None for s in snaps):
            stale.append({"id": tk.id, "keyword": tk.keyword,
                          "reason": f"no top-100 position in {len(snaps)} checks over {stale_days} days"})
    wasted = len(invalid) + len(stale)
    return {"total": len(rows), "invalid": invalid, "stale": stale,
            "wasted_searches_per_day": wasted,
            "wasted_searches_per_month": wasted * 30}


def remove_keywords(db, email: str, ids: List[int]) -> int:
    """Bulk delete by id, scoped to the owner. Returns how many rows went."""
    if not ids:
        return 0
    rows = (db.query(TrackedKeyword)
            .filter(TrackedKeyword.user_email == email, TrackedKeyword.id.in_(ids)).all())
    for tk in rows:
        db.query(RankSnapshot).filter(RankSnapshot.tracked_keyword_id == tk.id).delete()
        db.query(SerpSnapshot).filter(SerpSnapshot.tracked_keyword_id == tk.id).delete()
        db.delete(tk)
    db.commit()
    return len(rows)


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

    # Keep the rest of the page too — same API call, no extra spend. Powers SERP competitors,
    # share of voice, SERP features and the AI Overview tracker.
    if res.get("organic") or res.get("ai_overview"):
        ss = (db.query(SerpSnapshot)
              .filter(SerpSnapshot.tracked_keyword_id == tk.id, SerpSnapshot.checked_on == on).first())
        if ss:
            ss.organic, ss.features, ss.ai_overview = (
                res.get("organic"), res.get("features"), res.get("ai_overview"))
        else:
            db.add(SerpSnapshot(tracked_keyword_id=tk.id, checked_on=on,
                                organic=res.get("organic"), features=res.get("features"),
                                ai_overview=res.get("ai_overview")))
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
