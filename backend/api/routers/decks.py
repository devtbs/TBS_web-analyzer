"""AI deck generation routes (HTML-based): generate from PDF or GSC data, preview
saved decks, download, and manage AI providers + prompt library."""
from fastapi import APIRouter, Depends, HTTPException, status, Body, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from models.schemas import UserInfo
from auth.auth import get_current_user
from database import get_db, Document
from config import settings
from api.routers._shared import (
    PPTX_MEDIA_TYPE, PDF_MEDIA_TYPE, _SSE_HEADERS,
    _save_deck_document, _slides_payload, _stream_deck_generation,
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
    prompt_id: str = Form("default"),
    images: bool = Form(True),
    notes: str = Form(""),
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a report PDF → AI extracts its data and designs a deck. Returns the
    deck HTML for preview and saves it to Documents; download via the deck-download route.

    Form fields: file (the PDF), provider, prompt_id.
    """
    from services.ai_deck_service import generate_deck_from_pdf, render_slide_images
    from services.image_service import images_enabled
    from services.prompt_config import get_prompt_text
    if not (settings.DEEPSEEK_API_KEY or settings.GROQ_API_KEY):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No LLM key configured — add DEEPSEEK_API_KEY (cheap) or GROQ_API_KEY (free).")
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file.")
    label = (file.filename or "report").rsplit(".", 1)[0][:60] or "report"

    async def run(on_progress):
        result = await generate_deck_from_pdf(pdf_bytes, provider=provider,
                                              prompt=get_prompt_text(prompt_id), render=False,
                                              images=images and images_enabled(),
                                              notes=notes, on_progress=on_progress)
        slides = await render_slide_images(result["html"], on_progress=on_progress)
        doc_id = _save_deck_document(db, current_user.email, html=result["html"], source="pdf",
                                     label=label, provider=provider, prompt_id=prompt_id)
        return {"document_id": doc_id, "slides": _slides_payload(slides), "label": label}

    return StreamingResponse(_stream_deck_generation(run), media_type="text/event-stream",
                             headers=_SSE_HEADERS)


@router.get("/api/presentation/ai-providers")
async def presentation_ai_providers(current_user: UserInfo = Depends(get_current_user)):
    """Which AI providers are configured (have a key) — for the UI picker."""
    from services.ai_service import AIService
    return {"providers": AIService.configured_providers()}


@router.get("/api/presentation/prompts")
async def list_prompts_route(current_user: UserInfo = Depends(get_current_user)):
    """List selectable prompts (built-in default + saved) and the default's text."""
    from services.prompt_config import list_prompts, default_prompt
    return {"prompts": list_prompts(), "default_prompt": default_prompt()}


@router.get("/api/presentation/prompts/{prompt_id}")
async def get_prompt_route(prompt_id: str, current_user: UserInfo = Depends(get_current_user)):
    """Get one prompt's full text (use 'default' for the built-in)."""
    from services.prompt_config import get_prompt
    return get_prompt(prompt_id)


@router.post("/api/presentation/prompts")
async def save_prompt_route(body: dict = Body(...), current_user: UserInfo = Depends(get_current_user)):
    """Save a prompt. Body: {name, prompt, id?}. With id → update; without → create new.
    The required HTML output contract is always applied automatically — no need to include it."""
    from services.prompt_config import upsert_prompt, list_prompts
    if not (body.get("prompt") or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt text is required.")
    saved = upsert_prompt(body.get("name", ""), body["prompt"], body.get("id"))
    return {"status": "saved", "saved": saved, "prompts": list_prompts()}


@router.delete("/api/presentation/prompts/{prompt_id}")
async def delete_prompt_route(prompt_id: str, current_user: UserInfo = Depends(get_current_user)):
    from services.prompt_config import delete_prompt, list_prompts
    delete_prompt(prompt_id)
    return {"status": "deleted", "prompts": list_prompts()}


@router.post("/api/presentation/ai-deck-gsc")
async def presentation_ai_deck_gsc(
    property: str,
    days: int = 28,
    provider: str = "deepseek",
    prompt_id: str = "default",
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
    from services.prompt_config import get_prompt_text
    from utils.user_manager import get_user_gsc_token
    if not (settings.DEEPSEEK_API_KEY or settings.GROQ_API_KEY):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No LLM key configured — add DEEPSEEK_API_KEY (cheap) or GROQ_API_KEY (free).")
    gsc_token, is_refresh = get_user_gsc_token(db, current_user.email)
    if not gsc_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Google Search Console not connected for this account.")
    prompt = get_prompt_text(prompt_id)
    service = GSCService.from_stored_token(gsc_token, is_refresh_token=is_refresh, user_email=current_user.email)
    notes = (body or {}).get("notes", "")

    async def run(on_progress):
        result = await generate_ai_gsc_deck(service, property, days, provider=provider, prompt=prompt,
                                            images=images and images_enabled(),
                                            notes=notes, on_progress=on_progress)
        slides = await render_slide_images(result["html"], on_progress=on_progress)
        doc_id = _save_deck_document(db, current_user.email, html=result["html"], source="gsc",
                                     label=result["domain"], provider=provider, prompt_id=prompt_id)
        return {"document_id": doc_id, "slides": _slides_payload(slides), "label": result["domain"]}

    return StreamingResponse(_stream_deck_generation(run), media_type="text/event-stream",
                             headers=_SSE_HEADERS)
