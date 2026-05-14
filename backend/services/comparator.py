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

        system_prompt = """You are a senior SEO strategist specialising in competitive topical authority analysis.
Your job is to analyse a primary website versus its competitors and produce a clear, highly actionable battle-plan
that tells the primary site EXACTLY what content to create, update, or optimise to outrank and out-authorise the competition.
Return ONLY valid JSON without markdown formatting or explanation."""

        prompt = f"""PRIMARY SITE:
{json.dumps(primary_summary, indent=2)}

COMPETITORS:
{json.dumps(competitor_summaries, indent=2)}

Analyse the data above and return a JSON object with the following fields:

{{
  "gap_summary": "A 3-5 sentence executive summary explaining the primary site's current position relative to competitors and the single most important action to take.",

  "topic_gaps": [
    "List of 8-15 specific topic areas that competitors cover but the primary site does NOT. Be specific — use real topic names from the competitor data."
  ],

  "entity_gaps": [
    "List of 6-10 semantic entities/concepts that appear prominently in competitor content but are absent or weak on the primary site."
  ],

  "quick_wins": [
    "5-7 high-priority content actions the primary site can take RIGHT NOW to close the gap fastest. Start each with an action verb. Be very specific."
  ],

  "content_opportunities": [
    "5-8 longer-term strategic content opportunities the primary site should invest in over the next 3-6 months to build topical authority."
  ],

  "recommended_articles": [
    {{
      "title": "Exact proposed article title (SEO-friendly)",
      "reason": "Why this article will close a gap vs a specific competitor",
      "priority": 1,
      "competitor_source": "URL of the competitor that covers this topic"
    }}
  ]
}}

Rules:
- recommended_articles: provide 8-12 articles, with 3-4 at priority 1, 3-4 at priority 2, 2-4 at priority 3.
- Be specific — reference actual topics, competitor URLs, and real content themes from the data.
- Do NOT make generic suggestions like "write more blog posts". Every item must be directly derived from the competitive gap.
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
