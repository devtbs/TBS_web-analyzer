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


def _gl(body: dict) -> str:
    """SERP country code — explicit `gl` from the wizard wins, else guess from the domain TLD."""
    return (body.get("gl") or "").strip().lower() or _serp_gl(body.get("domain"))


def _loc_id(domain: Optional[str], location_id: Optional[int]) -> int:
    if location_id:
        return location_id
    from services.mangools_service import location_for_domain, _DEFAULT_LOCATION
    return location_for_domain(domain) if domain else _DEFAULT_LOCATION


async def _filter_relevant(keywords: List[str], seeds: List[str], domain: str) -> Optional[set]:
    """Competitor-keywords return a domain's WHOLE footprint (brands, off-topic pages). Keep only the
    keywords topically relevant to the site's subject (defined by the AI seeds). Returns a lowercase
    keep-set, or None to keep everything (LLM unavailable) — best-effort."""
    import json
    from services.ai_service import ai_service
    topic = ", ".join([s for s in seeds if s]) or domain
    prompt = (
        f"The website's CORE SUBJECT is: {topic} (domain: {domain}).\n"
        "From the KEYWORDS list, return ONLY keywords that a person specifically interested in THIS "
        "core subject would search. Be STRICT:\n"
        "- DROP keywords about other industries, general food/cooking/baking, brand names, "
        "restaurants, and anything only loosely related.\n"
        "- A tangential term (e.g. an ingredient or pairing) is relevant ONLY if it is directly tied "
        "to the core subject; generic terms like 'vegan', 'pastries', 'baguette', 'cooking class' "
        "are NOT relevant unless the core subject IS that industry.\n"
        "- When unsure, DROP it.\n"
        "Keep the keyword strings exactly as given.\n"
        'Return JSON: {"keep": ["...", "..."]}\n\n'
        f"KEYWORDS: {json.dumps(keywords, ensure_ascii=False)}"
    )
    try:
        res = await ai_service.extract_json(prompt, "You are an SEO relevance filter. Return only JSON.",
                                            use_deepseek=True)
        keep = res.get("keep") if isinstance(res, dict) else (res if isinstance(res, list) else None)
        if keep is None:
            return None
        return {k.strip().lower() for k in keep if isinstance(k, str) and k.strip()}
    except Exception as e:
        logger.warning("relevance filter failed: %s", str(e)[:120])
        return None


@router.post("/api/research/suggest-queries")
async def research_suggest_queries(body: dict = Body(...),
                                   current_user: UserInfo = Depends(get_current_user)):
    """Step 1 — analyze the selected site and let the AI propose 10 search queries grounded in the
    real business (avoids the generic-seed problem, e.g. 'wine' → winehq.org)."""
    from urllib.parse import urlparse
    from services.scraper import scraper
    from services.sitemap_service import sitemap_service
    from services.ai_service import ai_service
    import json

    url = (body.get("url") or "").strip()
    if not url:
        return {"queries": [], "site": None}
    if not url.startswith("http"):
        url = "https://" + url
    domain = urlparse(url).netloc.replace("www.", "") or url

    # Light scrape: homepage + a few priority pages (fast — this isn't the full analysis).
    pages = []
    try:
        extra = await sitemap_service.get_priority_pages(url, max_pages=5)
        targets = [url] + [u for u in (extra or []) if u != url][:5]
        scraped = await scraper.scrape_multiple(targets)
        for p in scraped or []:
            if p.get("status") != "success":
                continue
            h = p.get("headings") or {}
            pages.append({"title": p.get("title", ""), "h1": (h.get("h1") or [])[:3],
                          "h2": (h.get("h2") or [])[:8],
                          "text": (p.get("markdown") or p.get("text_content") or "")[:800]})
    except Exception as e:
        logger.warning("suggest-queries scrape failed for %s: %s", domain, str(e)[:120])

    prompt = (
        "From this website, suggest 10 short SEARCH QUERIES (2-5 words) that represent its core "
        "topics, products or services — the kind of terms real people search — that we can use to "
        "research competitors. Be specific to the business, not generic single words. "
        'Return JSON: {"queries": ["...", "..."]}\n\n'
        f"Site: {domain}\nPages: {json.dumps(pages, ensure_ascii=False)[:6000]}"
    )
    try:
        res = await ai_service.extract_json(prompt, "You are an SEO keyword strategist. Return only JSON.",
                                            use_deepseek=True)
        queries = res.get("queries") if isinstance(res, dict) else (res if isinstance(res, list) else [])
        queries = [q.strip() for q in (queries or []) if isinstance(q, str) and q.strip()][:10]
    except Exception as e:
        logger.warning("suggest-queries AI failed for %s: %s", domain, str(e)[:120])
        queries = []
    return {"queries": queries, "site": url, "domain": domain}


@router.post("/api/research/serp")
async def research_serp(body: dict = Body(...), current_user: UserInfo = Depends(get_current_user)):
    """SERP step — single query (rich preview) or multiple queries (aggregated competitors)."""
    from services.serp_service import serp_service
    from services.mangools_service import get_related_keywords

    domain = body.get("domain")
    queries = [q for q in (body.get("queries") or []) if q and q.strip()]

    # Multi-query mode (wizard v2): aggregate the competitor domains that rank ACROSS the selected
    # queries — the sites that show up repeatedly are the real niche rivals.
    if queries:
        agg = await serp_service.get_serp_insights(queries, domain=domain, max_keywords=len(queries),
                                                   location=_gl(body))
        return {
            "competitors": agg.get("top_competitors") or [],
            "people_also_ask": agg.get("people_also_ask") or [],
            "related_searches": agg.get("related_searches") or [],
            "queries": queries,
        }

    # Single-query mode (back-compat): rich organic preview + top related queries with volume.
    query = (body.get("query") or "").strip()
    if not query:
        return {"serp": None, "top_queries": []}
    serp = await serp_service.get_serp_preview(query, location=_gl(body))
    related = await get_related_keywords(query, location_id=_loc_id(domain, body.get("location_id")))
    top_queries = sorted(related, key=lambda x: (x.get("volume") or 0), reverse=True)[:10]
    return {"serp": serp, "top_queries": top_queries}


async def _expand_topics(seeds: List[str], domain: str) -> List[str]:
    """Generate richer discovery queries to find NEW keyword territory: question queries, specific
    entities (grape varieties, regions, course levels…), and modifier combos (best/for beginners/
    near me/price/vs). Each becomes a Mangools seed. Best-effort."""
    import json
    from services.ai_service import ai_service
    topic = ", ".join([s for s in seeds if s]) or domain
    prompt = (
        f"A website about: {topic}.\n"
        "Generate 15 SHORT search phrases to discover NEW keyword opportunities for this subject. "
        "Mix three kinds:\n"
        "- QUESTIONS people ask (how to…, what…, is…, best…, vs…)\n"
        "- specific ENTITIES within the subject (e.g. named types, levels, regions, varieties)\n"
        "- MODIFIER combos (for beginners, near me, price, in [country], online, certification)\n"
        "Stay strictly within the subject. Return JSON: {\"topics\": [\"...\"]}"
    )
    try:
        res = await ai_service.extract_json(prompt, "You are an SEO keyword researcher. Return only JSON.",
                                            use_deepseek=True)
        topics = res.get("topics") if isinstance(res, dict) else (res if isinstance(res, list) else [])
        return [t.strip() for t in (topics or []) if isinstance(t, str) and t.strip()][:15]
    except Exception as e:
        logger.warning("expand topics failed: %s", str(e)[:120])
        return []


@router.post("/api/research/keywords")
async def research_keywords(body: dict = Body(...),
                            current_user: UserInfo = Depends(get_current_user),
                            db: Session = Depends(get_db),
                            account_id=Depends(get_account_id)):
    """Step 3 — merge Mangools related-keywords(seed) + competitor-keywords(each selected domain)."""
    from services.mangools_service import get_related_keywords, get_competitor_keywords

    seeds: List[str] = [s for s in (body.get("seeds") or []) if s and s.strip()][:8]
    if not seeds and body.get("seed"):
        seeds = [body["seed"].strip()]
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

    # Broaden beyond the site's own topics into CLOSELY-RELATED subject areas, so the pool contains
    # new territory (wine → wine regions, grape varieties, food pairing) — not just what it ranks for.
    expand = list(seeds)
    try:
        from services.topical_grounding import _adjacent_topic_seeds
        adj = await _adjacent_topic_seeds(body.get("domain") or "", seeds, [], [])
        expand = list(dict.fromkeys(seeds + adj[:4]))
    except Exception as e:
        logger.warning("research adjacency failed: %s", str(e)[:120])

    # "Find more": deeper discovery — questions, entities and modifier combos across the subject.
    if body.get("expand"):
        more = await _expand_topics(seeds, body.get("domain") or "")
        expand = list(dict.fromkeys(expand + more))

    for seed in expand:
        for kw in await get_related_keywords(seed, location_id=loc):
            _merge(kw)
    for d in domains:
        for kw in await get_competitor_keywords(d, location_id=loc):
            _merge(kw)

    rows = list(candidates.values())
    raw_count = len(rows)
    filtered_off_topic = 0
    hidden_ranked = 0

    # Relevance filter: competitor domains drag in their whole footprint (brands, other industries).
    # Keep only keywords on-topic for the site (unless the caller opts out). Only DROP keywords the
    # LLM actually judged — anything beyond the judged window is kept, so long-tail questions survive.
    if (domains or body.get("expand")) and rows and body.get("relevance_filter", True):
        rows.sort(key=lambda x: (x.get("volume") or 0), reverse=True)
        judged = [r["keyword"] for r in rows[:200]]
        keep = await _filter_relevant(judged, seeds, body.get("domain") or "")
        if keep:
            judged_set = {j.lower() for j in judged}
            before = len(rows)
            rows = [r for r in rows
                    if (r.get("keyword") or "").lower() not in judged_set
                    or (r.get("keyword") or "").lower() in keep]
            filtered_off_topic = before - len(rows)

    # Optional: hide keywords the client already ranks well for (GSC position <= 10).
    if body.get("exclude_ranked") and body.get("gsc_property"):
        try:
            from api.routers._shared import _gsc_service_for
            svc = _gsc_service_for(db, current_user.email, account_id)
            gsc_rows = await svc.get_top_queries(body["gsc_property"], days=90)
            won = {(r.get("query") or "").lower() for r in (gsc_rows or [])
                   if r.get("position") is not None and r["position"] <= 10}
            before = len(rows)
            rows = [r for r in rows if (r.get("keyword") or "").lower() not in won]
            hidden_ranked = before - len(rows)
        except Exception as e:
            logger.warning("research exclude_ranked failed: %s", str(e)[:120])

    rows.sort(key=lambda x: (x.get("volume") or 0), reverse=True)
    rows = rows[:200]

    # Backfill KD: related-keywords often returns a null difficulty even when Mangools has a cached
    # score. Do one keyword-imports lookup (batched, 24h-cached) for the rows still missing KD.
    missing_kd = [r["keyword"] for r in rows if r.get("kd") is None and r.get("keyword")]
    if missing_kd:
        try:
            from services.mangools_service import get_keyword_difficulty
            kd_map = await get_keyword_difficulty(missing_kd, location_id=loc)
            if kd_map:
                for r in rows:
                    if r.get("kd") is None:
                        v = kd_map.get((r.get("keyword") or "").lower())
                        if v is not None:
                            r["kd"] = v
        except Exception as e:
            logger.warning("research KD backfill failed: %s", str(e)[:120])

    return {
        "keywords": rows,
        # Transparency: what the filters did, so the wizard can explain "why a keyword isn't here".
        "meta": {
            "raw_count": raw_count,
            "filtered_off_topic": filtered_off_topic,
            "hidden_ranked": hidden_ranked,
            "returned": min(len(rows), 200),
        },
    }


@router.post("/api/research/cluster")
async def research_cluster(body: dict = Body(...), current_user: UserInfo = Depends(get_current_user)):
    """Step 4 — SERP-overlap cluster the selected keywords (Keyword-Insights technique, our SerpAPI)."""
    from services.keyword_clustering import cluster_by_serp

    kws = [{"keyword": k.get("keyword"), "volume": k.get("volume") or k.get("avg_monthly_searches"),
            "kd": k.get("kd")}
           for k in (body.get("keywords") or []) if k.get("keyword")]
    if not kws:
        return {"clusters": []}
    clusters = await cluster_by_serp(kws, location=_gl(body))
    return {"clusters": clusters}


_QUESTION_STARTS = ("how", "what", "why", "when", "where", "who", "which", "is", "are", "can",
                    "does", "do", "will", "should", "could")


def _is_question(kw: str) -> bool:
    k = (kw or "").strip().lower()
    return "?" in k or k.split(" ", 1)[0] in _QUESTION_STARTS


@router.post("/api/research/discover")
async def research_discover(body: dict = Body(...),
                            current_user: UserInfo = Depends(get_current_user)):
    """Seed-first keyword DISCOVERY (Keyword-Insights style): expand a few seeds into a large keyword
    universe with real volume/KD. Mangools-powered by default (cheap — 1 KWFinder lookup per seed,
    NOT SerpAPI); AI adds question/entity/modifier seeds; SERP People-Also-Ask + related is opt-in
    (costs SerpAPI). Returns a flat, volume-ranked list tagged by intent + question flag."""
    from services.mangools_service import get_related_keywords, mangools_configured

    seeds = [s.strip() for s in (body.get("seeds") or []) if s and s.strip()][:8]
    if not seeds and body.get("seed"):
        seeds = [body["seed"].strip()]
    if not seeds:
        return {"keywords": [], "total": 0, "question_count": 0}
    loc = _loc_id(body.get("domain"), body.get("location_id"))

    # Broaden the seed set with AI-generated questions / entities / modifiers (each becomes a seed).
    all_seeds = list(seeds)
    if body.get("expand", True):
        try:
            all_seeds = list(dict.fromkeys(seeds + await _expand_topics(seeds, body.get("domain") or "")))[:24]
        except Exception as e:
            logger.warning("discover expand failed: %s", str(e)[:120])

    candidates: dict = {}

    def _merge(kw, source):
        k = (kw.get("keyword") or "").strip()
        if not k:
            return
        kl = k.lower()
        cur = candidates.get(kl)
        if cur is None:
            candidates[kl] = {**kw, "keyword": k, "sources": [source]}
        else:
            if source not in cur["sources"]:
                cur["sources"].append(source)
            if (kw.get("volume") or 0) > (cur.get("volume") or 0):
                cur["volume"] = kw.get("volume")
            if cur.get("kd") is None and kw.get("kd") is not None:
                cur["kd"] = kw.get("kd")

    if mangools_configured():
        for s in all_seeds:
            for kw in await get_related_keywords(s, location_id=loc):
                _merge(kw, "related")

    # Opt-in: pull People-Also-Ask + related searches from live SERPs (SerpAPI cost).
    if body.get("include_serp"):
        from services.serp_service import serp_service
        for s in seeds[:5]:
            try:
                serp = await serp_service.get_serp_preview(s, location=_gl(body))
                for q in (serp.get("people_also_ask") or []) + (serp.get("related_searches") or []):
                    if q:
                        _merge({"keyword": q, "volume": None, "kd": None}, "serp")
            except Exception as e:
                logger.warning("discover serp '%s' failed: %s", s, str(e)[:100])

    rows = list(candidates.values())
    for r in rows:
        r["is_question"] = _is_question(r["keyword"])
    rows.sort(key=lambda x: (x.get("volume") or 0), reverse=True)
    rows = rows[:600]
    return {
        "keywords": rows,
        "total": len(rows),
        "question_count": sum(1 for r in rows if r["is_question"]),
        "seeds_used": len(all_seeds),
    }


@router.get("/api/research/quota")
async def research_quota(current_user: UserInfo = Depends(get_current_user)):
    """Credit/quota visibility so a demo doesn't silently burn through paid API balance.

    SerpAPI exposes a live account endpoint (searches left this month). Mangools' KWFinder REST has no
    public remaining-quota endpoint, so we only report whether it's configured — the wizard shows a
    per-run *estimate* of lookups client-side instead.
    """
    import asyncio
    from config import settings
    from services.mangools_service import mangools_configured

    serp = None
    if settings.SERPAPI_KEY:
        def _fetch():
            import requests
            r = requests.get("https://serpapi.com/account",
                             params={"api_key": settings.SERPAPI_KEY}, timeout=10)
            r.raise_for_status()
            return r.json()
        try:
            d = await asyncio.to_thread(_fetch)
            serp = {
                "plan": d.get("plan_name"),
                "used": d.get("this_month_usage"),
                "limit": d.get("searches_per_month"),
                "left": d.get("total_searches_left"),
            }
        except Exception as e:
            logger.warning("serpapi account fetch failed: %s", str(e)[:120])
            serp = {"error": True}
    return {"serpapi": serp, "mangools": {"configured": mangools_configured()}}


# ---------------------------------------------------------------------------
# Saved research runs (save / resume) — persist the wizard state so a run can be
# reopened later or revisited from the client hub.
# ---------------------------------------------------------------------------

def _run_summary(r) -> dict:
    """Lightweight row for lists — no heavy `state` blob."""
    st = r.state or {}
    kw = st.get("keywords") or []
    return {
        "id": r.id, "name": r.name, "domain": r.domain, "site_url": r.site_url,
        "client_id": r.client_id, "gl": r.gl, "location_id": r.location_id,
        "step": r.step, "analysis_id": r.analysis_id,
        "keyword_count": len(kw), "cluster_count": len(st.get("clusters") or []),
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@router.get("/api/research/runs")
async def list_research_runs(client_id: Optional[str] = None,
                             current_user: UserInfo = Depends(get_current_user),
                             db: Session = Depends(get_db)):
    from database import ResearchRun
    q = db.query(ResearchRun).filter(ResearchRun.user_email == current_user.email)
    if client_id:
        q = q.filter(ResearchRun.client_id == client_id)
    runs = q.order_by(ResearchRun.updated_at.desc()).limit(100).all()
    return {"runs": [_run_summary(r) for r in runs]}


@router.get("/api/research/runs/{run_id}")
async def get_research_run(run_id: str,
                           current_user: UserInfo = Depends(get_current_user),
                           db: Session = Depends(get_db)):
    from fastapi import HTTPException
    from database import ResearchRun
    r = (db.query(ResearchRun)
         .filter(ResearchRun.id == run_id, ResearchRun.user_email == current_user.email).first())
    if not r:
        raise HTTPException(status_code=404, detail="Research run not found")
    return {**_run_summary(r), "state": r.state or {}}


@router.post("/api/research/runs")
async def save_research_run(body: dict = Body(...),
                            current_user: UserInfo = Depends(get_current_user),
                            db: Session = Depends(get_db)):
    """Create or update (upsert by `id`) a saved research run."""
    import uuid
    from database import ResearchRun

    state = body.get("state") or {}
    run_id = body.get("id")
    r = None
    if run_id:
        r = (db.query(ResearchRun)
             .filter(ResearchRun.id == run_id, ResearchRun.user_email == current_user.email).first())
    if r is None:
        run_id = run_id or str(uuid.uuid4())
        r = ResearchRun(id=run_id, user_email=current_user.email, state={})
        db.add(r)
    r.name = (body.get("name") or r.name or (body.get("domain") or "Untitled research"))[:200]
    r.domain = body.get("domain") or r.domain
    r.site_url = body.get("site_url") or r.site_url
    r.client_id = body.get("client_id") if body.get("client_id") is not None else r.client_id
    r.gl = body.get("gl") or r.gl
    r.location_id = body.get("location_id") if body.get("location_id") is not None else r.location_id
    r.step = int(body.get("step") or r.step or 1)
    r.state = state
    if body.get("analysis_id"):
        r.analysis_id = body["analysis_id"]
    db.commit()
    return _run_summary(r)


@router.delete("/api/research/runs/{run_id}")
async def delete_research_run(run_id: str,
                              current_user: UserInfo = Depends(get_current_user),
                              db: Session = Depends(get_db)):
    from database import ResearchRun
    (db.query(ResearchRun)
     .filter(ResearchRun.id == run_id, ResearchRun.user_email == current_user.email)
     .delete())
    db.commit()
    return {"deleted": True}
