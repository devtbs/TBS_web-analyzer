"""AI monthly SEO report route, built from SE Ranking data and saved as a Document."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status

from models.schemas import UserInfo
from auth.auth import get_current_user
from database import get_db, Document
from config import settings
from sqlalchemy.orm import Session

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
