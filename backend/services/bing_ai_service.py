"""Bing AI Performance (Copilot citations) — auto-pull ingest path.

Bing Webmaster Tools' AI Performance report (citations / cited pages) has **no official API**
(confirmed on Microsoft's backlog, no timeline). The only programmatic source is an undocumented
internal endpoint that requires the user's live browser session (HttpOnly cookies + x-csrf-token),
which our OAuth token cannot satisfy. So the data is collected by a **bookmarklet** that runs inside
the user's logged-in Bing tab, calls that endpoint in-session, and POSTs the parsed rows here.

This module never sees or stores Bing session secrets — only the derived citation numbers. It
normalizes the bookmarklet payload into the exact shape the deck already consumes (see
bing_service.parse_ai_performance_csv) and caches it per user+site for a day so a deck can pick it
up without re-uploading anything.

Token: a short-lived, single-site-scoped HMAC token is minted for the bookmarklet and verified on
ingest — it is NOT a bearer for the rest of the API.
"""
from typing import Dict, List, Optional
import base64
import hashlib
import hmac
import json
import logging
import time

from services import bing_service

logger = logging.getLogger(__name__)

# Ingested AI-performance data lives in the shared Bing TTL cache under a distinct tag.
_TTL_AI = 24 * 60 * 60  # 24h — citations update daily; a day-old pull is fine for a deck.
_TOKEN_TTL = 10 * 60    # 10 min — the bookmarklet is minted and used immediately.


def _secret() -> bytes:
    """Signing key for bookmarklet tokens. Falls back to the app secret / OAuth secret so we don't
    add new required config; any stable server-side secret works since tokens are short-lived."""
    from config import settings
    raw = (getattr(settings, "SECRET_KEY", "") or getattr(settings, "BING_CLIENT_SECRET", "")
           or "bing-ai-fallback-secret")
    return raw.encode("utf-8")


def mint_bookmarklet_token(user_email: str, site: str) -> str:
    """Short-lived signed token scoping the bookmarklet to (user, site). Format: b64(payload).sig."""
    payload = {"u": user_email, "s": site, "exp": int(time.time()) + _TOKEN_TTL}
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    sig = hmac.new(_secret(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def verify_bookmarklet_token(token: str, user_email: str, site: str) -> bool:
    """Constant-time verify a bookmarklet token against the current user+site and expiry."""
    try:
        raw, sig = token.rsplit(".", 1)
    except (ValueError, AttributeError):
        return False
    expected = hmac.new(_secret(), raw.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return False
    try:
        payload = json.loads(base64.urlsafe_b64decode(raw.encode()))
    except (ValueError, json.JSONDecodeError):
        return False
    return (payload.get("u") == user_email and payload.get("s") == site
            and int(payload.get("exp", 0)) > time.time())


def normalize_ai_citations(raw) -> Optional[Dict]:
    """Map a bookmarklet payload into the deck's AI-performance shape (same as
    parse_ai_performance_csv). Accepts either a raw CSV string, or a list of row dicts already
    parsed client-side ([{date, citations, cited_pages}], keys case-insensitive). Returns None if
    nothing usable is present."""
    if raw is None:
        return None
    # Raw CSV export string → reuse the tolerant CSV parser.
    if isinstance(raw, str):
        return bing_service.parse_ai_performance_csv(raw)
    # Pre-parsed rows from the bookmarklet.
    if isinstance(raw, list):
        daily: List[Dict] = []
        for row in raw:
            if not isinstance(row, dict):
                continue
            r = {(k or "").strip().lower(): v for k, v in row.items()}
            d = bing_service._norm_csv_date(str(r.get("date", "") or ""))
            if not d:
                continue
            try:
                citations = int(float(r.get("citations", 0) or 0))
            except (ValueError, TypeError):
                citations = 0
            try:
                cited_pages = int(float(r.get("cited_pages", r.get("cited pages", 0)) or 0))
            except (ValueError, TypeError):
                cited_pages = 0
            daily.append({"date": d, "citations": citations, "cited_pages": cited_pages})
        return bing_service.aggregate_ai_daily(daily)
    return None


def parse_grounding_queries(text: str) -> list:
    """Parse the 'searchqueries/stats/export' CSV (the List By → Grounding Queries download).
    Columns seen in the dashboard: Grounding Query, Intent, Topic, Citations, Citation Share.
    Tolerant to BOM / header casing / spacing. Returns a list sorted by citations desc, or []."""
    import csv
    import io
    if not text or not text.strip():
        return []
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    if not reader.fieldnames:
        return []
    fields = {(f or "").lstrip("﻿").strip().lower(): f for f in reader.fieldnames}
    # Header names may vary slightly; match on substrings.
    def col(*names):
        for n in names:
            for k, orig in fields.items():
                if n in k:
                    return orig
        return None
    q_f = col("grounding query", "query")
    cit_f = col("citations")
    intent_f = col("intent")
    topic_f = col("topic")
    share_f = col("citation share", "share")
    if not q_f:
        return []
    out = []
    for row in reader:
        query = (row.get(q_f, "") or "").strip()
        if not query:
            continue
        try:
            citations = int(float(row.get(cit_f, 0) or 0)) if cit_f else 0
        except (ValueError, TypeError):
            citations = 0
        out.append({
            "query": query,
            "intent": (row.get(intent_f, "") or "").strip() if intent_f else "",
            "topic": (row.get(topic_f, "") or "").strip() if topic_f else "",
            "citations": citations,
            "citation_share": (row.get(share_f, "") or "").strip() if share_f else "",
        })
    out.sort(key=lambda r: r["citations"], reverse=True)
    return out


def _cache_key(user_email: str, site: str) -> tuple:
    return (user_email, "ai_perf", site)


def store_ai_performance(user_email: str, site: str, data: Dict) -> None:
    bing_service._cache_set(_cache_key(user_email, site), data, _TTL_AI)


def get_ai_performance(user_email: str, site: str) -> Optional[Dict]:
    return bing_service._cache_get(_cache_key(user_email, site))
