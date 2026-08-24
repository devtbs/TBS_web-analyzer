"""AI Results Tracker — are we cited in Google's AI Overview, and who is?

Reads the SerpSnapshot rows captured by the daily rank check (no extra SerpAPI spend: the AI
Overview arrives in the same response as the rank probe). Three views, mirroring what an agency
actually needs to report:

  rankings    — per keyword: is there an AI Overview, and are we cited in it?
  competitors — which domains get cited most across the tracked set
  sources     — the specific URLs the AI Overview pulls from
"""
from datetime import date, timedelta
from typing import List, Optional

from database import TrackedKeyword, SerpSnapshot

def _scope(db, email: str, client_id: Optional[str]):
    """Tracked keywords for this user (optionally one client), plus their latest SERP snapshot."""
    q = db.query(TrackedKeyword).filter(TrackedKeyword.user_email == email,
                                        TrackedKeyword.active == True)  # noqa: E712
    if client_id:
        q = q.filter(TrackedKeyword.client_id == client_id)
    kws = q.all()
    if not kws:
        return [], {}
    ids = [k.id for k in kws]
    rows = (db.query(SerpSnapshot)
            .filter(SerpSnapshot.tracked_keyword_id.in_(ids))
            .order_by(SerpSnapshot.checked_on.desc()).all())
    latest = {}
    for r in rows:                      # rows are newest-first, so first hit per keyword wins
        latest.setdefault(r.tracked_keyword_id, r)
    return kws, latest


def rankings(db, email: str, client_id: Optional[str] = None) -> dict:
    """Per-keyword AI Overview status, plus the headline coverage numbers."""
    kws, latest = _scope(db, email, client_id)
    out, with_ai, cited = [], 0, 0
    for k in kws:
        snap = latest.get(k.id)
        ai = (snap.ai_overview if snap else None) or {}
        present, is_cited = bool(ai.get("present")), bool(ai.get("cited"))
        with_ai += present
        cited += is_cited
        out.append({
            "id": k.id, "keyword": k.keyword, "domain": k.domain,
            "checked_on": str(snap.checked_on) if snap else None,
            "ai_overview": present,
            "cited": is_cited,
            "deferred": bool(ai.get("deferred")),
            "source_count": len(ai.get("sources") or []),
        })
    out.sort(key=lambda r: (not r["ai_overview"], not r["cited"], r["keyword"]))
    return {
        "keywords": out,
        "summary": {
            "tracked": len(kws),
            "with_ai_overview": with_ai,
            "cited": cited,
            # Share of the AI Overviews that actually mention us — the number worth reporting.
            "citation_rate": round(100 * cited / with_ai, 1) if with_ai else 0.0,
        },
    }


def competitors(db, email: str, client_id: Optional[str] = None, limit: int = 25) -> dict:
    """Domains cited across our keywords' AI Overviews, most-cited first."""
    kws, latest = _scope(db, email, client_id)
    own = {(k.domain or "").lower() for k in kws}
    tally, kw_hits = {}, {}
    for k in kws:
        snap = latest.get(k.id)
        for s in ((snap.ai_overview if snap else None) or {}).get("sources") or []:
            d = s.get("domain")
            if not d:
                continue
            tally[d] = tally.get(d, 0) + 1
            kw_hits.setdefault(d, set()).add(k.keyword)
    rows = [{"domain": d, "citations": n, "keywords": len(kw_hits.get(d, ())),
             "is_you": d in own,
             "example_keywords": sorted(kw_hits.get(d, ()))[:3]}
            for d, n in tally.items()]
    rows.sort(key=lambda r: -r["citations"])
    return {"competitors": rows[:limit], "total_domains": len(rows)}


def sources(db, email: str, client_id: Optional[str] = None, limit: int = 100) -> dict:
    """The individual URLs the AI Overviews cite, with which keyword surfaced them."""
    kws, latest = _scope(db, email, client_id)
    own = {(k.domain or "").lower() for k in kws}
    seen, rows = set(), []
    for k in kws:
        snap = latest.get(k.id)
        for s in ((snap.ai_overview if snap else None) or {}).get("sources") or []:
            url = s.get("url")
            if not url or url in seen:
                continue
            seen.add(url)
            rows.append({"url": url, "domain": s.get("domain"), "title": s.get("title"),
                         "keyword": k.keyword, "is_you": (s.get("domain") or "") in own})
    return {"sources": rows[:limit], "total": len(rows)}


def trend(db, email: str, client_id: Optional[str] = None, days: int = 30) -> dict:
    """Citation rate over time — the metric only becomes meaningful once history accrues."""
    kws, _ = _scope(db, email, client_id)
    if not kws:
        return {"points": []}
    ids = [k.id for k in kws]
    since = date.today() - timedelta(days=days)
    rows = (db.query(SerpSnapshot)
            .filter(SerpSnapshot.tracked_keyword_id.in_(ids), SerpSnapshot.checked_on >= since)
            .all())
    by_day = {}
    for r in rows:
        ai = r.ai_overview or {}
        d = by_day.setdefault(str(r.checked_on), {"with_ai": 0, "cited": 0})
        d["with_ai"] += bool(ai.get("present"))
        d["cited"] += bool(ai.get("cited"))
    points = [{"date": d, **v,
               "citation_rate": round(100 * v["cited"] / v["with_ai"], 1) if v["with_ai"] else 0.0}
              for d, v in sorted(by_day.items())]
    return {"points": points}
