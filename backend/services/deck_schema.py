"""The slide contract: what the model may say, and how much of it fits.

This is the load-bearing idea of the rendered pipeline. The model emits CONTENT ONLY against a
fixed template menu — it never writes HTML, CSS or a chart spec. Each template declares its
CAPACITY here, and anything over capacity is truncated before it ever reaches a renderer.

That is what makes overflow structurally impossible rather than patched. The old pipeline let the
model write however much it liked and then fought the consequences downstream: clipped tables,
sliced titles, a donut spilling past the canvas, a takeaway band printed over a chart, and a
scale-to-fit script that turned out to be inert because the CSS squeezed content instead of
overflowing. None of that can happen if the content is known to fit before rendering starts.

The caps are derived from the 1920x1080 geometry (see deck_templates.DECK_CSS) with slack, and are
verified by rendering deliberately over-capacity fixtures in a browser — not guessed.
"""
from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Chart kinds the model may name. Mirrors deck_charts.CHART_KINDS; imported lazily to keep this
# module dependency-free for testing.
_VALID_CHART_KINDS = (
    "monthly_trend", "daily_trend", "rank_distribution",
    "keyword_bubble", "device_split", "country_bars",
)

CALLOUT_KINDS = ("see", "opportunity", "recommendation")

# ── capacity ──────────────────────────────────────────────────────────────────────────────────
# Every number here is a fitting constraint, not a style preference. `chars` limits are measured
# against the type scale in DECK_CSS at 1920x1080.
TEMPLATES: Dict[str, Dict] = {
    "cover": {
        "caps": {"title": 60, "subtitle": 90, "meta": 80, "stats": 2, "stat_label": 24},
        "wants_image": True,
    },
    "cards": {
        # 3-4 across in one row, or 6-8 as two rows. Below 3 a grid looks broken; above 8 the
        # cards get too small to read at 1080p.
        "caps": {"title": 68, "subtitle": 110, "cards": 8, "cards_min": 3,
                 "card_title": 38, "card_body": 132, "callouts": 3, "takeaway": 190},
    },
    "dark_split": {
        # Navy statement panel left, cards right. The panel headline must stay short or it wraps
        # past the panel; the right grid holds 2x2 or 2x3.
        "caps": {"title": 52, "subtitle": 90, "cards": 6, "cards_min": 2,
                 "card_title": 32, "card_body": 120, "takeaway": 190},
    },
    "table": {
        # 10 rows x 5 cols is the most that fits above the takeaway band with readable type.
        "caps": {"title": 68, "subtitle": 110, "rows": 10, "cols": 5,
                 "cell": 46, "header": 18, "callouts": 3, "takeaway": 190},
    },
    "kpi_chart": {
        # A KPI strip over one chart. 5 tiles max before the numbers shrink.
        "caps": {"title": 68, "subtitle": 110, "kpis": 5, "kpi_label": 20,
                 "kpi_note": 28, "takeaway": 190},
    },
    "movers": {
        # Two facing lists: risers / fallers.
        "caps": {"title": 68, "subtitle": 110, "rows": 7, "row_label": 44,
                 "side_title": 28, "takeaway": 190},
    },
    "roadmap": {
        "caps": {"title": 68, "subtitle": 110, "phases": 3, "phase_title": 26,
                 "phase_meta": 26, "bullets": 4, "bullet": 120, "outcome": 90,
                 "takeaway": 190},
    },
    "quote": {
        "caps": {"title": 150, "subtitle": 120, "takeaway": 190},
    },
    "closing": {
        "caps": {"title": 70, "subtitle": 130, "stats": 3, "stat_label": 22},
        "wants_image": True,
    },
}
TEMPLATE_NAMES = tuple(TEMPLATES)
_CONTENT_TEMPLATES = tuple(t for t in TEMPLATES if t not in ("cover", "closing"))

_WS_RE = re.compile(r"\s+")


def _text(v, limit: int) -> str:
    """One line of plain text, collapsed and hard-limited. Truncation is the mechanism that makes
    the fit guarantee real, so it happens here rather than being hoped for in a prompt."""
    s = _WS_RE.sub(" ", str(v if v is not None else "")).strip()
    if len(s) <= limit:
        return s
    cut = s[:limit].rsplit(" ", 1)[0]         # don't slice a word in half
    return (cut or s[:limit]).rstrip(" ,;:.-") + "…"


def _clamp_list(v, cap: int) -> List:
    return list(v)[:cap] if isinstance(v, (list, tuple)) else []


def _norm_callouts(v, cap: int) -> List[Dict]:
    out = []
    for c in _clamp_list(v, cap):
        if not isinstance(c, dict):
            continue
        kind = str(c.get("kind", "")).strip().lower()
        if kind not in CALLOUT_KINDS:
            kind = "see"
        text = _text(c.get("text"), 130)
        if text:
            out.append({"kind": kind, "text": text})
    return out


def _body_cap(s: Dict, full: int, *, one_row: int) -> int:
    """How much the BODY can hold, given what else is on the slide.

    Capacity is not a constant, and this is where the first version got it wrong. Measured in a
    browser at 1920x1080: the body box is ~510px with a takeaway, and ~317px with a takeaway AND
    a callout row — while one row of cards is ~250px and a table row ~50px. So a flat "8 cards"
    cap overlapped the bands by 95px, and "10 table rows" by 72px. Every band on the slide takes
    its space out of the body, so the cap has to know about them.
    """
    if s.get("callouts"):
        return min(full, one_row)        # tightest: callouts + (usually) a takeaway too
    if s.get("takeaway"):
        return min(full, one_row)        # a takeaway alone still costs ~1 row of body
    return full                          # bare slide: the body gets everything


def _norm_chart(v) -> Optional[Dict]:
    """The model may only NAME a chart kind. It never supplies data or a spec — deck_charts builds
    both from the real context. An unknown name is dropped rather than guessed at."""
    if not isinstance(v, dict):
        return None
    kind = str(v.get("kind", "")).strip()
    if kind not in _VALID_CHART_KINDS:
        if kind:
            logger.warning("Slide named unknown chart kind %r — dropping it.", kind)
        return None
    return {"kind": kind, "caption": _text(v.get("caption"), 90)}


def normalize_slide(raw: Dict, *, n: int, total: int) -> Optional[Dict]:
    """Validate + coerce + TRUNCATE one slide. Returns None if it can't be salvaged.

    Never raises on bad model output: a malformed slide is dropped, and the deck ships without it.
    """
    if not isinstance(raw, dict):
        return None
    tpl = str(raw.get("template", "")).strip().lower()
    if tpl not in TEMPLATES:
        # An unknown template is a content slide the model mislabelled; `cards` carries almost
        # anything, so fall back rather than lose the slide.
        logger.warning("Slide %s named unknown template %r — falling back to 'cards'.", n, tpl)
        tpl = "cards"
    caps = TEMPLATES[tpl]["caps"]
    content = raw.get("content") if isinstance(raw.get("content"), dict) else {}

    s: Dict = {
        "n": n,
        "total": total,
        "template": tpl,
        "section": _text(raw.get("section"), 34).upper(),
        "title": _text(raw.get("title"), caps["title"]),
        "subtitle": _text(raw.get("subtitle"), caps.get("subtitle", 0)) if caps.get("subtitle") else "",
        "takeaway": _text(raw.get("takeaway"), caps["takeaway"]) if caps.get("takeaway") else "",
        "chart": _norm_chart(raw.get("chart")),
        "callouts": _norm_callouts(raw.get("callouts"), caps.get("callouts", 0)),
        "content": {},
    }
    if not s["title"]:
        return None

    c = s["content"]
    if tpl in ("cards", "dark_split"):
        cards = []
        for item in _clamp_list(content.get("cards"), _body_cap(s, caps["cards"], one_row=4)):
            if not isinstance(item, dict):
                continue
            t = _text(item.get("title"), caps["card_title"])
            b = _text(item.get("body"), caps["card_body"])
            if t or b:
                cards.append({"title": t, "body": b})
        if len(cards) < caps.get("cards_min", 1):
            return None          # a card grid with 1 card is a broken-looking slide
        c["cards"] = cards
        if tpl == "dark_split":
            c["panel_note"] = _text(content.get("panel_note"), 110)

    elif tpl == "table":
        cols = [_text(h, caps["header"]) for h in _clamp_list(content.get("columns"), caps["cols"])]
        rows = []
        for r in _clamp_list(content.get("rows"), _body_cap(s, caps["rows"], one_row=8)):
            if not isinstance(r, (list, tuple)):
                continue
            rows.append([_text(cell, caps["cell"]) for cell in list(r)[:len(cols) or caps["cols"]]])
        if not cols or not rows:
            return None
        c["columns"], c["rows"] = cols, rows

    elif tpl == "kpi_chart":
        kpis = []
        for k in _clamp_list(content.get("kpis"), caps["kpis"]):
            if not isinstance(k, dict):
                continue
            kpis.append({
                "label": _text(k.get("label"), caps["kpi_label"]),
                "value": _text(k.get("value"), 12),
                "note": _text(k.get("note"), caps["kpi_note"]),
                # semantic colour is the model's call but constrained to the three meanings
                "tone": (str(k.get("tone", "")).lower()
                         if str(k.get("tone", "")).lower() in ("good", "bad", "warn") else ""),
            })
        c["kpis"] = [k for k in kpis if k["value"]]
        if not c["kpis"] and not s["chart"]:
            return None

    elif tpl == "movers":
        def side(key, default_title):
            d = content.get(key) if isinstance(content.get(key), dict) else {}
            rows = []
            for r in _clamp_list(d.get("rows"), caps["rows"]):
                if not isinstance(r, dict):
                    continue
                label = _text(r.get("label"), caps["row_label"])
                if label:
                    rows.append({"label": label, "delta": _text(r.get("delta"), 18)})
            return {"title": _text(d.get("title"), caps["side_title"]) or default_title, "rows": rows}
        c["rising"] = side("rising", "Rising")
        c["falling"] = side("falling", "Declining")
        if not c["rising"]["rows"] and not c["falling"]["rows"]:
            return None

    elif tpl == "roadmap":
        phases = []
        for p in _clamp_list(content.get("phases"), caps["phases"]):
            if not isinstance(p, dict):
                continue
            phases.append({
                "title": _text(p.get("title"), caps["phase_title"]),
                "meta": _text(p.get("meta"), caps["phase_meta"]),
                "bullets": [_text(b, caps["bullet"])
                            for b in _clamp_list(p.get("bullets"), caps["bullets"]) if _text(b, 1)],
                "outcome": _text(p.get("outcome"), caps["outcome"]),
            })
        c["phases"] = [p for p in phases if p["title"]]
        if not c["phases"]:
            return None

    elif tpl in ("cover", "closing"):
        stats = []
        for st in _clamp_list(content.get("stats"), caps["stats"]):
            if not isinstance(st, dict):
                continue
            v = _text(st.get("value"), 12)
            if v:
                stats.append({"value": v, "label": _text(st.get("label"), caps["stat_label"])})
        c["stats"] = stats
        c["meta"] = _text(content.get("meta"), caps.get("meta", 80))
        c["client"] = _text(content.get("client"), 42)
        c["descriptor"] = _text(content.get("descriptor"), 60)
        c["image_prompt"] = _text(content.get("image_prompt"), 160)

    # quote needs nothing beyond title/subtitle
    return s


def normalize_plan(raw: object) -> List[Dict]:
    """Validate a whole plan. Guarantees: slide 1 is a cover, the last is a closing, everything
    between is a content template, and every slide fits its template's capacity."""
    items = raw if isinstance(raw, list) else (raw or {}).get("slides") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        logger.warning("Plan is not a list of slides — nothing to render.")
        return []

    out: List[Dict] = []
    total = len(items)
    for i, item in enumerate(items, 1):
        s = normalize_slide(item, n=i, total=total)
        if s is None:
            logger.warning("Dropping unsalvageable slide %s.", i)
            continue
        out.append(s)

    if not out:
        return []
    # Force the poster bookends: the deck opens and closes on an image.
    if out[0]["template"] != "cover":
        out[0]["template"] = "cover"
    for s in out[1:-1]:
        if s["template"] in ("cover", "closing"):
            s["template"] = "cards"
    if len(out) > 1 and out[-1]["template"] != "closing":
        out[-1]["template"] = "closing"
    for i, s in enumerate(out, 1):
        s["n"], s["total"] = i, len(out)
    return out
