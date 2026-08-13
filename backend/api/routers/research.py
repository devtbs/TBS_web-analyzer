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
        agg = await serp_service.get_serp_insights(queries, domain=domain, max_keywords=len(queries))
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

    for seed in expand:
        for kw in await get_related_keywords(seed, location_id=loc):
            _merge(kw)
    for d in domains:
        for kw in await get_competitor_keywords(d, location_id=loc):
            _merge(kw)

    rows = list(candidates.values())

    # Relevance filter: competitor domains drag in their whole footprint (brands, other industries).
    # Keep only keywords on-topic for the site (unless the caller opts out).
    if domains and rows and body.get("relevance_filter", True):
        rows.sort(key=lambda x: (x.get("volume") or 0), reverse=True)
        keep = await _filter_relevant([r["keyword"] for r in rows[:150]], seeds, body.get("domain") or "")
        if keep:
            rows = [r for r in rows if (r.get("keyword") or "").lower() in keep]

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
