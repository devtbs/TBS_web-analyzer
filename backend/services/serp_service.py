"""
SerpAPI Service for Real Google Search Data
Enhances topical maps with actual SERP insights
"""
from typing import Dict, List, Optional
from serpapi import GoogleSearch
from config import settings
import asyncio


class SerpService:
    """Service for fetching real Google search data via SerpAPI"""
    
    def __init__(self):
        self.api_key = settings.SERPAPI_KEY
    
    def _detect_location_from_domain(self, domain: str) -> str:
        """Detect country code from domain TLD"""
        # Common TLD to country code mapping
        tld_to_country = {
            '.th': 'th',  # Thailand
            '.uk': 'uk',  # United Kingdom
            '.au': 'au',  # Australia
            '.ca': 'ca',  # Canada
            '.de': 'de',  # Germany
            '.fr': 'fr',  # France
            '.jp': 'jp',  # Japan
            '.sg': 'sg',  # Singapore
            '.my': 'my',  # Malaysia
            '.ph': 'ph',  # Philippines
            '.vn': 'vn',  # Vietnam
            '.in': 'in',  # India
            '.cn': 'cn',  # China
            '.kr': 'kr',  # South Korea
        }
        
        # Check TLD
        for tld, country in tld_to_country.items():
            if domain.endswith(tld):
                return country
        
        # Default to US for .com, .net, .org, etc.
        return 'th'
    
    async def get_serp_insights(self, keywords: List[str], domain: str = None, max_keywords: int = 3,
                                location: str = None) -> Dict:
        """
        Get SERP insights for multiple keywords
        Returns competitor rankings, PAA questions, related searches

        max_keywords caps how many keywords we spend SerpAPI credits on (default 3 for the legacy
        post-hoc enrichment; the grounding step passes a higher cap to cover the niche).
        `location` (gl country code) overrides the domain-based guess when the caller knows the market.
        """
        if not self.api_key:
            print("⚠️  SerpAPI key not configured, skipping SERP analysis")
            return self._empty_insights()

        # Explicit location wins; otherwise detect from domain.
        location = location or (self._detect_location_from_domain(domain) if domain else 'th')
        keywords = keywords[:max_keywords]
        print(f"🔍 Fetching SERP data for {len(keywords)} keywords (location: {location.upper()})...")

        insights = {
            'top_competitors': [],
            'people_also_ask': [],
            'related_searches': [],
            'ranking_opportunities': [],
            'content_types': {},
            'ai_visibility': {},
        }
        
        try:
            # Process the (already-capped) keywords in parallel
            tasks = [self._fetch_keyword_data(kw, location) for kw in keywords]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Aggregate results
            all_competitors = []
            all_paa = []
            all_related = []
            ai_pages = []

            for result in results:
                if isinstance(result, dict):
                    all_competitors.extend(result.get('competitors', []))
                    all_paa.extend(result.get('paa', []))
                    all_related.extend(result.get('related', []))
                    if result.get('ai_overview'):
                        ai_pages.append(result['ai_overview'])
            
            # Deduplicate and rank
            insights['top_competitors'] = self._get_top_items(all_competitors, 10)
            insights['people_also_ask'] = self._get_top_items(all_paa, 15)
            insights['related_searches'] = self._get_top_items(all_related, 10)
            insights['ai_visibility'] = self._summarise_ai_visibility(ai_pages, domain)
            
            print(f"✅ SERP insights collected:")
            print(f"   - {len(insights['top_competitors'])} competitors")
            print(f"   - {len(insights['people_also_ask'])} PAA questions")
            print(f"   - {len(insights['related_searches'])} related searches")
            
        except Exception as e:
            print(f"⚠️  SerpAPI error: {str(e)}")
            return self._empty_insights()
        
        return insights
    
    def _summarise_ai_visibility(self, ai_pages: List[Dict], domain: str = None) -> Dict:
        """Turn per-query AI Overview readings into the headline a proposal needs:
        how often an AI Overview appears, whether THIS site is ever cited, and who is cited instead.

        `queries_checked` is deliberately reported alongside the rate — "cited in 0 of 6" is honest,
        "0% AI presence" from a sample of six is not.
        """
        own = (domain or "").lower().replace("www.", "").strip("/")
        checked = len(ai_pages)
        with_ai = [p for p in ai_pages if p.get("present")]
        resolved = [p for p in with_ai if not p.get("deferred")]

        cited_queries, competitor_counts = [], {}
        for page in resolved:
            hit = False
            for src in page.get("sources") or []:
                d = src.get("domain", "")
                if own and self._is_target(d, own):
                    hit = True
                else:
                    competitor_counts[d] = competitor_counts.get(d, 0) + 1
            if hit:
                cited_queries.append(page.get("query"))

        return {
            "queries_checked": checked,
            "ai_overview_present": len(with_ai),
            "resolved": len(resolved),
            "cited_count": len(cited_queries),
            "cited_queries": cited_queries,
            "not_cited_queries": [p.get("query") for p in resolved if p.get("query") not in cited_queries],
            "citation_rate": round(len(cited_queries) / len(resolved), 3) if resolved else None,
            "top_cited_competitors": [
                {"domain": d, "citations": n}
                for d, n in sorted(competitor_counts.items(), key=lambda kv: -kv[1])[:10]
            ],
        }

    async def _fetch_keyword_data(self, keyword: str, location: str = 'th') -> Dict:
        """Fetch SERP data for a single keyword"""
        try:
            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, 
                self._search_google, 
                keyword,
                location
            )
            return result
        except Exception as e:
            print(f"   ⚠️  Error fetching '{keyword}': {str(e)}")
            return {'competitors': [], 'paa': [], 'related': [], 'ai_overview': None}
    
    def _search_google(self, keyword: str, location: str = None) -> Dict:
        """Synchronous Google search via SerpAPI"""
        # Auto-detect location if not provided (defaults to global)
        country_code = location if location else "th"
        
        params = {
            "q": keyword,
            "api_key": self.api_key,
            "num": 10,  # Get top 10 results
            "gl": country_code,  # Country code (th for Thailand, us for USA, etc.)
            "hl": "en"   # Language
        }
        
        search = GoogleSearch(params)
        results = search.get_dict()
        
        # Extract data
        competitors = []
        paa = []
        related = []
        
        # Get organic results (competitors)
        if 'organic_results' in results:
            for result in results['organic_results'][:10]:
                competitors.append({
                    'domain': self._extract_domain(result.get('link', '')),
                    'url': result.get('link', ''),
                    'title': result.get('title', ''),
                    'position': result.get('position', 0)
                })
        
        # Get People Also Ask
        if 'related_questions' in results:
            for question in results['related_questions']:
                paa.append(question.get('question', ''))
        
        # Get Related Searches
        if 'related_searches' in results:
            for search in results['related_searches']:
                related.append(search.get('query', ''))
        
        # AI Overview presence + who it cites. This SERP page is already paid for, so reading the
        # AI block costs nothing extra — the same trick the rank tracker uses. For a prospect this
        # is the only honest way to answer "is this brand visible in AI answers?", since we have no
        # Search Console access to their site.
        ai = results.get('ai_overview') or {}
        ai_sources = []
        for ref in (ai.get('references') or []):
            link = ref.get('link', '')
            ai_sources.append({'domain': self._extract_domain(link).lower(), 'url': link,
                               'title': (ref.get('title') or '')[:200]})

        return {
            'competitors': competitors,
            'paa': paa,
            'related': related,
            'ai_overview': {
                'query': keyword,
                'present': bool(ai),
                # SerpAPI returns the block as a page_token when it needs a second call; we do not
                # spend that here, so record it as present-but-unresolved rather than "no sources".
                'deferred': bool(ai.get('page_token') and not ai.get('references')),
                'sources': ai_sources[:10],
            },
        }
    
    async def get_rank(self, keyword: str, domain: str, location: str = None) -> Dict:
        """Find `domain`'s best organic position (1-100) for `keyword` — the rank-tracker probe.
        Returns {position, url} or {position: None, url: None} if the domain isn't in the top 100."""
        empty = {"position": None, "url": None}
        if not self.api_key or not keyword or not domain:
            return empty
        loc = location or (self._detect_location_from_domain(domain) if domain else 'th')
        target = domain.lower().replace('www.', '').strip('/')
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, self._rank_sync, keyword, target, loc)
        except Exception as e:
            print(f"⚠️  rank check '{keyword}' failed: {str(e)}")
            return empty

    def _rank_sync(self, keyword: str, target_domain: str, location: str) -> Dict:
        params = {"q": keyword, "api_key": self.api_key, "num": 100, "gl": location, "hl": "en"}
        results = GoogleSearch(params).get_dict()
        parsed = self._parse_rank_page(results, target_domain)

        # Google often returns the AI Overview as a page_token rather than inline references. The
        # citations are only readable via a SECOND SerpAPI request, so this is opt-in: it doubles
        # the per-keyword cost on affected keywords. Off unless AI_OVERVIEW_DETAIL=1.
        ai = parsed.get("ai_overview") or {}
        token = (results.get("ai_overview") or {}).get("page_token")
        if ai.get("deferred") and token and str(settings.AI_OVERVIEW_DETAIL) == "1":
            try:
                detail = GoogleSearch({"engine": "google_ai_overview", "page_token": token,
                                       "api_key": self.api_key}).get_dict()
                srcs = []
                for ref in ((detail.get("ai_overview") or {}).get("references") or []):
                    link = ref.get("link", "")
                    srcs.append({"domain": self._extract_domain(link).lower(), "url": link,
                                 "title": (ref.get("title") or "")[:200]})
                if srcs:
                    ai["sources"] = srcs[:20]
                    ai["deferred"] = False
                    ai["cited"] = any(self._is_target(x["domain"], target_domain) for x in srcs)
                    parsed["ai_overview"] = ai
            except Exception as e:
                print(f"⚠️  AI overview detail failed for '{keyword}': {str(e)[:100]}")
        return parsed

    def _is_target(self, domain: str, target: str) -> bool:
        d = (domain or "").lower()
        return bool(d) and (d == target or d.endswith("." + target) or target.endswith("." + d))

    def _parse_rank_page(self, results: Dict, target_domain: str) -> Dict:
        """Pull everything useful out of one SERP response.

        We already pay for this whole page to find our own position, so the organic list, the SERP
        features and the AI Overview come along for free — that is what makes share of voice,
        SERP competitors and AI-citation tracking cost nothing extra.
        """
        position, url = None, None
        organic = []
        for r in (results.get("organic_results") or []):
            link = r.get("link", "")
            d = self._extract_domain(link).lower()
            organic.append({"position": r.get("position"), "domain": d,
                            "url": link, "title": (r.get("title") or "")[:200]})
            if position is None and self._is_target(d, target_domain):
                position, url = r.get("position"), link

        # SERP features present on the page — SE Ranking calls these "snippets".
        fs = results.get("answer_box") or {}
        features = {
            "featured_snippet": bool(fs),
            "featured_snippet_domain": self._extract_domain(fs.get("link", "")).lower() if fs else None,
            "people_also_ask": len(results.get("related_questions") or []),
            "local_pack": bool(results.get("local_results")),
            "knowledge_graph": bool(results.get("knowledge_graph")),
            "shopping": bool(results.get("shopping_results")),
            "videos": bool(results.get("inline_videos") or results.get("video_results")),
            "top_ads": len(results.get("ads") or []),
        }

        # AI Overview. SerpAPI sometimes inlines the references and sometimes only returns a
        # page_token needing a second request — we record which, rather than pretending it's absent.
        ai = results.get("ai_overview") or {}
        ai_sources = []
        for ref in (ai.get("references") or []):
            link = ref.get("link", "")
            ai_sources.append({"domain": self._extract_domain(link).lower(), "url": link,
                               "title": (ref.get("title") or "")[:200]})
        ai_overview = {
            "present": bool(ai),
            "deferred": bool(ai.get("page_token") and not ai.get("references")),
            "cited": any(self._is_target(s["domain"], target_domain) for s in ai_sources),
            "sources": ai_sources[:20],
        }

        return {"position": position, "url": url,
                "organic": organic[:100], "features": features, "ai_overview": ai_overview}

    async def get_serp_preview(self, query: str, location: str = None) -> Dict:
        """Full SERP for a single query — for the research wizard's live 'Test Search' step.
        Returns top-10 organic (title/url/domain/position/snippet), PAA, related, knowledge panel."""
        empty = {"query": query, "organic": [], "people_also_ask": [], "related_searches": [], "knowledge_graph": None}
        if not self.api_key or not query:
            return empty
        loc = location or 'th'
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, self._serp_preview_sync, query, loc)
        except Exception as e:
            print(f"⚠️  SERP preview error: {str(e)}")
            return empty

    def _serp_preview_sync(self, query: str, location: str) -> Dict:
        params = {"q": query, "api_key": self.api_key, "num": 10, "gl": location, "hl": "en"}
        results = GoogleSearch(params).get_dict()
        organic = [{
            "position": r.get("position"),
            "title": r.get("title", ""),
            "url": r.get("link", ""),
            "domain": self._extract_domain(r.get("link", "")),
            "snippet": r.get("snippet", ""),
        } for r in (results.get("organic_results") or [])[:10]]
        kg = results.get("knowledge_graph") or {}
        knowledge = ({"title": kg.get("title"), "type": kg.get("type"),
                      "description": kg.get("description")} if kg else None)
        return {
            "query": query,
            "organic": organic,
            "people_also_ask": [q.get("question", "") for q in (results.get("related_questions") or [])],
            "related_searches": [s.get("query", "") for s in (results.get("related_searches") or [])],
            "knowledge_graph": knowledge,
        }

    async def get_account(self) -> Dict:
        """Live SerpAPI plan usage — the source of truth for the spend guard.
        Returns {used, limit, left} this month, or {} if unavailable."""
        if not self.api_key:
            return {}

        def _fetch():
            import requests
            r = requests.get("https://serpapi.com/account",
                             params={"api_key": self.api_key}, timeout=10)
            r.raise_for_status()
            return r.json()

        try:
            d = await asyncio.to_thread(_fetch)
            return {"used": d.get("this_month_usage"), "limit": d.get("searches_per_month"),
                    "left": d.get("total_searches_left")}
        except Exception as e:
            print(f"⚠️  SerpAPI account fetch failed: {str(e)}")
            return {}

    def _extract_domain(self, url: str) -> str:
        """Extract domain from URL"""
        from urllib.parse import urlparse
        try:
            parsed = urlparse(url)
            return parsed.netloc.replace('www.', '')
        except:
            return url
    
    def _get_top_items(self, items: List, limit: int) -> List:
        """Get top unique items"""
        seen = set()
        unique = []
        for item in items:
            # Handle both strings and dicts
            key = item if isinstance(item, str) else item.get('domain', '')
            if key and key not in seen:
                seen.add(key)
                unique.append(item)
                if len(unique) >= limit:
                    break
        return unique
    
    def _empty_insights(self) -> Dict:
        """Return empty insights structure"""
        return {
            'top_competitors': [],
            'people_also_ask': [],
            'related_searches': [],
            'ranking_opportunities': [],
            'content_types': {}
        }


# Singleton instance
serp_service = SerpService()
