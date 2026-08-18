"""Self-hosted keyword rank tracker routes.

Replaces the former SE Ranking API integration: positions are collected with our own SerpAPI (see
services/rank_tracker_service.py) and stored per day, so no third-party rank-tracking subscription is
needed. The daily collector runs from the APScheduler job in main.py; these endpoints manage the
tracked keyword set and read history back for the UI.
"""
import logging

from fastapi import APIRouter, Depends, Body, HTTPException
from sqlalchemy.orm import Session

from models.schemas import UserInfo
from auth.auth import get_current_user
from database import get_db, TrackedKeyword
from services import rank_tracker_service as rt

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/ranktracker/keywords")
async def list_keywords(client_id: str = None,
                        current_user: UserInfo = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    """Tracked keywords with latest position, delta, best and a 30-reading sparkline."""
    return {"keywords": rt.list_tracked(db, current_user.email, client_id)}


@router.post("/api/ranktracker/keywords")
async def add_keywords(body: dict = Body(...),
                       current_user: UserInfo = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    """Add keywords (bulk) to track for a site/client. Idempotent."""
    keywords = [k for k in (body.get("keywords") or []) if k and k.strip()]
    domain = (body.get("domain") or "").strip()
    if not keywords or not domain:
        raise HTTPException(status_code=400, detail="domain and keywords are required")
    added = rt.add_keywords(db, current_user.email, body.get("client_id"), domain,
                            keywords, body.get("gl"), body.get("location_id"))
    return {"added": added, "requested": len(keywords)}


@router.delete("/api/ranktracker/keywords/{kw_id}")
async def delete_keyword(kw_id: int,
                         current_user: UserInfo = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    if not rt.remove_keyword(db, current_user.email, kw_id):
        raise HTTPException(status_code=404, detail="Keyword not found")
    return {"deleted": True}


@router.get("/api/ranktracker/keywords/{kw_id}/history")
async def keyword_history(kw_id: int, days: int = 90,
                          current_user: UserInfo = Depends(get_current_user),
                          db: Session = Depends(get_db)):
    data = rt.history(db, current_user.email, kw_id, days)
    if data is None:
        raise HTTPException(status_code=404, detail="Keyword not found")
    return data


@router.post("/api/ranktracker/refresh")
async def refresh_now(client_id: str = None,
                      current_user: UserInfo = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    """On-demand check now (spends SerpAPI credits) — writes today's snapshots for the user's tracked
    keywords, optionally scoped to one client."""
    q = db.query(TrackedKeyword).filter(TrackedKeyword.user_email == current_user.email,
                                        TrackedKeyword.active.is_(True))
    if client_id:
        q = q.filter(TrackedKeyword.client_id == client_id)
    kws = q.all()
    # Spend guard: 1 SerpAPI search per keyword — don't run if the balance/cap can't cover it.
    from services.serp_service import serp_service
    from config import settings
    acct = await serp_service.get_account()
    left = acct.get("left")
    if left is not None and len(kws) > left:
        raise HTTPException(status_code=402,
                            detail=f"Not enough SerpAPI balance: refresh needs {len(kws)} searches, "
                                   f"{left} remain this month.")
    if settings.SERPAPI_MONTHLY_CAP and acct.get("used") is not None \
            and acct["used"] + len(kws) > settings.SERPAPI_MONTHLY_CAP:
        raise HTTPException(status_code=402, detail="Monthly SerpAPI cap reached — refresh blocked.")
    checked = await rt.collect(db, kws)
    return {"checked": checked}
