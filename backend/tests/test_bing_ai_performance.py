"""Regression tests for Bing AI Performance parsing.

Covers the two things that broke (or would silently break) with real Bing exports:
  1. The UTF-8 BOM that real "Overview Stats" CSVs carry, which previously made
     parse_ai_performance_csv return None (so uploads silently did nothing).
  2. The grounding-queries export ("searchqueries/stats/export") column mapping.

These use only stdlib parsing paths — no network, config, or env needed.
"""
from services import bing_service
from services import bing_ai_service

BOM = "﻿"

# Real Bing "Overview Stats" export shape: BOM + quoted header + "M/D/YYYY 12:00:00 AM" dates.
OVERVIEW_CSV = BOM + (
    '"Date","Citations","Cited Pages"\n'
    '"4/14/2026 12:00:00 AM","22","1"\n'
    '"4/15/2026 12:00:00 AM","3","2"\n'
    '"4/20/2026 12:00:00 AM","0","0"\n'
    '"7/3/2026 12:00:00 AM","44","3"\n'
)

# Real "Download all" grounding-queries export shape (columns from the dashboard).
QUERIES_CSV = BOM + (
    '"Grounding Query","Intent","Topic","Citations","Citation Share"\n'
    '"absolute sanctuary koh samui","Navigational","Medical & Wellness Tourism","646","26.21%"\n'
    '"thailand wellness retreat","Informational","Medical & Wellness Tourism","15","10.00%"\n'
)


def test_overview_csv_with_bom_parses():
    """A BOM-prefixed export must parse (previously returned None -> silent no-op)."""
    r = bing_service.parse_ai_performance_csv(OVERVIEW_CSV)
    assert r is not None
    assert len(r["daily"]) == 4
    assert r["total_citations"] == 22 + 3 + 0 + 44
    assert r["peak"] == {"date": "2026-07-03", "citations": 44, "cited_pages": 3}
    assert r["start"] == "2026-04-14" and r["end"] == "2026-07-03"
    # avg cited pages counts only active days (cited_pages > 0): (1+2+3)/3 = 2.0
    assert r["avg_cited_pages"] == 2.0


def test_unrecognized_csv_returns_none():
    assert bing_service.parse_ai_performance_csv("not,a,valid\nexport,file,here") is None
    assert bing_service.parse_ai_performance_csv("") is None


def test_normalize_accepts_csv_and_rows_identically():
    """The auto-pull path (list of rows) must yield the same headline shape as the CSV path."""
    from_csv = bing_ai_service.normalize_ai_citations(OVERVIEW_CSV)
    rows = [dict(d) for d in from_csv["daily"]]
    from_rows = bing_ai_service.normalize_ai_citations(rows)
    assert from_rows == from_csv


def test_grounding_queries_parse_and_sort():
    q = bing_ai_service.parse_grounding_queries(QUERIES_CSV)
    assert len(q) == 2
    assert q[0]["query"] == "absolute sanctuary koh samui"
    assert q[0]["citations"] == 646
    assert q[0]["citation_share"] == "26.21%"
    assert q[0]["intent"] == "Navigational"
    assert q[0]["topic"] == "Medical & Wellness Tourism"
    # sorted by citations desc
    assert q[0]["citations"] >= q[1]["citations"]


def test_grounding_queries_empty_is_empty_list():
    assert bing_ai_service.parse_grounding_queries("") == []
    assert bing_ai_service.parse_grounding_queries("Nope\n1\n2") == []


def test_bookmarklet_token_roundtrip(monkeypatch):
    """Token verifies for its own user+site and is rejected for a different site."""
    import types
    monkeypatch.setattr(bing_ai_service, "_secret", lambda: b"unit-test-secret")
    tok = bing_ai_service.mint_bookmarklet_token("a@b.com", "https://x.com/")
    assert bing_ai_service.verify_bookmarklet_token(tok, "a@b.com", "https://x.com/") is True
    assert bing_ai_service.verify_bookmarklet_token(tok, "a@b.com", "https://other.com/") is False
    assert bing_ai_service.verify_bookmarklet_token("garbage", "a@b.com", "https://x.com/") is False
