"""
AI-Powered Knowledge Graph Generator
Generates separate knowledge graph clusters for each domain
"""
import networkx as nx
from typing import Dict, List
from models.schemas import KnowledgeGraphData, Node, Link
from .ai_service import ai_service
import json
from urllib.parse import urlparse


class KnowledgeGraphGenerator:
    """Generate knowledge graphs with AI-powered entity extraction and domain-based clustering"""
    
    def __init__(self):
        # Color palette for different domains
        self.domain_colors = [
            '#3b82f6',  # Blue
            '#ef4444',  # Red
            '#10b981',  # Green
            '#f59e0b',  # Amber
            '#8b5cf6',  # Purple
            '#ec4899',  # Pink
            '#06b6d4',  # Cyan
            '#f97316',  # Orange
            '#14b8a6',  # Teal
            '#a855f7',  # Violet
        ]
    
    async def extract_entities_for_domain(self, domain: str, scraped_content: Dict, additional_pages: List[Dict] = None) -> Dict:
        """Extract entities for a specific domain using AI with multi-page analysis"""
        
        # Use Firecrawl markdown if available for better content
        if scraped_content.get('source') == 'firecrawl' and scraped_content.get('markdown'):
            main_text = scraped_content.get('markdown', '')[:3000]
        else:
            main_text = scraped_content.get('text_content', '')[:2000]
        
        # Prepare comprehensive content from multiple pages
        main_content = f"""
Domain: {domain}
Title: {scraped_content.get('title', '')}
Description: {scraped_content.get('description', '')}
Main Content: {main_text}
"""
        
        # Add additional page data if available
        additional_context = ""
        if additional_pages:
            additional_context = "\n\nAdditional Pages Analyzed:\n"
            for idx, page in enumerate(additional_pages[:5], 1):
                additional_context += f"\nPage {idx}:\n"
                additional_context += f"- Title: {page.get('title', 'N/A')}\n"
                additional_context += f"- H1: {', '.join(page.get('headings', {}).get('h1', [])[:2])}\n"
                additional_context += f"- H2: {', '.join(page.get('headings', {}).get('h2', [])[:3])}\n"
        
        system_prompt = """You are an expert at analyzing websites and extracting key entities.
Extract the most important entities from the website content across multiple pages.
Return ONLY valid JSON without markdown formatting."""
        
        prompt = f"""Analyze this website comprehensively and extract key entities:

{main_content}
{additional_context}

Extract entities in these categories:
- services: Main services or offerings (max 10)
- products: Specific products (max 10)
- technologies: Technologies used or mentioned (max 8)
- audiences: Target audiences (max 6)
- topics: Main topics or themes (max 8)

Return JSON format:
{{
  "services": ["Service 1", "Service 2"],
  "products": ["Product 1", "Product 2"],
  "technologies": ["Tech 1", "Tech 2"],
  "audiences": ["Audience 1", "Audience 2"],
  "topics": ["Topic 1", "Topic 2"]
}}

Keep names concise (under 40 characters). Prioritize the most important and frequently mentioned entities."""
        
        try:
            # Use DeepSeek for entity extraction (better quality, no rate limits)
            entities = await ai_service.extract_json(prompt, system_prompt, use_deepseek=True)
            
            # Validate and clean
            cleaned = {}
            for key in ['services', 'products', 'technologies', 'audiences', 'topics']:
                if key in entities and isinstance(entities[key], list):
                    cleaned[key] = [str(item)[:40] for item in entities[key][:12]]
                else:
                    cleaned[key] = []
            
            return cleaned
            
        except Exception as e:
            print(f"AI extraction failed for {domain}: {e}")
            return {
                'services': [],
                'products': [],
                'technologies': [],
                'audiences': [],
                'topics': []
            }
    
    async def generate_graph(self, scraped_data: List[Dict]) -> KnowledgeGraphData:
        """Generate a single unified knowledge graph centred on the PRIMARY site.

        - Primary site entities -> emerald (covered)
        - Competitor-exclusive entities -> amber / gap nodes (gap=True)
        """
        print("Generating AI-powered knowledge graph (primary + competitor gap view)...")

        nodes = []
        links = []
        node_ids = set()

        from .sitemap_service import sitemap_service
        from .scraper import scraper
        import asyncio

        # Group by domain
        domain_groups = {}
        for data in scraped_data:
            if data.get('status') != 'success':
                continue
            parsed = urlparse(data['url'])
            domain = parsed.netloc.replace('www.', '')
            domain_groups.setdefault(domain, []).append(data)

        domains = list(domain_groups.keys())
        primary_domain = domains[0] if domains else None
        competitor_domains = domains[1:]

        print(f"  Primary: {primary_domain} | Competitors: {', '.join(competitor_domains) or 'none'}")

        PRIMARY_COLOR = '#10b981'   # emerald - existing coverage
        GAP_COLOR     = '#f59e0b'   # amber   - competitor has, primary doesn't

        # Extract entities per domain
        domain_entities = {}

        for idx, (domain, domain_data_list) in enumerate(domain_groups.items()):
            print(f"  Processing {domain}...")
            all_entities = {k: [] for k in ['services', 'products', 'technologies', 'audiences', 'topics']}

            for data in domain_data_list:
                url = data['url']
                additional_pages = []
                if domain_data_list.index(data) == 0:
                    sitemap_urls = await sitemap_service.get_priority_pages(url, max_pages=5)

                    async def scrape_page(su):
                        if su == url:
                            return None
                        try:
                            pd = await scraper.scrape_url(su)
                            if pd.get('status') == 'success':
                                return {'url': su, 'title': pd.get('title', ''), 'headings': pd.get('headings', {})}
                        except Exception:
                            pass
                        return None

                    tasks = [scrape_page(su) for su in sitemap_urls[:4]]
                    results = await asyncio.gather(*tasks)
                    additional_pages = [p for p in results if p]

                entities = await self.extract_entities_for_domain(domain, data, additional_pages)
                for etype, elist in entities.items():
                    for e in elist:
                        if e and e not in all_entities[etype]:
                            all_entities[etype].append(e)

            domain_entities[domain] = all_entities

        # Build primary domain cluster
        if primary_domain:
            primary_ents = domain_entities.get(primary_domain, {})

            # Collect all competitor entity names
            comp_entity_set = set()
            comp_entity_source = {}
            for cd in competitor_domains:
                cd_data_list = domain_groups[cd]
                cd_url = cd_data_list[0]['url'] if cd_data_list else cd
                for etype, elist in domain_entities.get(cd, {}).items():
                    for e in elist:
                        key = e.strip().lower()
                        comp_entity_set.add(key)
                        if key not in comp_entity_source:
                            comp_entity_source[key] = cd_url

            # Primary domain node
            domain_id = f"domain_{primary_domain}"
            nodes.append(Node(
                id=domain_id,
                label=primary_domain,
                type='domain',
                color=PRIMARY_COLOR,
                size=80,
                gap=False,
            ))
            node_ids.add(domain_id)

            # Primary entity nodes
            for etype, elist in primary_ents.items():
                for entity in elist:
                    if not entity:
                        continue
                    node_id = f"{primary_domain}_{etype}_{entity}"
                    if node_id not in node_ids:
                        nodes.append(Node(
                            id=node_id,
                            label=entity,
                            type=etype,
                            color=PRIMARY_COLOR,
                            size=35,
                            gap=False,
                        ))
                        node_ids.add(node_id)
                        links.append(Link(source=domain_id, target=node_id, label=etype, inferred=False))

            # Build set of primary entity names (normalised)
            primary_entity_set = {e.strip().lower() for elist in primary_ents.values() for e in elist}

            # Gap nodes - competitor entities NOT in primary
            seen_gap_entities = set()
            for cd in competitor_domains:
                for etype, elist in domain_entities.get(cd, {}).items():
                    for entity in elist:
                        if not entity:
                            continue
                        key = entity.strip().lower()
                        if key not in primary_entity_set and key not in seen_gap_entities:
                            seen_gap_entities.add(key)
                            node_id = f"gap_{etype}_{entity}"
                            if node_id not in node_ids:
                                source_url = comp_entity_source.get(key, cd)
                                nodes.append(Node(
                                    id=node_id,
                                    label=entity,
                                    type=etype,
                                    color=GAP_COLOR,
                                    size=28,
                                    gap=True,
                                    source_url=source_url,
                                ))
                                node_ids.add(node_id)
                                links.append(Link(
                                    source=domain_id,
                                    target=node_id,
                                    label=f"gap:{etype}",
                                    inferred=True,
                                ))

            # Intra-domain connections
            for service in primary_ents.get('services', [])[:3]:
                s_id = f"{primary_domain}_services_{service}"
                if s_id in node_ids:
                    for product in primary_ents.get('products', [])[:2]:
                        p_id = f"{primary_domain}_products_{product}"
                        if p_id in node_ids:
                            links.append(Link(source=s_id, target=p_id, label='offers', inferred=False))
            for tech in primary_ents.get('technologies', [])[:3]:
                t_id = f"{primary_domain}_technologies_{tech}"
                if t_id in node_ids:
                    for service in primary_ents.get('services', [])[:2]:
                        s_id = f"{primary_domain}_services_{service}"
                        if s_id in node_ids:
                            links.append(Link(source=t_id, target=s_id, label='powers', inferred=False))

        gap_count = sum(1 for n in nodes if n.gap)
        print(f"Knowledge graph complete!")
        print(f"   - {len(nodes)} nodes ({len(nodes) - gap_count} primary, {gap_count} gaps)")
        print(f"   - {len(links)} relationships")

        return KnowledgeGraphData(nodes=nodes, links=links)


# Singleton instance
kg_generator = KnowledgeGraphGenerator()
