"""Keyword-clustering job engine — the Keyword-Insights-style tool, done with our own SerpAPI.

A run is persisted in the ClusteringRun table (which doubles as the async job store): the router
creates a `queued` row and fires `run_job` as a background task; this module flips it to `running`,
fetches SERPs + clusters (services.keyword_clustering), enriches each cluster with AI search-intent +
a page brief, flags whether the site already ranks for the cluster (free GSC cross-reference), then
writes the result and marks it `done`. The frontend polls the row.
"""
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from database import SessionLocal, ClusteringRun

logger = logging.getLogger(__name__)

STALE_MINUTES = 20     # a queued/running job untouched this long is treated as interrupted

RUN_CAP = 600          # hard ceiling on keywords per run (= SerpAPI credits) — cost guardrail
ENRICH_CAP = 60        # only AI-enrich / GSC-check this many top clusters (by volume)
DISCOVER_SEED_CAP = 12     # how many input keywords we expand via Mangools (each = 1 Mangools lookup)
DISCOVER_POOL_CAP = 400    # cap on newly-discovered keywords kept (by volume) before clustering


def parse_keywords(raw: List) -> List[Dict]:
    """Normalize input into [{keyword, volume}]. Accepts strings or {keyword, volume} dicts; dedupes
    case-insensitively keeping the highest volume seen."""
    by = {}
    for item in raw or []:
        if isinstance(item, str):
            kw, vol = item.strip(), None
        elif isinstance(item, dict):
            kw, vol = (item.get("keyword") or "").strip(), item.get("volume")
        else:
            continue
        if not kw:
            continue
        k = kw.lower()
        cur = by.get(k)
        if cur is None or (vol or 0) > (cur.get("volume") or 0):
            by[k] = {"keyword": kw, "volume": vol}
    return list(by.values())


async def _discover(seeds: List[Dict], *, domain: str, location_id, gl: str,
                    exclude_ranked: bool, gsc_property, account_id, db, email) -> List[Dict]:
    """Expand the seed keywords into NEW territory before clustering: Mangools related-keywords for
    the top seeds + competitor-keywords for the site's domain, minus keywords the site already ranks
    for (GSC). Returns the merged [{keyword, volume, kd}] pool (seeds + discovered), volume-ranked."""
    from services.mangools_service import get_related_keywords, get_competitor_keywords

    pool: Dict[str, Dict] = {s["keyword"].lower(): s for s in seeds}

    def _merge(kw):
        k = (kw.get("keyword") or "").strip().lower()
        if not k:
            return
        cur = pool.get(k)
        if cur is None or (kw.get("volume") or 0) > (cur.get("volume") or 0):
            pool[k] = {"keyword": kw.get("keyword"), "volume": kw.get("volume"), "kd": kw.get("kd")}

    # Expand the highest-signal seeds (cap the number of Mangools lookups for cost).
    for s in seeds[:DISCOVER_SEED_CAP]:
        for kw in await get_related_keywords(s["keyword"], location_id=location_id):
            _merge(kw)
    if domain:
        for kw in await get_competitor_keywords(domain, location_id=location_id):
            _merge(kw)

    rows = list(pool.values())

    # Drop what the site already ranks well for, so the run surfaces NEW opportunities.
    if exclude_ranked and gsc_property:
        try:
            from api.routers._shared import _gsc_service_for
            svc = _gsc_service_for(db, email, account_id)
            gsc_rows = await svc.get_top_queries(gsc_property, days=90)
            won = {(r.get("query") or "").lower() for r in (gsc_rows or [])
                   if r.get("position") is not None and r["position"] <= 10}
            seed_set = {s["keyword"].lower() for s in seeds}
            # keep seeds even if ranked; only filter freshly-discovered ranked terms
            rows = [r for r in rows
                    if r["keyword"].lower() in seed_set or r["keyword"].lower() not in won]
        except Exception as e:
            logger.warning("discover exclude_ranked failed: %s", str(e)[:120])

    rows.sort(key=lambda r: (r.get("volume") or 0), reverse=True)
    # Keep all seeds + the top discovered, bounded so clustering cost stays in check.
    seed_set = {s["keyword"].lower() for s in seeds}
    kept_seeds = [r for r in rows if r["keyword"].lower() in seed_set]
    discovered = [r for r in rows if r["keyword"].lower() not in seed_set][:DISCOVER_POOL_CAP]
    return (kept_seeds + discovered)


async def _enrich_intent_and_brief(clusters: List[Dict]) -> None:
    """AI pass: for the top clusters, classify search intent and write a one-line page brief.
    Mutates each cluster in place with `intent`, `page_type`, `title`, `angle`. Best-effort."""
    from services.ai_service import ai_service
    targets = clusters[:ENRICH_CAP]
    if not targets:
        return
    payload = [{"pillar": c["pillar"], "sample": [k["keyword"] for k in c["keywords"][:6]]}
               for c in targets]
    prompt = (
        "For each keyword cluster below, decide the dominant SEARCH INTENT and propose the page to "
        "build. Intent is one of: informational, commercial, transactional, navigational.\n"
        "Return JSON {\"clusters\": [{\"pillar\": <same pillar>, \"intent\": <one word>, "
        "\"page_type\": <e.g. Blog post, Category, Product, Landing, Guide, Comparison>, "
        "\"title\": <a compelling H1, <=70 chars>, \"angle\": <one sentence on what the page should "
        "cover>}]} — one object per cluster, keep the pillar text identical.\n\n"
        f"CLUSTERS: {json.dumps(payload, ensure_ascii=False)[:8000]}"
    )
    try:
        res = await ai_service.extract_json(prompt, "You are an SEO content strategist. Return only JSON.",
                                            use_deepseek=True)
        rows = res.get("clusters") if isinstance(res, dict) else (res if isinstance(res, list) else [])
        by = {(r.get("pillar") or "").strip().lower(): r for r in (rows or []) if isinstance(r, dict)}
        for c in targets:
            r = by.get(c["pillar"].strip().lower())
            if r:
                c["intent"] = (r.get("intent") or "").lower() or None
                c["page_type"] = r.get("page_type")
                c["title"] = r.get("title")
                c["angle"] = r.get("angle")
    except Exception as e:
        logger.warning("cluster enrich failed: %s", str(e)[:120])


async def _flag_gsc_coverage(clusters: List[Dict], *, db, email, gsc_property, account_id) -> None:
    """Cross-reference each cluster's keywords against what the site already ranks for in GSC (free).
    Sets `gsc_status` = 'ranking' (any member in top 20), 'weak' (ranks but >20), or 'gap' (not seen).
    This is the edge over Keyword Insights, which has no access to the client's Search Console."""
    if not gsc_property:
        return
    try:
        from api.routers._shared import _gsc_service_for
        svc = _gsc_service_for(db, email, account_id)
        rows = await svc.get_top_queries(gsc_property, days=90)
        pos = {(r.get("query") or "").lower(): r.get("position") for r in (rows or [])}
    except Exception as e:
        logger.warning("cluster GSC flag failed: %s", str(e)[:120])
        return
    for c in clusters[:ENRICH_CAP]:
        best = None
        for k in c["keywords"]:
            p = pos.get((k["keyword"] or "").lower())
            if p is not None and (best is None or p < best):
                best = p
        c["gsc_status"] = "gap" if best is None else ("ranking" if best <= 20 else "weak")
        c["gsc_best_position"] = best


async def run_job(run_id: str) -> None:
    """Background entrypoint — owns its own DB session (runs outside the request)."""
    from services.keyword_clustering import cluster_by_serp
    db = SessionLocal()
    try:
        run = db.query(ClusteringRun).filter(ClusteringRun.id == run_id).first()
        if not run:
            return
        params = run.params or {}
        keywords = parse_keywords(params.get("keywords") or [])
        run.status = "running"
        db.commit()

        # DISCOVER: expand the seeds into new keyword territory (related + competitor keywords, minus
        # already-ranked) BEFORE clustering, so one run both finds and groups new opportunities.
        if params.get("discover"):
            keywords = await _discover(
                keywords, domain=run.domain or "", location_id=run.location_id, gl=run.gl or "th",
                exclude_ranked=bool(params.get("exclude_ranked")),
                gsc_property=params.get("gsc_property"), account_id=params.get("account_id"),
                db=db, email=run.user_email)

        keywords = keywords[:RUN_CAP]
        run.progress = {"done": 0, "total": len(keywords)}
        db.commit()

        # Attach REAL search volume + KD from Mangools (one batched, cached call). GSC-imported and
        # pasted keywords arrive with no volume, which is why totals would otherwise all read 0/mo.
        try:
            from services.mangools_service import get_keyword_metrics
            metrics = await get_keyword_metrics([k["keyword"] for k in keywords],
                                                location_id=run.location_id)
            for k in keywords:
                m = metrics.get(k["keyword"].lower())
                if m:
                    if m.get("volume") is not None:
                        k["volume"] = m["volume"]
                    if m.get("kd") is not None:
                        k["kd"] = m["kd"]
        except Exception as e:
            logger.warning("clustering volume enrich failed: %s", str(e)[:120])

        async def _progress(done, total):
            run.progress = {"done": done, "total": total}
            run.updated_at = datetime.utcnow()
            db.commit()

        clusters = await cluster_by_serp(
            keywords, location=run.gl or "th",
            min_overlap=int(params.get("min_overlap") or 3),
            top_n=int(params.get("top_n") or 10),
            mode=params.get("mode") or "hard",
            max_keywords=RUN_CAP, progress=_progress,
        )
        await _enrich_intent_and_brief(clusters)
        await _flag_gsc_coverage(clusters, db=db, email=run.user_email,
                                 gsc_property=params.get("gsc_property"),
                                 account_id=params.get("account_id"))
        run.result = clusters
        run.status = "done"
        run.progress = {"done": len(keywords), "total": len(keywords)}
        db.commit()
        logger.info("clustering %s done: %d clusters from %d keywords",
                    run_id, len(clusters), len(keywords))
    except Exception as e:
        logger.exception("clustering job %s failed", run_id)
        try:
            run = db.query(ClusteringRun).filter(ClusteringRun.id == run_id).first()
            if run:
                run.status = "error"
                run.error = str(e)[:500]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


def sweep_stale(db, email: Optional[str] = None) -> int:
    """Recover interrupted jobs: any queued/running run whose worker died (deploy/crash) or that hung
    would otherwise show 'running' forever. Mark those older than STALE_MINUTES as error. Called
    lazily on list/get so the UI never shows a permanently-stuck job."""
    cutoff = datetime.utcnow() - timedelta(minutes=STALE_MINUTES)
    q = db.query(ClusteringRun).filter(ClusteringRun.status.in_(["queued", "running"]),
                                       ClusteringRun.updated_at < cutoff)
    if email:
        q = q.filter(ClusteringRun.user_email == email)
    n = 0
    for r in q.all():
        r.status = "error"
        r.error = "Interrupted — the job stopped before finishing (server restart or timeout). Re-run it."
        n += 1
    if n:
        db.commit()
    return n


def fail_orphaned_on_startup() -> None:
    """On boot, any job still 'queued'/'running' is orphaned — its background task didn't survive the
    restart. Fail them immediately (not just after STALE_MINUTES) so users can re-run right away."""
    db = SessionLocal()
    try:
        rows = db.query(ClusteringRun).filter(ClusteringRun.status.in_(["queued", "running"])).all()
        for r in rows:
            r.status = "error"
            r.error = "Interrupted by a server restart. Re-run it."
        if rows:
            db.commit()
            logger.info("clustering: failed %d orphaned job(s) on startup", len(rows))
    except Exception as e:
        logger.warning("clustering startup sweep failed: %s", str(e)[:120])
    finally:
        db.close()


def summarize(run: ClusteringRun, *, include_result: bool = False) -> Dict:
    params = run.params or {}
    out = {
        "id": run.id, "name": run.name, "domain": run.domain, "client_id": run.client_id,
        "gl": run.gl, "status": run.status, "progress": run.progress or {},
        "cluster_count": len(run.result or []) if run.result else 0,
        "keyword_count": params.get("keyword_count"),
        "params": {k: params.get(k) for k in ("min_overlap", "top_n", "mode")},
        "error": run.error,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "updated_at": run.updated_at.isoformat() if run.updated_at else None,
    }
    if include_result:
        out["clusters"] = run.result or []
    return out
