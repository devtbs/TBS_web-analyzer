"""Bing Webmaster Tools routes.

Bing runs its own OAuth 2.0 server (not Azure). A user connects one or more Bing accounts
(often Google-based logins) via the auth-code flow; we store each account's refresh token
and query the Bing Webmaster JSON API on their behalf. When no OAuth client is configured
every endpoint reports {configured: false} (HTTP 200) so the frontend can render a clear
"connect Bing" state instead of erroring — same pattern as the Google Ads router.
"""
import json
from urllib.parse import urlencode

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from models.schemas import UserInfo
from auth.auth import get_current_user
from database import get_db
from config import settings
from api.routers._shared import exchange_bing_code, refresh_bing_token
from services.bing_service import (
    bing_is_configured,
    get_verified_sites,
    get_rank_and_traffic,
    get_query_stats,
    get_page_stats,
    _cache_get,
    _cache_set,
    _TTL_SITES,
    _TTL_REPORT,
)
from utils.user_manager import (
    upsert_bing_account,
    get_bing_accounts,
    get_bing_account_token,
    delete_bing_account,
)

router = APIRouter()

BING_SCOPE = "webmaster.read"
BING_AUTHORIZE_URL = "https://www.bing.com/webmasters/oauth/authorize"

# The bookmarklet runs on bing.com and POSTs cross-origin to /ingest; scope CORS to that origin only.
_BOOKMARKLET_ORIGIN = "https://www.bing.com"


def _label_from_sites(sites: list) -> str:
    """Derive a human-facing label for a newly connected Bing account from its sites.
    Bing's token response has no email/profile, so name it after a representative site."""
    if not sites:
        return "Bing account (no verified sites)"
    first = (sites[0].get("url") or "").replace("https://", "").replace("http://", "").strip("/")
    extra = len(sites) - 1
    return f"{first}" + (f" +{extra} more" if extra > 0 else "")


@router.get("/auth/bing/status")
async def bing_status(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Report whether Bing OAuth is configured and how many accounts are connected."""
    accounts = get_bing_accounts(db, current_user.email) if bing_is_configured() else []
    return {
        "configured": bing_is_configured(),
        "client_id": settings.BING_CLIENT_ID if bing_is_configured() else None,
        "accounts": len(accounts),
    }


@router.get("/auth/bing/authorize-url")
async def bing_authorize_url(
    redirect_uri: str,
    current_user: UserInfo = Depends(get_current_user),
):
    """Build the Bing OAuth authorize URL the frontend opens in a popup."""
    if not bing_is_configured():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bing OAuth is not configured.")
    qs = urlencode({
        "client_id": settings.BING_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": BING_SCOPE,
    })
    return {"url": f"{BING_AUTHORIZE_URL}?{qs}"}


@router.post("/auth/bing/connect")
async def bing_connect(
    request: dict,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Exchange an authorization code for tokens and store the Bing account."""
    if not bing_is_configured():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bing OAuth is not configured.")

    code = request.get("code")
    redirect_uri = request.get("redirect_uri")
    if not code or not redirect_uri:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="'code' and 'redirect_uri' are required.")

    token_data = exchange_bing_code(code, redirect_uri)
    refresh_token = token_data.get("refresh_token")
    access_token = token_data.get("access_token")
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No refresh token returned by Bing. Revoke the app's access in Bing Webmaster settings and try again.",
        )

    # Name the account after its verified sites (Bing gives no email/profile).
    try:
        sites = await get_verified_sites(access_token)
    except Exception:
        sites = []
    label = _label_from_sites(sites)

    acct = upsert_bing_account(db, user_email=current_user.email, label=label, refresh_token=refresh_token)
    return {"id": acct.id, "label": acct.label, "sites": len(sites)}


@router.get("/auth/bing/accounts")
async def bing_list_accounts(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all connected Bing accounts for the current user."""
    return {"accounts": get_bing_accounts(db, current_user.email)}


@router.delete("/auth/bing/accounts/{account_id}")
async def bing_disconnect(
    account_id: int,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Disconnect (remove) a connected Bing account."""
    if not delete_bing_account(db, current_user.email, account_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bing account not found.")
    from services.bing_service import invalidate_cache
    invalidate_cache(current_user.email)
    return {"ok": True}


@router.get("/api/bing/sites")
async def bing_sites(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Merged verified sites across all connected Bing accounts, tagged by account."""
    if not bing_is_configured():
        return {"configured": False, "sites": [], "errors": []}

    accounts = get_bing_accounts(db, current_user.email)
    sites, errors = [], []
    for a in accounts:
        cache_key = (current_user.email, a["id"], "sites")
        cached = _cache_get(cache_key)
        if cached is not None:
            sites.extend(cached)
            continue
        try:
            refresh = get_bing_account_token(db, current_user.email, a["id"])
            access_token = refresh_bing_token(refresh)
            acct_sites = await get_verified_sites(access_token)
            tagged = [{**s, "account_id": a["id"], "account_label": a["label"]} for s in acct_sites]
            _cache_set(cache_key, tagged, _TTL_SITES)
            sites.extend(tagged)
        except Exception as e:
            errors.append({"account_id": a["id"], "label": a["label"], "error": str(e)})

    return {"configured": True, "sites": sites, "errors": errors}


@router.get("/api/bing/performance")
async def bing_performance(
    site: str,
    account_id: int,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search-performance data for one site under one connected Bing account."""
    if not bing_is_configured():
        return {"configured": False}

    cache_key = (current_user.email, account_id, "perf", site)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    refresh = get_bing_account_token(db, current_user.email, account_id)
    if not refresh:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connected Bing account not found.")

    try:
        access_token = refresh_bing_token(refresh)
        traffic = await get_rank_and_traffic(access_token, site)
        queries = await get_query_stats(access_token, site)
        pages = await get_page_stats(access_token, site)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to fetch Bing data: {e}")

    totals = {
        "clicks": sum(t["clicks"] for t in traffic),
        "impressions": sum(t["impressions"] for t in traffic),
    }
    result = {
        "configured": True,
        "site": site,
        "totals": totals,
        "traffic": traffic,
        "queries": sorted(queries, key=lambda q: q["clicks"], reverse=True),
        "pages": sorted(pages, key=lambda p: p["clicks"], reverse=True),
    }
    _cache_set(cache_key, result, _TTL_REPORT)
    return result


# ---------------------------------------------------------------------------
# AI Performance (Copilot citations) — auto-pull via in-session bookmarklet.
# Bing exposes no API for this; the bookmarklet runs in the user's logged-in Bing
# tab, pulls citation data in-session, and POSTs the derived rows to /ingest.
# ---------------------------------------------------------------------------

_BOOKMARKLET_JS = r"""(async () => {
  try {
    var OVERVIEW = 'https://www.bing.com/webmasters/api/aiperformance/citationstats/export';
    var QUERIES  = 'https://www.bing.com/webmasters/api/aiperformance/searchqueries/stats/export';
    var SITE = __SITE__, TOKEN = __TOKEN__, INGEST = __INGEST__;

    /* The x-csrf-token lives only in the app's memory (not cookie/meta/storage) and the session
       cookies are HttpOnly, so we must run in-page and capture the token from the dashboard's own
       requests. Hook fetch + XHR once to record any x-csrf-token header we see. */
    if (!window.__bwtHook) {
      window.__bwtHook = true; window.__bwtTok = '';
      var oSet = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
        if (k && k.toLowerCase() === 'x-csrf-token' && v) window.__bwtTok = v;
        return oSet.apply(this, arguments);
      };
      var oFetch = window.fetch;
      window.fetch = function (u, o) {
        try {
          var h = (o && o.headers) || {};
          var t = h['x-csrf-token'] || h['X-CSRF-Token'] || (h.get && h.get('x-csrf-token'));
          if (t) window.__bwtTok = t;
        } catch (e) {}
        return oFetch.apply(this, arguments);
      };
    }

    /* Nudge the dashboard to refetch (which sends the token) by clicking a period button. */
    var btns = [].slice.call(document.querySelectorAll('button,div,span,a'));
    var pb = btns.find(function (e) { return /^(3\s*M|30\s*D|7\s*D|6\s*M)$/i.test((e.textContent || '').trim()); });
    if (pb) pb.click();

    var t0 = Date.now();
    while (!window.__bwtTok && Date.now() - t0 < 10000) { await new Promise(function (r) { setTimeout(r, 300); }); }
    var csrf = window.__bwtTok;
    if (!csrf) csrf = prompt('Could not auto-detect the security token. Open DevTools > Network, click the page\'s Download button, open that request, and paste its x-csrf-token header here:', '');
    if (!csrf) { alert('No security token found — aborted. Tip: click a date button (7D/30D/3M) once, then run again.'); return; }

    var body = JSON.stringify({ SiteUrl: SITE });
    async function pull(url) {
      var r = await fetch(url, { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'X-CSRF-Token': csrf }, body: body });
      return { ok: r.ok, status: r.status, text: await r.text() };
    }

    var ov = await pull(OVERVIEW);
    var qs = await pull(QUERIES);
    if (!ov.ok && !qs.ok) {
      alert('Bing rejected both requests (' + ov.status + '/' + qs.status + ').\nReply: ' +
            ov.text.slice(0, 200) + '\n\nCopy this and paste it back in the app.');
      return;
    }

    var out = await fetch(INGEST, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ site: SITE, token: TOKEN,
        overview_csv: ov.ok ? ov.text : '', queries_csv: qs.ok ? qs.text : '' }) });
    var j = await out.json().catch(function () { return {}; });
    alert(out.ok
      ? 'AI Performance sent: ' + (j.days || 0) + ' days, ' + (j.total_citations || 0) +
        ' citations, ' + (j.queries || 0) + ' queries. Return to the app.'
      : 'Send to app failed (' + out.status + '): ' + (j.detail || ''));
  } catch (e) { alert('Bookmarklet error: ' + e); }
})();"""


def _bookmarklet_source(ingest_url: str, token: str, site: str) -> str:
    """The javascript: bookmarklet body. Runs on the Bing AI Performance page, calls Bing's two
    (undocumented) export endpoints in-session (cookies auto-attached), and POSTs the raw CSVs to
    our ingest endpoint. It reads the x-csrf-token live from the page and, if Bing rejects the
    request, alerts the HTTP status + reply snippet so the payload can be corrected in one pass."""
    return (_BOOKMARKLET_JS
            .replace("__SITE__", json.dumps(site))
            .replace("__TOKEN__", json.dumps(token))
            .replace("__INGEST__", json.dumps(ingest_url)))


@router.get("/api/bing/ai-performance/bookmarklet")
async def bing_ai_bookmarklet(
    request: Request,
    site: str,
    current_user: UserInfo = Depends(get_current_user),
):
    """Mint a short-lived, single-site token and return the bookmarklet JS the user drags to their
    bookmarks bar (then clicks on the Bing AI Performance page)."""
    from services.bing_ai_service import mint_bookmarklet_token
    token = mint_bookmarklet_token(current_user.email, site)
    ingest_url = str(request.base_url).rstrip("/") + "/api/bing/ai-performance/ingest"
    js = _bookmarklet_source(ingest_url, token, site)
    return {"site": site, "bookmarklet": "javascript:" + js}


@router.options("/api/bing/ai-performance/ingest")
async def bing_ai_ingest_preflight():
    """CORS preflight for the cross-origin bookmarklet POST (scoped to bing.com only)."""
    return Response(status_code=204, headers={
        "Access-Control-Allow-Origin": _BOOKMARKLET_ORIGIN,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Max-Age": "600",
    })


@router.post("/api/bing/ai-performance/ingest")
async def bing_ai_ingest(response: Response, payload: dict = Body(...)):
    """Receive AI Performance data from the bookmarklet. Authenticated purely by the signed token
    (the bookmarklet runs on bing.com and cannot carry our JWT). No Bing session secrets are
    accepted or stored — only the derived citation numbers and grounding queries.

    Payload: {site, token, overview_csv, queries_csv} (raw CSV text straight from Bing's two
    export endpoints). `rows`/`csv` are still accepted for backward compatibility."""
    from services.bing_ai_service import (
        verify_bookmarklet_token, normalize_ai_citations, parse_grounding_queries,
        store_ai_performance,
    )

    response.headers["Access-Control-Allow-Origin"] = _BOOKMARKLET_ORIGIN
    payload = payload or {}
    site = payload.get("site") or ""
    token = payload.get("token") or ""

    # The token embeds the user+site, so we recover the user from it rather than a session.
    import base64, json as _json
    try:
        raw = token.rsplit(".", 1)[0]
        user_email = _json.loads(base64.urlsafe_b64decode(raw.encode())).get("u", "")
    except Exception:
        user_email = ""
    if not user_email or not verify_bookmarklet_token(token, user_email, site):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token.")

    overview = payload.get("overview_csv") or payload.get("rows") or payload.get("csv")
    data = normalize_ai_citations(overview)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No recognizable AI Performance overview data in the payload.")
    data["queries"] = parse_grounding_queries(payload.get("queries_csv") or "")
    store_ai_performance(user_email, site, data)
    return {"ok": True, "total_citations": data["total_citations"], "days": len(data["daily"]),
            "queries": len(data["queries"])}


@router.get("/api/bing/ai-performance")
async def bing_ai_get(
    site: str,
    current_user: UserInfo = Depends(get_current_user),
):
    """Return the most recently ingested AI Performance data for a site (404 if none pulled yet)."""
    from services.bing_ai_service import get_ai_performance
    data = get_ai_performance(current_user.email, site)
    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No AI Performance data pulled yet.")
    return data
