"""Cross-channel synthesis: the comparisons that only exist when two platforms are in one deck.

WHY THIS IS PYTHON AND NOT A PROMPT RULE
----------------------------------------
The whole point of a combined deck is answering "are we paying for clicks we already earn?". That
answer requires intersecting Google Ads search terms with Search Console queries and comparing two
numbers per row. A language model asked to do that from two tables in a prompt will produce a
plausible-looking overlap that is not real — it cannot reliably join on a normalised key across
hundreds of rows, and it has no way to check itself.

Every durable fix in this project has been deterministic and every prompt-level rule eventually
slipped, so the joins, the buckets and the arithmetic all happen here. The brief then states the
result as fact ('"steel patches" — organic pos 2.1, 340 clicks | paid 88 clicks, £412, 3 conv') and
the deck's job is to explain it, not to derive it.

Everything is conditional on WHICH platforms are present — a GA4+Ads deck has no organic queries to
intersect, so it gets reconciliation and blended figures but no overlap table. Every block returns
empty rather than raising when its inputs are missing.
"""
from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

# Organic position at or above which a term counts as "already owned" — paying on top of a rank-3
# listing is the classic wasted spend. Deliberately strict: rank 4+ still loses real clicks to ads.
_DEFEND_MAX_POS = 3.0
# Below this rank organic is effectively invisible, so paid conversions there prove a content gap.
_GAP_MIN_POS = 10.0
# The overlap table is a slide, not a spreadsheet. Ranked by ad spend, so the rows carry the money.
_MAX_OVERLAP_ROWS = 12
# How far GSC clicks and GA4 organic sessions may diverge before it is worth telling the client.
# They measure different things (GSC = Google only, GA4 = all engines minus consent/blocked), so a
# modest gap is normal and only a large one is a finding.
_RECON_TOLERANCE = 0.25

_ADS_MATCH_WRAPPER_RE = re.compile(r'^[\[\"\'+]+|[\]\"\'+]+$')
_WS_RE = re.compile(r"\s+")


def _norm(term: str) -> str:
    """Normalise a query/search term for joining across the two platforms.

    Ads keyword text carries match-type syntax that Search Console never has: `[steel patches]`
    (exact), `"steel patches"` (phrase), `+steel +patches` (broad modified). Without stripping it,
    the join silently finds nothing and the deck quietly loses its most valuable slide.
    """
    t = (term or "").strip().lower()
    t = " ".join(_ADS_MATCH_WRAPPER_RE.sub("", w) for w in t.split())
    return _WS_RE.sub(" ", t).strip()


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _is_branded(term: str, brand_cores: Sequence[str]) -> bool:
    """Branded match, mirroring report_generator._is_brand_query's normalisation."""
    if not brand_cores:
        return False
    qn = re.sub(r"[^a-z0-9]", "", (term or "").lower())
    if not qn:
        return False
    qn2 = qn.replace("and", "")
    for core in brand_cores:
        core2 = core.replace("and", "")
        if core in qn or (core2 and core2 in qn2):
            return True
    return False


def _bucket(pos: Optional[float], cost: float, conversions: float, in_gsc: bool) -> Optional[str]:
    """Classify one overlapping term. Returns None when the row says nothing worth a slide.

    These three buckets ARE the analysis — computing them here is what stops the model inventing
    its own interpretation of the same numbers.
    """
    if not in_gsc or pos is None:
        # Paid is converting on a term organic does not rank for at all — the clearest content gap.
        return "CONTENT GAP" if conversions > 0 else None
    if pos <= _DEFEND_MAX_POS and cost > 0:
        return "DEFEND"
    if pos > _GAP_MIN_POS and conversions > 0:
        return "CONTENT GAP"
    if _DEFEND_MAX_POS < pos <= _GAP_MIN_POS and cost > 0:
        return "DOUBLE COVERAGE"
    return None


def _overlap(gsc_ctx: Optional[Dict], ads_deep: Optional[Dict],
             brand_cores: Sequence[str]) -> List[Dict]:
    """Intersect Ads search terms with GSC queries and bucket each hit."""
    if not gsc_ctx or not ads_deep:
        return []
    terms = ads_deep.get("search_terms") or []
    if not terms:
        return []

    # Index organic by normalised query. `top_queries` is already non-brand filtered, so also index
    # query_insights (the unfiltered movers set) to catch branded overlap — which we want to REPORT,
    # not hide: "you are bidding on your own name" is a real finding, it just needs a caveat.
    organic: Dict[str, Dict] = {}
    for src in (gsc_ctx.get("top_queries") or [], (gsc_ctx.get("query_insights") or {}).get("queries") or []):
        for q in src:
            key = _norm(q.get("query", ""))
            if key and key not in organic:
                organic[key] = q

    rows: List[Dict] = []
    for t in terms:
        key = _norm(t.get("term", ""))
        if not key:
            continue
        o = organic.get(key)
        pos = _f(o.get("position")) if o else None
        cost, conv = _f(t.get("cost")), _f(t.get("conversions"))
        bucket = _bucket(pos, cost, conv, in_gsc=o is not None)
        if not bucket:
            continue
        rows.append({
            "term": t.get("term", ""),
            "bucket": bucket,
            "branded": _is_branded(key, brand_cores),
            "organic_position": round(pos, 1) if pos is not None else None,
            "organic_clicks": int(_f(o.get("clicks"))) if o else 0,
            "organic_impressions": int(_f(o.get("impressions"))) if o else 0,
            "ads_clicks": int(_f(t.get("clicks"))),
            "ads_cost": round(cost, 2),
            "ads_conversions": conv,
        })
    rows.sort(key=lambda r: r["ads_cost"], reverse=True)
    return rows[:_MAX_OVERLAP_ROWS]


def _channel(ga4_ctx: Optional[Dict], *names: str) -> Optional[Dict]:
    """Find a GA4 channel row by name, case-insensitively."""
    if not ga4_ctx:
        return None
    wanted = {n.lower() for n in names}
    for row in ga4_ctx.get("channels") or []:
        if str(row.get("channel", "")).strip().lower() in wanted:
            return row
    return None


def _reconciliation(gsc_ctx, ga4_ctx, ads_ctx) -> List[str]:
    """Compare the same traffic as each platform counts it. Divergence is itself a finding."""
    out: List[str] = []

    organic = _channel(ga4_ctx, "Organic Search")
    if gsc_ctx and organic:
        clicks = _f((gsc_ctx.get("analytics") or {}).get("totals", {}).get("clicks"))
        sessions = _f(organic.get("sessions"))
        if clicks > 0 and sessions > 0:
            ratio = sessions / clicks
            note = ("in normal range" if abs(ratio - 1) <= _RECON_TOLERANCE else
                    "a wide gap — worth explaining to the client, not hiding")
            out.append(
                f"Organic: Search Console counts {int(clicks)} Google clicks; GA4 counts "
                f"{int(sessions)} Organic Search sessions ({ratio:.2f}x, {note}). They measure "
                f"different things — GSC is Google only, GA4 covers all search engines and loses "
                f"consent-blocked sessions — so they are NOT expected to match exactly.")

    paid = _channel(ga4_ctx, "Paid Search", "Cross-network")
    if ads_ctx and paid:
        clicks = _f((ads_ctx.get("totals") or {}).get("clicks"))
        sessions = _f(paid.get("sessions"))
        if clicks > 0 and sessions > 0:
            ratio = sessions / clicks
            if ratio < 0.7:
                out.append(
                    f"Paid: Google Ads reports {int(clicks)} clicks but GA4 records only "
                    f"{int(sessions)} Paid Search sessions ({ratio:.2f}x). A gap this large usually "
                    f"means auto-tagging (gclid) is off or being stripped — paid traffic is landing "
                    f"but being attributed to another channel. This is a REAL, fixable finding.")
            elif ratio <= 1.3:
                out.append(
                    f"Paid: Google Ads reports {int(clicks)} clicks, GA4 records {int(sessions)} "
                    f"Paid Search sessions ({ratio:.2f}x) — tracking looks healthy.")
            else:
                out.append(
                    f"Paid: GA4 records {int(sessions)} Paid Search sessions against "
                    f"{int(clicks)} Google Ads clicks ({ratio:.2f}x). GA4 counting materially MORE "
                    f"paid sessions than Ads reports clicks usually means other paid sources "
                    f"(non-Google, or Cross-network) are folded into this channel. Do not present "
                    f"the two as the same number.")
    return out


def _blended(gsc_ctx, ga4_ctx, ads_ctx) -> Optional[Dict]:
    """Organic and paid side by side: the deck's headline acquisition picture."""
    if not ads_ctx:
        return None
    t = ads_ctx.get("totals") or {}
    paid_clicks = _f(t.get("clicks"))
    cost = _f(t.get("cost"))
    ads_conv = _f(t.get("conversions"))

    organic_clicks = 0.0
    source = None
    if gsc_ctx:
        organic_clicks = _f((gsc_ctx.get("analytics") or {}).get("totals", {}).get("clicks"))
        source = "Search Console clicks"
    else:
        ch = _channel(ga4_ctx, "Organic Search")
        if ch:
            organic_clicks = _f(ch.get("sessions"))
            source = "GA4 Organic Search sessions"
    if organic_clicks <= 0 and paid_clicks <= 0:
        return None

    total = organic_clicks + paid_clicks
    avg_cpc = _f(t.get("avg_cpc")) or (cost / paid_clicks if paid_clicks else 0)
    ga4_conv = _f((ga4_ctx.get("totals") or {}).get("conversions")) if ga4_ctx else 0.0
    return {
        "organic_clicks": int(organic_clicks),
        "organic_source": source,
        "paid_clicks": int(paid_clicks),
        "total_clicks": int(total),
        "organic_share": round(100 * organic_clicks / total, 1) if total else 0,
        "paid_share": round(100 * paid_clicks / total, 1) if total else 0,
        "ads_cost": round(cost, 2),
        "ads_conversions": ads_conv,
        "ga4_conversions": ga4_conv,
        "paid_cpa": round(cost / ads_conv, 2) if ads_conv else None,
        "blended_cpa": round(cost / ga4_conv, 2) if ga4_conv else None,
        # What the organic clicks would have cost at the account's own CPC. Not a real saving — it
        # is the media cost avoided, and the brief labels it that way so nobody books it as revenue.
        "organic_click_value": round(organic_clicks * avg_cpc, 2) if avg_cpc else None,
        "avg_cpc": round(avg_cpc, 2) if avg_cpc else None,
    }


def _flags(overlap: List[Dict], blended: Optional[Dict]) -> List[str]:
    """Headline conclusions, pre-written so the deck cannot soften or invent them."""
    out: List[str] = []
    defend = [r for r in overlap if r["bucket"] == "DEFEND"]
    nonbrand_defend = [r for r in defend if not r["branded"]]
    if nonbrand_defend:
        spend = round(sum(r["ads_cost"] for r in nonbrand_defend), 2)
        out.append(
            f"{len(nonbrand_defend)} non-branded term(s) are being paid for while already ranking in "
            f"the organic top 3 — {spend} of spend. Review whether paid is adding incremental clicks "
            f"here or duplicating a listing already won.")
    brand_defend = [r for r in defend if r["branded"]]
    if brand_defend:
        spend = round(sum(r["ads_cost"] for r in brand_defend), 2)
        out.append(
            f"{len(brand_defend)} BRANDED term(s) account for {spend} of paid spend on terms already "
            f"ranked top 3. Note the caveat: brand bidding often defends against competitors bidding "
            f"on the name, so do NOT recommend cutting it outright without checking the auction.")
    gaps = [r for r in overlap if r["bucket"] == "CONTENT GAP"]
    if gaps:
        conv = round(sum(r["ads_conversions"] for r in gaps), 1)
        out.append(
            f"{len(gaps)} term(s) convert on paid ({conv} conversions) while organic ranks outside "
            f"the top 10 or not at all — paid has already proven the commercial intent, so these are "
            f"the highest-confidence content targets in the deck.")
    if blended and blended.get("paid_share", 0) > 0:
        out.append(
            f"Paid accounts for {blended['paid_share']}% of acquisition clicks and organic "
            f"{blended['organic_share']}%.")
    return out


def compute_cross_channel(gsc_ctx: Optional[Dict], ga4_ctx: Optional[Dict],
                          ads_ctx: Optional[Dict], ads_deep: Optional[Dict] = None,
                          *, brand_cores: Sequence[str] = ()) -> Dict:
    """The full synthesis. Every block degrades to empty when its platforms are absent."""
    try:
        overlap = _overlap(gsc_ctx, ads_deep, brand_cores)
        blended = _blended(gsc_ctx, ga4_ctx, ads_ctx)
        return {
            "overlap": overlap,
            "reconciliation": _reconciliation(gsc_ctx, ga4_ctx, ads_ctx),
            "blended": blended,
            "flags": _flags(overlap, blended),
            "period_mismatch": _period_mismatch(gsc_ctx, ga4_ctx, ads_ctx),
            "currency": (ads_ctx or {}).get("currency") or "",
        }
    except Exception:
        # A synthesis failure must never cost the client their deck — the platform sections still
        # stand on their own.
        logger.exception("cross-channel synthesis failed; continuing without it")
        return {"overlap": [], "reconciliation": [], "blended": None, "flags": [],
                "period_mismatch": None, "currency": ""}


def _period_mismatch(gsc_ctx, ga4_ctx, ads_ctx) -> Optional[str]:
    """Google Ads has its own reporting lag, so its window can differ from GSC/GA4 by a day or more.

    Blending clicks across windows that don't line up produces a number nobody can reconcile later.
    Rather than silently summing, state the mismatch and let the deck carry the caveat.
    """
    labels = {}
    if gsc_ctx:
        labels["Search Console"] = (gsc_ctx.get("period") or {}).get("label") or ""
    if ga4_ctx:
        labels["GA4"] = ga4_ctx.get("period_label") or ""
    if ads_ctx:
        labels["Google Ads"] = ads_ctx.get("period_label") or ""
    distinct = {v for v in labels.values() if v}
    if len(distinct) <= 1:
        return None
    parts = ", ".join(f"{k} {v}" for k, v in labels.items() if v)
    return (f"NOTE — the platforms cover slightly different windows ({parts}) because Google Ads "
            f"reports on its own lag. Blended totals are therefore approximate; say so once and do "
            f"not present them as exact.")
