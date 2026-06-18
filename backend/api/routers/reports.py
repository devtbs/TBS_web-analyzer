"""AI monthly report + template-driven presentation (PPTX) routes built from
SE Ranking data."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status, Body
from fastapi.responses import StreamingResponse

from models.schemas import UserInfo
from auth.auth import get_current_user
from database import get_db, Document
from config import settings
from sqlalchemy.orm import Session
from api.routers._shared import PPTX_MEDIA_TYPE, PDF_MEDIA_TYPE

router = APIRouter()


@router.post("/api/report/generate/{site_id}")
async def generate_report(
    site_id: int,
    days: int = 30,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate an AI monthly SEO report for a SE Ranking project, and save it as a Document."""
    from services.report_generator import generate_monthly_report
    if not settings.SERANKING_API_KEY:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SE Ranking not configured.")
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Anthropic (Claude) API key not configured — needed to write reports.")
    try:
        result = await generate_monthly_report(site_id, days)

        # Persist as a Document so it shows up in the existing Documents UI
        doc_id = str(uuid.uuid4())
        new_doc = Document(
            id=doc_id,
            user_email=current_user.email,
            title=f"Monthly SEO Report — {result['domain']}",
            content_type="SEO Report",
            content={
                "article_markdown": result["report_markdown"],
                "report_context": result["context"],
            },
        )
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)

        return {"status": "success", "document_id": doc_id, **result}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to generate report: {str(e)}")


@router.get("/api/presentation/sample")
async def presentation_sample(current_user: UserInfo = Depends(get_current_user)):
    """Download a branded sample Google Ads deck (placeholder data) — proves the
    rendering pipeline end-to-end without needing any client data or API key."""
    from services.presentation_generator import build_deck, sample_deck_data
    pptx_bytes = build_deck(sample_deck_data())
    return StreamingResponse(
        iter([pptx_bytes]),
        media_type=PPTX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="GoogleAds_Report_SAMPLE.pptx"'},
    )


@router.post("/api/presentation/generate")
async def presentation_generate(
    data: dict = Body(...),
    current_user: UserInfo = Depends(get_current_user),
):
    """Render a branded deck from a normalized deck-data dict and return the .pptx.

    The dict shape matches `presentation_generator.sample_deck_data()`. The content
    layer (LLM digesting a Looker Studio PDF / SE Ranking data into this shape)
    plugs in ahead of this route as those integrations come online.
    """
    from services.presentation_generator import build_deck
    try:
        pptx_bytes = build_deck(data)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Could not render deck — check the data shape: {str(e)}")
    company = (data.get("company") or "report").replace(" ", "_")
    return StreamingResponse(
        iter([pptx_bytes]),
        media_type=PPTX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="GoogleAds_Report_{company}.pptx"'},
    )


@router.post("/api/presentation/generate/{site_id}")
async def presentation_generate_from_site(
    site_id: int,
    days: int = 30,
    current_user: UserInfo = Depends(get_current_user),
):
    """Generate a branded SEO deck for a SE Ranking project, built from real data.

    Numbers come straight from SE Ranking; the prose is LLM-written (with a
    templated fallback if no LLM key is configured).
    """
    from services.report_generator import generate_deck
    if not settings.SERANKING_API_KEY:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SE Ranking not configured.")
    try:
        result = await generate_deck(site_id, days)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"Failed to generate deck: {str(e)}")
    domain = (result["domain"] or "report").replace(" ", "_")
    return StreamingResponse(
        iter([result["pptx_bytes"]]),
        media_type=PPTX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="SEO_Report_{domain}.pptx"'},
    )


@router.post("/api/presentation/ai-generate/{site_id}")
async def presentation_ai_generate(
    site_id: int,
    days: int = 30,
    length: int = 8,
    current_user: UserInfo = Depends(get_current_user),
):
    """AI-designed deck (SlideSpeak) built from real SE Ranking data — the AI
    composes layouts/visuals, not a fixed template."""
    from services.report_generator import generate_ai_deck
    if not settings.SERANKING_API_KEY:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SE Ranking not configured.")
    if not settings.SLIDESPEAK_API_KEY:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="SlideSpeak not configured — add SLIDESPEAK_API_KEY to generate AI decks.")
    try:
        result = await generate_ai_deck(site_id, days, length=length)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"AI deck generation failed: {str(e)}")
    domain = (result["domain"] or "report").replace(" ", "_")
    return StreamingResponse(
        iter([result["pptx_bytes"]]),
        media_type=PPTX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="AI_SEO_Report_{domain}.pptx"'},
    )


@router.post("/api/presentation/ai-deck/{site_id}")
async def presentation_ai_html_deck(
    site_id: int,
    days: int = 30,
    format: str = "pdf",
    body: dict = Body(default={}),
    current_user: UserInfo = Depends(get_current_user),
):
    """Free AI-designed deck from real data. The AI writes unique HTML (no fixed
    template); Chromium renders it to a downloadable file.

    Query: ?format=pdf|pptx. Optional JSON body: {"prompt","brand","structure"}
    to customise the Abacus-style prompt.
    """
    from services.report_generator import generate_ai_html_deck
    fmt = (format or "pdf").lower()
    if fmt not in ("pdf", "pptx"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="format must be 'pdf' or 'pptx'.")
    if not settings.SERANKING_API_KEY:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SE Ranking not configured.")
    if not (settings.DEEPSEEK_API_KEY or settings.GROQ_API_KEY):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No LLM key configured — add DEEPSEEK_API_KEY (cheap) or GROQ_API_KEY (free) to generate AI decks.")
    try:
        result = await generate_ai_html_deck(
            site_id, days, fmt=fmt,
            prompt=body.get("prompt"), brand=body.get("brand"), structure=body.get("structure"),
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"AI deck generation failed: {str(e)}")
    domain = (result["domain"] or "report").replace(" ", "_")
    media = PDF_MEDIA_TYPE if fmt == "pdf" else PPTX_MEDIA_TYPE
    return StreamingResponse(
        iter([result["file_bytes"]]),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="AI_Report_{domain}.{fmt}"'},
    )
