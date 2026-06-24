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
import asyncio
import base64
import re
from io import BytesIO
from pathlib import Path
from typing import Dict, List, Optional

from services.ai_service import ai_service, ProgressCb

logger = logging.getLogger(__name__)

# Slide geometry — 16:9 at 1280x720 CSS px == 13.333x7.5in for PPTX.
SLIDE_W_PX, SLIDE_H_PX = 1280, 720

# AI photos per deck. Bounds both the early (streamed) prewarm and the final resolve,
# and the concurrency cap keeps us under Supermachine's 10 req/min rate limit.
MAX_DECK_IMAGES = 8
_IMG_CONCURRENCY = 3


def _img_prompt(tag: str) -> str:
    """Extract the data-prompt text from an <img class="ai-img" ...> placeholder."""
    m = re.search(r'data-prompt=["\'](.*?)["\']', tag, re.S)
    return (m.group(1).strip() if m else "professional abstract background, premium")


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
DYNAMIC BRANDING & STYLE ENGINE — EDITORIAL / DESIGN-STUDIO GRADE:
Design this like a high-end editorial design studio "frame system" — think art-direction-led poster design and a premium print magazine, NOT a generic corporate slide template. Every deck must feel like a confident, hand-crafted design object with its own identity. Analyze the domain and data context to establish that identity:
- INDUSTRY VIBE: Deduce the company's core focus (e.g., Trust/Security for Insurance; Precision for Manufacturing) and let it drive a DISTINCTIVE art direction — two decks must look visibly different.
- EXPRESSIVE DISPLAY TYPOGRAPHY (the #1 driver of the look): Pair a characterful display face (an elegant high-contrast SERIF, or a bold grotesque) for headlines with a clean sans for body — load real fonts from fonts.googleapis.com (e.g. Fraunces, Playfair Display, Libre Caslon, Archivo, Space Grotesk, Instrument Serif, Bricolage Grotesque, Syne). Headlines are OVERSIZED and confident (clamp ~56–104px), tight line-height, with deliberate mixing of an italic serif accent word inside a sans headline (e.g. big sans + one *italic serif* word). Use real typographic hierarchy: tiny ALL-CAPS letter-spaced kickers/eyebrows, large display headline, restrained body.
- KICKER / SYSTEM LABEL MOTIF: Put a small uppercase, letter-spaced label in a corner of each slide (e.g. "PERFORMANCE SYSTEM · VOL. 01", "ORGANIC SEARCH — 2026", or a slide index "03 / 09"). This "frame system" tagging is a signature of the look.
- THE 60-30-10 COLOR RULE:
  * 60% Dominant: a premium CREAM / off-white / ivory paper ground (not stark white) for editorial warmth and readability — or, for cover/section/closing slides, ONE saturated full-bleed colour field.
  * 30% Secondary Structure: deep near-black ink, charcoal, or a deep brand tone for crisp text hierarchy.
  * 10% Accent/Pop Color: exactly ONE vivid, sophisticated accent (a confident yellow, vermilion red, electric blue, etc.) used for emphasis, the kicker, key metrics and a single decorative motif.
- DECORATIVE MOTIF (use with RESTRAINT, never over charts/tables): carry ONE repeating graphic device across slides — e.g. a thin ruled grid or dot-grid, a slightly rotated/"crooked" outlined frame, a small filled star or circle, pill/tape-style labels, a hairline rule with an index number. It should feel intentional and editorial, never like clip-art.
- LAYOUT: confident, asymmetric, magazine-grade composition with generous negative space and a clear focal point — avoid centred, evenly-stacked "default template" layouts. Vary layouts slide to slide (full-bleed type poster cover, split editorial spreads, a strong data spread).
- COVER, SECTION DIVIDERS & CLOSING: treat these as poster pages — huge expressive type on a bold colour field or dramatic photo, minimal supporting text. These set the tone.

=======================================================
INTERACTIVE DATA VISUALIZATION (PLOTLY.JS INTEGRATION):
Wherever the data can be grouped, tracked over time, or categorized into distributions, add a chart.
- Charts are embedded ONLY through the hidden chart mechanism defined in the HTML OUTPUT CONTRACT
  below (a sized <div> + an immediately-following <script type="application/json" class="plotly-spec">).
  NEVER write the chart's JSON/config anywhere a reader can see it — no visible JSON, no <pre>/<code>
  block, no "config" column, no spec printed next to the chart. The JSON lives only inside that script.
- Charts strictly inherit the chosen palette (secondary tone for gridlines/text, the accent for the
  key series). Keep them clean: few gridlines, clean tooltips, sharp modern fonts.

=======================================================
DYNAMIC DECK STRUCTURE:
Do not limit the output to a rigid slide count. Read the data payload and dynamically generate a
beautifully balanced sequence of slides mapping to the structure below.

CRITICAL OUTPUT RULE: emit each slide as FINAL RENDERED HTML only. Do NOT print any planning text,
slide blueprints, "Slide X:" headings, "VISUAL LAYOUT COMPOSITION", or chart-config blocks as visible
content — translate all of that directly into the HTML/CSS and the hidden chart script. The reader must
see a finished slide, never the instructions or data behind it.

Your slide sequence must seamlessly guide the viewer through these core thematic phases:

- PHASE 1: PRESTIGE WELCOME — A minimalist, striking cover frame tailored to the brand's industry context.

- PHASE 2: THE EXECUTIVE DASHBOARD HUB (PRE-PHASE 2) — A single, high-impact overview screen designed to act as a unified command center.
  * Visual Layout: A premium dashboard grid interface layout.
  * Plotly Requirement: This slide MUST include a comprehensive Plotly.js multi-chart grid configuration (e.g., a combined subplots breakdown or side-by-side comparison charts displaying performance distribution, macro summaries, and growth curves simultaneously).
  * Text: Brief structural anchor notes highlighting how to read the visual data matrix below it.

- PHASE 3: EXECUTIVE SUMMARY & AGGREGATE CORE METRICS — This slide is CHART-LED, not card-led. Make one or two large Plotly.js charts the visual focus (filling the majority of the slide), and place the high-level snapshot numbers ONLY as a slim, compact KPI strip along the top or bottom (small values in a single row, NOT large cards with empty space below). Do NOT fill the slide with big number cards.

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
- NEVER show raw chart JSON or any {"data":...,"layout":...} config as visible text. A chart's JSON belongs ONLY inside its hidden <script type="application/json" class="plotly-spec"> — if a reader can see JSON on a slide, that is a bug.
- KPI DISCIPLINE — do NOT repeat the same headline metric row on every slide. Show the clicks / impressions / CTR / avg-position (or sessions/cost) KPI strip on the EXECUTIVE SUMMARY slide ONLY; every other slide focuses on its own chart/insight with at most one or two metrics relevant to THAT slide. The cover and closing carry NO KPI chips.
- EVERY slide must fill the entire 1280x720 page edge to edge (a real full-bleed page): no letterboxing, no large empty margins or blank bands — size the hero chart/visual to consume the slide's main area.
- Start with <!DOCTYPE html>.
- All CSS inline in a single <style> tag. Fonts may load from fonts.googleapis.com.
- Each slide is exactly: <section class="slide"> ... </section>. Every .slide is 1280px wide and 720px tall, overflow hidden.
- FILL THE CANVAS — this is critical. Every slide MUST use the full 1280x720 height; NO slide may leave a large empty band (no more than ~12% blank vertical space). Make each .slide a vertical flex container (display:flex; flex-direction:column; justify-content:center; gap:28px; padding:60px 72px) so content is balanced over the whole height — never dump everything in the top third. To fill space meaningfully: pair every data TABLE or KPI-card row with a relevant Plotly chart beside or below it (two-column or stacked grid), enlarge cards, and use generous spacing. A data slide that is only a small table at the top is NOT acceptable — add a chart or distribute the layout to fill the slide.
- Include this CSS so it paginates when printed:
    @page { size: 1280px 720px; margin: 0; }
    * { box-sizing: border-box; }
    html,body { margin:0; padding:0; }
    .slide { width:1280px; height:720px; position:relative; overflow:hidden; page-break-after:always; }
- CHARTS via Plotly.js (use them generously where the data suits a chart). The Plotly library is provided for you — do NOT add any Plotly <script src>, and do NOT call Plotly.newPlot yourself. For each chart output exactly two elements:
    (a) a sized container in its slide: <div id="chartN" style="width:600px;height:380px"></div>  (unique id per chart)
    (b) immediately AFTER it, its spec: <script type="application/json" class="plotly-spec" data-target="chartN">{"data":[...],"layout":{...}}</script>
  The system reads every plotly-spec and renders it. The JSON must be strictly valid (double-quoted keys/strings, no trailing commas, no JS expressions). Never print chart config as visible text. Charts MUST fit fully within the 1280x720 slide.
  Every chart's "layout" MUST be styled consistently for a premium look: "paper_bgcolor":"rgba(0,0,0,0)","plot_bgcolor":"rgba(0,0,0,0)", "font":{"family":"<your body font>","color":"<--muted>","size":13}, "margin":{"t":10,"l":48,"r":16,"b":36}, "showlegend":false (or a single clean legend), x/y axes with "gridcolor":"<--line>","zeroline":false and no chartjunk. Use the ACCENT colour for the primary series and --accent-2 for a secondary series — never default Plotly colours. Keep it clean: few gridlines, sharp modern fonts, rounded bar feel.
- PHOTOS: to add a photo, output <img class="ai-img" data-prompt="<a vivid, specific photographic description on-theme to this site's industry — e.g. 'close-up of embroidered military patches on dark fabric, studio lighting, premium'>" style="...">. Do NOT put a src — the system fills it in. Size/position it with CSS (object-fit:cover) so it fits inside its slide.
  Use photos on MOST slides as full-bleed backgrounds or side panels to make the deck visually rich. When text or numbers sit on top of a photo, place a dark gradient overlay (e.g. linear-gradient(rgba(15,23,42,.65), rgba(15,23,42,.35))) over the image for legibility. Keep chart and table areas on a clean solid background, not over a photo. Use at most 8 photos total.
- ICONS: add a crisp icon with <i class="ai-icon" data-icon="NAME"></i> (no other attributes). The system swaps it for an inline SVG that inherits the current text colour (set it to --accent or --ink via CSS; size with font-size/width). Put ONE relevant icon on every KPI, every list bullet, and section markers — never as random decoration. Available NAMEs ONLY: trending-up, trending-down, target, search, eye, mouse-pointer-click, users, globe, bar-chart, line-chart, pie-chart, activity, arrow-up-right, arrow-down-right, check-circle, alert-triangle, lightbulb, rocket, star, award, flag, calendar, clock, map-pin, link, file-text, layers, filter, zap, dollar-sign, percent, shopping-cart, smartphone, monitor, thumbs-up, refresh-cw, compass, megaphone, sparkles, gauge. If none fit, omit the icon.
- Do NOT reference any other external resource or remote <img> with a real URL. Self-contained except the Google Font, the single Plotly script, and ai-img / ai-icon placeholders the system fills."""


DEFAULT_BRAND = (
    "Primary CI color: #26397A. Style: premium B2B aesthetic — trustworthy, professional. "
    "White or light backgrounds with strong spacing and clean layouts. Modern typography, "
    "consistent hierarchy, subtle CI-blue accents. Avoid overly colorful or playful designs. "
    "Keep visuals sharp, structured, and minimal."
)

# A brand directive that makes the AI invent a UNIQUE visual identity per site,
# rather than reusing one fixed template.
UNIQUE_STYLE_BRAND = (
    "Design like a high-end EDITORIAL DESIGN STUDIO — art-direction-led, poster/magazine grade — NOT a generic "
    "corporate slide template. Create a UNIQUE visual identity tailored specifically to THIS website and its industry; "
    "do NOT reuse a generic or default template, and do not default to navy/blue. From the site's domain and content, choose: "
    "a distinctive colour palette (one dominant colour ~60% — favour a warm cream/ivory paper ground for content slides — "
    "1-2 supporting tones, ONE sharp vivid accent); an EXPRESSIVE display font pairing (a characterful serif or bold grotesque "
    "for OVERSIZED confident headlines + a clean sans for body, loaded from fonts.googleapis.com), mixing an italic serif accent "
    "word into sans headlines; tiny ALL-CAPS letter-spaced kicker/eyebrow labels and a small corner 'system' tag or slide index; "
    "and ONE repeating editorial motif used with restraint (a dot/ruled grid, a slightly rotated outlined frame, a star/circle, "
    "pill/tape labels) carried across every slide — never over charts/tables. Layouts must be confident and ASYMMETRIC with "
    "generous negative space and a clear focal point; vary them slide to slide. Two different sites must produce visibly "
    "different decks. Treat the cover, section dividers and closing as poster pages: huge expressive type on a bold saturated "
    "or dark colour field. Avoid AI-slop: no thin accent lines under titles, no full-width decorative colour bars unless they "
    "serve the layout, no centred evenly-stacked default layouts."
)

DEFAULT_STRUCTURE = (
    "Cover (company, report title, reporting period, hero visual); Executive Summary (CHART-LED — "
    "one or two large charts as the focus, KPIs only as a slim compact strip, not large number cards "
    "with empty space; strongest positives + short strategic summary); Keyword Rankings overview; Biggest Movers; "
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
    "1. Cover Slide — company name, 'Google Ads Performance Report', and the REPORTING PERIOD date range as the subtitle, on a professional hero visual. NO KPI numbers/metric chips/clicks/spend on the cover — keep it clean.\n"
    "2. Executive Summary — CHART-LED slide: one or two large Plotly charts as the focus, with the high-level KPIs as a slim compact strip along the top or bottom (NOT large number cards with empty space). Strongest positive outcomes, short strategic summary.\n"
    "3. Account Performance — Spend, Clicks, Impressions, CTR, CPC, Conversions, Cost per Conversion, ROAS/Conversion Value if available; highlight key wins visually.\n"
    "4. Keyword Conversion Performance — top converting keywords, best CTR keywords, highest-value search intent; tables or charts.\n"
    "5. Landing Page Performance — best-performing and conversion-driving pages, engagement insights if available; focus on strengths.\n"
    "6. Conversion Funnel Analysis — funnel visualization, drop-off points, positive conversion flow insights.\n"
    "7. Click Type Analysis — breakdown of click types, performance comparison, strongest engagement sources.\n"
    "8. Demographics Performance — age, gender, audience segments if available; highlight highest-performing demographics.\n"
    "9. Strategic Insights & Optimization Opportunities — actionable Google Ads recommendations ONLY (scale winning campaigns, improve keyword targeting, budget allocation, audience optimization, bid strategy). Do NOT suggest website redesign unless the data supports it.\n"
    "10. Closing Slide — key takeaways, positive momentum summary, professional thank-you page with the reporting period in a slim footer."
)


# Structure for a GA4 (Google Analytics) on-site behaviour report.
GA4_STRUCTURE = (
    "1. Cover Slide — site/property name, 'Website Analytics Performance Report', and the REPORTING PERIOD date range as the subtitle, on a professional hero visual. NO KPI numbers/metric chips/sessions/users on the cover — keep it clean.\n"
    "2. Executive Summary — CHART-LED slide: one or two large Plotly charts (sessions/users/conversions over time) as the focus, with the high-level KPIs as a slim compact strip along the top or bottom (NOT large number cards with empty space). Strongest positives, short strategic summary.\n"
    "3. Audience & Engagement — sessions, total users, new users, engagement rate, bounce rate, average session duration with period-over-period change; highlight key wins visually.\n"
    "4. Traffic by Channel — sessions/users/conversions broken down by channel (organic, direct, paid, referral, social, etc.); present clearly with a table or bar/pie chart.\n"
    "5. Conversions — conversions and conversion trend; where conversions come from (best channels); positive framing.\n"
    "6. Trends — how sessions/users/conversions moved over the period; positive momentum framing with a trend chart.\n"
    "7. Sessions by Country — a Plotly CHOROPLETH world map (\"type\":\"choropleth\", \"locationmode\":\"country names\", locations = the country names, z = sessions) shaded with the accent colourscale, paired with a top-countries bar/table. Keep the geo clean (transparent bg, no coastline/frame chartjunk).\n"
    "8. Strategic Insights & Recommendations — actionable recommendations ONLY based on the analytics (double down on best channels, improve engagement on weak pages, grow new-user acquisition, lift conversion rate).\n"
    "9. Closing Slide — key takeaways, positive momentum summary, professional thank-you page with the reporting period in a slim footer."
)


# Structure for an organic-search (Google Search Console) monthly report.
GSC_STRUCTURE = (
    "1. Cover Slide — site/domain, 'Organic Search Performance Report', and the REPORTING PERIOD date range as the subtitle, on a professional hero visual. NO KPI numbers/metric chips/clicks/impressions on the cover — keep it clean.\n"
    "2. Executive Summary — CHART-LED slide: one or two large Plotly charts (clicks/impressions/CTR/position) as the focus, with the high-level KPIs as a slim compact strip along the top or bottom (NOT large number cards with empty space). Strongest positives, short strategic summary.\n"
    "3. Search Performance — clicks, impressions, CTR, average position with period-over-period change; highlight key wins visually.\n"
    "4. Performance Over Time — use MONTHLY PERFORMANCE: a Plotly COMBO chart with clicks & impressions as bars (accent / accent-2) and average POSITION as a line on a SECONDARY y-axis that is REVERSED (lower is better, so a rising line = improving rank). Optionally a second slide with the daily impressions and URL-clicks as filled AREA charts.\n"
    "5. Top Queries (REQUIRED — always include this slide) — a clean, readable TABLE of the top ~10 queries by clicks "
    "with columns Query · Clicks · Impressions · CTR · Avg position. The boss must be able to read exactly which keywords drive "
    "traffic, so this is a real labelled table (NOT just the bubble chart). Optionally pair it with a small bar of clicks by query.\n"
    "6. Keyword Deep-Dive (Top Queries & Opportunity) — ONE slide, two-column full-height layout (.layout-split). "
    "LEFT column (~38%): the eyebrow 'KEYWORD DEEP-DIVE' + a title, then the TOP 3 queries (by clicks) as compact pill/cards "
    "(query · clicks · avg position); BELOW them a grounded 'Unique Keywords' block from KEYWORD MIX — a .kpi showing the "
    "'Unique keywords (distinct queries)' number, plus a SMALL ranking-distribution DONUT (Plotly pie, \"hole\":0.6, "
    "values = [positions 1-3 count, positions 4-10 count, positions 11+ count] from KEYWORD MIX, "
    "labels = [\"Pos 1-3\",\"Pos 4-10\",\"Pos 11+\"], colours = [accent, accent-2, --muted], sized ~190x190 to fit its box with a "
    "slim legend below — it MUST actually render as a pie and must NOT overflow/clip. Do NOT replace the donut with plain number "
    "cards, and do NOT print any '% long-tail/short-tail' framing. "
    "RIGHT column (~62%, the HERO): a Plotly BUBBLE chart from KEYWORD POSITION vs IMPRESSIONS — ONE scatter trace with "
    "\"type\":\"scatter\", x = the average position of every query (x-axis REVERSED so better ranks sit on the RIGHT), "
    "y = the impressions of every query. The trace MUST carry, ALIGNED to x/y, a \"customdata\" array = the QUERY STRING of each point, "
    "and MUST include \"meta\":{\"chart\":\"keyword-bubble\"} so the renderer can finish it. Marker colour = --accent. "
    "(The system deterministically scales the bubbles by impressions and labels the biggest ~8 queries beside their bubble, so just "
    "supply accurate x, y and customdata — do not worry about marker.size yourself.) \"showlegend\":false.\n"
    "7. Biggest Movers (REQUIRED: show BOTH risers AND fallers — not climbers only) — two side-by-side panels: rising vs falling "
    "QUERIES (previous → current) and, below or beside them, rising vs falling LANDING PAGES. Frame the fallers honestly as "
    "at-risk/decline-to-defend (not alarmist), but they MUST be shown so the report is balanced. Diverging horizontal bars or clean "
    "two-column tables work well.\n"
    "8. Query Opportunities — high-impression / low-CTR or near-page-1 queries to target next.\n"
    "9. CTR Opportunities — from CTR OPPORTUNITIES: queries with strong impressions but a CTR below what their rank should earn. Show actual vs expected CTR (a grouped/diverging bar or a clean table) ranked by missed clicks, framed as quick title/meta wins. OMIT this slide entirely if CTR OPPORTUNITIES is (none).\n"
    "10. Query Footprint — from QUERY FOOTPRINT: a Plotly STACKED BAR per month of top-10 query counts (pos 1-3 stacked with pos 4-10) plus a line for total queries; shows ranking visibility growing over time.\n"
    "11. Top Pages (REQUIRED — always include this slide) — a readable TABLE of the best-performing landing pages by clicks "
    "(Page · Clicks · Impressions · CTR · Avg position); shorten long URLs to their path. Focus on strengths.\n"
    "12. Channels — Devices & Search Type — a .layout-split: on one side a device breakdown (from BY DEVICE — donut or bar of clicks/impressions by desktop/mobile/tablet); on the other a search-surface breakdown (from BY SEARCH TYPE — bar of web/image/video/news). If BY SEARCH TYPE is (none) or web-only, show devices alone full-width. OMIT the slide only if BY DEVICE is also (none).\n"
    "13. Search Appearance — from SEARCH APPEARANCE: a bar or table of rich-result types (FAQ, product snippets, etc.) by clicks/impressions/CTR. OMIT this slide entirely if SEARCH APPEARANCE is (none).\n"
    "14. Geographic Distribution — from GEOGRAPHY: a Plotly CHOROPLETH world map (\"type\":\"choropleth\") shaded by the stated metric (sessions or clicks) using the stated locationmode, paired with a top-countries bar. Keep the geo clean (accent colourscale, transparent bg, no coastline/frame chartjunk).\n"
    "15. Strategic Insights & Recommendations — actionable SEO recommendations ONLY (content, internal linking, CTR/title improvements, target near-page-1 queries, defend declining queries/pages).\n"
    "16. Closing Slide — key takeaways, positive momentum summary, professional thank-you page with the reporting period in a slim footer."
)


# ---------------------------------------------------------------------------
# DESIGN SYSTEM — always appended (like HTML_CONTRACT) so EVERY deck, including
# custom prompts, gets the same template-grade consistency. This is what closes the
# gap to polished tools: cohesive tokens + a fixed component/layout vocabulary so all
# slides look like one designed template instead of N improvised ones.
# ---------------------------------------------------------------------------
DESIGN_SYSTEM = """=== DESIGN SYSTEM (required — build the deck like a senior studio template) ===
Define a single design language ONCE in :root and reuse it on every slide. Do NOT invent
per-slide colours, fonts or spacing — everything references the tokens below.

1. DESIGN TOKENS — put this in the <style> and use var(...) everywhere:
   :root{
     --bg: <chosen background>;        /* page/canvas ground */
     --surface: <card surface>;        /* cards, panels */
     --ink: <primary text>;            /* headings/body — must be high-contrast on --bg */
     --muted: <secondary text>;        /* captions, axis labels */
     --accent: <ONE vivid accent>;     /* the single pop colour */
     --accent-2: <supporting tone>;    /* second series / subtle fills */
     --line: <hairline/border colour>;
     --font-display: '<display font>', serif;   /* headlines */
     --font-body: '<body font>', sans-serif;    /* everything else */
   }
   Type scale (use consistently): display 64-96px, h2 34-44px, kpi-number 40-56px,
   body 18-20px, caption 13-14px. Spacing in multiples of 8px. Border-radius consistent.

2. SHARED COMPONENTS — define and reuse these classes (consistent on every slide):
   - .eyebrow  : tiny ALL-CAPS letter-spaced kicker in --accent above a heading.
   - .kpi      : a metric block — big number (--font-display, --accent) + small label (--muted).
   - .card     : --surface bg, --line border, generous padding, consistent radius & subtle shadow.
   - .chip     : small pill label (used for tags, deltas like ▲ +12%).
   - .pageno   : small corner index "03 / 09".

3. FILL THE WHOLE SLIDE (critical — slides must NOT end half-empty):
   Make every .slide a full-height column: display:flex; flex-direction:column; height:720px;
   padding:56px 72px. Give it a header (eyebrow+title), then a MAIN content region that GROWS
   to fill all remaining height (flex:1; min-height:0; display:flex), then the .pageno pinned at
   the bottom. The main region's chart/cards/table MUST stretch to consume that space — size
   charts large (e.g. height:100% of the main region, ~420-520px), enlarge cards and spacing.
   No slide may leave more than ~10% empty vertical space (no big empty band at the bottom).

4. LAYOUT ARCHETYPES — EVERY <section class="slide"> must ALSO carry one archetype class,
   and follow its structure (this is what makes the deck feel templated). All of them obey
   rule 3 (fill the full height):
   - .layout-cover    : poster title page — a FULL-BLEED hero PHOTO (an <img class="ai-img">
                        covering the whole slide) with a dark gradient overlay for legible text;
                        oversized display title (one *italic serif* accent word), an eyebrow report
                        label, and the REPORTING PERIOD date range as the subtitle. (Use a bold
                        saturated colour field only if no fitting photo.) Do NOT put any KPI numbers,
                        metric chips, clicks or impressions on the cover — keep it clean (title +
                        report label + reporting period + hero photo only).
   - .layout-section  : a divider — huge number + section title on a saturated/dark ground.
   - .layout-kpi-strip: a slim horizontal KPI row (3-5 .kpi) at the top + ONE large chart that
                        fills ALL the remaining height below it (the chart is the hero, not a thumbnail).
   - .layout-split    : two columns ~40/60, both stretched to full slide height — text/KPIs on one
                        side, a large chart or full-height photo on the other.
   - .layout-list     : icon bullets spread over the full height — each row is an .ai-icon + bold
                        lead-in + one line; use generous row spacing so the list fills the slide.
   - .layout-comparison: two/three .card columns, full height, compared side by side.
   - .layout-roadmap  : a horizontal numbered step sequence (3-5 steps) centred in the slide.
   - .layout-quote    : one large pull-quote / single headline insight, vertically centred.
   - .layout-closing  : thank-you poster — big type + the reporting period in a slim footer strip.
   Vary archetypes across the deck; never repeat the same layout on consecutive content slides."""


# A short menu of vetted, cohesive palette + Google-font pairings. The model picks ONE
# that fits the industry and binds it to the tokens — prevents clashing colour/type.
THEME_PRESETS = """=== THEME PRESETS (pick exactly ONE that fits the industry, then bind it to the tokens) ===
A. "Editorial Cream" — bg #FAF7F0, surface #FFFFFF, ink #1A1A1A, muted #6B6B6B, accent #E4572E, accent-2 #2A4D69; display 'Fraunces', body 'Inter'.
B. "Modern Mono" — bg #0E0E10 (dark) for covers / #F5F5F4 content, ink #111 / #FAFAFA, accent #FACC15, accent-2 #64748B; display 'Space Grotesk', body 'Inter'.
C. "Clean Corporate" — bg #FFFFFF, surface #F8FAFC, ink #0F172A, muted #64748B, accent #2563EB, accent-2 #0EA5E9; display 'Archivo', body 'Inter'.
D. "Warm Premium" — bg #FBF6F1, surface #FFFFFF, ink #20140E, muted #7A6A5F, accent #B45309, accent-2 #166534; display 'Playfair Display', body 'Source Sans 3'.
E. "Bold Vermillion" — bg #FFF8F4, surface #FFFFFF, ink #1C1917, muted #78716C, accent #DC2626, accent-2 #1E293B; display 'Bricolage Grotesque', body 'Inter'.
Load the chosen fonts from fonts.googleapis.com. You MAY tune the accent toward the brand's industry, but keep the palette cohesive and high-contrast."""


# One complete worked example anchors the model far more than instructions alone. Generic
# placeholder content only (no numbers that could be mistaken for real data).
DESIGN_EXEMPLARS = """=== EXEMPLAR (match THIS polish AND the full-height skeleton; do NOT copy its words/theme) ===
Note how the slide is a full-height column and the chart region (flex:1) fills ALL space below
the KPI row so there is no empty band at the bottom:
<section class="slide layout-kpi-strip" style="display:flex;flex-direction:column;height:720px;padding:56px 72px">
  <span class="eyebrow">Performance Overview</span>
  <h2>The quarter in <em>focus</em>.</h2>
  <div class="kpi-row" style="display:flex;gap:20px">
    <div class="kpi"><i class="ai-icon" data-icon="trending-up"></i><span class="kpi-num">—</span><span class="kpi-label">Clicks</span></div>
    <div class="kpi"><i class="ai-icon" data-icon="eye"></i><span class="kpi-num">—</span><span class="kpi-label">Impressions</span></div>
    <div class="kpi"><i class="ai-icon" data-icon="target"></i><span class="kpi-num">—</span><span class="kpi-label">Avg position</span></div>
  </div>
  <div style="flex:1;min-height:0;margin-top:24px"><div id="chart1" style="width:100%;height:100%"></div></div>
  <div class="pageno" style="margin-top:16px">02 / 09</div>
  <script type="application/json" class="plotly-spec" data-target="chart1">{"data":[{"type":"bar","x":["Jan","Feb","Mar"],"y":[3,5,4]}],"layout":{}}</script>
</section>
And a clean cover — a FULL-BLEED hero photo with a dark overlay, then title + report label +
reporting PERIOD only (NO metric chips):
<section class="slide layout-cover" style="position:relative;display:flex;flex-direction:column;justify-content:center;height:720px;padding:64px 72px;color:#fff">
  <img class="ai-img" data-prompt="modern luxury bathroom showroom, marble vanity, soft warm lighting, premium, photographic" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0">
  <div style="position:absolute;inset:0;background:linear-gradient(rgba(20,12,8,.72),rgba(20,12,8,.42));z-index:1"></div>
  <div style="position:relative;z-index:2">
    <span class="eyebrow">Organic Search Report</span>
    <h1>Bathrooms &amp; <em>More</em></h1>
    <p class="period">1 – 28 May 2026</p>
  </div>
  <div class="pageno" style="position:relative;z-index:2">01 / 09</div>
</section>
Every real slide must fill all 1280x720 (no bottom band), use the tokens/components above, put a
relevant icon on every KPI and list bullet, and use ai-img photos liberally — ALWAYS a full-bleed
hero photo on the cover, and photo backgrounds/side-panels on most content slides."""


def build_prompt(data_brief: str, *, prompt: Optional[str] = None,
                 brand: Optional[str] = None, structure: Optional[str] = None) -> str:
    """Fill the (possibly user-customised) prompt template with brand/structure/data,
    then append the rendering contract + design system + theme presets + exemplar so
    every deck — default or custom — gets the same template-grade quality bar."""
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
    return "\n\n".join([filled, HTML_CONTRACT, DESIGN_SYSTEM, THEME_PRESETS, DESIGN_EXEMPLARS])


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


_SCRIPT_STYLE_RE = re.compile(r'<(script|style)\b[^>]*>.*?</\1>', re.IGNORECASE | re.DOTALL)


def _match_brace(s: str, start: int) -> int:
    """Index of the '}' that closes the '{' at `start`, respecting JSON strings. -1 if none."""
    depth, in_str, esc = 0, False, False
    for k in range(start, len(s)):
        c = s[k]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return k
    return -1


def _strip_leaked_specs(html: str) -> str:
    """Remove any chart-spec JSON the model printed as VISIBLE text (a bare object with
    "data" and "layout"). Legit specs live inside <script class="plotly-spec"> and must be
    preserved, so script/style bodies are masked out before scanning. Safety net: even if a
    model ignores the contract, no raw chart JSON ever reaches a slide."""
    if '{"data"' not in html and '{ "data"' not in html:
        return html
    blocks: list = []

    def _hide(m):
        blocks.append(m.group(0))
        return f"\x00B{len(blocks) - 1}\x00"

    masked = _SCRIPT_STYLE_RE.sub(_hide, html)

    out, i, n = [], 0, len(masked)
    while i < n:
        j = masked.find('{"data"', i)
        if j == -1:
            out.append(masked[i:])
            break
        end = _match_brace(masked, j)
        if end == -1:
            out.append(masked[i:])
            break
        blob = masked[j:end + 1]
        if '"layout"' in blob:          # a leaked chart spec → drop it
            out.append(masked[i:j])
        else:                            # some other inline JSON → keep it
            out.append(masked[i:end + 1])
        i = end + 1
    cleaned = "".join(out)
    return re.sub(r"\x00B(\d+)\x00", lambda m: blocks[int(m.group(1))], cleaned)


_DECK_SYSTEM_PROMPT = "You are an award-winning presentation designer who outputs only clean, self-contained HTML."


def _build_repair_prompt(html: str, instructions: str) -> str:
    """A focused follow-up asking the model to fix ONLY the listed problems and
    re-emit the whole document. Keeps the deck self-contained per HTML_CONTRACT."""
    return (
        "The HTML presentation below has specific problems that must be fixed. Fix ONLY "
        "the problems listed; preserve all other content, wording, numbers, layout and "
        "design exactly as they are.\n\n"
        "PROBLEMS TO FIX:\n" + instructions + "\n\n"
        "Return the COMPLETE corrected HTML document and NOTHING ELSE — no markdown, no "
        "commentary. It must still satisfy this contract:\n\n" + HTML_CONTRACT + "\n\n"
        "=== CURRENT HTML ===\n" + html
    )


def _make_image_prewarmer(image_cache: Dict[str, "asyncio.Task"]):
    """Build an on_delta callback that, as the deck streams in, starts generating an
    image the moment each <img class="ai-img" data-prompt="..."> placeholder is fully
    written — so photos render concurrently with the rest of the slide-writing instead
    of serially afterward. Tasks are keyed by prompt in image_cache for resolve_ai_images
    to await. Bounded by MAX_DECK_IMAGES and _IMG_CONCURRENCY (rate-limit safe)."""
    from services.image_service import generate_image
    sem = asyncio.Semaphore(_IMG_CONCURRENCY)

    async def _gen(prompt: str):
        async with sem:
            return await generate_image(prompt)

    async def on_delta(buf: str):
        if len(image_cache) >= MAX_DECK_IMAGES or "ai-img" not in buf:
            return
        for m in _AI_IMG_RE.finditer(buf):
            if len(image_cache) >= MAX_DECK_IMAGES:
                break
            p = _img_prompt(m.group(0))
            if p and p not in image_cache:
                image_cache[p] = asyncio.create_task(_gen(p))

    return on_delta


async def generate_deck_html(data_brief: str, *, prompt: Optional[str] = None,
                             brand: Optional[str] = None, structure: Optional[str] = None,
                             provider: str = "deepseek", on_progress: ProgressCb = None,
                             image_cache: Optional[Dict[str, "asyncio.Task"]] = None) -> str:
    """Ask the chosen LLM provider to design the deck and return self-contained HTML.

    Runs one cheap (no-browser) validation pass; if it finds structural, Plotly-spec,
    or ungrounded-number problems, makes a single targeted repair call. Always returns
    renderable HTML best-effort — a failed/worse repair is discarded, never blocks.

    If image_cache is provided, the deck is streamed and image generation is kicked off
    for each photo placeholder as it appears (concurrent with writing); resolve_ai_images
    later awaits those tasks. Falls back transparently to non-streaming if streaming fails."""
    from services.deck_validation import validate_deck_html
    from services.image_service import images_enabled

    # prompt is normally resolved by the route (from the chosen prompt id); fall back
    # to the built-in default if none was passed.
    full_prompt = build_prompt(data_brief, prompt=prompt, brand=brand, structure=structure)
    if on_progress:
        await on_progress("Writing slides…")
    # Stream + prewarm images only when a cache is supplied and images are enabled.
    on_delta = (_make_image_prewarmer(image_cache)
                if image_cache is not None and images_enabled() else None)
    try:
        raw = await ai_service.analyze_with_provider(
            full_prompt,
            system_prompt=_DECK_SYSTEM_PROMPT,
            provider=provider,
            on_progress=on_progress,
            on_delta=on_delta,
        )
    except Exception:
        if on_delta is None:
            raise
        # Streaming path failed — retry once without it so a deck still generates.
        logger.exception("streamed deck generation failed — retrying without streaming")
        raw = await ai_service.analyze_with_provider(
            full_prompt, system_prompt=_DECK_SYSTEM_PROMPT, provider=provider,
            on_progress=on_progress,
        )
    html = _clean_html(raw)

    result = validate_deck_html(html, data_brief)
    if result.ok:
        return _strip_leaked_specs(html)

    logger.info(
        "deck validation found issues (structural=%d, plotly=%d, ungrounded_numbers=%d) — attempting repair",
        len(result.structural), len(result.plotly), len(result.ungrounded_numbers),
    )
    if on_progress:
        await on_progress("Checking & fixing the deck…")
    try:
        repair_raw = await ai_service.analyze_with_provider(
            _build_repair_prompt(html, result.repair_instructions()),
            system_prompt=_DECK_SYSTEM_PROMPT,
            provider=provider,
            on_progress=on_progress,
        )
        repaired = _clean_html(repair_raw)
        after = validate_deck_html(repaired, data_brief)
        # Accept the repair only if it is still a valid full deck (no structural errors),
        # so a bad repair can never leave us worse off than the original.
        if not after.structural:
            html = repaired
            logger.info(
                "post-repair validation (structural=%d, plotly=%d, ungrounded_numbers=%d)",
                len(after.structural), len(after.plotly), len(after.ungrounded_numbers),
            )
        else:
            logger.warning("repair produced a structurally invalid deck — keeping original HTML")
    except Exception:
        logger.exception("deck repair call failed — keeping original HTML")

    return _strip_leaked_specs(html)


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


_PLOTLY_SPEC_RE = re.compile(
    r'(<script\b[^>]*\bclass=["\']plotly-spec["\'][^>]*>)(.*?)(</script>)',
    re.IGNORECASE | re.DOTALL,
)
# How big the largest bubble should render (px diameter) and how many to label.
_BUBBLE_MAX_PX = 95
_BUBBLE_LABELS = 8


def _is_keyword_bubble(trace: dict, layout: dict) -> bool:
    """Identify the keyword position-vs-impressions scatter so we can enforce its
    sizing/labels. Prefer an explicit meta flag the prompt asks for; else fall back to
    the axis titles the model reliably emits (x≈'position', y≈'impressions')."""
    if (trace.get("meta") or {}).get("chart") == "keyword-bubble":
        return True
    if (layout.get("meta") or {}).get("chart") == "keyword-bubble":
        return True
    if str(trace.get("type", "scatter")).lower() not in ("scatter", "scattergl", ""):
        return False

    def _title(ax):
        t = (layout.get(ax) or {}).get("title")
        return (t.get("text") if isinstance(t, dict) else t) or ""

    xt, yt = _title("xaxis").lower(), _title("yaxis").lower()
    return "position" in xt and "impress" in yt


def _enforce_keyword_bubble(html: str) -> str:
    """Deterministically fix the keyword bubble chart regardless of what the LLM emitted:
    scale every bubble's area by impressions and label the top-N by impressions beside their
    point. The model only needs to supply the data (x positions, y impressions, and a query
    per point via customdata/text/hovertext); the math + labelling happen here so the chart
    is reliably big and labelled even when the model ignores those instructions."""
    if "plotly-spec" not in html:
        return html
    import json

    def _floats(seq):
        out = []
        for v in seq:
            try:
                out.append(float(v))
            except (TypeError, ValueError):
                out.append(0.0)
        return out

    def _fix(m):
        try:
            spec = json.loads(m.group(2))
        except Exception:
            return m.group(0)
        data = spec.get("data")
        layout = spec.get("layout") or {}
        if not isinstance(data, list):
            return m.group(0)

        changed = False
        for trace in data:
            if not isinstance(trace, dict) or "y" not in trace or not isinstance(trace.get("y"), list):
                continue
            if not _is_keyword_bubble(trace, layout):
                continue
            ys = _floats(trace["y"])
            if not ys or max(ys) <= 0:
                continue
            maxy = max(ys)
            marker = trace.get("marker") if isinstance(trace.get("marker"), dict) else {}
            marker["size"] = ys
            marker["sizemode"] = "area"
            marker["sizeref"] = (2.0 * maxy) / (_BUBBLE_MAX_PX ** 2)
            marker["sizemin"] = 6
            marker.setdefault("opacity", 0.7)
            trace["marker"] = marker

            # Per-point query labels — pull from whatever the model provided.
            labels_src = None
            for key in ("customdata", "text", "hovertext"):
                val = trace.get(key)
                if isinstance(val, list) and len(val) == len(ys):
                    labels_src = [("" if v is None else str(v)) for v in val]
                    break
            if labels_src:
                keep = set(sorted(range(len(ys)), key=lambda i: ys[i], reverse=True)[:_BUBBLE_LABELS])
                trace["text"] = [labels_src[i] if i in keep else "" for i in range(len(ys))]
                trace["mode"] = "markers+text"
                # Place each label on the INWARD side so it can't run off the slide edge:
                # the x-axis is reversed (best ranks on the right), so points with a small x
                # sit on the right and get a left-side label; the rest get a right-side label.
                xs = _floats(trace.get("x") or list(range(len(ys))))
                xmid = (min(xs) + max(xs)) / 2 if xs else 0
                trace["textposition"] = [
                    ("middle left" if xs[i] <= xmid else "middle right") for i in range(len(ys))
                ]
                tf = trace.get("textfont") if isinstance(trace.get("textfont"), dict) else {}
                tf.setdefault("size", 11)
                trace["textfont"] = tf
            else:
                trace["mode"] = "markers"

            # Headroom on BOTH sides so inward labels (left or right) never clip.
            margin = layout.get("margin") if isinstance(layout.get("margin"), dict) else {}
            margin["r"] = max(int(margin.get("r", 0) or 0), 130)
            margin["l"] = max(int(margin.get("l", 0) or 0), 120)
            layout["margin"] = margin
            spec["layout"] = layout
            changed = True

        if not changed:
            return m.group(0)
        return m.group(1) + json.dumps(spec) + m.group(3)

    return _PLOTLY_SPEC_RE.sub(_fix, html)


def _polish_plotly_specs(html: str) -> str:
    """Apply one cohesive 'house style' to EVERY chart so the deck looks like a designed
    template, not N improvised charts — done deterministically (setdefault only, so explicit
    model choices win) instead of trusting the LLM to style each chart. Fixes the recurring
    rough edges: transparent backgrounds, faint gridlines, tidy margins, rounded bars,
    automargin so axis labels stop overlapping, and compact choropleth colorbars."""
    if "plotly-spec" not in html:
        return html
    import json

    def _polish(m):
        try:
            spec = json.loads(m.group(2))
        except Exception:
            return m.group(0)
        data = spec.get("data")
        layout = spec.get("layout") if isinstance(spec.get("layout"), dict) else {}
        if not isinstance(data, list):
            return m.group(0)

        layout.setdefault("paper_bgcolor", "rgba(0,0,0,0)")
        layout.setdefault("plot_bgcolor", "rgba(0,0,0,0)")
        layout.setdefault("hovermode", False)
        margin = layout.get("margin") if isinstance(layout.get("margin"), dict) else {}
        for k, v in (("t", 16), ("r", 16), ("b", 44), ("l", 52)):
            margin.setdefault(k, v)
        layout["margin"] = margin
        font = layout.get("font") if isinstance(layout.get("font"), dict) else {}
        font.setdefault("size", 13)
        layout["font"] = font
        # Every axis (xaxis, yaxis, xaxis2, …) gets automargin + clean grid/zeroline.
        for key, ax in list(layout.items()):
            if (key.startswith("xaxis") or key.startswith("yaxis")) and isinstance(ax, dict):
                ax.setdefault("automargin", True)
                ax.setdefault("zeroline", False)
                ax.setdefault("gridcolor", "rgba(0,0,0,0.06)")
                ax.setdefault("linecolor", "rgba(0,0,0,0.15)")
                ax.setdefault("ticks", "")

        for tr in data:
            if not isinstance(tr, dict):
                continue
            ttype = str(tr.get("type", "")).lower()
            if ttype == "bar":
                mk = tr.get("marker") if isinstance(tr.get("marker"), dict) else {}
                mk.setdefault("cornerradius", 5)
                tr["marker"] = mk
            elif ttype in ("scatter", "scattergl", "") and isinstance(tr.get("line"), dict):
                tr["line"].setdefault("width", 2.5)
            elif ttype == "choropleth":
                cb = tr.get("colorbar") if isinstance(tr.get("colorbar"), dict) else {}
                cb.setdefault("thickness", 12)
                cb.setdefault("len", 0.6)
                cb.setdefault("outlinewidth", 0)
                cb.setdefault("x", 1.02)
                tr["colorbar"] = cb

        spec["layout"] = layout
        return m.group(1) + json.dumps(spec) + m.group(3)

    return _PLOTLY_SPEC_RE.sub(_polish, html)


def _prepare_html_for_render(html: str) -> str:
    """Inline the bundled Plotly so charts render with NO internet access — the VPS
    may not reach cdn.plot.ly. Strips the CDN <script> and injects the local copy."""
    if not any(k in html for k in ("Plotly.newPlot", "plot.ly", "plotly-spec")):
        return html
    html = _polish_plotly_specs(html)
    html = _enforce_keyword_bubble(html)
    src = _plotly_source()
    if not src:
        return html  # no local bundle available — leave the CDN tag as-is
    html = re.sub(r'<script\b[^>]*\bsrc=["\']https?://cdn\.plot\.ly/[^"\']*["\'][^>]*>\s*</script>',
                  '', html, flags=re.IGNORECASE)
    inline = "<script>/* bundled-plotly */\n" + src + "\n</script>"
    if "</head>" in html:
        html = html.replace("</head>", inline + "</head>", 1)
    else:
        html = inline + html
    # Render every <script type="application/json" class="plotly-spec"> ourselves — the
    # AI emits JSON specs reliably but inconsistently wires up executable <script> calls.
    bootstrap = (
        "<script>(function(){if(!window.Plotly)return;"
        "document.querySelectorAll('script.plotly-spec').forEach(function(s){try{"
        "var spec=JSON.parse(s.textContent);"
        "var id=s.getAttribute('data-target');"
        "var el=(id&&document.getElementById(id))||s.previousElementSibling;"
        "if(el)Plotly.newPlot(el,spec.data||[],spec.layout||{},"
        "{staticPlot:true,displayModeBar:false,responsive:false});"
        "}catch(e){console.error('plotly-spec render failed',e);}});})();</script>"
    )
    if "</body>" in html:
        return html.replace("</body>", bootstrap + "</body>", 1)
    return html + bootstrap


_AI_IMG_RE = re.compile(r'<img\b[^>]*\bai-img\b[^>]*>', re.IGNORECASE)


async def resolve_ai_images(html: str, *, max_images: int = MAX_DECK_IMAGES,
                            on_progress: ProgressCb = None,
                            image_cache: Optional[Dict[str, "asyncio.Task"]] = None) -> str:
    """Replace <img class="ai-img" data-prompt="..."> placeholders with real
    Supermachine photos embedded as base64 (so the offline renderer can use them).
    Failed or over-cap placeholders are dropped so the deck still renders cleanly.

    If image_cache is given, photos whose generation was already kicked off during the
    streamed write are awaited from it (usually already done) instead of being generated
    from scratch here — that's what overlaps image generation with slide-writing."""
    if "ai-img" not in html:
        return html
    from services.image_service import generate_image, images_enabled

    tags = list(_AI_IMG_RE.finditer(html))
    if not tags:
        return html
    if not images_enabled():
        # no image key — strip placeholders so no empty <img> shows
        return _AI_IMG_RE.sub("", html)

    gen_tags = tags[:max_images]
    if on_progress:
        await on_progress(f"Finalizing images… ({len(gen_tags)})")
    sem = asyncio.Semaphore(_IMG_CONCURRENCY)

    async def _one(prompt: str):
        # Prefer the prewarmed task started while the deck was being written.
        if image_cache is not None and prompt in image_cache:
            try:
                return await image_cache[prompt]
            except Exception:
                return None
        async with sem:
            return await generate_image(prompt)

    images = await asyncio.gather(*[_one(_img_prompt(m.group(0))) for m in gen_tags])

    # Clean up any prewarmed tasks the final deck didn't use (e.g. a placeholder the
    # repair pass changed) so they don't leak as 'never retrieved' or keep running.
    if image_cache:
        used = {_img_prompt(m.group(0)) for m in gen_tags}
        for p, task in image_cache.items():
            if p not in used and not task.done():
                task.cancel()
        await asyncio.gather(*image_cache.values(), return_exceptions=True)

    out, last = [], 0
    for idx, m in enumerate(tags):
        out.append(html[last:m.start()])
        img = images[idx] if idx < len(gen_tags) else None
        if img:
            mime = "jpeg" if img[:2] == b"\xff\xd8" else "png"
            b64 = base64.b64encode(img).decode()
            out.append(m.group(0).replace("<img", f'<img src="data:image/{mime};base64,{b64}"', 1))
        # else: drop the placeholder (failed or beyond cap)
        last = m.end()
    out.append(html[last:])
    return "".join(out)


_AI_ICON_RE = re.compile(r'<i\b[^>]*\bai-icon\b[^>]*>\s*</i>', re.IGNORECASE)
_ICONS_SRC: Optional[Dict[str, str]] = None


def _icons_source() -> Dict[str, str]:
    """Load the bundled inline-SVG icon set once (backend/assets/icons.json, Lucide/ISC)."""
    global _ICONS_SRC
    if _ICONS_SRC is None:
        import json
        f = Path(__file__).resolve().parent.parent / "assets" / "icons.json"
        try:
            _ICONS_SRC = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            _ICONS_SRC = {}
    return _ICONS_SRC


_ICON_COMMENT_RE = re.compile(r'<!--.*?-->', re.DOTALL)
_ICON_SIZE_RE = re.compile(r'\b(width|height)="[^"]*"', re.IGNORECASE)


def _prep_icon_svg(svg: str) -> str:
    """Make a vendored Lucide SVG inline-friendly: drop the license comment, size it to
    1em (so font-size controls it) and tag it .ai-icon. Stroke is already currentColor,
    so it inherits the surrounding text colour (set to --accent/--ink via CSS)."""
    svg = _ICON_COMMENT_RE.sub("", svg).strip()
    svg = _ICON_SIZE_RE.sub(lambda m: f'{m.group(1)}="1em"', svg)
    # ensure our class is present for sizing/vertical-align in the deck CSS
    if "ai-icon" not in svg:
        svg = svg.replace("<svg", '<svg class="ai-icon"', 1)
    return svg


def resolve_ai_icons(html: str) -> str:
    """Replace <i class="ai-icon" data-icon="NAME"></i> placeholders with inline SVG from
    the bundled set. Unknown icons are dropped (no broken glyphs). No network — instant,
    offline-safe — so this runs synchronously at the end of the deck pipeline."""
    if "ai-icon" not in html:
        return html
    icons = _icons_source()
    if not icons:
        return _AI_ICON_RE.sub("", html)

    def _sub(m: "re.Match") -> str:
        tag = m.group(0)
        name_m = re.search(r'data-icon=["\']([\w-]+)["\']', tag, re.IGNORECASE)
        svg = icons.get(name_m.group(1)) if name_m else None
        return _prep_icon_svg(svg) if svg else ""

    return _AI_ICON_RE.sub(_sub, html)


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
            # Pin SCREEN media for the whole pipeline. The deck is designed for screen
            # (dark/saturated colour fields, full-bleed photos, 720px flex columns); print
            # emulation would drop those, which is what made the old page.pdf() output blank.
            await page.emulate_media(media="screen")
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
                        timeout=25000,
                    )
                except Exception:
                    pass
                await page.wait_for_timeout(1500)
            # Build the PDF from the SAME per-slide screenshots the preview uses, rather than
            # page.pdf() (which forces print-media emulation and produced blank/black pages).
            # This guarantees PDF == preview == PPTX.
            slide_pngs: List[bytes] = []
            for el in await page.query_selector_all(".slide"):
                slide_pngs.append(await el.screenshot(type="png"))
            await browser.close()
        return {"pdf": _slides_to_pdf(slide_pngs), "slides": slide_pngs}
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


def _slides_to_pdf(slide_pngs: List[bytes]) -> bytes:
    """Assemble the full-slide PNG screenshots into a multi-page PDF (one slide per page).
    Uses the same screenshots as the preview/PPTX so all three outputs match exactly."""
    from PIL import Image

    if not slide_pngs:
        raise ValueError("No slides were rendered — cannot build a PDF (the deck has no .slide elements).")
    pages = [Image.open(BytesIO(p)).convert("RGB") for p in slide_pngs]
    buf = BytesIO()
    pages[0].save(buf, format="PDF", save_all=True, append_images=pages[1:], resolution=96.0)
    return buf.getvalue()


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


async def render_slide_images(html: str, *, quality: int = 72, on_progress: ProgressCb = None) -> List[bytes]:
    """Render each slide to a JPEG for in-app preview — same load/Plotly-wait path as
    _render, so the preview matches the downloaded file exactly (charts included)."""
    import os
    import tempfile
    from pathlib import Path
    from playwright.async_api import async_playwright

    if on_progress:
        await on_progress("Rendering charts & slides…")
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".html", delete=False, encoding="utf-8")
    try:
        tmp.write(_prepare_html_for_render(html))
        tmp.close()
        uses_plotly = "Plotly.newPlot" in html or "plot.ly" in html
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=["--no-sandbox"])
            page = await browser.new_page(viewport={"width": SLIDE_W_PX, "height": SLIDE_H_PX})
            await page.goto(Path(tmp.name).as_uri(), wait_until="networkidle")
            await page.emulate_media(media="screen")
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
                        timeout=25000,
                    )
                except Exception:
                    pass
                await page.wait_for_timeout(1500)
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
    images: bool = True,
    notes: str = "",
    on_progress: ProgressCb = None,
) -> Dict:
    """Full PDF→deck flow: extract the PDF's data, have the AI design the deck with the
    chosen prompt + provider. Renders to the file unless render=False (deferred to download)."""
    from services.pdf_extract import extract_pdf_text
    from services.highlights import to_brief_block

    if on_progress:
        await on_progress("Reading the PDF…")
    data_text = extract_pdf_text(pdf_bytes)
    if not data_text.strip():
        raise ValueError("No extractable text found in the PDF.")
    data_text = data_text + to_brief_block(notes)
    # Shared cache overlaps image generation with the streamed slide-writing.
    image_cache = {} if images else None
    html = await generate_deck_html(
        data_text,
        prompt=prompt,
        brand=brand or GOOGLE_ADS_BRAND,
        structure=structure or GOOGLE_ADS_STRUCTURE,
        provider=provider,
        on_progress=on_progress,
        image_cache=image_cache,
    )
    html = (await resolve_ai_images(html, on_progress=on_progress, image_cache=image_cache)
            if images else _AI_IMG_RE.sub("", html))
    html = resolve_ai_icons(html)
    file_bytes = await render_deck(html, fmt=fmt) if render else None
    return {"format": fmt, "html": html, "data_text": data_text, "file_bytes": file_bytes}
