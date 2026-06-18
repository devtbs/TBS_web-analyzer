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

    res.ok = not (res.structural or res.plotly or res.ungrounded_numbers)
    return res
