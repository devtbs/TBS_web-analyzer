"""SE Ranking routes.

SE Ranking uses TBS's single account API key (settings.SERANKING_API_KEY), shared
across the tool — no per-user OAuth. These power true keyword rank tracking.
"""
from fastapi import APIRouter, Depends, HTTPException, status

from models.schemas import UserInfo
from auth.auth import get_current_user
from config import settings

router = APIRouter()


@router.get("/api/seranking/status")
async def seranking_status(current_user: UserInfo = Depends(get_current_user)):
    """Quick check that the SE Ranking key is configured and valid (lists 1 project)."""
    from services.seranking_service import SERankingService
    if not settings.SERANKING_API_KEY:
        return {"configured": False, "message": "SERANKING_API_KEY not set."}
    try:
        projects = await SERankingService().get_projects()
        return {"configured": True, "connected": True, "project_count": len(projects)}
    except Exception as e:
        return {"configured": True, "connected": False, "error": str(e)}


@router.get("/api/seranking/projects")
async def seranking_projects(current_user: UserInfo = Depends(get_current_user)):
    """List SE Ranking projects (tracked client sites)."""
    from services.seranking_service import SERankingService
    if not settings.SERANKING_API_KEY:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SE Ranking not configured (SERANKING_API_KEY missing).")
    try:
        projects = await SERankingService().get_projects()
        return {"projects": projects, "total": len(projects)}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch SE Ranking projects: {str(e)}")


@router.get("/api/seranking/positions/{site_id}")
async def seranking_positions(
    site_id: int,
    days: int = 30,
    current_user: UserInfo = Depends(get_current_user),
):
    """Get keyword positions + summary for one SE Ranking project."""
    from services.seranking_service import SERankingService
    if not settings.SERANKING_API_KEY:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SE Ranking not configured (SERANKING_API_KEY missing).")
    try:
        data = await SERankingService().get_keyword_positions(site_id, days)
        return data
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch SE Ranking positions: {str(e)}")
