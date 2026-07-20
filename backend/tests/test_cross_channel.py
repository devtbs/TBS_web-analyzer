"""Cross-channel synthesis tests — pure functions over fixtures, no network.

These guard the numbers a client sees on the paid-vs-organic slides. The join is the fragile part:
if normalisation breaks, the overlap silently becomes empty and the deck quietly loses its most
valuable slide rather than failing loudly.
"""
import pytest

from services.cross_channel import _norm, compute_cross_channel


GSC = {
    "top_queries": [
        {"query": "steel patches", "clicks": 340, "impressions": 9000, "position": 2.1},
        {"query": "patch supplier uk", "clicks": 40, "impressions": 3000, "position": 6.4},
        {"query": "cheap iron on badges", "clicks": 2, "impressions": 500, "position": 24.0},
    ],
    "query_insights": {"queries": [
        {"query": "acme patches", "clicks": 500, "impressions": 6000, "position": 1.1}]},
    "analytics": {"totals": {"clicks": 890, "impressions": 81100, "ctr": 1.1, "position": 12.0}},
    "period": {"label": "16 Jun - 14 Jul 2026"},
}
ADS = {"totals": {"clicks": 500, "cost": 1200.0, "conversions": 25.0, "avg_cpc": 2.4},
       "currency": "GBP", "period_label": "17 Jun - 15 Jul 2026"}
GA4 = {"totals": {"sessions": 5000, "conversions": 40},
       "channels": [{"channel": "Organic Search", "sessions": 950, "conversions": 20},
                    {"channel": "Paid Search", "sessions": 180, "conversions": 12}],
       "period_label": "16 Jun - 14 Jul 2026"}
DEEP = {"search_terms": [
    {"term": "[steel patches]", "clicks": 88, "cost": 412.0, "conversions": 3},
    {"term": "acme patches", "clicks": 60, "cost": 150.0, "conversions": 9},
    {"term": "cheap iron on badges", "clicks": 30, "cost": 210.0, "conversions": 4},
    {"term": "embroidered logo tape", "clicks": 25, "cost": 180.0, "conversions": 2},
    {"term": "patch supplier uk", "clicks": 20, "cost": 90.0, "conversions": 1},
    {"term": "browsing only", "clicks": 5, "cost": 0.0, "conversions": 0},
]}


def _result():
    return compute_cross_channel(GSC, GA4, ADS, DEEP, brand_cores=["acme"])


@pytest.mark.parametrize("raw", [
    "[steel patches]",      # Ads exact match
    '"Steel Patches"',      # Ads phrase match
    "+steel +patches",      # Ads broad match modified
    "steel  patches ",      # stray whitespace
    "STEEL PATCHES",        # case
])
def test_ads_match_syntax_normalises_to_the_gsc_query(raw):
    """Without this, the join finds nothing and the overlap slide silently disappears."""
    assert _norm(raw) == "steel patches"


def test_buckets_classify_each_overlap_case():
    got = {r["term"]: r["bucket"] for r in _result()["overlap"]}
    assert got["[steel patches]"] == "DEFEND"              # organic 2.1 + paid spend
    assert got["cheap iron on badges"] == "CONTENT GAP"    # converts on paid, organic pos 24
    assert got["embroidered logo tape"] == "CONTENT GAP"   # converts on paid, absent from organic
    assert got["patch supplier uk"] == "DOUBLE COVERAGE"   # organic 6.4 + paid spend


def test_terms_with_no_spend_and_no_conversions_are_dropped():
    assert "browsing only" not in {r["term"] for r in _result()["overlap"]}


def test_overlap_is_ranked_by_spend():
    costs = [r["ads_cost"] for r in _result()["overlap"]]
    assert costs == sorted(costs, reverse=True)


def test_branded_overlap_is_tagged_not_dropped():
    """'Stop bidding on your own brand' is naive advice — the row must survive, with a caveat."""
    branded = [r for r in _result()["overlap"] if r["branded"]]
    assert [r["term"] for r in branded] == ["acme patches"]
    assert any("do NOT recommend cutting it outright" in f for f in _result()["flags"])


def test_large_paid_tracking_gap_is_flagged_as_autotagging():
    """500 Ads clicks vs 180 GA4 paid sessions is a real, fixable finding."""
    assert any("auto-tagging" in line for line in _result()["reconciliation"])


def test_blended_shares_and_cpa():
    b = _result()["blended"]
    assert b["organic_share"] + b["paid_share"] == 100.0
    assert b["paid_cpa"] == 48.0        # 1200 cost / 25 ads conversions
    assert b["blended_cpa"] == 30.0     # 1200 cost / 40 GA4 conversions


def test_mismatched_reporting_windows_are_declared():
    """Ads reports on its own lag; blending across windows without saying so is dishonest."""
    assert "different windows" in (_result()["period_mismatch"] or "")


@pytest.mark.parametrize("gsc,ga4,ads,deep", [
    (None, GA4, ADS, None),     # GA4 + Ads
    (GSC, None, None, None),    # GSC alone
    (GSC, None, ADS, None),     # GSC + Ads, deep-dive failed
    (None, None, None, None),   # nothing
])
def test_missing_platforms_degrade_instead_of_raising(gsc, ga4, ads, deep):
    r = compute_cross_channel(gsc, ga4, ads, deep)
    assert isinstance(r["overlap"], list) and isinstance(r["flags"], list)


def test_organic_falls_back_to_ga4_sessions_without_gsc():
    """A GA4+Ads deck has no Search Console clicks, so organic volume comes from GA4."""
    b = compute_cross_channel(None, GA4, ADS, None)["blended"]
    assert b["organic_source"] == "GA4 Organic Search sessions"
    assert b["organic_clicks"] == 950
