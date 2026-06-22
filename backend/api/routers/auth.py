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
    """Login with Google.

    Two modes:
      • Authorization-code flow (preferred): the frontend sends `code` from a consent
        that includes the Search Console + Analytics scopes. We exchange it for tokens,
        verify identity from the returned id_token, and store the refresh token — so the
        signed-in account is *also* the data account (GSC/GA4 just work, no extra step).
      • Legacy id-token flow: the frontend sends `token` (identity only, no data scopes).
    """
    from utils.user_manager import get_or_create_user, update_gsc_token
    import requests as http_requests

    code = request.get('code')
    token = request.get('token')

    refresh_token = None
    access_token_g = None

    if code:
        # Exchange the authorization code for id/access/refresh tokens.
        token_response = http_requests.post(
            'https://oauth2.googleapis.com/token',
            data={
                'code': code,
                'client_id': settings.GOOGLE_CLIENT_ID,
                'client_secret': settings.GOOGLE_CLIENT_SECRET,
                'redirect_uri': 'postmessage',  # Required for popup/ux_mode flows
                'grant_type': 'authorization_code',
            },
        )
        token_data = token_response.json()
        if 'error' in token_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Google token exchange failed: {token_data.get('error_description', token_data['error'])}"
            )

        id_tok = token_data.get('id_token')
        if not id_tok:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No id_token returned from Google."
            )
        user_info = await verify_google_token(id_tok)
        refresh_token = token_data.get('refresh_token')
        access_token_g = token_data.get('access_token')
    elif token:
        # Identity-only login (no data scopes).
        user_info = await verify_google_token(token)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either 'code' or 'token' is required"
        )

    # Create or update user in database
    db_user = get_or_create_user(
        db,
        email=user_info.email,
        name=user_info.name,
        picture=user_info.picture
    )

    # Persist the Google data credential so GSC/GA4 follow the login account.
    # Google only returns a refresh_token on first consent — keep the existing stored
    # refresh token on subsequent logins rather than overwriting it with nothing.
    if refresh_token:
        update_gsc_token(db, user_info.email, refresh_token, is_refresh_token=True)
        db.refresh(db_user)

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
