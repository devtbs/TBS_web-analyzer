"""Authentication routes: Google OAuth login, dev login, logout, current user."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from models.schemas import TokenResponse, UserInfo
from auth.auth import verify_google_token, create_access_token, get_current_user
from database import get_db
from config import settings

router = APIRouter()


@router.post("/auth/google/login", response_model=TokenResponse)
async def google_login(request: dict, db: Session = Depends(get_db)):
    """Login with Google OAuth token"""
    from utils.user_manager import get_or_create_user

    token = request.get('token')
    if not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token is required"
        )

    # Verify Google token
    user_info = await verify_google_token(token)

    # Create or update user in database
    db_user = get_or_create_user(
        db,
        email=user_info.email,
        name=user_info.name,
        picture=user_info.picture
    )

    # Create JWT access token
    access_token = create_access_token(
        data={
            "sub": user_info.email,
            "name": user_info.name,
            "picture": user_info.picture,
            "gsc_connected": db_user.gsc_token is not None
        }
    )

    return TokenResponse(
        access_token=access_token,
        user=user_info
    )


@router.post("/auth/dev-login", response_model=TokenResponse)
async def dev_login():
    """Local development only: mint a JWT without Google OAuth so the app is usable
    on localhost (where Google sign-in isn't configured). Disabled outside development."""
    if settings.ENVIRONMENT != "development":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    user_info = UserInfo(email="dev@tbs-local", name="Local Dev", picture=None)
    access_token = create_access_token(
        data={"sub": user_info.email, "name": user_info.name}
    )
    return TokenResponse(access_token=access_token, user=user_info)


@router.post("/auth/logout")
async def logout(current_user: UserInfo = Depends(get_current_user)):
    """Logout user"""
    return {"message": "Successfully logged out"}


@router.get("/auth/me", response_model=UserInfo)
async def get_me(current_user: UserInfo = Depends(get_current_user)):
    """Get current user info"""
    return current_user
