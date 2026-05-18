from typing import Dict, List
from models.schemas import ComparisonData, TopicalMapData, RecommendedArticle
from .ai_service import ai_service
import json


class Comparator:
    """AI-powered competitor gap analysis engine.

    Goal: given a primary site (index 0) and one or more competitors,
    produce **actionable recommendations** on how the primary site can
    achieve greater topical authority than the competition.
    """

    async def compare_websites_with_ai(
        self,
        scraped_data_list: List[Dict],
        topical_maps: List[TopicalMapData],
    ) -> ComparisonData:
        """Generate competitor-beating gap analysis using AI."""

        if len(scraped_data_list) < 2:
            return None

        # ── Identify primary vs competitors ─────────────────────────────────
        primary_data = scraped_data_list[0]
        primary_map = topical_maps[0] if topical_maps else None
        competitor_data = scraped_data_list[1:]
        competitor_maps = topical_maps[1:] if len(topical_maps) > 1 else []

        def site_summary(data: Dict, tmap: TopicalMapData) -> Dict:
            if data.get('source') == 'firecrawl' and data.get('markdown'):
                text_preview = data.get('markdown', '')[:1500]
            else:
                text_preview = data.get('text_content', '')[:1000]
            return {
                'url': data['url'],
                'title': data.get('title', ''),
                'key_topics': tmap.key_topics if tmap else [],
                'content_gaps': (tmap.content_strategy.content_gaps if tmap and tmap.content_strategy else []),
                'core_topics': (tmap.content_strategy.core_topics if tmap and tmap.content_strategy else []),
                'outer_topics': (tmap.content_strategy.outer_topics if tmap and tmap.content_strategy else []),
                'target_audiences': tmap.target_audiences if tmap else [],
                'semantic_core_entities': (tmap.semantic_relationships.core_entities if tmap and tmap.semantic_relationships else []),
                'h2_headings': data.get('headings', {}).get('h2', [])[:12],
                'text_preview': text_preview,
                'competitive_advantages': (tmap.competitive_advantages or []) if tmap else [],
                'competitor_top_competitors': (tmap.competitive_analysis.top_competitors if tmap and tmap.competitive_analysis else []),
            }

        primary_summary = site_summary(primary_data, primary_map) if primary_data.get('status') == 'success' else {}
        competitor_summaries = [
            site_summary(d, m)
            for d, m in zip(competitor_data, competitor_maps)
            if d.get('status') == 'success'
        ]

        if not competitor_summaries:
            return None

        competitor_urls = [s['url'] for s in competitor_summaries]
        competitor_list_str = "\n".join(f"  - {u}" for u in competitor_urls)

        system_prompt = f"""You are an aggressive SEO strategist whose sole job is to help the PRIMARY site beat its competitors in search rankings and topical authority.
You have been given data on the PRIMARY site and its competitors. Your output must be a concrete, specific battle-plan — not a generic gap analysis.
Every recommendation MUST name the specific competitor it targets and explain exactly what content to create to outrank them.
The primary site's goal is to DOMINATE these competitors:
{competitor_list_str}
Return ONLY valid JSON without markdown formatting or explanation."""

        prompt = f"""PRIMARY SITE:
{json.dumps(primary_summary, indent=2)}

COMPETITORS TO BEAT:
{json.dumps(competitor_summaries, indent=2)}

Your task: produce a BATTLE-PLAN that tells the primary site exactly what to do to outrank and out-authorise every competitor listed above.

Return this exact JSON structure:

{{
  "gap_summary": "3-5 sentences: current position of the primary site vs competitors, its biggest weakness, and the #1 action that would have the highest ranking impact. Be direct and specific — name the competitors.",

  "topic_gaps": [
    "Each item MUST follow this format: '[Topic name] — covered by [competitor domain] but absent from {primary_summary.get('url','primary site')}. Creating this content would directly challenge [competitor domain] for [keyword/intent].'",
    "Provide 8-15 items."
  ],

  "entity_gaps": [
    "Each item MUST follow this format: '[Entity name] — prominent on [competitor domain]. Adding this entity to the primary site's content would improve semantic relevance and challenge [competitor domain] on [topic].'",
    "Provide 6-10 items."
  ],

  "quick_wins": [
    "Each item MUST follow this format: '[Action verb] [specific content piece] to directly compete with [competitor domain] on [specific keyword/topic]. Expected impact: [brief impact statement].'",
    "Provide 5-7 items ordered by estimated impact (highest first)."
  ],

  "content_opportunities": [
    "Each item MUST follow this format: 'Build topical authority on [topic cluster] — currently owned by [competitor domain]. A series of [N] articles would challenge their dominance within [timeframe].'",
    "Provide 5-8 strategic opportunities for 3-6 month horizon."
  ],

  "recommended_articles": [
    {{
      "title": "Exact SEO-optimised article title (include primary keyword)",
      "reason": "This article directly competes with [competitor domain] for [keyword]. They rank for this because [brief reason]. Our angle: [differentiation].",
      "priority": 1,
      "competitor_source": "URL of the specific competitor this article targets"
    }}
  ]
}}

RULES:
- recommended_articles: 8-12 articles. 3-4 at priority 1 (immediate — will close biggest gaps), 3-4 at priority 2 (next 30 days), 2-4 at priority 3 (longer term).
- Every single item in every array must reference a real competitor by domain/URL.
- Do NOT write generic advice like "publish more content". Every item must be traceable to specific competitor data above.
- Return ONLY the JSON object.
"""

        try:
            result = await ai_service.extract_json(prompt, system_prompt, use_deepseek=True)

            # Parse recommended_articles
            raw_articles = result.get('recommended_articles', [])
            recommended_articles = []
            for a in raw_articles:
                if isinstance(a, dict):
                    try:
                        recommended_articles.append(RecommendedArticle(
                            title=a.get('title', ''),
                            reason=a.get('reason', ''),
                            priority=int(a.get('priority', 2)),
                            competitor_source=a.get('competitor_source'),
                        ))
                    except Exception:
                        pass

            return ComparisonData(
                gap_summary=result.get('gap_summary', ''),
                topic_gaps=result.get('topic_gaps', [])[:15],
                entity_gaps=result.get('entity_gaps', [])[:10],
                quick_wins=result.get('quick_wins', [])[:7],
                content_opportunities=result.get('content_opportunities', [])[:8],
                recommended_articles=recommended_articles,
                # Legacy fields — populate lightly so old UI doesn't break
                business_models={s['url']: 'See gap summary' for s in [primary_summary] + competitor_summaries},
                service_overlap=[],
                unique_services={},
                audience_comparison={},
                technology_stack={},
                geographic_coverage={},
                similarity_matrix={},
            )

        except Exception as e:
            print(f"AI competitor gap analysis failed: {str(e)}")
            return self._fallback_comparison(scraped_data_list, topical_maps)

    def _fallback_comparison(
        self,
        scraped_data_list: List[Dict],
        topical_maps: List[TopicalMapData],
    ) -> ComparisonData:
        """Minimal fallback when AI fails."""
        primary_map = topical_maps[0] if topical_maps else None
        competitor_maps = topical_maps[1:] if len(topical_maps) > 1 else []

        primary_topics = set(primary_map.key_topics) if primary_map else set()
        comp_topics: set = set()
        for m in competitor_maps:
            comp_topics.update(m.key_topics)

        topic_gaps = list(comp_topics - primary_topics)[:10]

        return ComparisonData(
            gap_summary=f"The primary site covers {len(primary_topics)} key topics while competitors collectively cover {len(comp_topics)}. There are {len(topic_gaps)} topic gaps identified.",
            topic_gaps=topic_gaps,
            entity_gaps=[],
            quick_wins=[f"Create content covering: {t}" for t in topic_gaps[:5]],
            content_opportunities=[],
            recommended_articles=[
                RecommendedArticle(title=f"Guide to {t}", reason="Covered by competitors but absent from primary site", priority=1)
                for t in topic_gaps[:5]
            ],
            business_models={},
            service_overlap=[],
            unique_services={},
            audience_comparison={},
            technology_stack={},
            geographic_coverage={},
            similarity_matrix={},
        )

    async def compare_websites(
        self,
        scraped_data_list: List[Dict],
        topical_maps: List[TopicalMapData],
    ) -> ComparisonData:
        """Main comparison method."""
        return await self.compare_websites_with_ai(scraped_data_list, topical_maps)


# Singleton instance
comparator = Comparator()
