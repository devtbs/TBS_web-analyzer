"""Validate the AI-generated deck HTML before it is rendered, and describe any
problems precisely enough that the model can repair them.

Three classes of problem are caught here, all of which otherwise fail silently:
  1. Structural — not a full HTML doc, or no <section class="slide"> slides.
  2. Plotly specs — a <script class="plotly-spec"> whose JSON is invalid or is
     missing data/layout. Today these only fail inside the headless browser, so
     the deck ships with a blank chart and no error surfaced.
  3. Ungrounded numbers — numeric values shown on the slides that do NOT appear
     anywhere in the source data brief. The prompt asks the model to use ONLY the
     real data; this verifies it instead of trusting it.

Nothing here mutates the HTML — it only reports. Repairing is the LLM's job (see
the repair loop in ai_deck_service.generate_deck_html).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import List, Set

_SLIDE_RE = re.compile(r'<section\b[^>]*\bclass=["\'][^"\']*\bslide\b', re.IGNORECASE)
_SLIDE_CHUNK_RE = re.compile(r'<section\b[^>]*\bclass=["\'][^"\']*\bslide\b.*?</section>',
                             re.IGNORECASE | re.DOTALL)
_LAYOUT_RE = re.compile(r'\blayout-[a-z-]+', re.IGNORECASE)
# Words-per-slide above this reads as an overcrowded wall of text.
_MAX_WORDS_PER_SLIDE = 150
_PLOTLY_SPEC_RE = re.compile(
    r'<script\b[^>]*\bclass=["\'][^"\']*\bplotly-spec\b[^"\']*["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)
_STYLE_SCRIPT_RE = re.compile(r'<(style|script)\b[^>]*>.*?</\1>', re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r'<[^>]+>')
# A number a viewer would read as a data value: 3+ digits, or anything with a
# decimal/percent/comma group. Deliberately skips 1-2 digit integers (slide
# numbers, "3 wins", small layout values) and 4-digit years are tolerated below.
_NUM_RE = re.compile(r'\d[\d,]*\.\d+|\d{1,3}(?:,\d{3})+|\d+\.\d+|\d{3,}|\d+%')


@dataclass
class ValidationResult:
    ok: bool = True
    structural: List[str] = field(default_factory=list)
    plotly: List[str] = field(default_factory=list)
    ungrounded_numbers: List[str] = field(default_factory=list)
    design: List[str] = field(default_factory=list)

    def repair_instructions(self) -> str:
        """A focused instruction block listing only what to fix. Empty when ok."""
        if self.ok:
            return ""
        parts: List[str] = []
        if self.structural:
            parts.append("STRUCTURE problems:\n" + "\n".join(f"- {m}" for m in self.structural))
        if self.plotly:
            parts.append("INVALID PLOTLY CHART SPECS (fix the JSON so each is strictly "
                         "valid and has both \"data\" and \"layout\"):\n"
                         + "\n".join(f"- {m}" for m in self.plotly))
        if self.ungrounded_numbers:
            parts.append(
                "NUMBERS NOT FOUND IN THE SOURCE DATA — these appear on slides but are "
                "not in the provided data, so they look invented. Replace each with the "
                "correct figure from the data, or remove it:\n"
                + "\n".join(f"- {n}" for n in self.ungrounded_numbers))
        if self.design:
            parts.append(
                "DESIGN QUALITY problems (apply the DESIGN SYSTEM — :root tokens, layout "
                "archetype classes, icons and charts — to fix these):\n"
                + "\n".join(f"- {m}" for m in self.design))
        return "\n\n".join(parts)


def _normalize_num(tok: str) -> str:
    return tok.replace(",", "").rstrip("%").rstrip(".")


def _numbers_in(text: str) -> Set[str]:
    return {_normalize_num(m) for m in _NUM_RE.findall(text)}


def _visible_text(html: str) -> str:
    """Slide-visible text only: drop <style>/<script> bodies (CSS px, chart JSON,
    bootstrap code) so we don't mistake them for displayed figures."""
    stripped = _STYLE_SCRIPT_RE.sub(" ", html)
    return _TAG_RE.sub(" ", stripped)


def validate_deck_html(html: str, data_brief: str) -> ValidationResult:
    res = ValidationResult()

    # 1. Structural
    low = html.lower()
    if "<!doctype" not in low and "<html" not in low:
        res.structural.append("Output is not a complete HTML document (missing <!DOCTYPE html>/<html>).")
    if not _SLIDE_RE.search(html):
        res.structural.append('No slides found — every slide must be a <section class="slide">.')

    # 2. Plotly specs
    for i, body in enumerate(_PLOTLY_SPEC_RE.findall(html), 1):
        raw = body.strip()
        if not raw:
            res.plotly.append(f"Chart spec #{i} is empty.")
            continue
        try:
            spec = json.loads(raw)
        except json.JSONDecodeError as e:
            res.plotly.append(f"Chart spec #{i} is not valid JSON ({e.msg} at line {e.lineno} col {e.colno}).")
            continue
        if not isinstance(spec, dict) or "data" not in spec or "layout" not in spec:
            res.plotly.append(f'Chart spec #{i} is missing "data" and/or "layout".')

    # 3. Ungrounded numbers
    source_nums = _numbers_in(data_brief)
    seen: Set[str] = set()
    for tok in _NUM_RE.findall(_visible_text(html)):
        norm = _normalize_num(tok)
        if norm in seen or norm in source_nums:
            continue
        # Tolerate bare 4-digit years — they're rarely "data" and often contextual.
        if len(norm) == 4 and norm.isdigit() and 1900 <= int(norm) <= 2100:
            continue
        seen.add(norm)
        res.ungrounded_numbers.append(tok)

    # 4. Design quality — conservative heuristics so good decks aren't flagged.
    _check_design(html, res)

    # 5. Required keyword-opportunity bubble slide present when its data exists.
    _check_bubble(html, data_brief, res)

    res.ok = not (res.structural or res.plotly or res.ungrounded_numbers or res.design)
    return res


# A scatter whose axis titles pair position + impressions (mirrors _is_keyword_bubble in
# ai_deck_service.py without importing it — keeps validation dependency-free).
_BUBBLE_AXES_RE = re.compile(r'"(?:title|text)"\s*:\s*"[^"]*position[^"]*"', re.IGNORECASE)


def _check_bubble(html: str, data_brief: str, res: "ValidationResult") -> None:
    """The keyword position-vs-impressions bubble slide is REQUIRED whenever the brief carries
    that data, but the model sometimes drops it. Detect the data section (real rows, not (none))
    and flag a repair when no bubble is present in the HTML, so the existing repair loop adds it."""
    # Is there real bubble data in the brief?
    m = re.search(r'KEYWORD POSITION vs IMPRESSIONS.*?\n(.*?)(?:\n\n|\Z)', data_brief, re.DOTALL | re.IGNORECASE)
    section = (m.group(1) if m else "").strip()
    if not section or section.lower().startswith("(none)"):
        return  # no bubble data → the slide is legitimately absent
    # Is a bubble present? meta flag is the strong signal; axis-title pairing is the fallback.
    has_meta = '"keyword-bubble"' in html
    has_axes = bool(_BUBBLE_AXES_RE.search(html)) and "impress" in html.lower()
    if not (has_meta or has_axes):
        res.design.append(
            'The REQUIRED Keyword Opportunity bubble slide is missing. Add a full-page slide whose '
            'hero is ONE Plotly scatter of every query (x = avg position with the x-axis REVERSED, '
            'y = impressions), carrying "meta":{"chart":"keyword-bubble"} and a "customdata" array of '
            'the query strings. Do not omit this slide.')


def _check_design(html: str, res: "ValidationResult") -> None:
    """Cheap, conservative design-quality checks. Only flags clear template violations
    (no design tokens, archetypes barely used, overcrowded slides, few visuals) so the
    repair pass nudges the deck toward the design system without churning on good decks."""
    slides = _SLIDE_CHUNK_RE.findall(html)
    if not slides:
        return  # structural check already handled the no-slides case

    # a. design tokens defined once and reused
    if ":root" not in html or "var(--" not in html:
        res.design.append("No reusable :root design tokens — define --bg/--ink/--accent/"
                          "--font-display etc. once and reference them with var(...) on every "
                          "slide for one cohesive theme.")

    # b. layout archetypes actually used
    with_layout = sum(1 for s in slides if _LAYOUT_RE.search(s))
    if with_layout < max(1, len(slides) // 2):
        res.design.append(f"Only {with_layout}/{len(slides)} slides use a layout archetype "
                          "class (layout-cover/-kpi-strip/-split/-list/…). Give EVERY slide an "
                          "archetype and follow its structure so the deck looks templated.")

    # c. overcrowded slides
    crowded = [i for i, s in enumerate(slides, 1)
               if len(_visible_text(s).split()) > _MAX_WORDS_PER_SLIDE]
    if crowded:
        res.design.append(f"Slides {crowded} are overcrowded with text (>{_MAX_WORDS_PER_SLIDE} "
                          "words). Cut to the essentials: one idea per slide, short bullets, let "
                          "charts/visuals carry the detail.")

    # d. enough visual elements across the deck
    def _has_visual(s: str) -> bool:
        return ("plotly-spec" in s or "ai-img" in s or "ai-icon" in s
                or "<svg" in s or "<img" in s)
    visual = sum(1 for s in slides if _has_visual(s))
    if visual < max(1, int(len(slides) * 0.4)):
        res.design.append(f"Only {visual}/{len(slides)} slides have a chart, photo or icon — "
                          "the deck is too text-heavy. Add a relevant chart or image and icons "
                          "to KPIs/bullets on most slides.")
