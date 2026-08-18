"""Keyword-clustering endpoints — a Keyword-Insights-style SERP-overlap clustering tool.

Clustering is a long, credit-spending job (1 SerpAPI search per keyword), so it runs asynchronously:
POST creates a persisted ClusteringRun and fires a background task; the client polls GET for progress
and the final result. `/estimate` lets the UI show cost before the user commits.
"""
import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, Body, HTTPException
from sqlalchemy.orm import Session

from models.schemas import UserInfo
from auth.auth import get_current_user
from database import get_db, ClusteringRun, Client
from api.routers._shared import get_account_id
from services import clustering_service as cs

logger = logging.getLogger(__name__)
router = APIRouter()


def _resolve_gsc(db, email, client_id, domain):
    """Find the GSC property + account backing this run, so the GSC gap-flag can query it."""
    c = None
    if client_id:
        c = db.query(Client).filter(Client.id == client_id, Client.user_email == email).first()
    if c is None and domain:
        d = (domain or "").lower().replace("www.", "").strip("/")
        c = (db.query(Client).filter(Client.user_email == email, Client.domain == d,
                                     Client.gsc_property.isnot(None)).first())
    if c:
        return c.gsc_property, c.google_account_id, c.id
    return None, None, client_id


async def _serp_budget_guard(cost: int):
    """Block a run that would exceed the live SerpAPI balance or the optional monthly cap. Raises
    HTTPException(402) with a clear message; passes silently when balance is unknown (fail-open, since
    the per-run estimate + cache already bound spend)."""
    from services.serp_service import serp_service
    from config import settings
    acct = await serp_service.get_account()
    left = acct.get("left")
    if left is not None and cost > left:
        raise HTTPException(status_code=402,
                            detail=f"Not enough SerpAPI balance: this run needs up to {cost} searches "
                                   f"but only {left} remain this month.")
    cap = settings.SERPAPI_MONTHLY_CAP
    used = acct.get("used")
    if cap and used is not None and (used + cost) > cap:
        raise HTTPException(status_code=402,
                            detail=f"Monthly SerpAPI cap reached: {used} used + {cost} needed exceeds "
                                   f"the {cap} cap. Raise SERPAPI_MONTHLY_CAP or wait for reset.")


@router.post("/api/clustering/estimate")
async def estimate(body: dict = Body(...), current_user: UserInfo = Depends(get_current_user)):
    kws = cs.parse_keywords(body.get("keywords") or [])
    n = min(len(kws), cs.RUN_CAP)
    # Discover mode expands the set before clustering, so cost can rise to the cap.
    cost = cs.RUN_CAP if body.get("discover") else n
    from services.serp_service import serp_service
    acct = await serp_service.get_account()
    return {"keyword_count": n, "over_cap": len(kws) > cs.RUN_CAP, "cap": cs.RUN_CAP,
            "serp_cost": cost, "serp_left": acct.get("left")}


@router.post("/api/clustering")
async def create_run(body: dict = Body(...),
                     current_user: UserInfo = Depends(get_current_user),
                     db: Session = Depends(get_db),
                     account_id=Depends(get_account_id)):
    """Start a clustering job. Returns the run immediately (status=queued); poll GET for the result."""
    keywords = cs.parse_keywords(body.get("keywords") or [])
    if len(keywords) < 2:
        raise HTTPException(status_code=400, detail="Provide at least 2 keywords")
    keywords = keywords[:cs.RUN_CAP]
    # Spend guard: discover mode can expand to the cap, so bound the check by that.
    await _serp_budget_guard(cs.RUN_CAP if body.get("discover") else len(keywords))
    domain = (body.get("domain") or "").strip()
    gsc_property, acct, client_id = _resolve_gsc(db, current_user.email, body.get("client_id"), domain)

    run = ClusteringRun(
        id=str(uuid.uuid4()), user_email=current_user.email, client_id=client_id,
        name=(body.get("name") or domain or f"{len(keywords)} keywords")[:200],
        domain=domain or None, gl=(body.get("gl") or "th"), location_id=body.get("location_id"),
        status="queued", progress={"done": 0, "total": len(keywords)},
        params={
            "keywords": keywords, "keyword_count": len(keywords),
            "min_overlap": int(body.get("min_overlap") or 3),
            "top_n": int(body.get("top_n") or 10),
            "mode": body.get("mode") or "hard",
            "discover": bool(body.get("discover")),
            "exclude_ranked": bool(body.get("exclude_ranked", True)),
            "gsc_property": gsc_property, "account_id": acct or account_id,
        },
    )
    db.add(run)
    db.commit()
    # Fire-and-forget: the job opens its own DB session and updates this row as it runs.
    asyncio.create_task(cs.run_job(run.id))
    return cs.summarize(run)


@router.get("/api/clustering")
async def list_runs(client_id: str = None,
                    current_user: UserInfo = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    cs.sweep_stale(db, current_user.email)   # recover any interrupted jobs before listing
    q = db.query(ClusteringRun).filter(ClusteringRun.user_email == current_user.email)
    if client_id:
        q = q.filter(ClusteringRun.client_id == client_id)
    runs = q.order_by(ClusteringRun.created_at.desc()).limit(50).all()
    return {"runs": [cs.summarize(r) for r in runs]}


@router.get("/api/clustering/{run_id}")
async def get_run(run_id: str,
                  current_user: UserInfo = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    cs.sweep_stale(db, current_user.email)   # recover this job if its worker died mid-run
    run = (db.query(ClusteringRun)
           .filter(ClusteringRun.id == run_id, ClusteringRun.user_email == current_user.email).first())
    if not run:
        raise HTTPException(status_code=404, detail="Clustering run not found")
    return cs.summarize(run, include_result=True)


@router.delete("/api/clustering/{run_id}")
async def delete_run(run_id: str,
                     current_user: UserInfo = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    (db.query(ClusteringRun)
     .filter(ClusteringRun.id == run_id, ClusteringRun.user_email == current_user.email).delete())
    db.commit()
    return {"deleted": True}
