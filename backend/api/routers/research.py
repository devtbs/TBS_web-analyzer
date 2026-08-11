"""Interactive keyword-research endpoints powering the New Analysis wizard.

Thin wrappers over the engines built for the topical map: SerpAPI (live SERP preview + competitor
discovery), Mangools KWFinder (seed + competitor keywords with volume/KD), and SERP-overlap
clustering. The wizard drives these step by step; the final selection is sent to /api/analyze to
build the full topical map from the user's picks.
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, Body
from sqlalchemy.orm import Session

from auth.auth import get_current_user
from database import get_db
from models.schemas import UserInfo
from api.routers._shared import get_account_id

logger = logging.getLogger(__name__)
router = APIRouter()


def _serp_gl(domain: Optional[str]) -> str:
    from services.serp_service import serp_service
    return serp_service._detect_location_from_domain(domain) if domain else "th"


def _loc_id(domain: Optional[str], location_id: Optional[int]) -> int:
    if location_id:
        return location_id
    from services.mangools_service import location_for_domain, _DEFAULT_LOCATION
    return location_for_domain(domain) if domain else _DEFAULT_LOCATION


@router.post("/api/research/serp")
async def research_serp(body: dict = Body(...), current_user: UserInfo = Depends(get_current_user)):
    """Step 1 — live Google SERP for a seed query + the top related queries with real volume."""
    from services.serp_service import serp_service
    from services.mangools_service import get_related_keywords

    query = (body.get("query") or "").strip()
    if not query:
        return {"serp": None, "top_queries": []}
    domain = body.get("domain")
    serp = await serp_service.get_serp_preview(query, location=_serp_gl(domain))
    related = await get_related_keywords(query, location_id=_loc_id(domain, body.get("location_id")))
    top_queries = sorted(related, key=lambda x: (x.get("volume") or 0), reverse=True)[:10]
    return {"serp": serp, "top_queries": top_queries}


@router.post("/api/research/keywords")
async def research_keywords(body: dict = Body(...),
                            current_user: UserInfo = Depends(get_current_user),
                            db: Session = Depends(get_db),
                            account_id=Depends(get_account_id)):
    """Step 3 — merge Mangools related-keywords(seed) + competitor-keywords(each selected domain)."""
    from services.mangools_service import get_related_keywords, get_competitor_keywords

    seed = (body.get("seed") or "").strip()
    domains: List[str] = [d for d in (body.get("domains") or []) if d and d.strip()][:8]
    loc = _loc_id(body.get("domain"), body.get("location_id"))

    candidates = {}

    def _merge(kw):
        k = (kw.get("keyword") or "").lower()
        if not k:
            return
        cur = candidates.get(k)
        if cur is None or (kw.get("volume") or 0) > (cur.get("volume") or 0):
            # keep a KD if either source has one
            if cur and cur.get("kd") is not None and kw.get("kd") is None:
                kw = {**kw, "kd": cur["kd"]}
            candidates[k] = kw

    if seed:
        for kw in await get_related_keywords(seed, location_id=loc):
            _merge(kw)
    for d in domains:
        for kw in await get_competitor_keywords(d, location_id=loc):
            _merge(kw)

    rows = list(candidates.values())

    # Optional: hide keywords the client already ranks well for (GSC position <= 10).
    if body.get("exclude_ranked") and body.get("gsc_property"):
        try:
            from api.routers._shared import _gsc_service_for
            svc = _gsc_service_for(db, current_user.email, account_id)
            gsc_rows = await svc.get_top_queries(body["gsc_property"], days=90)
            won = {(r.get("query") or "").lower() for r in (gsc_rows or [])
                   if r.get("position") is not None and r["position"] <= 10}
            rows = [r for r in rows if (r.get("keyword") or "").lower() not in won]
        except Exception as e:
            logger.warning("research exclude_ranked failed: %s", str(e)[:120])

    rows.sort(key=lambda x: (x.get("volume") or 0), reverse=True)
    return {"keywords": rows[:200]}


@router.post("/api/research/cluster")
async def research_cluster(body: dict = Body(...), current_user: UserInfo = Depends(get_current_user)):
    """Step 4 — SERP-overlap cluster the selected keywords (Keyword-Insights technique, our SerpAPI)."""
    from services.keyword_clustering import cluster_by_serp

    kws = [{"keyword": k.get("keyword"), "volume": k.get("volume") or k.get("avg_monthly_searches"),
            "kd": k.get("kd")}
           for k in (body.get("keywords") or []) if k.get("keyword")]
    if not kws:
        return {"clusters": []}
    clusters = await cluster_by_serp(kws, location=_serp_gl(body.get("domain")))
    return {"clusters": clusters}
