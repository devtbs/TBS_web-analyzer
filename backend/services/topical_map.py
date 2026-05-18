from typing import Dict, List
from models.schemas import TopicalMapData
from .ai_service import ai_service
import json
import asyncio


class TopicalMapGenerator:
    """
    AI-powered topical map generator with comprehensive semantic analysis.
    
    Implements the complete 8-part semantic website analysis framework:
    - Part 1: Business Intelligence Extraction
    - Part 2: Deep Semantic Analysis
    - Part 3: Competitive & Source Analysis
    - Part 4: Content Strategy Framework
    - Part 5: Comprehensive Query Research
    - Part 6: Content Plan Generation
    - Part 7: Semantic SEO Optimization
    - Part 8: Competitive Positioning
    """
    
    def _extract_content_themes(self, pages: List[Dict]) -> List[str]:
        """Extract main content themes from existing pages"""
        themes = []
        for page in pages[:5]:
            # Extract themes from H1 and H2 headings
            h1s = page.get('headings', {}).get('h1', [])
            h2s = page.get('headings', {}).get('h2', [])[:3]
            
            if h1s:
                themes.extend(h1s)
            if h2s:
                themes.extend(h2s)
        
        # Return unique themes
        return list(set(themes))[:15]
    
    async def generate_topical_map_with_ai(
        self,
        scraped_data: Dict,
        competitor_context: List[Dict] = None,
    ) -> TopicalMapData:
        """
        Generate comprehensive topical map using AI with detailed 8-part semantic analysis.

        competitor_context (optional): list of dicts, each with keys:
            url, key_topics, core_topics, content_gaps
        When provided (primary site only), the AI is told which topics competitors
        already own so it can suggest gap-filling articles.
        """

        url = scraped_data.get('url', '')
        title = scraped_data.get('title', '')
        description = scraped_data.get('description', '')
        
        # Use Firecrawl markdown if available (better structure), otherwise use text_content
        if scraped_data.get('source') == 'firecrawl' and scraped_data.get('markdown'):
            # Firecrawl: Use full markdown (better structure, more context)
            text = scraped_data.get('markdown', '')[:8000]  # Use more content from markdown
            print(f"✅ Using Firecrawl markdown ({len(text)} chars)")
        else:
            # BeautifulSoup: Use text_content
            text = scraped_data.get('text_content', '')[:5000]
            print(f"📄 Using BeautifulSoup text ({len(text)} chars)")
        
        headings = scraped_data.get('headings', {})
        links = scraped_data.get('links', [])
        
        # Extract domain as central entity
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.netloc.replace('www.', '')
        central_entity = domain.split('.')[0].title()
        
        # Fetch sitemap and scrape additional pages for better analysis
        print(f"🔍 Fetching sitemap for {domain}...")
        from .sitemap_service import sitemap_service
        from .scraper import scraper
        
        sitemap_urls = await sitemap_service.get_priority_pages(url, max_pages=5)
        print(f"📄 Found {len(sitemap_urls)} priority pages from sitemap")
        
        # Scrape additional pages in parallel with FULL content for better analysis
        async def scrape_page(sitemap_url):
            if sitemap_url == url:  # Skip the main page
                return None
            try:
                page_data = await scraper.scrape_url(sitemap_url)
                if page_data.get('status') == 'success':
                    # Get full content for content strategy analysis
                    if page_data.get('source') == 'firecrawl' and page_data.get('markdown'):
                        content_preview = page_data.get('markdown', '')[:2000]
                    else:
                        content_preview = page_data.get('text_content', '')[:1500]
                    
                    return {
                        'url': sitemap_url,
                        'title': page_data.get('title', ''),
                        'headings': page_data.get('headings', {}),
                        'content_preview': content_preview,
                        'h2_count': len(page_data.get('headings', {}).get('h2', []))
                    }
            except Exception as e:
                print(f"  -> Skipped {sitemap_url}: {str(e)}")
            return None
        
        # Scrape pages in parallel
        tasks = [scrape_page(sitemap_url) for sitemap_url in sitemap_urls[:5]]
        results = await asyncio.gather(*tasks)
        additional_pages = [page for page in results if page is not None]
        
        print(f"✅ Successfully scraped {len(additional_pages)} additional pages")
        
        # Prepare comprehensive content data
        content_data = {
            'url': url,
            'domain': domain,
            'title': title,
            'description': description,
            'h1_headings': headings.get('h1', []),
            'h2_headings': headings.get('h2', [])[:15],
            'h3_headings': headings.get('h3', [])[:15],
            'text_preview': text,
            'sample_links': [{'text': link.get('text', ''), 'url': link.get('url', '')} for link in links[:30]],
            'sitemap_pages': len(sitemap_urls),
            'additional_pages_analyzed': len(additional_pages),
            'site_structure': [     
                {
                    'url': page['url'],
                    'title': page['title'],
                    'h1': page['headings'].get('h1', [])[:3],
                    'h2': page['headings'].get('h2', [])[:5],
                    'content_preview': page.get('content_preview', '')[:500],
                    'h2_count': page.get('h2_count', 0)
                }
                for page in additional_pages[:5]
            ],
            'existing_content_themes': self._extract_content_themes(additional_pages)
        }
        
        # System prompt for AI analysis
        system_prompt = """You are an expert SEO strategist and business analyst specializing in semantic website analysis and content strategy.
Analyze the provided website data and create a comprehensive topical map following the 8-part semantic analysis framework.
Return ONLY valid JSON without markdown formatting."""
        
        # ── CALL 1: metadata, semantic, taxonomy, competitive (NO articles) ──
        prompt = f"""Analyze this website and return a topical map in JSON.

Website Data:
{json.dumps(content_data, indent=2)}

Return ONLY this JSON (replace ALL placeholder values with real data about {domain}. No markdown, no code blocks):
{{
  "business_description": "200-word description of what the company does, its business model, and value propositions",
  "central_entity": "{central_entity}",
  "business_model": "e.g. B2C Ride-hailing Platform",
  "search_intent": ["Intent 1", "Intent 2", "Intent 3"],
  "target_audiences": ["Audience 1", "Audience 2", "Audience 3"],
  "conversion_methods": ["Method 1", "Method 2"],
  "key_topics": ["Topic 1", "Topic 2", "Topic 3", "Topic 4", "Topic 5"],
  "semantic_relationships": {{
    "core_entities": ["e1","e2","e3","e4","e5"],
    "derived_entities": ["d1","d2","d3"],
    "attributes": ["a1","a2","a3","a4","a5"],
    "context_terms": ["c1","c2","c3","c4"],
    "synonyms": ["s1","s2","s3"],
    "antonyms": ["an1","an2"],
    "hypernyms": ["h1","h2"],
    "hyponyms": ["hy1","hy2","hy3"],
    "holonyms": ["ho1","ho2"],
    "meronyms": ["m1","m2","m3"],
    "troponyms": ["t1","t2"],
    "entailments": ["en1","en2"],
    "acronyms": ["ac1","ac2"],
    "polysemes": ["p1","p2"],
    "related_concepts": ["rc1","rc2","rc3"]
  }},
  "audience_segments": [
    {{"name":"Segment Name","expertise_level":"Beginner","primary_goal":"Goal","pain_points":["p1","p2"],"content_types":["t1","t2"]}}
  ],
  "content_strategy": {{
    "core_topics": ["t1","t2","t3","t4"],
    "outer_topics": ["o1","o2","o3","o4"],
    "content_gaps": ["g1","g2","g3"],
    "priority_areas": ["pa1","pa2","pa3"]
  }},
  "competitive_analysis": {{
    "top_competitors": ["c1","c2","c3","c4","c5"],
    "content_approaches": ["a1","a2","a3"],
    "gap_opportunities": ["g1","g2","g3"],
    "serp_insights": ["s1","s2","s3"]
  }},
  "seo_optimization": {{
    "topic_clusters": ["tc1","tc2","tc3"],
    "schema_recommendations": ["sr1","sr2","sr3"],
    "entity_optimization": ["eo1","eo2","eo3"]
  }},
  "competitive_advantages": ["adv1","adv2","adv3"],
  "technology_stack": ["tech1","tech2","tech3","tech4"],
  "taxonomy": [
    {{"name":"Category A","level":1,"parent":null,"children":["Sub A1","Sub A2"],"color":"#4F46E5"}},
    {{"name":"Sub A1","level":2,"parent":"Category A","children":["Topic A1a","Topic A1b"],"color":"#10B981"}},
    {{"name":"Topic A1a","level":3,"parent":"Sub A1","children":[],"color":"#F59E0B"}},
    {{"name":"Topic A1b","level":3,"parent":"Sub A1","children":[],"color":"#F59E0B"}},
    {{"name":"Sub A2","level":2,"parent":"Category A","children":["Topic A2a","Topic A2b"],"color":"#10B981"}},
    {{"name":"Topic A2a","level":3,"parent":"Sub A2","children":[],"color":"#F59E0B"}},
    {{"name":"Topic A2b","level":3,"parent":"Sub A2","children":[],"color":"#F59E0B"}}
  ],
  "ontology": [
    {{"subject":"{central_entity}","predicate":"provides","object":"Core Service","context":"Target Market"}},
    {{"subject":"Technology","predicate":"enables","object":"Business Outcome","context":"Industry"}}
  ]
}}

CRITICAL INSTRUCTIONS:
✓ Be SPECIFIC and DETAILED - use actual industry terminology, not generic placeholders
✓ Provide COMPREHENSIVE coverage - don't skip any sections
✓ Use domain expertise - demonstrate deep understanding of the industry
✓ Be ACTIONABLE - insights should directly inform content strategy
✓ Return ONLY the JSON object, no markdown code blocks or explanations
"""
        
        try:
            # Import AI service at the start
            from .ai_service import ai_service
            
            # Use DeepSeek for all analysis (high quality, no rate limits, ~10-15 min per URL)
            print(f"🤖 Generating topical analysis for {url}...")
            
            try:
                result = await ai_service.extract_json(prompt, system_prompt, use_deepseek=True)
                if not isinstance(result, dict):
                    if isinstance(result, list) and len(result) > 0 and isinstance(result[0], dict):
                        result = result[0]
                    else:
                        raise ValueError("Could not extract valid JSON: Expected a JSON object but got a list.")
                
                # Robust dictionary unwrapper: If the AI nested everything under a single root key (e.g., {"topical_map": {...}})
                if isinstance(result, dict) and len(result) == 1 and isinstance(list(result.values())[0], dict):
                    inner = list(result.values())[0]
                    # verify it actually contains our keys
                    if any(k in inner for k in ['business_description', 'key_topics', 'taxonomy', 'content_strategy', 'semantic_relationships']):
                        result = inner
            except ValueError as e:
                # If JSON parsing fails, try with a simplified prompt
                error_msg = str(e)
                if "Could not extract valid JSON" in error_msg:
                    print(f"⚠️ Comprehensive analysis failed, retrying with simplified prompt...")
                    
                    # Simplified prompt with fewer requirements
                    simplified_prompt = f"""Analyze this website and return a simplified topical map.

Website Data:
{json.dumps(content_data, indent=2)}

Return ONLY valid JSON with this structure (no markdown, no code blocks):
{{
  "business_description": "200-300 word description",
  "central_entity": "{central_entity}",
  "business_model": "B2B/B2C/SaaS/etc",
  "search_intent": ["Intent 1", "Intent 2", "Intent 3"],
  "target_audiences": ["Audience 1", "Audience 2"],
  "conversion_methods": ["Method 1", "Method 2"],
  "key_topics": ["Topic 1", "Topic 2", "Topic 3"],
  "semantic_relationships": {{
    "core_entities": ["Entity 1", "Entity 2"],
    "attributes": ["Attr 1", "Attr 2"],
    "related_concepts": ["Concept 1", "Concept 2"]
  }},
  "content_articles": [
    {{
      "title": "Article Title",
      "section": "Core",
      "article_type": "informative",
      "category_l1": "Main Category",
      "category_l2": "Subcategory",
      "category_l3": "Sub-subcategory",
      "priority": 1,
      "source_context": "Brief description"
    }}
  ],
  "taxonomy": [
    {{
      "name": "Main Category",
      "level": 1,
      "parent": null,
      "children": ["Subcategory 1"],
      "color": "#4F46E5"
    }},
    {{
      "name": "Subcategory 1",
      "level": 2,
      "parent": "Main Category",
      "children": ["Topic 1"],
      "color": "#10B981"
    }},
    {{
      "name": "Topic 1",
      "level": 3,
      "parent": "Subcategory 1",
      "children": [],
      "color": "#F59E0B"
    }}
  ]
}}

CRITICAL: Return ONLY the JSON object. No explanations, no markdown formatting."""
                    
                    result = await ai_service.extract_json(
                        simplified_prompt,
                        "You are a business analyst. Return ONLY valid JSON without markdown formatting.",
                        use_deepseek=True
                    )
                    if not isinstance(result, dict):
                        if isinstance(result, list) and len(result) > 0 and isinstance(result[0], dict):
                            result = result[0]
                        else:
                            raise ValueError("Could not extract valid JSON: Expected a JSON object but got a list.")
                    
                    if isinstance(result, dict) and len(result) == 1 and isinstance(list(result.values())[0], dict):
                        inner = list(result.values())[0]
                        if any(k in inner for k in ['business_description', 'key_topics', 'taxonomy', 'content_strategy', 'semantic_relationships']):
                            result = inner
                    print(f"✅ Simplified analysis succeeded")
                else:
                    raise
            
            # Parse semantic relationships
            semantic_rel = None
            if 'semantic_relationships' in result:
                from models.schemas import SemanticRelationships
                semantic_rel = SemanticRelationships(**result['semantic_relationships'])
            
            # Parse audience segments
            audience_segs = None
            if 'audience_segments' in result and result['audience_segments']:
                from models.schemas import AudienceSegment
                audience_segs = [AudienceSegment(**seg) for seg in result['audience_segments']]
            
            # Parse content strategy
            content_strat = None
            if 'content_strategy' in result:
                from models.schemas import ContentStrategy
                content_strat = ContentStrategy(**result['content_strategy'])
            
            # Parse query templates
            query_temps = None
            if 'query_templates' in result:
                from models.schemas import QueryTemplates
                query_temps = QueryTemplates(**result['query_templates'])
            
            # Parse competitive analysis (Part 3)
            competitive_analysis = None
            if 'competitive_analysis' in result:
                from models.schemas import CompetitiveAnalysis
                competitive_analysis = CompetitiveAnalysis(**result['competitive_analysis'])
            
            # ── CALL 2: Generate content_articles separately (competitor-aware) ──
            content_articles = None
            try:
                core_topics = result.get('content_strategy', {}).get('core_topics', [])
                outer_topics = result.get('content_strategy', {}).get('outer_topics', [])
                key_topics = result.get('key_topics', [])

                # Build competitor context block if provided
                comp_block = ''
                if competitor_context:
                    comp_lines = []
                    for c in competitor_context:
                        comp_lines.append(
                            f"  - {c['url']}: topics={c.get('key_topics', [])[:6]}, "
                            f"core={c.get('core_topics', [])[:4]}, "
                            f"gaps they fill={c.get('content_gaps', [])[:3]}"
                        )
                    comp_block = (
                        "\n\nCOMPETITOR INTELLIGENCE (topics these competitors rank for that {domain} does NOT yet cover):\n"
                        + "\n".join(comp_lines)
                        + "\n\nPRIORITY RULE: At least 8 of the 15 articles must directly target a gap "
                          "identified from the competitor list above. For those articles, set "
                          "source_context to start with 'Gap vs [competitor domain]: ...'"
                    ).format(domain=domain)

                articles_prompt = f"""Generate 15 SEO article ideas for {domain} ({result.get('business_model', 'business')}).

Key topics: {', '.join(key_topics[:5])}
Core content areas: {', '.join(core_topics[:4])}
Outer content areas: {', '.join(outer_topics[:4])}{comp_block}

Return ONLY a JSON array (no markdown):
[
  {{
    "title": "Specific SEO article title",
    "section": "Core",
    "article_type": "informative",
    "category_l1": "Main Category",
    "category_l2": "Subcategory",
    "category_l3": "Sub-topic",
    "priority": 1,
    "source_context": "One sentence on content angle (start with 'Gap vs [competitor]: ' for gap articles)."
  }}
]

Generate 15 diverse articles mixing Core and Outer sections. Return ONLY the JSON array."""

                print(f"📝 Generating content articles (Call 2)...")
                articles_result = await ai_service.extract_json(
                    articles_prompt,
                    "You are an SEO content strategist. Return ONLY a valid JSON array of article objects. No markdown.",
                    use_deepseek=True
                )
                from models.schemas import ContentArticle
                articles_data = articles_result if isinstance(articles_result, list) else articles_result.get('articles', [])
                content_articles = [ContentArticle(**a) for a in articles_data if isinstance(a, dict)]
                print(f"✅ Generated {len(content_articles)} articles from Call 2")
            except Exception as e:
                print(f"⚠️ Article generation failed: {str(e)}, continuing without articles")

            print(f"✅ Generated {len(content_articles or [])} articles from initial analysis")

            seo_optimization = None
            if 'seo_optimization' in result:
                from models.schemas import SEOOptimization
                seo_optimization = SEOOptimization(**result['seo_optimization'])
            
            # Parse taxonomy (Part 9)
            taxonomy = None
            if 'taxonomy' in result and result['taxonomy']:
                from models.schemas import TaxonomyNode
                taxonomy = [TaxonomyNode(**node) for node in result['taxonomy']]
                
                # Validate taxonomy: Remove L1/L2 nodes with empty children
                if taxonomy:
                    validated_taxonomy = []
                    nodes_to_remove = set()
                    
                    # First pass: identify L1 and L2 nodes with no children
                    for node in taxonomy:
                        if node.level in [1, 2] and (not node.children or len(node.children) == 0):
                            nodes_to_remove.add(node.name)
                            print(f"⚠️  Removing empty taxonomy node: {node.name} (Level {node.level})")
                    
                    # Second pass: remove nodes and update parent references
                    for node in taxonomy:
                        if node.name in nodes_to_remove:
                            continue
                        if node.children:
                            node.children = [child for child in node.children if child not in nodes_to_remove]
                        validated_taxonomy.append(node)
                    
                    taxonomy = validated_taxonomy if validated_taxonomy else None
                    
                    if taxonomy:
                        print(f"✅ Validated taxonomy: {len(taxonomy)} nodes (removed {len(nodes_to_remove)} empty branches)")
            
            # Parse ontology (Part 10)
            ontology = None
            if 'ontology' in result and result['ontology']:
                from models.schemas import OntologyRelation
                ontology = [OntologyRelation(**relation) for relation in result['ontology']]

            
            # Competitor detection: AI is the source of truth for competitors.
            # SERP is only used to enrich PAA questions and related searches.
            # Rationale: SERP returns sites that *rank* for broad keywords (e.g. g2.com, gartner.com),
            # not actual business competitors. The AI correctly identifies real rivals
            # (e.g. bing.com / ecosia.com for google.com) based on semantic understanding.
            if competitive_analysis:
                print(f"✅ Using AI-identified competitors: {', '.join(competitive_analysis.top_competitors[:5])}")
                
                try:
                    from .serp_service import serp_service
                    
                    # Use key topics as search queries to fetch PAA + related searches from SERP
                    # (we do NOT use these results to overwrite competitors)
                    serp_queries = result.get('key_topics', [])[:3]
                    if not serp_queries:
                        serp_queries = [result.get('central_entity', domain)]
                    
                    print(f"  📊 Fetching SERP enrichment (PAA/related searches) for: {serp_queries}")
                    serp_insights = await serp_service.get_serp_insights(serp_queries, domain)
                    
                    # Only use SERP data to enrich PAA questions and related searches
                    if serp_insights.get('people_also_ask'):
                        competitive_analysis.serp_insights.extend([
                            f"PAA: {q}" for q in serp_insights['people_also_ask'][:10]
                        ])
                        print(f"  ✅ Added {len(serp_insights['people_also_ask'][:10])} PAA questions from SERP")
                    
                    if serp_insights.get('related_searches'):
                        competitive_analysis.serp_insights.extend([
                            f"Related: {s}" for s in serp_insights['related_searches'][:5]
                        ])
                        print(f"  ✅ Added {len(serp_insights['related_searches'][:5])} related searches from SERP")
                    
                    # NOTE: We intentionally do NOT overwrite competitive_analysis.top_competitors here.
                    # The AI already identified the correct direct competitors in the main analysis prompt.
                    
                except Exception as e:
                    print(f"⚠️ Error fetching SERP enrichment (PAA/related): {str(e)}")
                    # Competitors from AI are already set — no fallback needed
                    pass


            # Create comprehensive TopicalMapData
            return TopicalMapData(
                url=url,
                business_description=result.get('business_description', '')[:1500],
                central_entity=result.get('central_entity', central_entity),
                business_model=result.get('business_model', 'Information/Content'),
                search_intent=result.get('search_intent', ['Informational'])[:5],
                target_audiences=result.get('target_audiences', ['General Public'])[:10],
                conversion_methods=result.get('conversion_methods', ['Contact Form'])[:15],
                key_topics=result.get('key_topics', [])[:15],
                semantic_relationships=semantic_rel,
                audience_segments=audience_segs,
                content_strategy=content_strat,
                query_templates=query_temps,
                competitive_advantages=result.get('competitive_advantages', [])[:10],
                technology_stack=result.get('technology_stack', [])[:10],
                competitive_analysis=competitive_analysis,
                content_articles=content_articles,  # Initial articles from AI response
                seo_optimization=seo_optimization,
                taxonomy=taxonomy,
                ontology=ontology
            )
            
        except Exception as e:
            print(f"❌ AI topical map generation failed: {str(e)}")
            raise  # Let the error propagate instead of using fallback
    
    async def _generate_expansive_content_plan(
        self, 
        content_data: Dict, 
        content_strategy: Dict,
        semantic_relationships: Dict,
        initial_articles: List
    ) -> List:
        """
        Generate 40-50 article ideas using batch processing.
        
        This method:
        1. Extracts taxonomy categories from initial articles
        2. Generates 8-10 articles per category
        3. Processes categories sequentially to avoid rate limits
        4. Returns comprehensive content plan
        """
        import asyncio
        from models.schemas import ContentArticle
        
        # Extract taxonomy categories from initial articles
        categories = {}
        for article in initial_articles:
            l1 = article.category_l1
            if l1 not in categories:
                categories[l1] = set()
            if hasattr(article, 'category_l2') and article.category_l2:
                categories[l1].add(article.category_l2)
        
        # If no initial articles, create default categories from content strategy
        if not categories:
            core_topics = content_strategy.get('core_topics', [])
            outer_topics = content_strategy.get('outer_topics', [])
            for topic in (core_topics + outer_topics)[:10]:
                categories[topic] = set(['Overview', 'Guide', 'Best Practices'])
        
        print(f"📊 Generating content for {len(categories)} main categories...")
        
        # Generate articles sequentially with delays to avoid rate limits
        all_expanded_articles = []
        
        for idx, (category_l1, subcategories) in enumerate(list(categories.items())[:4]):
            print(f"  📁 Processing category {idx + 1}/4: {category_l1}")
            
            try:
                articles = await self._generate_category_articles(
                    content_data,
                    category_l1,
                    list(subcategories)[:5] if subcategories else ['General'],
                    semantic_relationships
                )
                all_expanded_articles.extend(articles)
                print(f"    ✅ Generated {len(articles)} articles for {category_l1}")
                
                # Add delay between categories to avoid rate limits (except for last one)
                if idx < len(list(categories.items())[:4]) - 1:
                    print(f"    ⏳ Waiting 1 second before next category...")
                    await asyncio.sleep(1)
                    
            except Exception as e:
                print(f"    ❌ Error generating articles for {category_l1}: {e}")
                # Continue with next category even if one fails
                continue
        
        print(f"✅ Generated {len(all_expanded_articles)} additional articles")
        return all_expanded_articles
    
    async def _generate_category_articles(
        self,
        content_data: Dict,
        category_l1: str,
        subcategories: List[str],
        semantic_relationships: Dict
    ) -> List:
        """
        Generate 8-10 articles for a specific category.
        
        Uses DeepSeek AI to create diverse article types:
        - Beginner guides (2-3 articles)
        - Advanced tutorials (2-3 articles)
        - Comparison/Review content (2-3 articles)
        - Tool/Resource pages (1-2 articles)
        """
        from models.schemas import ContentArticle
        
        system_prompt = """You are an expert content strategist. Generate comprehensive article ideas for the given category.
Return ONLY valid JSON array without markdown formatting."""
        
        prompt = f"""Generate 8-10 detailed article ideas for this content category.

Business Context:
- Domain: {content_data.get('domain')}
- Main Topic: {category_l1}
- Subcategories: {', '.join(subcategories)}

Semantic Context:
- Related Terms: {', '.join(semantic_relationships.get('related_concepts', [])[:10])}
- Core Entities: {', '.join(semantic_relationships.get('core_entities', [])[:10])}

Generate articles covering:
1. Beginner guides (2-3 articles)
2. Advanced tutorials (2-3 articles)
3. Comparison/Review content (2-3 articles)
4. Tool/Resource pages (1-2 articles)

Return JSON array with this structure:
[
  {{
    "title": "Specific, SEO-optimized article title",
    "section": "Core or Outer",
    "article_type": "informative/service_page/listicle/tool_page/case_study/comparison",
    "category_l1": "{category_l1}",
    "category_l2": "Subcategory from list above",
    "category_l3": "Specific sub-topic",
    "priority": 1-3,
    "source_context": "2-3 sentences on how to create this content, what to include, CTAs"
  }}
]

Make titles specific, actionable, and SEO-friendly. Vary the article types and priorities.
"""
        
        # Retry logic for rate limits
        max_retries = 3
        for attempt in range(max_retries):
            try:
                # Use DeepSeek for bulk article generation (reliable, no rate limits)
                result = await ai_service.extract_json(prompt, system_prompt, use_deepseek=True)
                
                # Handle both array and object responses
                articles_data = result if isinstance(result, list) else result.get('articles', [])
                
                articles = []
                for article_data in articles_data[:10]:  # Limit to 10 per category
                    try:
                        article = ContentArticle(**article_data)
                        articles.append(article)
                    except Exception as e:
                        print(f"      ⚠️  Error parsing article: {e}")
                        continue
                
                return articles
                
            except Exception as e:
                error_str = str(e)
                # Check if it's a rate limit error
                if 'rate_limit' in error_str.lower() or '429' in error_str:
                    if attempt < max_retries - 1:
                        wait_time = (attempt + 1) * 2  # 2s, 4s, 6s
                        print(f"      ⏳ Rate limit hit, retrying in {wait_time}s... (attempt {attempt + 1}/{max_retries})")
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        print(f"      ❌ Max retries reached for category {category_l1}")
                        return []  # Return empty list instead of raising
                else:
                    # Non-rate-limit error, return empty list
                    print(f"      ❌ Error generating articles for category {category_l1}: {e}")
                    return []
        
        # If all retries exhausted, return empty list
        return []
    
    async def generate_multiple(self, scraped_data_list: List[Dict]) -> List[TopicalMapData]:
        """
        Generate topical maps for multiple URLs.

        The PRIMARY site (index 0) is generated with competitor context so its
        article suggestions are gap-driven rather than generic.
        Competitor sites are still analysed independently for their own data.
        """
        import asyncio

        if not scraped_data_list:
            return []

        # ── Step 1: generate competitor maps first (needed as context for primary) ──
        primary_data = scraped_data_list[0] if scraped_data_list[0].get('status') == 'success' else None
        competitor_data_list = [d for d in scraped_data_list[1:] if d.get('status') == 'success']

        # Generate competitor maps in parallel (no competitor context needed for these)
        competitor_tasks = [self.generate_topical_map_with_ai(d) for d in competitor_data_list]
        competitor_results_raw = await asyncio.gather(*competitor_tasks, return_exceptions=True)

        competitor_maps = []
        for r in competitor_results_raw:
            if isinstance(r, Exception):
                print(f"⚠️ Competitor topical map failed: {r}")
            else:
                competitor_maps.append(r)

        # ── Step 2: build competitor context summaries for primary ──
        competitor_context = []
        for cm in competitor_maps:
            competitor_context.append({
                'url': cm.url,
                'key_topics': cm.key_topics or [],
                'core_topics': (cm.content_strategy.core_topics if cm.content_strategy else []),
                'content_gaps': (cm.content_strategy.content_gaps if cm.content_strategy else []),
            })

        # ── Step 3: generate primary map with competitor context ──
        tasks = []
        if primary_data:
            tasks.append(self.generate_topical_map_with_ai(primary_data, competitor_context=competitor_context or None))
        
        if tasks:
            # Use return_exceptions=True to allow partial success
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Filter out exceptions
            primary_map = None
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    print(f"⚠️ Primary topical map generation failed: {str(result)}")
                else:
                    primary_map = result

            if not primary_map and not competitor_maps:
                raise ValueError("All topical map generations failed")

            # Return: primary first (index 0), then competitors
            final = []
            if primary_map:
                final.append(primary_map)
            final.extend(competitor_maps)
            return final

        # No primary data — return just competitor maps
        return competitor_maps


# Singleton instance
topical_generator = TopicalMapGenerator()
