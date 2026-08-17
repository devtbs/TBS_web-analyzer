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
import json
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

SEED_CAP = 6            # SerpAPI credits per analysis
COMPETITOR_SCRAPE_CAP = 6
GSC_QUERY_CAP = 50
MIN_KW_VOLUME = 50      # drop no/low-demand keywords from the map's opportunity list (real demand only)

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


_GENERIC_SLUGS = {"home", "index", "about", "about-us", "contact", "contact-us", "blog", "news",
                  "privacy", "terms", "login", "signup", "cart", "checkout", "search", "page",
                  "category", "tag", "en", "th", "faq", "sitemap"}


def _slug_to_phrase(url: str) -> str:
    """Turn a competitor page URL into a searchable topic phrase (last path segment → words)."""
    from urllib.parse import urlparse, unquote
    try:
        path = urlparse(url).path
    except Exception:
        return ""
    seg = [s for s in path.split("/") if s]
    if not seg:
        return ""
    last = unquote(seg[-1]).rsplit(".", 1)[0]
    if not last or last.lower() in _GENERIC_SLUGS or last.isdigit():
        return ""
    phrase = last.replace("-", " ").replace("_", " ").strip()
    wc = len(phrase.split())
    return phrase if 1 <= wc <= 8 else ""


async def _adjacent_topic_seeds(domain: str, seeds: List[str], gsc_queries: List[Dict],
                                competitor_topics: List[str]) -> List[str]:
    """Broaden into CLOSELY-RELATED subject areas around the theme (wine → wine pairing, cheese,
    vineyards, wine regions, decanting) — adjacent topics, not reworded seeds. These become extra
    Mangools seeds so opportunities span the whole subject, not just the exact query. Best-effort."""
    try:
        from services.ai_service import ai_service
        ctx = {
            "domain": domain,
            "known_queries": [q.get("query") for q in gsc_queries[:15] if q.get("query")],
            "seeds": seeds,
            "competitor_topics": competitor_topics[:15],
        }
        prompt = (
            "Given this website's subject area, list 10 CLOSELY-RELATED topic areas worth expanding "
            "content into — adjacent subjects around the same theme, NOT reworded versions of the "
            "seeds (e.g. for a wine school: wine pairing, cheese, vineyards, wine regions, decanting, "
            "wine investment, wine storage). Short searchable noun phrases. "
            'Return JSON: {"topics": ["...", "..."]}\n\n'
            f"Context: {json.dumps(ctx, ensure_ascii=False)}"
        )
        res = await ai_service.extract_json(prompt, "You are an SEO topic strategist. Return only JSON.",
                                            use_deepseek=True)
        topics = res.get("topics") if isinstance(res, dict) else (res if isinstance(res, list) else [])
        return [t.strip() for t in (topics or []) if isinstance(t, str) and t.strip()][:10]
    except Exception as e:
        logger.warning("adjacent topics failed for %s: %s", domain, str(e)[:120])
        return []


async def _grounding_from_research(out: Dict, domain: str, own: str, research: Dict) -> Dict:
    """Build the real_data block from the wizard's curated selection (keywords/clusters/domains)."""
    domains = [_bare(d) for d in (research.get("domains") or []) if d]
    out["serp"]["top_competitors"] = [{"domain": d, "url": f"https://{d}/"} for d in domains if d != own]
    out["seed_keywords"] = [s for s in (research.get("seeds") or [research.get("seed")]) if s]

    # The user's selected keywords → the opportunity table (already ranked-by the wizard).
    out["keyword_volumes"] = [
        {"keyword": k.get("keyword"), "avg_monthly_searches": k.get("volume") or k.get("avg_monthly_searches") or 0,
         "kd": k.get("kd"), "cpc": k.get("cpc"), "competition": None}
        for k in (research.get("keywords") or []) if k.get("keyword")
    ][:60]
    out["keyword_clusters"] = research.get("clusters") or []

    # Scrape the chosen competitor domains for the subtopics they cover (grounds the taxonomy).
    urls = [f"https://{d}/" for d in domains][:COMPETITOR_SCRAPE_CAP]
    if urls:
        try:
            from services.scraper import scraper
            pages = await scraper.scrape_multiple(urls)
            for p in pages or []:
                if p.get("status") != "success":
                    continue
                h = p.get("headings") or {}
                out["competitor_structure"].append({
                    "url": p.get("url"), "domain": _bare(p.get("url", "")),
                    "title": (p.get("title") or "")[:200],
                    "h1": (h.get("h1") or [])[:5], "h2": (h.get("h2") or [])[:25], "h3": (h.get("h3") or [])[:30],
                })
                for hh in (h.get("h2") or [])[:6]:
                    out["competitor_topics"].append(hh)
        except Exception as e:
            logger.warning("research grounding scrape failed: %s", str(e)[:120])
    out["competitor_topics"] = list(dict.fromkeys(out["competitor_topics"]))[:40]
    logger.info("grounding(research) %s: %d kw, %d clusters, %d domains",
                domain, len(out["keyword_volumes"]), len(out["keyword_clusters"]), len(domains))
    return out


async def gather_grounding(domain: str, seed_keywords: List[str], *, db=None, email: Optional[str] = None,
                           gsc_property: Optional[str] = None, account_id: Optional[int] = None,
                           ads_customer_id: Optional[str] = None, research: Optional[Dict] = None) -> Dict:
    """Assemble the real_data block. Never raises — returns whatever it could gather.

    When `research` (from the New Analysis wizard) is provided, the map is built from the user's
    CURATED picks — their selected keywords, clusters and competitor domains — instead of auto-deriving
    from GSC/SERP. We still scrape the chosen domains for their page subtopics.
    """
    heading_seeds = [s for s in (seed_keywords or []) if s and s.strip()][:SEED_CAP]
    out: Dict = {
        "seed_keywords": [],
        "serp": {"top_competitors": [], "people_also_ask": [], "related_searches": []},
        "competitor_structure": [],
        "competitor_topics": [],
        "adjacent_topics": [],
        "gsc_queries": [],
        "keyword_volumes": [],   # NEW opportunities (already-ranked queries excluded)
        "keyword_clusters": [],  # opportunities grouped into content pieces by SERP overlap
        "already_ranked": [],    # queries the site already ranks <=10 for (for context)
    }
    own = _bare(domain)

    # ── Curated (wizard) mode: use the user's selections directly. ───────────────────────────
    if research and (research.get("keywords") or research.get("domains") or research.get("clusters")):
        return await _grounding_from_research(out, domain, own, research)

    # ── 0. The site's own ranking queries (GSC) — real ground truth AND the best SERP seeds. ────
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

    # Seed the SERP with the site's REAL ranking queries when we have them — far more relevant than
    # homepage headings (a wine school seeds wine queries, not generic nav labels). Blend in a couple
    # of heading seeds for breadth; fall back to headings entirely when there's no GSC data.
    gsc_terms = [q["query"] for q in out["gsc_queries"][:5] if q.get("query")]
    seeds = ((gsc_terms[:4] + heading_seeds[:2]) if gsc_terms else heading_seeds)[:SEED_CAP]
    out["seed_keywords"] = seeds
    if not seeds:
        return out

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

    # ── 3. Mine the 1-2 most prominent competitors' sitemaps for the topics THEY cover ───────
    top_comp_domains = [_bare(c.get("domain", "")) for c in out["serp"]["top_competitors"][:2] if c.get("domain")]
    competitor_topics: List[str] = []
    for cd in top_comp_domains:
        try:
            from services.sitemap_service import sitemap_service
            urls = await sitemap_service.get_priority_pages(f"https://{cd}/", max_pages=25)
            for u in urls or []:
                ph = _slug_to_phrase(u)
                if ph:
                    competitor_topics.append(ph)
        except Exception as e:
            logger.warning("grounding competitor sitemap %s failed: %s", cd, str(e)[:120])
    out["competitor_topics"] = list(dict.fromkeys(competitor_topics))[:40]

    # Broaden into closely-related subject areas around the theme (wine → pairing, cheese, regions…).
    out["adjacent_topics"] = await _adjacent_topic_seeds(domain, seeds, out["gsc_queries"], out["competitor_topics"])

    # Queries the site ALREADY ranks well for (pos<=10) — "already optimized", excluded from opps.
    won = {(q.get("query") or "").lower() for q in out["gsc_queries"]
           if q.get("position") is not None and q["position"] <= 10}
    out["already_ranked"] = sorted(
        [{"query": q["query"], "position": round(q["position"], 1)} for q in out["gsc_queries"]
         if q.get("position") is not None and q["position"] <= 10],
        key=lambda x: x["position"])[:30]
    own_brand = _brand_tokens([c.get("domain", "") for c in out["serp"]["top_competitors"]], own)

    def _is_opportunity(kw_lower: str) -> bool:
        if kw_lower in won:
            return False                                  # already ranking well → not new
        if any(t in kw_lower.replace(" ", "") for t in own_brand):
            return False                                  # brand/navigational, not a topic
        return True

    # ── 4. Keyword opportunities with REAL volume + KD (Mangools KWFinder). ───────────────────
    try:
        from services.mangools_service import mangools_configured, get_related_keywords, location_for_domain
        if mangools_configured():
            loc = location_for_domain(domain)
            idea_seeds = list(dict.fromkeys(
                seeds + out["adjacent_topics"][:6] + out["serp"]["related_searches"][:3]
                + out["competitor_topics"][:3]))[:12]
            candidates: Dict[str, Dict] = {}
            for s in idea_seeds:
                for kw in await get_related_keywords(s, location_id=loc):
                    k = kw["keyword"].lower()
                    if not _is_opportunity(k):
                        continue
                    if k not in candidates or (kw["volume"] or 0) > (candidates[k]["volume"] or 0):
                        candidates[k] = kw
            ranked = sorted(candidates.values(), key=lambda x: (x["volume"] or 0), reverse=True)
            # Only surface keywords with real search demand. Falling back to the top-by-volume set
            # when nothing clears the floor keeps a genuinely tiny niche from yielding an empty table.
            with_demand = [o for o in ranked if (o.get("volume") or 0) >= MIN_KW_VOLUME]
            chosen = with_demand or ranked
            out["keyword_volumes"] = [
                {"keyword": o["keyword"], "avg_monthly_searches": o["volume"],
                 "kd": o["kd"], "cpc": o["cpc"], "competition": None}
                for o in chosen[:40]
            ]
        elif db is not None and email:
            # Fallback: Google Ads Keyword Planner (only when Mangools isn't configured).
            from services.ads_service import ads_is_configured
            if ads_is_configured():
                from api.routers._shared import _ads_service_for
                svc = _ads_service_for(db, email, account_id, required=False)
                if svc:
                    idea_seeds = seeds + out["serp"]["related_searches"][:6]
                    vols = await svc.generate_keyword_ideas(idea_seeds, customer_id=ads_customer_id)
                    opps = [v for v in vols if _is_opportunity(v["keyword"].lower())]
                    with_demand = [v for v in opps
                                   if (v.get("avg_monthly_searches") or v.get("volume") or 0) >= MIN_KW_VOLUME]
                    out["keyword_volumes"] = (with_demand or opps)[:40]
    except Exception as e:
        logger.warning("grounding keyword volumes failed for %s: %s", domain, str(e)[:150])

    # ── 5. Cluster the opportunities into content pieces by SERP overlap (no third-party API). ─
    try:
        if out["keyword_volumes"]:
            from services.keyword_clustering import cluster_by_serp
            from services.serp_service import serp_service
            loc = serp_service._detect_location_from_domain(domain)
            rows = [{"keyword": k["keyword"], "volume": k.get("avg_monthly_searches"), "kd": k.get("kd")}
                    for k in out["keyword_volumes"]]
            out["keyword_clusters"] = await cluster_by_serp(rows, location=loc)
    except Exception as e:
        logger.warning("grounding clustering failed for %s: %s", domain, str(e)[:150])

    logger.info("grounding %s: %d competitors, %d comp-topics, %d gsc, %d opps (%d already-ranked), %d clusters",
                domain, len(out["serp"]["top_competitors"]), len(out["competitor_topics"]),
                len(out["gsc_queries"]), len(out["keyword_volumes"]), len(out["already_ranked"]),
                len(out["keyword_clusters"]))
    return out
