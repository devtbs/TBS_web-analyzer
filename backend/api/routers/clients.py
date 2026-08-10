"""Clients — the agency-scale backbone.

A Client is one managed business and the platform assets that belong to it (GSC property, GA4
property, Ads customer, Bing site) plus its brand terms. The rest of the app already runs off those
individual ids; a Client just groups them so the agency picks a *client* once instead of wiring up
three separate selectors every time.

Clients auto-seed from the GSC properties across EVERY connected Google account — which, as a side
effect, makes a 2nd/3rd account's sites visible in one list. The table is standalone (no FKs into
analyses/documents), so it needed no migration: create_all() adds it on startup.
"""
import asyncio
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Body
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from auth.auth import get_current_user
from database import get_db, Client
from models.schemas import UserInfo
from api.routers._shared import iter_google_accounts

logger = logging.getLogger(__name__)
router = APIRouter()


def _serialize(c: Client) -> dict:
    return {
        "id": c.id, "name": c.name, "domain": c.domain,
        "google_account_id": c.google_account_id,
        "gsc_property": c.gsc_property, "ga4_property_id": c.ga4_property_id,
        "ads_customer_id": c.ads_customer_id, "bing_site": c.bing_site,
        "brand_terms": c.brand_terms, "archived": c.archived,
    }


def resolve_client(db, email: str, client_id: str) -> Optional[dict]:
    """Expand a client id into the asset tuple the rest of the app consumes. Single source of truth
    for 'what does this client map to' — used by the assistant and (later) the combined-deck route."""
    c = (db.query(Client)
         .filter(Client.id == client_id, Client.user_email == email).first())
    return _serialize(c) if c else None


def find_client_for(db, email: str, *, gsc_property: Optional[str] = None,
                    ga4_property_id: Optional[str] = None, ads_customer_id: Optional[str] = None,
                    account_id: Optional[int] = None) -> Optional[str]:
    """Reverse-lookup: given a platform asset, return the client id it belongs to (or None).

    Lets a generated deck self-link to its client even when the UI didn't pass a client id. Match
    priority mirrors how specific each asset is: exact GSC property (optionally scoped to the owning
    account), then GA4 property, then Ads customer. Only non-archived clients are considered."""
    base = db.query(Client.id).filter(Client.user_email == email, Client.archived == False)  # noqa: E712

    def _first(q):
        row = q.first()
        return row[0] if row else None

    if gsc_property:
        q = base.filter(Client.gsc_property == gsc_property)
        # Prefer the client on the owning account when the property exists under several.
        if account_id is not None:
            hit = _first(q.filter(Client.google_account_id == account_id))
            if hit:
                return hit
        hit = _first(q)
        if hit:
            return hit
    if ga4_property_id:
        hit = _first(base.filter(Client.ga4_property_id == ga4_property_id))
        if hit:
            return hit
    if ads_customer_id:
        hit = _first(base.filter(Client.ads_customer_id == ads_customer_id))
        if hit:
            return hit
    return None


@router.get("/api/clients")
async def list_clients(current_user: UserInfo = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    """Every non-archived client for this user, newest first."""
    rows = (db.query(Client)
            .filter(Client.user_email == current_user.email, Client.archived == False)  # noqa: E712
            .order_by(Client.created_at.desc()).all())
    return {"clients": [_serialize(c) for c in rows]}


@router.post("/api/clients")
async def create_client(body: dict = Body(...),
                        current_user: UserInfo = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    """Create a client by hand (the auto-seed covers the common case)."""
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A client name is required.")
    c = Client(
        id=str(uuid.uuid4()), user_email=current_user.email, name=name,
        domain=body.get("domain"), google_account_id=body.get("google_account_id"),
        gsc_property=body.get("gsc_property"), ga4_property_id=body.get("ga4_property_id"),
        ads_customer_id=body.get("ads_customer_id"), bing_site=body.get("bing_site"),
        brand_terms=body.get("brand_terms"),
    )
    db.add(c)
    db.commit()
    return _serialize(c)


@router.put("/api/clients/{client_id}")
async def update_client(client_id: str, body: dict = Body(...),
                        current_user: UserInfo = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    """Attach/replace a client's GA4, Ads, Bing, brand terms, name or archived flag."""
    c = (db.query(Client)
         .filter(Client.id == client_id, Client.user_email == current_user.email).first())
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Client not found.")
    for field in ("name", "domain", "google_account_id", "gsc_property", "ga4_property_id",
                  "ads_customer_id", "bing_site", "brand_terms", "archived"):
        if field in body:
            setattr(c, field, body[field])
    db.commit()
    return _serialize(c)


@router.delete("/api/clients/{client_id}")
async def delete_client(client_id: str,
                        current_user: UserInfo = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    """Archive (soft-delete) a client — keeps the row so auto-seed won't recreate it."""
    c = (db.query(Client)
         .filter(Client.id == client_id, Client.user_email == current_user.email).first())
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Client not found.")
    c.archived = True
    db.commit()
    return {"ok": True}


@router.post("/api/clients/autoseed")
async def autoseed_clients(current_user: UserInfo = Depends(get_current_user),
                           db: Session = Depends(get_db)):
    """Create one client per GSC property across ALL connected Google accounts.

    Idempotent: the (user_email, gsc_property) unique constraint means re-running never duplicates,
    and an archived client stays archived (its property is 'seen', so it is skipped). Best-effort
    GA4 auto-match by domain. This is what populates the whole book on first load — and surfaces
    properties from accounts other than the currently-selected one.
    """
    from services.gsc_service import get_user_properties
    from services.report_generator import _domain_from_property, property_display

    email = current_user.email
    accounts = iter_google_accounts(db, email)

    # One-time relabel: earlier auto-seeded clients were named with the bare domain, which made
    # https/http/www/sc-domain variants of one domain indistinguishable. Rewrite those names to the
    # disambiguating label — but only for rows the user hasn't renamed (name == old bare domain or
    # == the raw property), so hand-edited names are preserved. Idempotent.
    relabeled = 0
    for c in db.query(Client).filter(Client.user_email == email).all():
        if not c.gsc_property:
            continue
        label, domain = property_display(c.gsc_property)
        if c.name in (domain, c.gsc_property) and (c.name != label or c.domain != domain):
            c.name, c.domain = label, domain
            relabeled += 1
    if relabeled:
        db.commit()

    # Everything already mapped (any archived state), so we never recreate a pruned client.
    existing = {p for (p,) in db.query(Client.gsc_property)
                .filter(Client.user_email == email).all() if p}

    # Fetch each account's property list concurrently; one bad account must not sink the seed.
    async def _props(acct):
        try:
            return acct, await get_user_properties(
                acct["token"], is_refresh_token=acct["is_refresh"],
                user_email=f"{email}|{acct['google_email']}")
        except Exception:
            logger.warning("autoseed: property fetch failed for %s", acct["google_email"],
                           exc_info=True)
            return acct, []

    results = await asyncio.gather(*[_props(a) for a in accounts])

    # GA4 service (primary token) for best-effort domain matching; optional.
    ga4 = None
    try:
        from api.routers._shared import _ga4_service_for
        ga4 = _ga4_service_for(db, email, None)
    except Exception:
        ga4 = None

    created = 0
    for acct, props in results:
        for p in props or []:
            url = p.get("url")
            if not url or url in existing:
                continue
            label, domain = property_display(url)
            ga4_pid = None
            if ga4:
                try:
                    match = await ga4.find_property_for_domain(domain)
                    ga4_pid = (match or {}).get("property_id") or None
                except Exception:
                    ga4_pid = None
            db.add(Client(
                id=str(uuid.uuid4()), user_email=email,
                name=label or domain or url, domain=domain,
                google_account_id=acct["account_id"], gsc_property=url,
                ga4_property_id=ga4_pid,
            ))
            existing.add(url)
            created += 1
    if created:
        db.commit()
    total = (db.query(Client)
             .filter(Client.user_email == email, Client.archived == False).count())  # noqa: E712
    return {"created": created, "total": total}


async def _client_overview_row(db, email: str, c: Client, days: int) -> dict:
    """One client's GSC headline metrics + real period-over-period deltas (or an error marker).

    Shared by the batch (`/overview`) and streaming (`/overview/stream`) endpoints. `id` + the
    account/asset ids are what selectClient() writes into localStorage so the picked client opens on
    the RIGHT Google account (a cross-account client left these unset before, which is exactly why its
    property selector rendered blank)."""
    from services.gsc_service import GSCService
    from api.routers._shared import _resolve_token

    base = {"client_id": c.id, "id": c.id, "name": c.name, "domain": c.domain,
            "gsc_property": c.gsc_property, "google_account_id": c.google_account_id,
            "ga4_property_id": c.ga4_property_id, "ads_customer_id": c.ads_customer_id}
    if not c.gsc_property:
        return {**base, "error": "no Search Console property linked"}
    try:
        token, is_refresh = _resolve_token(db, email, c.google_account_id)
        svc = GSCService.from_stored_token(
            token, is_refresh_token=is_refresh,
            user_email=f"{email}|{c.google_account_id}" if c.google_account_id else email)
        data = await svc.get_search_analytics(c.gsc_property, days=days, group_by="daily")
        return {**base,
                "totals": data.get("totals", {}),
                "deltas": data.get("deltas", {}),
                "sparkline": [r.get("clicks", 0) for r in (data.get("chart_data") or [])]}
    except Exception as e:
        logger.warning("overview: %s failed: %s", c.gsc_property, str(e)[:120])
        return {**base, "error": "could not load — the account may need reconnecting"}


def _overview_clients(db, email: str):
    return (db.query(Client)
            .filter(Client.user_email == email, Client.archived == False)  # noqa: E712
            .order_by(Client.created_at.desc()).all())


@router.get("/api/clients/overview")
async def clients_overview(days: int = 28,
                           current_user: UserInfo = Depends(get_current_user),
                           db: Session = Depends(get_db)):
    """Portfolio: every client's GSC headline metrics + real period-over-period deltas, in one call.

    The old My Sites did this client-side, GSC-only and single-account, with a FAKE previous-period
    baseline. This runs server-side across all accounts and returns the REAL deltas from
    get_search_analytics. Per-client failures degrade to an error marker so one dead property never
    blanks the whole page. Kept as the non-streaming fallback alongside /overview/stream.
    """
    email = current_user.email
    clients = _overview_clients(db, email)
    rows = (await asyncio.gather(*[_client_overview_row(db, email, c, days) for c in clients])
            if clients else [])
    return {"clients": rows}


@router.get("/api/clients/overview/stream")
async def clients_overview_stream(days: int = 28,
                                  current_user: UserInfo = Depends(get_current_user),
                                  db: Session = Depends(get_db)):
    """Same portfolio data as /overview, but streamed one card at a time (SSE) so the Clients page
    paints progressively instead of blocking on the slowest client. Emits `start` {total}, then a
    `client` event per row as it resolves, then `done` {count}.

    Cost is identical to the batch call: GOOGLE_CALL_GATE (services/gsc_service.py) still caps Google
    calls at 4 concurrently — streaming only changes WHEN each finished row is flushed to the client.
    """
    from api.routers._shared import _SSE_HEADERS, _sse

    email = current_user.email
    clients = _overview_clients(db, email)

    async def gen():
        yield _sse("start", {"total": len(clients)})
        count = 0
        if clients:
            tasks = [asyncio.ensure_future(_client_overview_row(db, email, c, days)) for c in clients]
            for fut in asyncio.as_completed(tasks):
                row = await fut
                count += 1
                yield _sse("client", row)
        yield _sse("done", {"count": count})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)
