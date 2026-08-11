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

# Sites that show up in organic results but are NOT niche competitors — job boards, news, social,
# directories, encyclopaedias, marketplaces. Filtered out so the map's competitors are real rivals.
NOISE_DOMAIN_BITS = (
    "wikipedia.", "linkedin.", "facebook.", "instagram.", "youtube.", "twitter.", "x.com", "tiktok.",
    "reddit.", "quora.", "pinterest.", "medium.com", "blogspot.", "wordpress.com",
    "jobsdb", "jobstreet", "indeed.", "glassdoor", "jobthai",
    "bangkokpost", "nationthailand", "thairath", "posttoday", "sanook.", "kapook.", "pantip.",
    "investopedia.", "tradingview.", "amazon.", "booking.", "agoda.", "tripadvisor", "lazada.",
    "shopee.", "yellowpages", "yelp.", "google.", "bing.",
)


def _bare(domain: str) -> str:
    return (domain or "").lower().replace("https://", "").replace("http://", "").replace("www.", "").strip("/").split("/")[0]


def _is_noise(domain: str) -> bool:
    d = (domain or "").lower()
    return any(bit in d for bit in NOISE_DOMAIN_BITS)


def _brand_tokens(domains, own: str) -> set:
    """Second-level labels of competitors + the client — used to strip brand/navigational keywords
    (e.g. 'fbs', 'fxcm', the client's own name) from the search-volume list."""
    toks = set()
    for d in list(domains) + [own]:
        core = _bare(d).split(".")[0]
        if core and len(core) > 2:
            toks.add(core)
    return toks


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
        comps = [c for c in (serp.get("top_competitors") or [])
                 if _bare(c.get("domain", "")) != own and not _is_noise(c.get("domain", ""))]
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

    # ── 4. Real monthly search volumes from Google Ads Keyword Planner ───────────────────────
    # Seeds + the real queries we already gathered make the best idea seeds. Runs whenever the
    # account has an Ads connection; degrades to empty otherwise.
    if db is not None and email:
        try:
            from services.ads_service import ads_is_configured
            if ads_is_configured():
                from api.routers._shared import _ads_service_for
                svc = _ads_service_for(db, email, account_id, required=False)
                if svc:
                    idea_seeds = seeds + [q for q in out["serp"]["related_searches"][:6]]
                    vols = await svc.generate_keyword_ideas(idea_seeds, customer_id=ads_customer_id)
                    # Drop competitor/own brand terms — they're navigational, not topic opportunities.
                    brand_toks = _brand_tokens([c.get("domain", "") for c in out["serp"]["top_competitors"]], own)
                    out["keyword_volumes"] = [
                        v for v in vols
                        if not any(t in v["keyword"].lower().replace(" ", "") for t in brand_toks)
                    ]
        except Exception as e:
            logger.warning("grounding ads volumes failed for %s: %s", domain, str(e)[:150])

    logger.info("grounding %s: %d competitors, %d PAA, %d related, %d scraped, %d gsc",
                domain, len(out["serp"]["top_competitors"]), len(out["serp"]["people_also_ask"]),
                len(out["serp"]["related_searches"]), len(out["competitor_structure"]), len(out["gsc_queries"]))
    return out
