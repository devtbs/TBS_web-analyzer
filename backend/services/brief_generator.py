from services.ai_service import ai_service
from typing import Dict, Any, Optional

# ── Tone definitions ─────────────────────────────────────────────────────────

TONE_DESCRIPTIONS = {
    "professional":  "formal, authoritative, and credible — suitable for B2B, legal, finance, or technical readers",
    "conversational": "friendly, warm, and easy to read — like talking to a knowledgeable friend",
    "persuasive":    "compelling and sales-driven — motivates readers to take action",
    "educational":   "clear, structured, and informative — great for how-tos, guides, and explainers",
    "storytelling":  "narrative-driven with vivid scenes, anecdotes, and emotional hooks",
    "journalistic":  "factual, balanced, and direct — written like a quality news or magazine feature",
}

LENGTH_TARGETS = {
    "short":   "600–800 words",
    "medium":  "1,000–1,400 words",
    "long":    "1,800–2,400 words",
    "in-depth": "3,000+ words — comprehensive, exhaustive coverage",
}


def build_system_prompt(
    tone: str = "professional",
    length: str = "medium",
    audience: str = "",
    custom_instructions: str = "",
    language: str = "en",
) -> str:
    """Dynamically build a system prompt from user-controlled settings."""

    tone_desc = TONE_DESCRIPTIONS.get(tone, TONE_DESCRIPTIONS["professional"])
    length_target = LENGTH_TARGETS.get(length, LENGTH_TARGETS["medium"])
    audience_line = f"**Target audience:** {audience.strip()}" if audience and audience.strip() else ""
    custom_line   = f"\n**Additional instructions from the user:**\n{custom_instructions.strip()}" if custom_instructions and custom_instructions.strip() else ""

    lang_instruction = (
        "Write the ENTIRE article in Thai (ภาษาไทย). Every heading, paragraph, and FAQ must be in Thai."
        if language == "th"
        else "Write the entire article in English."
    )

    return f"""You are an expert content writer and SEO specialist.

**Your writing tone:** {tone_desc}
**Article length target:** {length_target}
{audience_line}

**Core writing rules:**
1. Open with a compelling hook — never start with generic AI phrases like "In today's fast-paced world..." or "In this article, we will...".
2. Use clear H2 and H3 headings that match or creatively expand on the provided outline.
3. Keep paragraphs short (2–4 sentences). Mix punchy sentences with flowing prose for rhythm.
4. Naturally weave in the provided keywords — never stuff them.
5. End with a strong conclusion and 3–4 relevant FAQs.
6. {lang_instruction}
7. Output clean, valid Markdown starting with the H1 title. Do NOT wrap output in a code block.
{custom_line}
"""


async def generate_content_brief(topic: str, category: str, article_type: str) -> Dict[str, Any]:
    system_prompt = """You are an expert SEO Content Strategist. Your task is to create a comprehensive, highly-optimized content brief for a writer based on the provided topic.
Your output MUST be a valid JSON object with the following structure:
{
  "title_ideas": ["3 catchy, SEO-optimized title ideas"],
  "meta_description": "A compelling meta description (150-160 chars max)",
  "primary_keywords": ["3-5 primary keywords to target"],
  "secondary_keywords": ["5-10 secondary/LSI keywords naturally related"],
  "search_intent": "The primary search intent (e.g., Informational, Transactional) and what the user is really looking for",
  "target_audience": "Brief description of who this article is written for",
  "outline": [
    {
      "heading": "Exact heading text",
      "level": 1, 
      "talking_points": ["First point to cover", "Second point to cover"]
    }
  ],
  "competitor_insights": ["2-3 things competitors often miss that we should include to make our post 10x better"],
  "internal_linking_suggestions": ["Concepts or topics to link internally to"]
}

Important notes for outline:
- Ensure the first element has level=1 (H1) and represents the main title.
- Follow with logical H2s (level=2) and H3s (level=3).
- Provide 2-3 talking points for each heading.
"""
    
    prompt = f"""Generate a detailed SEO content brief for the following article:
Topic/Title: {topic}
Category/Silo: {category}
Content Type: {article_type}

Ensure the outline is comprehensive, logically structured, and follows modern SEO best practices. Focus on satisfying search intent and answering what the user actually wants to know.
"""
    
    try:
        brief_data = await ai_service.extract_json(prompt, system_prompt=system_prompt, use_deepseek=False)
        return brief_data
    except Exception as e:
        print(f"Error generating brief: {e}")
        raise e


async def generate_full_article(
    topic: str,
    brief_data: Dict[str, Any],
    system_prompt: Optional[str] = None,
    language: Optional[str] = "en",
    # New user-controllable settings
    tone: Optional[str] = "professional",
    length: Optional[str] = "medium",
    audience: Optional[str] = "",
    custom_instructions: Optional[str] = "",
) -> str:
    """Generate a full article.

    Args:
        topic:               The article topic / title.
        brief_data:          Structured content brief from generate_content_brief().
        system_prompt:       Fully custom system prompt (overrides everything else).
        language:            "en" (default) or "th".
        tone:                One of professional | conversational | persuasive |
                             educational | storytelling | journalistic.
        length:              One of short | medium | long | in-depth.
        audience:            Free-text description of the target reader.
        custom_instructions: Any extra instructions from the user.
    """

    # If the caller provides a fully custom system prompt, use it as-is.
    # Otherwise build one dynamically from user settings.
    if system_prompt and system_prompt.strip():
        effective_system_prompt = system_prompt.strip()
    else:
        effective_system_prompt = build_system_prompt(
            tone=tone or "professional",
            length=length or "medium",
            audience=audience or brief_data.get("target_audience", ""),
            custom_instructions=custom_instructions or "",
            language=language or "en",
        )

    outline_str = "\n".join([
        f"{'#' * item['level']} {item['heading']}\n" + "\n".join([f"- {pt}" for pt in item.get('talking_points', [])])
        for item in brief_data.get('outline', [])
    ])

    prompt = f"""Write a comprehensive, SEO-optimized article about: {topic}

Here is the structured content brief you MUST follow and expand upon:

**Target Audience:** {brief_data.get('target_audience', 'General readers')}
**Search Intent:** {brief_data.get('search_intent', 'Informational')}
**Keywords to naturally include:** {', '.join(brief_data.get('primary_keywords', []) + brief_data.get('secondary_keywords', []))}

**Outline to follow:**
{outline_str}

**Competitor insights to address:**
{chr(10).join(brief_data.get('competitor_insights', []))}

Follow the tone, length, and style defined in your system instructions exactly.
"""

    try:
        article_markdown = await ai_service.analyze_with_ai(prompt, system_prompt=effective_system_prompt, use_deepseek=True)
        return article_markdown
    except Exception as e:
        print(f"Error generating full article: {e}")
        raise e
