"""Content routes: generate articles/briefs from an analysis, plus document and
folder CRUD."""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request, Body
from pydantic import BaseModel
from sqlalchemy.orm import Session

from models.schemas import UserInfo, BriefRequest, DocumentResponse, DocumentDetailResponse
from auth.auth import get_current_user
from services.brief_generator import generate_content_brief
from utils.storage import database_store
from database import get_db, Document

router = APIRouter()


@router.post("/api/article/{analysis_id}")
async def create_full_article_direct(
    analysis_id: str,
    request: BriefRequest,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generate a content brief, then generate the full article immediately."""
    from services.brief_generator import generate_content_brief, generate_full_article

    analysis = database_store.get_analysis(db, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    if analysis['user_email'] != current_user.email:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    try:
        # 1. Generate the brief to give AI context and structure
        brief = await generate_content_brief(
            topic=request.topic,
            category=request.category,
            article_type=request.article_type
        )

        # 2. Automatically generate the full article based on the brief
        article_markdown = await generate_full_article(
            topic=request.topic,
            brief_data=brief,
            system_prompt=getattr(request, 'system_prompt', None),
            language=getattr(request, 'language', 'en'),
            tone=getattr(request, 'tone', 'professional'),
            length=getattr(request, 'length', 'medium'),
            audience=getattr(request, 'audience', ''),
            custom_instructions=getattr(request, 'custom_instructions', ''),
        )

        brief["article_markdown"] = article_markdown

        # Save to database
        doc_id = str(uuid.uuid4())
        new_doc = Document(
            id=doc_id,
            user_email=current_user.email,
            analysis_id=analysis_id,
            title=request.topic,
            content_type="Full Article",
            content=brief
        )
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)

        return {"status": "success", "article": article_markdown, "document_id": doc_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate article: {str(e)}")


# Keep the old /api/brief just in case, but we will migrate the UI to /api/article.
@router.post("/api/brief/{analysis_id}")
async def create_content_brief(
    analysis_id: str,
    request: BriefRequest,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generate an AI content brief for a specific topic"""
    analysis = database_store.get_analysis(db, analysis_id)

    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis not found"
        )

    if analysis['user_email'] != current_user.email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )

    try:
        brief = await generate_content_brief(
            topic=request.topic,
            category=request.category,
            article_type=request.article_type
        )

        # Save to database
        doc_id = str(uuid.uuid4())
        new_doc = Document(
            id=doc_id,
            user_email=current_user.email,
            analysis_id=analysis_id,
            title=request.topic,
            content_type="Content Brief",
            content=brief
        )
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)

        return {"status": "success", "brief": brief, "document_id": doc_id}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate brief: {str(e)}"
        )


# ============= Document Routes =============

@router.post("/api/documents", response_model=DocumentDetailResponse)
async def create_document(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new empty document"""
    doc_id = str(uuid.uuid4())
    new_doc = Document(
        id=doc_id,
        user_email=current_user.email,
        title="Untitled Document",
        content_type="Full Article",
        content={"article_markdown": ""}
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)
    return new_doc


@router.get("/api/documents", response_model=List[DocumentResponse])
async def list_documents(
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all saved documents (content briefs) for the current user.

    For AI-Deck docs we surface content.status (generating|done|error) so the Documents
    list can show a live status chip; the nested JSON field isn't reachable via ORM
    attribute mapping, so build the response objects explicitly."""
    documents = db.query(Document).filter(Document.user_email == current_user.email).order_by(Document.updated_at.desc()).all()
    out = []
    for doc in documents:
        item = DocumentResponse.model_validate(doc)
        if doc.content_type == "AI Deck":
            item.status = (doc.content or {}).get("status")
        out.append(item)
    return out


@router.get("/api/documents/{document_id}", response_model=DocumentDetailResponse)
async def get_document(
    document_id: str,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific document by ID"""
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if doc.user_email != current_user.email:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return doc


@router.put("/api/documents/{document_id}", response_model=DocumentDetailResponse)
async def update_document(
    document_id: str,
    request: Request,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a specific document's content"""
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if doc.user_email != current_user.email:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    update_data = await request.json()

    if "content" in update_data:
        new_content = {**(doc.content or {})}
        new_content.update(update_data.get("content", {}))  # type: ignore
        doc.content = new_content

    if "folder" in update_data:
        doc.folder = update_data.get("folder")

    if "title" in update_data:
        doc.title = update_data.get("title")

    if "deadline" in update_data:
        deadline_val = update_data.get("deadline")
        if deadline_val:
            try:
                # Handle ISO format strings from frontend (replace Z with +00:00 for older Python versions)
                iso_str = deadline_val.replace("Z", "+00:00")
                from datetime import datetime
                doc.deadline = datetime.fromisoformat(iso_str)
            except Exception as e:
                print(f"Error parsing deadline: {e}")
                doc.deadline = None
        else:
            doc.deadline = None

    db.commit()
    return doc


@router.delete("/api/documents/{document_id}")
async def delete_document(
    document_id: str,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a specific document"""
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if doc.user_email != current_user.email:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    db.delete(doc)
    db.commit()
    return {"status": "success", "message": "Document deleted"}


@router.put("/api/folders/{folder_name}")
async def rename_folder(
    folder_name: str,
    new_name: str = Body(..., embed=True),
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Rename a folder (updates all docs for this user)"""
    db.query(Document).filter(
        Document.folder == folder_name,
        Document.user_email == current_user.email
    ).update({Document.folder: new_name})
    db.commit()
    return {"status": "success", "message": f"Folder renamed to {new_name}"}


@router.delete("/api/folders/{folder_name}")
async def delete_folder(
    folder_name: str,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a folder (unsets folder for matching docs)"""
    db.query(Document).filter(
        Document.folder == folder_name,
        Document.user_email == current_user.email
    ).update({Document.folder: None})
    db.commit()
    return {"status": "success", "message": f"Folder {folder_name} deleted (documents kept)"}


@router.post("/api/documents/{document_id}/generate-article")
async def create_full_article(
    document_id: str,
    request: Request,
    current_user: UserInfo = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generate a full article from a saved content brief"""
    from services.brief_generator import generate_full_article

    doc = db.query(Document).filter(
        Document.id == document_id,
        Document.user_email == current_user.email
    ).first()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if not doc.content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Document has no brief content to generate from.")

    # Accept an optional JSON body for prompt / language / style overrides
    class _ArticleOptions(BaseModel):
        system_prompt: Optional[str] = None
        language: Optional[str] = "en"
        tone: Optional[str] = "professional"
        length: Optional[str] = "medium"
        audience: Optional[str] = ""
        custom_instructions: Optional[str] = ""

    try:
        body = await request.json()
        opts = _ArticleOptions(**body)
    except Exception:
        opts = _ArticleOptions()

    try:
        article_markdown = await generate_full_article(
            topic=doc.title,
            brief_data=doc.content,
            system_prompt=opts.system_prompt,
            language=opts.language,
            tone=opts.tone,
            length=opts.length,
            audience=opts.audience,
            custom_instructions=opts.custom_instructions,
        )

        # Update the document
        doc_data = dict(doc.content) if isinstance(doc.content, dict) else {}
        doc_data["article_markdown"] = article_markdown

        doc.content = doc_data
        doc.content_type = "Full Article"
        db.commit()

        return {"status": "success", "article": article_markdown}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
