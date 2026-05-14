from services.ai_service import ai_service
from typing import Dict, Any, Optional

# ── Default prompts ──────────────────────────────────────────────────────────

DEFAULT_EN_SYSTEM_PROMPT = """You are an expert, award-winning travel and lifestyle writer.
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

DEFAULT_TH_SYSTEM_PROMPT = """คุณคือนักเขียนท่องเที่ยวและไลฟ์สไตล์ที่ได้รับรางวัล ผู้เชี่ยวชาญด้านการเขียนเชิงวัฒนธรรมไทย
เป้าหมายของคุณคือเขียนบทความที่น่าสนใจ สมจริง และให้เกียรติวัฒนธรรม โดยอิงจาก content brief ที่ให้มา

แนวทางการเขียน:
1. **Hook ที่กระตุ้นประสาทสัมผัส**: เริ่มต้นด้วย hook ที่ดึงดูดผู้อ่านให้จมอยู่กับประสบการณ์นั้น
2. **น้ำเสียงที่เป็นมิตรแต่เป็นมืออาชีพ**: เขียนด้วยความอบอุ่น จริงใจ สะท้อนวัฒนธรรมและคุณค่าของหัวข้อ
3. **หัวข้อที่มีโครงสร้างชัดเจน**: ใช้หัวข้อตาม brief หรือปรับให้ฟังดูมีคุณค่า
4. **รายละเอียดที่สมบูรณ์**: เน้นลักษณะเฉพาะ รายละเอียดที่สัมผัสได้ และการเฉลิมฉลองหัวข้ออย่างไม่ลังเล
5. **ประโยคสั้นกระชับผสมกับประโยคยาวที่ไหลลื่น**
6. **ความเคารพทางวัฒนธรรม**: อธิบาย 'ทำไม' และ 'อย่างไร' ขนบธรรมเนียมและค่านิยม
7. **สรุปและ FAQ**: จบด้วยบทสรุปที่แข็งแกร่งและ FAQ 3-4 ข้อ

ห้ามใช้ประโยคเปิดแบบ AI ทั่วไป เช่น "ในโลกปัจจุบัน..." ให้เริ่มด้วย hook เลย
ผลลัพธ์ต้องเป็น Markdown ที่ถูกต้อง เขียนทั้งบทความเป็นภาษาไทย
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
) -> str:
    """Generate a full article.

    Args:
        topic: The article topic / title.
        brief_data: Structured content brief from generate_content_brief().
        system_prompt: Optional custom system prompt. Falls back to the default
                       English or Thai prompt based on the ``language`` argument.
        language: "en" (default) or "th". When "th", the Thai system prompt is
                  used and the user prompt instructs the AI to write in Thai.
    """

    # Resolve which system prompt to use
    if system_prompt and system_prompt.strip():
        effective_system_prompt = system_prompt.strip()
    elif language == "th":
        effective_system_prompt = DEFAULT_TH_SYSTEM_PROMPT
    else:
        effective_system_prompt = DEFAULT_EN_SYSTEM_PROMPT

    outline_str = "\n".join([
        f"{'#' * item['level']} {item['heading']}\n" + "\n".join([f"- {pt}" for pt in item.get('talking_points', [])])
        for item in brief_data.get('outline', [])
    ])

    language_instruction = "\nWrite the entire article in Thai (ภาษาไทย). All headings, body text, and FAQs must be in Thai.\n" if language == "th" else ""

    prompt = f"""Write a comprehensive, SEO-optimized, engaging article about: {topic}
{language_instruction}
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
        article_markdown = await ai_service.analyze_with_ai(prompt, system_prompt=effective_system_prompt, use_deepseek=True)
        return article_markdown
    except Exception as e:
        print(f"Error generating full article: {e}")
        raise e
