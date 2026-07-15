"""AI deck generation routes (HTML-based): generate from GSC, GA4, Google Ads or an
uploaded PDF, preview saved decks, download, and list AI providers."""
from fastapi import APIRouter, Depends, HTTPException, status, Body, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from models.schemas import UserInfo
from auth.auth import get_current_user
from database import get_db, Document
from config import settings
from api.routers._shared import (
    PPTX_MEDIA_TYPE, PDF_MEDIA_TYPE, _SSE_HEADERS,
    _create_deck_placeholder, _finalize_deck_document,
    _slides_payload, _stream_deck_generation,
)

router = APIRouter()


@router.get("/api/presentation/deck/{document_id}/slides")
async def presentation_deck_slides(
    document_id: str,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Render a saved deck's slides to preview images (page-by-page carousel)."""
    from services.ai_deck_service import render_slide_images
    doc = db.query(Document).filter(
        Document.id == document_id, Document.user_email == current_user.email
    ).first()
    if not doc or doc.content_type != "AI Deck":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deck not found.")
    html = (doc.content or {}).get("html")
    if not html:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deck has no stored HTML.")
    try:
        imgs = await render_slide_images(html)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Render failed: {str(e)}")
    return {"slides": _slides_payload(imgs), "label": (doc.content or {}).get("label", "")}


@router.get("/api/presentation/deck/{document_id}/download")
async def presentation_deck_download(
    document_id: str,
    format: str = "pdf",
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-render a saved AI-deck Document's HTML to the requested file format."""
    from services.ai_deck_service import render_deck
    fmt = (format or "pdf").lower()
    if fmt not in ("pdf", "pptx"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="format must be 'pdf' or 'pptx'.")
    doc = db.query(Document).filter(
        Document.id == document_id, Document.user_email == current_user.email
    ).first()
    if not doc or doc.content_type != "AI Deck":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deck not found.")
    html = (doc.content or {}).get("html")
    if not html:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deck has no stored HTML.")
    try:
        file_bytes = await render_deck(html, fmt=fmt)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Render failed: {str(e)}")
    label = ((doc.content or {}).get("label") or "report").replace(" ", "_").replace("/", "_")
    media = PDF_MEDIA_TYPE if fmt == "pdf" else PPTX_MEDIA_TYPE
    return StreamingResponse(
        iter([file_bytes]),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="AI_Deck_{label}.{fmt}"'},
    )


@router.post("/api/presentation/ai-deck-from-pdf")
async def presentation_ai_deck_from_pdf(
    file: UploadFile = File(...),
    provider: str = Form("deepseek"),
    images: bool = Form(True),
    notes: str = Form(""),
    creativity: str = Form("balanced"),
    pipeline: str = Form("single"),
    models: str = Form(""),
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a report PDF → AI extracts its data and designs a deck. Returns the
    deck HTML for preview and saves it to Documents; download via the deck-download route.

    Form fields: file (the PDF), provider, images, notes, pipeline, models (JSON string).
    """
    from services.ai_deck_service import generate_deck_from_pdf, render_slide_images
    from services.image_service import images_enabled
    _require_llm_key()
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file.")
    label = (file.filename or "report").rsplit(".", 1)[0][:60] or "report"
    models_dict = _parse_models(models)

    async def run(on_progress, set_doc_id):
        doc_id = _create_deck_placeholder(current_user.email, source="pdf", label=label, provider=provider)
        set_doc_id(doc_id)
        result = await generate_deck_from_pdf(pdf_bytes, provider=provider, render=False,
                                              images=images and images_enabled(),
                                              notes=notes, seed=label, creativity=creativity,
                                              pipeline=pipeline, models=models_dict,
                                              on_progress=on_progress)
        slides = await _finalize_and_preview(doc_id, result["html"], on_progress)
        return {"document_id": doc_id, "slides": slides, "label": label}

    return StreamingResponse(_stream_deck_generation(run, current_user.email),
                             media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/api/presentation/ai-providers")
async def presentation_ai_providers(current_user: UserInfo = Depends(get_current_user)):
    """Which AI providers are configured (have a key) — for the UI picker."""
    from services.ai_service import AIService
    return {"providers": AIService.configured_providers()}


@router.get("/api/presentation/deck-job/{job_id}")
async def presentation_deck_job(job_id: str, current_user: UserInfo = Depends(get_current_user)):
    """Poll a background deck job — lets a client that reloaded/returned re-attach to a
    generation that keeps running server-side. Returns status + (when done) document_id+slides."""
    from api.routers._shared import _DECK_JOBS, _deck_job_public
    job = _DECK_JOBS.get(job_id)
    if not job or job.get("user_email") != current_user.email:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deck job not found.")
    return _deck_job_public(job)


async def _finalize_and_preview(doc_id: str, html: str, on_progress) -> list:
    """Save the finished deck HTML to its Document row first (so it's valid/downloadable even
    if preview rendering hiccups), then render preview images. A preview-render failure is
    non-fatal: the deck is already saved, so return an empty carousel rather than failing the job."""
    from services.ai_deck_service import render_slide_images
    _finalize_deck_document(doc_id, html=html)
    try:
        imgs = await render_slide_images(html, on_progress=on_progress)
        return _slides_payload(imgs)
    except Exception:
        return []


def _domain_of(url: str) -> str:
    """Best-effort display label from a property URL/domain for the placeholder row title
    (the final row title uses the generator's resolved domain)."""
    s = (url or "report").strip()
    s = s.replace("sc-domain:", "").replace("https://", "").replace("http://", "")
    return s.strip("/").split("/")[0] or "report"


def _parse_models(models):
    """Normalize the per-layer model override into a {planner,insights,html} dict or None.
    Accepts a dict (JSON body) or a JSON string (multipart form). Bad input → None (the
    engine then uses the single `provider` for every layer)."""
    import json
    if isinstance(models, dict):
        return models or None
    if isinstance(models, str) and models.strip():
        try:
            d = json.loads(models)
            return d if isinstance(d, dict) and d else None
        except Exception:
            return None
    return None


@router.get("/api/presentation/deck-jobs")
async def presentation_deck_jobs(current_user: UserInfo = Depends(get_current_user)):
    """List the current user's in-flight/recent background deck jobs (for the in-page
    multi-job tracker). Persistent status also lives on each deck's Document row."""
    from api.routers._shared import _DECK_JOBS, _deck_job_public, _evict_stale_jobs
    _evict_stale_jobs()
    jobs = [{"job_id": jid, **_deck_job_public(v)}
            for jid, v in _DECK_JOBS.items() if v.get("user_email") == current_user.email]
    return {"jobs": jobs}


def _require_llm_key():
    # Any configured deck provider (DeepSeek, Qwen, GLM, …) is enough — not just DeepSeek/Groq.
    from services.ai_service import AIService
    if not AIService.configured_providers():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No LLM key configured — set at least one provider key "
                                   "(e.g. DEEPSEEK_API_KEY, QWEN_API_KEY, GLM_API_KEY).")


def _require_google_token(db, email):
    """The stored Google token shared by GSC / GA4 / Ads, or a 400 if not connected."""
    from utils.user_manager import get_user_gsc_token
    token, is_refresh = get_user_gsc_token(db, email)
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Google account not connected for this account.")
    return token, is_refresh


@router.post("/api/presentation/ai-deck-gsc")
async def presentation_ai_deck_gsc(
    property: str,
    days: int = 28,
    provider: str = "deepseek",
    images: bool = True,
    body: dict = Body(default={}),
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI-designed organic-search deck for a GSC property (from 'My Sites'), built from
    the logged-in user's Search Console data. Returns the deck HTML for preview and saves
    it to Documents; download via the deck-download route. Query: ?property=<url>&days=N"""
    from services.report_generator import generate_ai_gsc_deck
    from services.ai_deck_service import render_slide_images
    from services.image_service import images_enabled
    from services.gsc_service import GSCService
    _require_llm_key()
    gsc_token, is_refresh = _require_google_token(db, current_user.email)
    service = GSCService.from_stored_token(gsc_token, is_refresh_token=is_refresh, user_email=current_user.email)
    notes = (body or {}).get("notes", "")
    creativity = (body or {}).get("creativity", "balanced")
    pipeline = (body or {}).get("pipeline", "single")
    models = _parse_models((body or {}).get("models"))
    place_label = _domain_of(property)

    async def run(on_progress, set_doc_id):
        doc_id = _create_deck_placeholder(current_user.email, source="gsc", label=place_label, provider=provider)
        set_doc_id(doc_id)
        result = await generate_ai_gsc_deck(service, property, days, provider=provider,
                                            images=images and images_enabled(),
                                            notes=notes, creativity=creativity,
                                            pipeline=pipeline, models=models, on_progress=on_progress)
        slides = await _finalize_and_preview(doc_id, result["html"], on_progress)
        return {"document_id": doc_id, "slides": slides, "label": result["domain"]}

    return StreamingResponse(_stream_deck_generation(run, current_user.email),
                             media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/api/presentation/ai-deck-bing")
async def presentation_ai_deck_bing(
    account_id: int,
    site: str,
    days: int = 28,
    provider: str = "deepseek",
    images: bool = True,
    label: str = "",
    body: dict = Body(default={}),
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI-designed Bing organic-search deck for one verified site under a connected Bing
    account. Query: ?account_id=<id>&site=<url>&days=N&label=<display name>.
    Body may carry {notes, ai_performance_csv} — the uploaded AI Performance CSV export
    (Bing has no AI API yet) adds an AI Search Visibility slide when present."""
    from services.report_generator import generate_ai_bing_deck
    from services.ai_deck_service import render_slide_images
    from services.image_service import images_enabled
    from services.bing_service import bing_is_configured
    from api.routers._shared import refresh_bing_token
    from utils.user_manager import get_bing_account_token
    _require_llm_key()
    if not bing_is_configured():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Bing is not configured — an OAuth client is required.")
    refresh = get_bing_account_token(db, current_user.email, account_id)
    if not refresh:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connected Bing account not found.")
    access_token = refresh_bing_token(refresh)
    notes = (body or {}).get("notes", "")
    creativity = (body or {}).get("creativity", "balanced")
    pipeline = (body or {}).get("pipeline", "single")
    models = _parse_models((body or {}).get("models"))
    ai_perf_csv = (body or {}).get("ai_performance_csv")
    # A manually uploaded CSV that doesn't parse should fail loudly, not be silently ignored.
    if ai_perf_csv:
        from services.bing_service import parse_ai_performance_csv
        if not parse_ai_performance_csv(ai_perf_csv):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That file isn't a recognized Bing AI Performance CSV export "
                       "(expected Date and Citations columns). Re-export from Bing Webmaster → AI Performance.")
    # When no CSV was uploaded, fall back to AI Performance data auto-pulled via the bookmarklet.
    ai_perf_data = None
    if not ai_perf_csv:
        from services.bing_ai_service import get_ai_performance
        ai_perf_data = get_ai_performance(current_user.email, site)

    place_label = label or _domain_of(site)

    async def run(on_progress, set_doc_id):
        doc_id = _create_deck_placeholder(current_user.email, source="bing", label=place_label, provider=provider)
        set_doc_id(doc_id)
        result = await generate_ai_bing_deck(access_token, site, days, label=label, provider=provider,
                                             images=images and images_enabled(),
                                             notes=notes, ai_perf_csv=ai_perf_csv,
                                             ai_perf_data=ai_perf_data, creativity=creativity,
                                             pipeline=pipeline, models=models, on_progress=on_progress)
        slides = await _finalize_and_preview(doc_id, result["html"], on_progress)
        return {"document_id": doc_id, "slides": slides, "label": result["domain"]}

    return StreamingResponse(_stream_deck_generation(run, current_user.email),
                             media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/api/presentation/ai-deck-ga4")
async def presentation_ai_deck_ga4(
    property_id: str,
    days: int = 28,
    provider: str = "deepseek",
    images: bool = True,
    label: str = "",
    body: dict = Body(default={}),
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI-designed website-analytics deck for a GA4 property, built from the logged-in
    user's Google Analytics data. Query: ?property_id=<id>&days=N&label=<display name>"""
    from services.report_generator import generate_ai_ga4_deck
    from services.ai_deck_service import render_slide_images
    from services.image_service import images_enabled
    from services.analytics_service import AnalyticsService
    _require_llm_key()
    token, is_refresh = _require_google_token(db, current_user.email)
    service = AnalyticsService.from_stored_token(token, is_refresh_token=is_refresh, user_email=current_user.email)
    notes = (body or {}).get("notes", "")
    creativity = (body or {}).get("creativity", "balanced")
    pipeline = (body or {}).get("pipeline", "single")
    models = _parse_models((body or {}).get("models"))
    place_label = label or _domain_of(property_id)

    async def run(on_progress, set_doc_id):
        doc_id = _create_deck_placeholder(current_user.email, source="ga4", label=place_label, provider=provider)
        set_doc_id(doc_id)
        result = await generate_ai_ga4_deck(service, property_id, days, label=label, provider=provider,
                                            images=images and images_enabled(),
                                            notes=notes, creativity=creativity,
                                            pipeline=pipeline, models=models, on_progress=on_progress)
        slides = await _finalize_and_preview(doc_id, result["html"], on_progress)
        return {"document_id": doc_id, "slides": slides, "label": result["domain"]}

    return StreamingResponse(_stream_deck_generation(run, current_user.email),
                             media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/api/presentation/ai-deck-ads")
async def presentation_ai_deck_ads(
    customer_id: str,
    days: int = 28,
    provider: str = "deepseek",
    images: bool = True,
    label: str = "",
    body: dict = Body(default={}),
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI-designed paid-search deck for a Google Ads account, built from the logged-in
    user's Google Ads data. Query: ?customer_id=<id>&days=N&label=<display name>"""
    from services.report_generator import generate_ai_ads_deck
    from services.ai_deck_service import render_slide_images
    from services.image_service import images_enabled
    from services.ads_service import ads_is_configured, AdsService
    _require_llm_key()
    if not ads_is_configured():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Google Ads is not configured — a developer token is required.")
    token, is_refresh = _require_google_token(db, current_user.email)
    if not is_refresh:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Google Ads requires a stored refresh token — reconnect your Google account.")
    service = AdsService.from_stored_token(token, is_refresh_token=is_refresh, user_email=current_user.email)
    notes = (body or {}).get("notes", "")
    creativity = (body or {}).get("creativity", "balanced")
    pipeline = (body or {}).get("pipeline", "single")
    models = _parse_models((body or {}).get("models"))
    place_label = label or _domain_of(customer_id)

    async def run(on_progress, set_doc_id):
        doc_id = _create_deck_placeholder(current_user.email, source="ads", label=place_label, provider=provider)
        set_doc_id(doc_id)
        result = await generate_ai_ads_deck(service, customer_id, days, label=label, provider=provider,
                                            images=images and images_enabled(),
                                            notes=notes, creativity=creativity,
                                            pipeline=pipeline, models=models, on_progress=on_progress)
        slides = await _finalize_and_preview(doc_id, result["html"], on_progress)
        return {"document_id": doc_id, "slides": slides, "label": result["domain"]}

    return StreamingResponse(_stream_deck_generation(run, current_user.email),
                             media_type="text/event-stream", headers=_SSE_HEADERS)
