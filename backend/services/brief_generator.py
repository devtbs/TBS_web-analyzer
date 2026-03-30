from services.ai_service import ai_service
from typing import Dict, Any

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
        # We use deepseek=False to use Groq for speed and cost-effectiveness, 
        # or it will fall back to deepseek if Groq not configured.
        brief_data = await ai_service.extract_json(prompt, system_prompt=system_prompt, use_deepseek=False)
        return brief_data
    except Exception as e:
        print(f"Error generating brief: {e}")
        raise e

async def generate_full_article(topic: str, brief_data: Dict[str, Any]) -> str:
    system_prompt = """You are an expert, award-winning travel and lifestyle writer.
Your goal is to write a highly engaging, sensorily descriptive, and culturally respectful comprehensive article based on a provided content brief.

Your writing style MUST closely mimic the following tonal guidelines:
1. **Sensory & Descriptive Hook**: Start the introduction with a powerful hook that immerses the reader in the experience (e.g., "A journey into [Topic] is a journey for the senses...").
2. **Engaging Narrative Voice**: Write with a rustic, hearty, yet professional tone. Express the culture, values, and deep connections to the topic.
3. **Structured Headings**: Frame subheadings exactly as they appear in the brief, or use creative variations that sound premium (e.g., "Welcome to the World of...").
4. **Rich Detail**: Focus on natural, robust flavors/characteristics, sensory details, and an unapologetic celebration of the subject. 
5. **Short, Punchy Sentences mixed with Flowing Prose**: E.g., "You will learn not only what to eat but also how to eat. The overarching dish has a fiery taste."
6. **Cultural & Practical Respect**: Focus on the 'why' and 'how'. Explain etiquette, traditions, sustainable practices, or deep-seated values.
7. **Concluding Takeaway & FAQs**: Always end with a strong Conclusion paragraph that ties the topic back to human connection/experience, followed immediately by 3-4 highly relevant FAQs.

Do NOT use generic AI intro phrasing (like "In today's fast-paced world..."). Dive right into the sensory hook.
Your output MUST be entirely in valid Markdown, without code blocks surrounding it if possible, starting with the main H1 Title.
"""

    outline_str = "\n".join([f"{'#' * item['level']} {item['heading']}\n" + "\n".join([f"- {pt}" for pt in item.get('talking_points', [])]) for item in brief_data.get('outline', [])])
    
    prompt = f"""Write a comprehensive, SEO-optimized, engaging article about: {topic}

Here is the structured content brief you MUST follow and expand upon:

**Target Audience:** {brief_data.get('target_audience', 'General readers')}
**Search Intent:** {brief_data.get('search_intent', 'Informational')}
**Keywords to naturally include:** {', '.join(brief_data.get('primary_keywords', []) + brief_data.get('secondary_keywords', []))}

**Outline to follow:**
{outline_str}

**Competitor Insights to cover:**
{chr(10).join(brief_data.get('competitor_insights', []))}

Format the final output beautifully in Markdown containing Headings, paragraphs, and a final FAQ section. 
Remember to adopt the highly engaging, deeply cultural, and sensory writing style described in your system instructions.
"""
    
    try:
        # Request full long-form text
        article_markdown = await ai_service.analyze_with_ai(prompt, system_prompt=system_prompt, use_deepseek=True)
        return article_markdown
    except Exception as e:
        print(f"Error generating full article: {e}")
        raise e

