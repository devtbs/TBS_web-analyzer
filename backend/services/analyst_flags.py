"""Analyst playbook — turn the deck's real period-over-period data into grounded, specific
recommendation "flags" the LLM weaves into slides, instead of leaving it to restate numbers.

Two pieces (see deck_playbook.md, the editable source of truth):
  - load_core_principles(): the CORE PRINCIPLES prose, injected verbatim into every deck prompt.
  - compute_analyst_flags(ctx): the CONDITIONAL RULES (R1–R9) evaluated against the same `ctx`
    that report_generator._gsc_data_brief renders, returning one-line flags that NAME the actual
    query/page/number — so the advice is deterministic and can't be fabricated.

Sign conventions (from gsc_service.get_search_analytics):
  deltas['clicks'|'impressions'] are PERCENT changes; deltas['position'] is (curr − prev) in
  positions, where POSITIVE means the average position got WORSE (lower rank).
Per-query rows (query_insights['queries']) carry raw clicks/impressions/position plus prev_* values.
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional

# ── Tunable thresholds (documented in deck_playbook.md → CONDITIONAL RULES) ──────────────────
R1_CLICKS_UP = 10.0      # % — momentum
R1_IMPR_UP = 10.0        # %
R2_IMPR_UP = 15.0        # % — visibility not converting
R2_CLICKS_FLAT = 3.0     # % (clicks at/below this)
R3_POS_WORSE = 0.5       # positions worse (overall)
R4_IMPR_UP = 20.0        # % — DEFEND (per query)
R4_POS_DROP = 1.0        # positions worse
R4_MIN_IMPR = 100        # ignore tiny-impression noise
R5_CLICKS_UP = 10        # absolute clicks gained — MOMENTUM
R5_POS_GAIN = 1.0        # positions improved
R7_CTR_RATIO = 0.5       # actual CTR below this fraction of expected — QUICK CTR WIN
R9_PAGE_DROP = -25.0     # % clicks — PAGE DECLINE

MAX_ITEM_FLAGS = 8       # cap on per-query/page flags (overall R1–R3 are always kept)


_PLAYBOOK_PATH = Path(__file__).resolve().parent / "deck_playbook.md"
_CORE_CACHE: Optional[str] = None


def load_core_principles() -> str:
    """The CORE PRINCIPLES section of deck_playbook.md (cached). Empty string if unavailable."""
    global _CORE_CACHE
    if _CORE_CACHE is None:
        try:
            text = _PLAYBOOK_PATH.read_text(encoding="utf-8")
            after = text.split("## CORE PRINCIPLES", 1)[1]
            core = after.split("## CONDITIONAL", 1)[0]
            _CORE_CACHE = core.strip()
        except Exception:
            _CORE_CACHE = ""
    return _CORE_CACHE


def _num(v) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _pct(curr, prev) -> Optional[float]:
    c, p = _num(curr), _num(prev)
    if c is None or not p:
        return None
    return round((c - p) / abs(p) * 100, 1)


def _pos(v) -> str:
    n = _num(v)
    return f"{n:.1f}" if n is not None else "?"


def compute_analyst_flags(ctx: Dict) -> List[str]:
    """Grounded recommendation flags (R1–R9) for THIS site's data. Overall flags first, then the
    strongest ~8 per-query/page flags by impact. Returns [] when nothing meaningful triggers."""
    flags: List[str] = []
    a = ctx.get("analytics") or {}
    d = a.get("deltas") or {}
    dc, di, dp = _num(d.get("clicks")), _num(d.get("impressions")), _num(d.get("position"))

    # ── Overall (R1–R3) ──
    if dc is not None and di is not None and dc >= R1_CLICKS_UP and di >= R1_IMPR_UP:
        flags.append(f"MOMENTUM — clicks {dc:+.0f}% on impressions {di:+.0f}%: healthy demand and "
                     "capture; scale the winning content/topics.")
    if di is not None and dc is not None and di >= R2_IMPR_UP and dc <= R2_CLICKS_FLAT:
        flags.append(f"VISIBILITY NOT CONVERTING — impressions {di:+.0f}% but clicks only {dc:+.0f}%: "
                     "rising visibility isn't turning into clicks — a CTR / title-tag opportunity.")
    if dp is not None and dp >= R3_POS_WORSE:
        flags.append(f"RANKING SOFTENED — average position slipped {dp:+.1f}: prioritise on-page "
                     "refreshes and internal links to the affected pages.")

    # ── Per-query movers (R4 DEFEND > R6 AT RISK > R5 MOMENTUM; one flag per query) ──
    scored: List[tuple] = []  # (impact, text)
    for q in (ctx.get("query_insights") or {}).get("queries") or []:
        name = q.get("query", "")
        if not name:
            continue
        impr = _num(q.get("impressions")) or 0
        prev_pos = _num(q.get("prev_position")) or 0
        pos = _num(q.get("position")) or 0
        pos_drop = round(pos - prev_pos, 1) if prev_pos else 0
        impr_pct = _pct(q.get("impressions"), q.get("prev_impressions"))
        clk_delta = int((_num(q.get("clicks")) or 0) - (_num(q.get("prev_clicks")) or 0))

        if impr_pct is not None and impr_pct >= R4_IMPR_UP and pos_drop >= R4_POS_DROP and impr >= R4_MIN_IMPR:
            scored.append((impr, f"DEFEND \"{name}\": demand rising ({impr_pct:+.0f}% impressions) but "
                                 f"rank slipping ({_pos(prev_pos)}→{_pos(pos)}) — refresh this page to hold position."))
        elif prev_pos and prev_pos <= 3 and pos > 3:
            scored.append((impr, f"AT RISK \"{name}\": a top-3 term slipped to pos {_pos(pos)} "
                                 f"(from {_pos(prev_pos)}) — defend priority."))
        elif clk_delta >= R5_CLICKS_UP and prev_pos and (prev_pos - pos) >= R5_POS_GAIN:
            scored.append((clk_delta, f"MOMENTUM \"{name}\": {_pos(prev_pos)}→{_pos(pos)}, +{clk_delta} clicks "
                                      "— double down on this query."))

    # ── R7 CTR quick wins (rank by missed clicks) ──
    ctr_opps = []
    for o in ctx.get("ctr_opportunities") or []:
        act, exp = _num(o.get("actual_ctr")), _num(o.get("expected_ctr"))
        if act is not None and exp and act < R7_CTR_RATIO * exp:
            missed = _num(o.get("missed_clicks")) or 0
            ctr_opps.append((missed, f"QUICK CTR WIN \"{o.get('query','')}\": pos {_pos(o.get('position'))}, "
                                     f"{act:.1f}% CTR vs {exp:.1f}% expected (~{missed:.0f} missed clicks) "
                                     "— rewrite the title/meta."))
    scored.extend(ctr_opps)

    # ── R8 near page 1 (striking distance; top by potential extra clicks) ──
    for s in (ctx.get("striking_distance") or [])[:5]:
        pot = _num(s.get("potential_clicks")) or 0
        if pot > 0:
            scored.append((pot, f"NEAR PAGE 1 \"{s.get('query','')}\": pos {_pos(s.get('position'))}, "
                                f"~{pot:.0f} extra clicks if pushed to the top 3."))

    # ── R9 page decline ──
    for p in ctx.get("top_pages") or []:
        cd = _num(p.get("clicks_delta"))
        if cd is not None and cd <= R9_PAGE_DROP:
            scored.append((abs(cd), f"PAGE DECLINE {p.get('url','')}: clicks {cd:+.0f}% vs previous "
                                    "— investigate and refresh this landing page."))

    # Strongest item flags by impact, capped.
    scored.sort(key=lambda x: x[0], reverse=True)
    flags.extend(text for _, text in scored[:MAX_ITEM_FLAGS])
    return flags
