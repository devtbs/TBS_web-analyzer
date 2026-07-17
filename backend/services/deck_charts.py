"""Deterministic Plotly specs, built in Python FROM THE DATA.

Why this module exists
----------------------
Every chart defect we have shipped came from asking a language model to write Plotly JSON:

  * clicks (tens) and impressions (tens of thousands) plotted on ONE axis, so the clicks bars
    flatten into an invisible line along the baseline and the slide says nothing;
  * a "position vs impressions" bubble chart that rendered as a single giant blue bar;
  * duplicate x-axes, and axis titles that described only one of two series;
  * a 3-bar "clicks by query" chart carrying no information at all.

Two prompt rules failed to fix any of them, because the model cannot see what it draws. The axis
strategy is a pure function of the numbers, so it belongs in code. The model's ONLY say over a
chart is naming its `kind` from CHART_KINDS; everything else — series, axes, units, colours,
annotations — is derived here from the real context data.

Contract: every builder takes (ctx, palette) and returns a Plotly figure dict, or None when the
data cannot support an honest chart (too few points, all zeros). None means "no chart" — the
caller drops the chart, it never renders an empty box.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# A series is only safe to share an axis with another when their magnitudes are within this
# factor. Beyond it the smaller series is visually annihilated, which is the exact bug.
_SAME_AXIS_MAX_RATIO = 10.0

# Below this many points a "trend" is not a trend — the caller should use a table or cards.
_MIN_TREND_POINTS = 4
_MIN_BUBBLE_POINTS = 5


def _nums(rows: List[Dict], key: str) -> List[float]:
    out = []
    for r in rows or []:
        v = r.get(key)
        out.append(float(v) if isinstance(v, (int, float)) else 0.0)
    return out


def _typical(vals: List[float]) -> float:
    """A magnitude summary that ignores zeros and isn't hostage to one spike (unlike max())."""
    nz = sorted(v for v in vals if v > 0)
    if not nz:
        return 0.0
    return nz[len(nz) // 2]          # median of the non-zero values


def needs_secondary_axis(a: List[float], b: List[float]) -> bool:
    """True when two series must NOT share one axis. This single check is what the two prompt
    rules kept failing to enforce: clicks ~12 against impressions ~1,369 is a 100x+ ratio."""
    ta, tb = _typical(a), _typical(b)
    if ta <= 0 or tb <= 0:
        return False                  # one series is empty; sharing is moot
    hi, lo = max(ta, tb), min(ta, tb)
    return (hi / lo) > _SAME_AXIS_MAX_RATIO


def _base_layout(palette: Dict, *, ytitle: str = "", xtitle: str = "") -> Dict:
    """Transparent, chrome-light layout. The slide supplies the background and the title."""
    grid = "#E3E8EF"
    muted = palette.get("muted", "#6B7A90")
    return {
        "paper_bgcolor": "rgba(0,0,0,0)",
        "plot_bgcolor": "rgba(0,0,0,0)",
        "margin": {"l": 72, "r": 72, "t": 16, "b": 56},
        "showlegend": True,
        "legend": {"orientation": "h", "y": 1.08, "x": 0, "font": {"size": 15, "color": muted}},
        "font": {"size": 15, "color": muted},
        "xaxis": {"title": {"text": xtitle, "font": {"size": 15, "color": muted}},
                  "gridcolor": grid, "zeroline": False, "automargin": True},
        "yaxis": {"title": {"text": ytitle, "font": {"size": 15, "color": muted}},
                  "gridcolor": grid, "zeroline": False, "automargin": True},
    }


# ── builders ──────────────────────────────────────────────────────────────────────────────────

def monthly_trend(ctx: Dict, palette: Dict) -> Optional[Dict]:
    """12-month clicks + impressions + average position.

    The deck's one genuinely earned chart. Clicks and impressions differ by orders of magnitude
    and position runs on an inverted scale, so this needs real axis work — exactly what the model
    kept getting wrong.
    """
    rows = ctx.get("monthly_trend") or []
    if len(rows) < _MIN_TREND_POINTS:
        return None
    months = [r.get("month", "") for r in rows]
    clicks, impr = _nums(rows, "clicks"), _nums(rows, "impressions")
    pos = _nums(rows, "position")
    if not any(clicks) and not any(impr):
        return None

    data = []
    split = needs_secondary_axis(clicks, impr)
    data.append({"type": "bar", "name": "Impressions", "x": months, "y": impr,
                 "marker": {"color": palette.get("accent2", "#79B84B")},
                 "yaxis": "y"})
    if split:
        # Clicks need their own axis, and on a SEPARATE axis a second bar trace cannot be grouped
        # — Plotly overlays it at the same x, so the two bars stack on each other and read as one
        # (verified visually; the numeric "is it visible" check happily passed while the picture
        # was wrong). A line is the correct partner for bars in a split-scale combo chart.
        data.append({"type": "scatter", "mode": "lines+markers", "name": "Clicks", "x": months,
                     "y": clicks, "yaxis": "y2",
                     "line": {"color": palette.get("accent", "#3C8DD9"), "width": 3},
                     "marker": {"size": 7}})
    else:
        # Comparable magnitudes: real grouped bars, side by side.
        data.append({"type": "bar", "name": "Clicks", "x": months, "y": clicks,
                     "marker": {"color": palette.get("accent", "#3C8DD9")}, "yaxis": "y"})

    layout = _base_layout(palette, ytitle="impressions" if split else "clicks / impressions")
    layout["barmode"] = "group"
    if split:
        layout["yaxis2"] = {"title": {"text": "clicks", "font": {"size": 15}},
                            "overlaying": "y", "side": "right", "showgrid": False,
                            "zeroline": False, "automargin": True, "rangemode": "tozero"}
    # Average position only when it exists; always inverted (lower is better) and on its own axis.
    if any(p > 0 for p in pos):
        axis = "y3" if split else "y2"
        data.append({"type": "scatter", "mode": "lines+markers", "name": "Avg position",
                     "x": months, "y": pos, "yaxis": axis,
                     "line": {"color": palette.get("ink", "#0F1B2D"), "width": 2},
                     "marker": {"size": 6}})
        layout[axis.replace("y", "yaxis")] = {
            "title": {"text": "avg position (lower is better)", "font": {"size": 15}},
            "overlaying": "y", "side": "right", "autorange": "reversed",
            "showgrid": False, "zeroline": False, "automargin": True,
            "position": 1.0 if not split else 0.94,
        }
        if split:
            layout["xaxis"]["domain"] = [0.0, 0.90]
    return {"data": data, "layout": layout}


def daily_trend(ctx: Dict, palette: Dict) -> Optional[Dict]:
    """Daily impressions with clicks on a secondary axis when the magnitudes demand it."""
    rows = ctx.get("trend") or []
    if len(rows) < _MIN_TREND_POINTS:
        return None
    x = [r.get("date") or r.get("day") or "" for r in rows]
    clicks, impr = _nums(rows, "clicks"), _nums(rows, "impressions")
    if not any(impr) and not any(clicks):
        return None
    split = needs_secondary_axis(clicks, impr)
    data = [{"type": "scatter", "mode": "lines", "name": "Impressions", "x": x, "y": impr,
             "line": {"color": palette.get("accent", "#3C8DD9"), "width": 2}, "yaxis": "y"}]
    if any(clicks):
        data.append({"type": "bar", "name": "Clicks", "x": x, "y": clicks,
                     "marker": {"color": palette.get("accent2", "#79B84B")},
                     "yaxis": "y2" if split else "y"})
    layout = _base_layout(palette, ytitle="impressions" if split else "clicks / impressions")
    if split:
        layout["yaxis2"] = {"title": {"text": "clicks", "font": {"size": 15}},
                            "overlaying": "y", "side": "right", "showgrid": False,
                            "zeroline": False, "automargin": True}
    return {"data": data, "layout": layout}


def rank_distribution(ctx: Dict, palette: Dict) -> Optional[Dict]:
    """Non-branded keywords by SERP position tier, as a donut."""
    km = ctx.get("keyword_mix") or {}
    vals = [km.get("top3", 0) or 0, km.get("mid", 0) or 0, km.get("low", 0) or 0]
    if sum(vals) <= 0:
        return None
    return {
        "data": [{
            "type": "pie", "hole": 0.58,
            "labels": ["Positions 1-3", "Positions 4-10", "Positions 11+"],
            "values": vals,
            "marker": {"colors": [palette.get("accent", "#3C8DD9"),
                                  palette.get("accent2", "#79B84B"),
                                  palette.get("muted", "#6B7A90")]},
            "textinfo": "label+percent", "textposition": "outside",
            "sort": False, "direction": "clockwise",
        }],
        "layout": {**_base_layout(palette), "showlegend": False,
                   "margin": {"l": 24, "r": 24, "t": 24, "b": 24}},
    }


def keyword_bubble(ctx: Dict, palette: Dict) -> Optional[Dict]:
    """Average position (x, reversed — better to the right) vs impressions (y), size by impressions.

    Explicitly a scatter with sized markers. The model once emitted this shape as a bar chart.
    """
    rows = (ctx.get("bubble_queries") or [])[:30]
    rows = [r for r in rows if (r.get("position") or 0) > 0 and (r.get("impressions") or 0) > 0]
    if len(rows) < _MIN_BUBBLE_POINTS:
        return None
    x = _nums(rows, "position")
    y = _nums(rows, "impressions")
    top = sorted(rows, key=lambda r: r.get("impressions", 0), reverse=True)[:6]
    top_q = {r.get("query") for r in top}
    # Label only the biggest few — labelling all 30 is what produced the overlapping mush.
    text = [(r.get("query") or "") if r.get("query") in top_q else "" for r in rows]
    smax = max(y) or 1
    return {
        "data": [{
            "type": "scatter", "mode": "markers+text", "x": x, "y": y,
            "text": text, "textposition": "middle right",
            "textfont": {"size": 13, "color": palette.get("muted", "#6B7A90")},
            "hovertext": [r.get("query", "") for r in rows], "name": "",
            "marker": {"size": y, "sizemode": "area", "sizeref": 2.0 * smax / (46.0 ** 2),
                       "sizemin": 6, "color": palette.get("accent", "#3C8DD9"), "opacity": 0.75,
                       "line": {"width": 0}},
        }],
        "layout": {**_base_layout(palette, xtitle="avg position (better →)", ytitle="impressions"),
                   "showlegend": False,
                   "xaxis": {**_base_layout(palette)["xaxis"], "autorange": "reversed",
                             "title": {"text": "avg position (better →)", "font": {"size": 15}}}},
    }


def device_split(ctx: Dict, palette: Dict) -> Optional[Dict]:
    """Clicks by device — horizontal bars."""
    rows = [r for r in (ctx.get("devices") or []) if (r.get("clicks") or 0) > 0]
    if len(rows) < 2:
        return None
    rows = sorted(rows, key=lambda r: r.get("clicks", 0))
    return {
        "data": [{"type": "bar", "orientation": "h",
                  "x": _nums(rows, "clicks"), "y": [r.get("name", "") for r in rows],
                  "marker": {"color": palette.get("accent", "#3C8DD9")}, "name": "Clicks"}],
        "layout": {**_base_layout(palette, xtitle="clicks"), "showlegend": False},
    }


def country_bars(ctx: Dict, palette: Dict) -> Optional[Dict]:
    """Clicks by country — horizontal bars, biggest at the top."""
    rows = [r for r in (ctx.get("top_countries") or []) if (r.get("clicks") or 0) > 0][:8]
    if len(rows) < 2:
        return None
    rows = sorted(rows, key=lambda r: r.get("clicks", 0))
    return {
        "data": [{"type": "bar", "orientation": "h",
                  "x": _nums(rows, "clicks"), "y": [r.get("name", "") for r in rows],
                  "marker": {"color": palette.get("accent", "#3C8DD9")}, "name": "Clicks"}],
        "layout": {**_base_layout(palette, xtitle="clicks"), "showlegend": False},
    }


# The model may ONLY choose a kind from this menu — it never writes a spec.
CHART_BUILDERS = {
    "monthly_trend": monthly_trend,
    "daily_trend": daily_trend,
    "rank_distribution": rank_distribution,
    "keyword_bubble": keyword_bubble,
    "device_split": device_split,
    "country_bars": country_bars,
}
CHART_KINDS = tuple(CHART_BUILDERS)


def build_chart(kind: str, ctx: Dict, palette: Dict) -> Optional[Dict]:
    """Return the Plotly spec for `kind`, or None when the data can't support it honestly."""
    fn = CHART_BUILDERS.get((kind or "").strip())
    if not fn:
        if kind:
            logger.warning("Unknown chart kind %r — dropping the chart.", kind)
        return None
    try:
        return fn(ctx, palette)
    except Exception as e:
        logger.warning("Chart %r failed to build (non-fatal, dropping): %s", kind, e)
        return None
