"""AI monthly SEO report generator.

Assembles a normalized data snapshot for a client site, then has Claude write a
polished, client-facing monthly report from it. Today it draws on SE Ranking
keyword data; GSC and GA4 sections plug into `assemble_context()` the same way as
those integrations come online.
"""
from typing import Dict, Optional
import json
import logging

from services.ai_service import ai_service
from services.seranking_service import SERankingService

logger = logging.getLogger(__name__)


REPORT_SYSTEM_PROMPT = """You are a senior SEO account manager at TBS Marketing writing the monthly performance report a client will actually read.

Write in clear, confident, plain English for a busy business owner — not an SEO technician. Explain what the numbers mean for their business, not just what they are. Be honest about declines but frame them constructively with the plan to address them.

Structure the report in Markdown:
1. **Executive Summary** — 3–4 sentences: the headline story of the month.
2. **Keyword Rankings** — how visibility changed: how many keywords are on page 1 (top 10), notable climbers (name the keyword and the movement), and any that slipped. Reference real numbers from the data.
3. **Wins of the Month** — 2–4 concrete positives.
4. **Areas to Improve** — 1–3 honest opportunities.
5. **Recommended Next Steps** — 3–5 specific, actionable items for next month.

Rules:
- Use ONLY the data provided. Never invent metrics, keywords, or numbers.
- When you cite a keyword, use its real text and real position from the data.
- Keep it concise — a client should read it in 3–4 minutes.
- Do not include a code block or raw JSON. Output clean Markdown starting with an H1 title."""


async def assemble_context(site_id: int, days: int = 30) -> Dict:
    """Gather all available data for a site into one normalized dict for the AI.

    Extensible: GSC and GA4 blocks are added here as those integrations land.
    """
    svc = SERankingService()

    projects = await svc.get_projects()
    project = next((p for p in projects if p.get('id') == site_id), None)

    positions = await svc.get_keyword_positions(site_id, days)

    # Pre-digest movers so the model doesn't have to scan the full keyword list.
    kws = positions.get('keywords', [])
    rising = sorted(
        [k for k in kws if k.get('change') and k['change'] > 0],
        key=lambda k: k['change'], reverse=True
    )[:10]
    falling = sorted(
        [k for k in kws if k.get('change') and k['change'] < 0],
        key=lambda k: k['change']
    )[:10]
    top_ranked = [k for k in kws if k.get('position')][:15]

    return {
        'site': {
            'domain': project.get('domain') if project else str(site_id),
            'title': project.get('title') if project else None,
        },
        'period_days': days,
        'period': positions.get('period'),
        'seranking': {
            'summary': positions.get('summary'),
            'top_ranked_keywords': top_ranked,
            'biggest_climbers': rising,
            'biggest_drops': falling,
        },
        # 'gsc': {...},   # added in a later phase
        # 'ga4': {...},   # added in a later phase
    }


async def generate_monthly_report(site_id: int, days: int = 30) -> Dict:
    """Assemble the data snapshot and generate the client-facing report markdown."""
    context = await assemble_context(site_id, days)

    domain = context['site']['domain']
    prompt = f"""Write the monthly SEO report for **{domain}** covering the last {context['period_days']} days.

Here is the data to base the report on (JSON):

{json.dumps(context, indent=2, ensure_ascii=False)}

Write the full report now, following the structure and rules in your instructions."""

    markdown = await ai_service.analyze_with_anthropic(
        prompt=prompt,
        system_prompt=REPORT_SYSTEM_PROMPT,
    )

    return {
        'site_id': site_id,
        'domain': domain,
        'period': context.get('period'),
        'context': context,        # the raw data the report was built from (for transparency)
        'report_markdown': markdown,
    }
