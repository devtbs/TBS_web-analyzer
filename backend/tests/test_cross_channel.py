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


# ─────────────────────────────────────────────────────────────────────────────────────────────
# E-COMMERCE: revenue outranks conversion count.
# A shop can take fewer, larger orders — conversions fall while the business has its best month.
# A deck that ranks by conversion count calls that a decline and tells the client a good month
# was bad. These guard against that.
# ─────────────────────────────────────────────────────────────────────────────────────────────

ADS_ECOM = {
    "currency": "GBP", "period_label": "P",
    "totals": {"clicks": 500, "cost": 1200.0, "conversions": 22.0, "avg_cpc": 2.4,
               "conversions_value": 9600.0, "roas": 8.0},
    "deltas": {"conversions": -12.0, "conversions_value": 34.0},
}
DEEP_ECOM = {"search_terms": [
    # ranks #1 organically AND returns 12x on paid — incremental revenue, not waste
    {"term": "[steel patches]", "clicks": 88, "cost": 412.0, "conversions": 3,
     "conversions_value": 4944.0},
    # ranks #2 organically and returns 0.4x — this is the one to question
    {"term": "patch bundle", "clicks": 40, "cost": 300.0, "conversions": 1,
     "conversions_value": 120.0},
]}
GSC_ECOM = {**GSC, "top_queries": GSC["top_queries"] + [
    {"query": "patch bundle", "clicks": 200, "impressions": 4000, "position": 2.0}]}


def test_conversions_down_but_revenue_up_is_reported_as_a_win():
    r = compute_cross_channel(GSC_ECOM, None, ADS_ECOM, DEEP_ECOM)
    first = r["flags"][0]
    assert "REVENUE ROSE" in first and "GOOD period" in first
    assert "do NOT list the conversion-count drop as a decline" in first


def test_conversions_up_but_revenue_down_is_flagged_too():
    ads = {**ADS_ECOM, "deltas": {"conversions": 15.0, "conversions_value": -20.0}}
    r = compute_cross_channel(GSC_ECOM, None, ads, DEEP_ECOM)
    assert "REVENUE FELL" in r["flags"][0]
    assert "Average order value is down" in r["flags"][0]


def test_profitable_defend_terms_are_not_called_wasted_spend():
    """A term you already rank for is only waste if the paid spend is not earning."""
    r = compute_cross_channel(GSC_ECOM, None, ADS_ECOM, DEEP_ECOM)
    defend_flag = next(f for f in r["flags"] if "organic top 3" in f)
    assert "Do NOT call this wasted spend on ROAS alone" in defend_flag
    assert "returns 2x or better" in defend_flag      # the 12x term
    assert "is the one to question first" in defend_flag  # the 0.4x term


def test_overlap_rows_carry_revenue_and_roas():
    rows = {r["term"]: r for r in compute_cross_channel(GSC_ECOM, None, ADS_ECOM, DEEP_ECOM)["overlap"]}
    assert rows["[steel patches]"]["ads_roas"] == 12.0
    assert rows["patch bundle"]["ads_roas"] == 0.4


def test_blended_exposes_roas_aov_and_ecommerce_flag():
    b = compute_cross_channel(GSC_ECOM, None, ADS_ECOM, DEEP_ECOM)["blended"]
    assert b["is_ecommerce"] is True
    assert b["roas"] == 8.0                      # 9600 revenue / 1200 spend
    assert b["aov"] == round(9600 / 22, 2)


def test_ga4_site_revenue_is_read_from_the_mapped_key():
    """analytics_service maps GA4's totalRevenue to `revenue` — reading the raw name finds nothing."""
    ga4 = {**GA4, "totals": {"sessions": 5000, "conversions": 40, "revenue": 24000.0}}
    b = compute_cross_channel(GSC_ECOM, ga4, ADS_ECOM, None)["blended"]
    assert b["ga4_revenue"] == 24000.0
    assert b["blended_roas"] == 20.0             # 24000 site revenue / 1200 paid spend


def test_lead_gen_account_has_no_revenue_noise():
    """No conversion value => not an e-commerce client; revenue fields stay absent."""
    ads = {**ADS_ECOM, "totals": {**ADS_ECOM["totals"], "conversions_value": 0.0, "roas": 0}}
    b = compute_cross_channel(GSC_ECOM, None, ads, None)["blended"]
    assert b["is_ecommerce"] is False
    assert b["roas"] is None and b["ads_revenue"] is None
