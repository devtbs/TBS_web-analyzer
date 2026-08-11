"""Ground the AI topical map in REAL data instead of model knowledge.

Given a domain + seed keywords, gather:
  - the real top-ranking competitors for the niche (SerpAPI organic results),
  - the real questions people search (People-Also-Ask + related searches),
  - the subtopics the winning pages actually cover (scrape their H1/H2/H3),
  - (optional) the client's own ranking queries from Search Console,
  - (optional, Phase 3) real monthly search volumes from Google Ads Keyword Planner.

The topical-map generator embeds the returned block as `real_data` and instructs the model to
ORGANIZE it into the schema rather than invent competitors/queries. Every source degrades
gracefully — a failure in one leaves its slice empty and the rest proceeds.
"""
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

SEED_CAP = 6            # SerpAPI credits per analysis
COMPETITOR_SCRAPE_CAP = 6
GSC_QUERY_CAP = 50


def _bare(domain: str) -> str:
    return (domain or "").lower().replace("https://", "").replace("http://", "").replace("www.", "").strip("/").split("/")[0]


async def gather_grounding(domain: str, seed_keywords: List[str], *, db=None, email: Optional[str] = None,
                           gsc_property: Optional[str] = None, account_id: Optional[int] = None,
                           ads_customer_id: Optional[str] = None) -> Dict:
    """Assemble the real_data block. Never raises — returns whatever it could gather."""
    seeds = [s for s in (seed_keywords or []) if s and s.strip()][:SEED_CAP]
    out: Dict = {
        "seed_keywords": seeds,
        "serp": {"top_competitors": [], "people_also_ask": [], "related_searches": []},
        "competitor_structure": [],
        "gsc_queries": [],
        "keyword_volumes": [],
    }
    if not seeds:
        return out

    own = _bare(domain)

    # ── 1. SERP: real competitors + PAA + related searches ──────────────────────────────────
    competitor_urls: List[str] = []
    try:
        from services.serp_service import serp_service
        serp = await serp_service.get_serp_insights(seeds, domain=domain, max_keywords=SEED_CAP)
        comps = [c for c in (serp.get("top_competitors") or []) if _bare(c.get("domain", "")) != own]
        out["serp"]["top_competitors"] = comps
        out["serp"]["people_also_ask"] = serp.get("people_also_ask") or []
        out["serp"]["related_searches"] = serp.get("related_searches") or []
        competitor_urls = [c["url"] for c in comps if c.get("url")][:COMPETITOR_SCRAPE_CAP]
    except Exception as e:
        logger.warning("grounding SERP failed for %s: %s", domain, str(e)[:150])

    # ── 2. Scrape the winning pages for the subtopics they actually cover ────────────────────
    if competitor_urls:
        try:
            from services.scraper import scraper
            pages = await scraper.scrape_multiple(competitor_urls)
            for p in pages or []:
                if p.get("status") != "success":
                    continue
                h = p.get("headings") or {}
                out["competitor_structure"].append({
                    "url": p.get("url"),
                    "domain": _bare(p.get("url", "")),
                    "title": (p.get("title") or "")[:200],
                    "h1": (h.get("h1") or [])[:5],
                    "h2": (h.get("h2") or [])[:25],
                    "h3": (h.get("h3") or [])[:30],
                })
        except Exception as e:
            logger.warning("grounding scrape failed for %s: %s", domain, str(e)[:150])

    # ── 3. (Phase 2) The client's own ranking queries from Search Console ────────────────────
    if gsc_property and db is not None and email:
        try:
            from api.routers._shared import _gsc_service_for
            svc = _gsc_service_for(db, email, account_id)
            rows = await svc.get_top_queries(gsc_property, days=90)
            out["gsc_queries"] = [
                {"query": r.get("query"), "clicks": r.get("clicks"),
                 "impressions": r.get("impressions"), "position": r.get("position")}
                for r in (rows or [])[:GSC_QUERY_CAP] if r.get("query")
            ]
        except Exception as e:
            logger.warning("grounding GSC failed for %s: %s", gsc_property, str(e)[:150])

    # ── 4. (Phase 3) Real search volumes from Google Ads Keyword Planner ─────────────────────
    # Wired in a later phase; left empty here so the schema/consumers are stable.

    logger.info("grounding %s: %d competitors, %d PAA, %d related, %d scraped, %d gsc",
                domain, len(out["serp"]["top_competitors"]), len(out["serp"]["people_also_ask"]),
                len(out["serp"]["related_searches"]), len(out["competitor_structure"]), len(out["gsc_queries"]))
    return out
