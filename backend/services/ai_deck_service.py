"""AI-designed deck generator — free engine, downloadable file.

Pipeline (no third-party deck subscription):
  1. assemble real data (done elsewhere) -> a data brief
  2. an editable, Abacus-style PROMPT + the data -> an LLM (DeepSeek/Groq) writes a
     complete, self-contained HTML presentation (unique design each time)
  3. headless Chromium renders that HTML to the chosen downloadable format:
       - PDF  (pixel-perfect, one slide per page)
       - PPTX (each slide screenshotted full-bleed into a python-pptx slide)

The AI designs the slides (not a fixed template); we only render its HTML to a file.
"""
from __future__ import annotations

import logging
import re
from io import BytesIO
from pathlib import Path
from typing import Dict, List, Optional

from services.ai_service import ai_service

logger = logging.getLogger(__name__)

# Slide geometry — 16:9 at 1280x720 CSS px == 13.333x7.5in for PPTX.
SLIDE_W_PX, SLIDE_H_PX = 1280, 720


# ---------------------------------------------------------------------------
# The editable prompt. This is the default; callers may pass their own text.
# {brand}, {structure}, {data} are filled in at request time.
# The HTML OUTPUT CONTRACT at the end is required for rendering and should be
# kept even if the rest of the prompt is customised.
# ---------------------------------------------------------------------------
DEFAULT_DECK_PROMPT = """You are an elite, executive-level Data Scientist, Presentation Designer, and Growth Strategist. Your task is to transform the attached monthly performance data into a visually stunning, dynamic, and premium presentation deck.

The report must look like it was hand-crafted by a premium data-analytics agency for a C-suite executive review. It must be clean, highly modern, clear, and deeply strategic.

=======================================================
CRITICAL RULES FOR DATA ACCURACY & TONE:
1. Use ONLY the actual data provided inside the file/text. Do NOT add fake numbers, assumptions, or estimates.
2. If metrics dropped or declined, do NOT use negative, alarmist, or failing language. Present drops professionally as an "Optimization Opportunity," "Niche Segment to Watch," or "Strategic Content Refresh Target."
3. Follow the structural rule: One core narrative or trend = one slide. Do NOT overcrowd layout spaces with dense blocks of text.

=======================================================
DYNAMIC BRANDING & STYLE ENGINE:
Analyze the domain name and data context provided in the dataset to dynamically establish a premium design language:
- INDUSTRY VIBE: Deduce the company's core focus (e.g., Trust/Security for Insurance; Precision for Manufacturing).
- THE 60-30-10 COLOR RULE:
  * 60% Dominant: Premium clean light background (white, off-white, or ivory-slate) for high executive readability.
  * 30% Secondary Structure: Deep charcoal, deep corporate slate, or dark navy for crisp text hierarchy.
  * 10% Accent/Pop Color: Exactly ONE vivid, sophisticated color reflecting the brand's industry identity to draw the eye exclusively to big wins and target metrics.

=======================================================
INTERACTIVE DATA VISUALIZATION (PLOTLY.JS INTEGRATION):
Wherever the data can be grouped, tracked over time, or categorized into distributions, you MUST generate a functional Plotly.js configuration block.
- For charts, generate a valid JSON block containing `data` and `layout` configurations that can be plugged straight into a `Plotly.newPlot()` function.
- Ensure the Plotly charts strictly inherit the chosen custom color palette (using the 30% secondary color for gridlines/text and the 10% accent color for positive metrics or bar highlights).
- Keep chart layouts clean: hide unnecessary grid lines, use clean tooltips, and ensure fonts are sharp and modern.

=======================================================
DYNAMIC DECK STRUCTURE:
Do not limit the output to a rigid slide count. Instead, read the data payload and dynamically generate a beautifully balanced sequence of slides mapping to the structure below. For EVERY slide generated, you must output:

1. SLIDE NUMBER & TITLE: E.g., "Slide X: Core Keyword Distribution"
2. VISUAL LAYOUT COMPOSITION: A clear structural blueprint detailing exactly how the slide is arranged (e.g., "Layout: Split-screen. Left: 40% width containing 3 strategic bullet highlights. Right: 60% width displaying the interactive Plotly.js Distribution Bar Chart.").
3. INTERACTIVE PLOTLY.JS CODE: (If applicable to the slide's data payload, output the valid Plotly configuration block).
4. EXECUTIVE DATA TEXT: The exact text, KPI metrics, and bullet points to be placed on the slide, written in an executive-ready, strategic tone.

Your dynamic slide sequence must seamlessly guide the viewer through these core thematic phases:

- PHASE 1: PRESTIGE WELCOME — A minimalist, striking cover frame tailored to the brand's industry context.

- PHASE 2: THE EXECUTIVE DASHBOARD HUB (PRE-PHASE 2) — A single, high-impact overview screen designed to act as a unified command center.
  * Visual Layout: A premium dashboard grid interface layout.
  * Plotly Requirement: This slide MUST include a comprehensive Plotly.js multi-chart grid configuration (e.g., a combined subplots breakdown or side-by-side comparison charts displaying performance distribution, macro summaries, and growth curves simultaneously).
  * Text: Brief structural anchor notes highlighting how to read the visual data matrix below it.

- PHASE 3: EXECUTIVE SUMMARY & AGGREGATE CORE METRICS — Grouping the highest-level snapshot numbers into clean visual cards alongside a confident summary paragraph.

- PHASE 4: DEEP-DIVE TRENDS & DISTRIBUTIONS — Dynamic slides visualizing data groups, keyword shifts, or metric clusters using Plotly.js graphs.

- PHASE 5: THE SUCCESS MATRIX (WINS) — Highlighting the top performing categories, highest climbers, and stable anchors.

- PHASE 6: RECOVERY & OPTIMIZATION TARGETS — High-volume segments that shifted downward, framed completely as strategic optimization paths.

- PHASE 7: STEP-BY-STEP STRATEGIC ROADMAP — A horizontal, numbered action plan mapping data vulnerabilities directly to execution solutions.

- PHASE 8: CLOSING CONTEXT — A professional thank-you page that anchors the core momentum takeaway alongside a minimal footer displaying primary high-level snapshot metrics.

=======================================================
INPUT DATA TO PROCESS:
DATA (use ONLY this — pulled automatically from the connected data source for this site):
{data}"""


# Always appended by build_prompt — the renderer depends on it, so it stays out of
# the user-editable prompt and can't be removed by mistake.
HTML_CONTRACT = """=== HTML OUTPUT CONTRACT (required — this OVERRIDES any conflicting instruction above) ===
Output ONE complete, self-contained HTML document and NOTHING ELSE: no markdown, no commentary, and do NOT print slide specifications, "SLIDE NUMBER & TITLE", "VISUAL LAYOUT COMPOSITION", or standalone code blocks as text — translate ALL of that directly into the final rendered HTML.
- Start with <!DOCTYPE html>.
- All CSS inline in a single <style> tag. Fonts may load from fonts.googleapis.com.
- Each slide is exactly: <section class="slide"> ... </section>. Every .slide is 1280px wide and 720px tall, overflow hidden.
- Include this CSS so it paginates when printed:
    @page { size: 1280px 720px; margin: 0; }
    * { box-sizing: border-box; }
    html,body { margin:0; padding:0; }
    .slide { width:1280px; height:720px; position:relative; overflow:hidden; page-break-after:always; }
- CHARTS via Plotly.js (when the data suits a chart): include EXACTLY ONCE in <head>:
    <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  For each chart, put a sized container inside its slide: <div id="chartN" style="width:600px;height:380px"></div>
  and at the very END of <body> add: <script>Plotly.newPlot('chartN', DATA, LAYOUT, {staticPlot:true, displayModeBar:false, responsive:false});</script>
  Charts MUST fit fully within the 1280x720 slide (never overflow). Use transparent paper_bgcolor and plot_bgcolor, the accent colour for key series, the secondary colour for axis text/gridlines, margins tight, and hide unneeded gridlines.
- Do NOT reference any other external resource or remote <img>. Self-contained except the Google Font and the single Plotly script."""


DEFAULT_BRAND = (
    "Primary CI color: #26397A. Style: premium B2B aesthetic — trustworthy, professional. "
    "White or light backgrounds with strong spacing and clean layouts. Modern typography, "
    "consistent hierarchy, subtle CI-blue accents. Avoid overly colorful or playful designs. "
    "Keep visuals sharp, structured, and minimal."
)

# A brand directive that makes the AI invent a UNIQUE visual identity per site,
# rather than reusing one fixed template.
UNIQUE_STYLE_BRAND = (
    "Design a UNIQUE, premium visual identity tailored specifically to THIS website and its industry — "
    "do NOT reuse a generic or default template, and do not default to navy/blue. "
    "From the site's domain and the nature of its content, choose: a distinctive colour palette (one dominant "
    "colour carrying ~60% of the weight, 1-2 supporting tones, one sharp accent), a characterful font pairing, "
    "and ONE repeating visual motif (e.g. rounded image frames, icons in coloured circles, a corner shape) carried "
    "across every slide. Two different sites must produce visibly different-looking decks. "
    "Executive-grade, modern, lots of whitespace, clear hierarchy. Use light backgrounds for content slides and a "
    "bold, saturated or dark cover + closing. Avoid AI-slop: no thin accent lines under titles, no full-width "
    "decorative colour bars unless they serve the layout."
)

DEFAULT_STRUCTURE = (
    "Cover (company, report title, reporting period, hero visual); Executive Summary (KPI overview + "
    "strongest positives + short strategic summary); Keyword Rankings overview; Biggest Movers; "
    "Wins of the Month; Opportunities; Strategic Recommendations; Closing (key takeaways + thank you)."
)


# Defaults tuned for a Google Ads report built from an uploaded Looker Studio PDF.
GOOGLE_ADS_BRAND = (
    "Primary CI color: #26397A. Style: premium B2B manufacturing / export company "
    "aesthetic (embroidery badges, patches, appliqués). Feel: trustworthy, industrial "
    "precision, professional, global export standard. White or light backgrounds with "
    "strong spacing and clean layouts. Modern typography, consistent hierarchy, subtle "
    "CI-blue accents. Avoid overly colorful or playful designs. Keep visuals sharp, "
    "structured, and minimal."
)

GOOGLE_ADS_STRUCTURE = (
    "1. Cover Slide — company name, 'Google Ads Performance Report', reporting period, professional hero visual.\n"
    "2. Executive Summary — high-level KPI overview, strongest positive outcomes, short strategic summary.\n"
    "3. Account Performance — Spend, Clicks, Impressions, CTR, CPC, Conversions, Cost per Conversion, ROAS/Conversion Value if available; highlight key wins visually.\n"
    "4. Keyword Conversion Performance — top converting keywords, best CTR keywords, highest-value search intent; tables or charts.\n"
    "5. Landing Page Performance — best-performing and conversion-driving pages, engagement insights if available; focus on strengths.\n"
    "6. Conversion Funnel Analysis — funnel visualization, drop-off points, positive conversion flow insights.\n"
    "7. Click Type Analysis — breakdown of click types, performance comparison, strongest engagement sources.\n"
    "8. Demographics Performance — age, gender, audience segments if available; highlight highest-performing demographics.\n"
    "9. Strategic Insights & Optimization Opportunities — actionable Google Ads recommendations ONLY (scale winning campaigns, improve keyword targeting, budget allocation, audience optimization, bid strategy). Do NOT suggest website redesign unless the data supports it.\n"
    "10. Closing Slide — key takeaways, positive momentum summary, professional thank-you page."
)


# Structure for an organic-search (Google Search Console) monthly report.
GSC_STRUCTURE = (
    "1. Cover Slide — site/domain, 'Organic Search Performance Report', reporting period, professional hero visual.\n"
    "2. Executive Summary — high-level KPI overview (clicks, impressions, CTR, average position), strongest positives, short strategic summary.\n"
    "3. Search Performance — clicks, impressions, CTR, average position with period-over-period change; highlight key wins visually.\n"
    "4. Top Queries — best queries by clicks (with impressions, CTR, position); present clearly with a table or chart.\n"
    "5. Query Opportunities — high-impression / low-CTR or near-page-1 queries to target next.\n"
    "6. Top Pages — best-performing landing pages by clicks; focus on strengths.\n"
    "7. Trends — how clicks/impressions moved over the period; positive momentum framing.\n"
    "8. Strategic Insights & Recommendations — actionable SEO recommendations ONLY (content, internal linking, CTR/title improvements, target near-page-1 queries).\n"
    "9. Closing Slide — key takeaways, positive momentum summary, professional thank-you page."
)


def build_prompt(data_brief: str, *, prompt: Optional[str] = None,
                 brand: Optional[str] = None, structure: Optional[str] = None) -> str:
    """Fill the (possibly user-customised) prompt template with brand/structure/data."""
    template = prompt or DEFAULT_DECK_PROMPT
    # Use replace (not str.format): prompts contain literal CSS braces.
    filled = (
        template
        .replace("{brand}", brand or DEFAULT_BRAND)
        .replace("{structure}", structure or DEFAULT_STRUCTURE)
        .replace("{data}", data_brief)
    )
    # If a custom prompt forgot the data placeholder, append the data anyway.
    if "{data}" not in template:
        filled = filled + "\n\nDATA (use ONLY this):\n" + data_brief
    return filled + "\n\n" + HTML_CONTRACT


def _clean_html(text: str) -> str:
    """Strip any stray markdown fences the model may wrap around the HTML."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.endswith("```"):
            t = t[: t.rfind("```")]
    i = t.lower().find("<!doctype")
    if i == -1:
        i = t.lower().find("<html")
    return t[i:].strip() if i != -1 else t.strip()


async def generate_deck_html(data_brief: str, *, prompt: Optional[str] = None,
                             brand: Optional[str] = None, structure: Optional[str] = None,
                             provider: str = "deepseek") -> str:
    """Ask the chosen LLM provider to design the deck and return self-contained HTML."""
    # prompt is normally resolved by the route (from the chosen prompt id); fall back
    # to the built-in default if none was passed.
    full_prompt = build_prompt(data_brief, prompt=prompt, brand=brand, structure=structure)
    raw = await ai_service.analyze_with_provider(
        full_prompt,
        system_prompt="You are an award-winning presentation designer who outputs only clean, self-contained HTML.",
        provider=provider,
    )
    return _clean_html(raw)


# ---- Rendering (headless Chromium via Playwright) --------------------------
_PLOTLY_SRC = None


def _plotly_source() -> str:
    """Load the bundled Plotly library once (backend/assets/plotly.min.js)."""
    global _PLOTLY_SRC
    if _PLOTLY_SRC is None:
        f = Path(__file__).resolve().parent.parent / "assets" / "plotly.min.js"
        try:
            _PLOTLY_SRC = f.read_text(encoding="utf-8")
        except Exception:
            _PLOTLY_SRC = ""
    return _PLOTLY_SRC


def _prepare_html_for_render(html: str) -> str:
    """Inline the bundled Plotly so charts render with NO internet access — the VPS
    may not reach cdn.plot.ly. Strips the CDN <script> and injects the local copy."""
    if "Plotly.newPlot" not in html and "plot.ly" not in html:
        return html
    src = _plotly_source()
    if not src:
        return html  # no local bundle available — leave the CDN tag as-is
    html = re.sub(r'<script\b[^>]*\bsrc=["\']https?://cdn\.plot\.ly/[^"\']*["\'][^>]*>\s*</script>',
                  '', html, flags=re.IGNORECASE)
    inline = "<script>/* bundled-plotly */\n" + src + "\n</script>"
    if "</head>" in html:
        return html.replace("</head>", inline + "</head>", 1)
    return inline + html


async def _render(html: str) -> Dict:
    """Render HTML once; return {'pdf': bytes, 'slides': [png bytes, ...]}.

    Loads via goto(temp file) rather than set_content: set_content injects HTML via
    document.write, which makes Chromium intermittently block the cross-site Plotly
    CDN script (leaving empty charts). A real navigation loads it reliably.
    """
    import os
    import tempfile
    from pathlib import Path
    from playwright.async_api import async_playwright

    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".html", delete=False, encoding="utf-8")
    try:
        tmp.write(_prepare_html_for_render(html))
        tmp.close()
        uses_plotly = "Plotly.newPlot" in html or "plot.ly" in html
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=["--no-sandbox"])
            page = await browser.new_page(viewport={"width": SLIDE_W_PX, "height": SLIDE_H_PX})
            await page.goto(Path(tmp.name).as_uri(), wait_until="networkidle")
            if uses_plotly:
                # ensure Plotly actually loaded; if the CDN was slow/blocked, inject it,
                # then wait for every chart to draw its SVG.
                try:
                    await page.wait_for_function("() => !!window.Plotly", timeout=6000)
                except Exception:
                    try:
                        await page.add_script_tag(url="https://cdn.plot.ly/plotly-2.35.2.min.js")
                        await page.wait_for_function("() => !!window.Plotly", timeout=6000)
                    except Exception:
                        pass
                try:
                    await page.wait_for_function(
                        "() => Array.from(document.querySelectorAll('.js-plotly-plot'))"
                        ".every(n => n.querySelector('.main-svg'))",
                        timeout=10000,
                    )
                except Exception:
                    pass
                await page.wait_for_timeout(1000)
            pdf = await page.pdf(prefer_css_page_size=True, print_background=True)
            slide_pngs: List[bytes] = []
            for el in await page.query_selector_all(".slide"):
                slide_pngs.append(await el.screenshot(type="png"))
            await browser.close()
        return {"pdf": pdf, "slides": slide_pngs}
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


def _slides_to_pptx(slide_pngs: List[bytes]) -> bytes:
    """Place each full-slide screenshot onto a 16:9 python-pptx slide."""
    from pptx import Presentation
    from pptx.util import Inches

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    for png in slide_pngs:
        slide = prs.slides.add_slide(blank)
        slide.shapes.add_picture(BytesIO(png), 0, 0, width=prs.slide_width, height=prs.slide_height)
    buf = BytesIO()
    prs.save(buf)
    return buf.getvalue()


async def render_deck(html: str, fmt: str = "pdf") -> bytes:
    """Render the AI's HTML to the requested downloadable format ('pdf' or 'pptx')."""
    fmt = (fmt or "pdf").lower()
    rendered = await _render(html)
    if fmt == "pdf":
        return rendered["pdf"]
    if fmt == "pptx":
        return _slides_to_pptx(rendered["slides"])
    raise ValueError(f"Unsupported format: {fmt!r} (use 'pdf' or 'pptx')")


async def render_slide_images(html: str, *, quality: int = 72) -> List[bytes]:
    """Render each slide to a JPEG for in-app preview — same load/Plotly-wait path as
    _render, so the preview matches the downloaded file exactly (charts included)."""
    import os
    import tempfile
    from pathlib import Path
    from playwright.async_api import async_playwright

    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".html", delete=False, encoding="utf-8")
    try:
        tmp.write(_prepare_html_for_render(html))
        tmp.close()
        uses_plotly = "Plotly.newPlot" in html or "plot.ly" in html
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=["--no-sandbox"])
            page = await browser.new_page(viewport={"width": SLIDE_W_PX, "height": SLIDE_H_PX})
            await page.goto(Path(tmp.name).as_uri(), wait_until="networkidle")
            if uses_plotly:
                try:
                    await page.wait_for_function("() => !!window.Plotly", timeout=6000)
                except Exception:
                    try:
                        await page.add_script_tag(url="https://cdn.plot.ly/plotly-2.35.2.min.js")
                        await page.wait_for_function("() => !!window.Plotly", timeout=6000)
                    except Exception:
                        pass
                try:
                    await page.wait_for_function(
                        "() => Array.from(document.querySelectorAll('.js-plotly-plot'))"
                        ".every(n => n.querySelector('.main-svg'))",
                        timeout=10000,
                    )
                except Exception:
                    pass
                await page.wait_for_timeout(1000)
            imgs: List[bytes] = []
            for el in await page.query_selector_all(".slide"):
                imgs.append(await el.screenshot(type="jpeg", quality=quality))
            await browser.close()
        return imgs
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


async def generate_deck_from_pdf(
    pdf_bytes: bytes,
    *,
    fmt: str = "pdf",
    prompt: Optional[str] = None,
    provider: str = "deepseek",
    brand: Optional[str] = None,
    structure: Optional[str] = None,
    render: bool = True,
) -> Dict:
    """Full PDF→deck flow: extract the PDF's data, have the AI design the deck with the
    chosen prompt + provider. Renders to the file unless render=False (deferred to download)."""
    from services.pdf_extract import extract_pdf_text

    data_text = extract_pdf_text(pdf_bytes)
    if not data_text.strip():
        raise ValueError("No extractable text found in the PDF.")
    html = await generate_deck_html(
        data_text,
        prompt=prompt,
        brand=brand or GOOGLE_ADS_BRAND,
        structure=structure or GOOGLE_ADS_STRUCTURE,
        provider=provider,
    )
    file_bytes = await render_deck(html, fmt=fmt) if render else None
    return {"format": fmt, "html": html, "data_text": data_text, "file_bytes": file_bytes}
