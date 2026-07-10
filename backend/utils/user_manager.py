"""User management utilities"""
from sqlalchemy.orm import Session
from database import User, GoogleAccount, BingAccount
from datetime import datetime
from typing import Optional, List, Dict


def get_or_create_user(db: Session, email: str, name: str = None, picture: str = None) -> User:
    """Get existing user or create new one"""
    user = db.query(User).filter(User.email == email).first()
    
    if user:
        # Update last login and user info
        user.last_login = datetime.utcnow()
        if name:
            user.name = name
        if picture:
            user.picture = picture
        db.commit()
        db.refresh(user)
    else:
        # Create new user
        user = User(
            email=email,
            name=name,
            picture=picture,
            created_at=datetime.utcnow(),
            last_login=datetime.utcnow()
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    
    return user


def update_gsc_token(db: Session, email: str, gsc_token: str, is_refresh_token: bool = False) -> User:
    """
    Update user's GSC token.
    
    Args:
        gsc_token: The token to store (either a refresh token or access token).
        is_refresh_token: True if this is a refresh token (permanent), False if access token (short-lived).
    """
    user = db.query(User).filter(User.email == email).first()
    
    if not user:
        raise ValueError(f"User {email} not found")
    
    user.gsc_token = gsc_token
    user.gsc_token_is_refresh = is_refresh_token
    user.gsc_connected_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    
    return user


def clear_gsc_token(db: Session, email: str) -> User:
    """Clear user's GSC token"""
    user = db.query(User).filter(User.email == email).first()
    
    if not user:
        raise ValueError(f"User {email} not found")
    
    user.gsc_token = None
    user.gsc_token_is_refresh = False
    user.gsc_connected_at = None
    db.commit()
    db.refresh(user)
    
    return user


def get_user_gsc_token(db: Session, email: str) -> Optional[tuple]:
    """
    Get user's GSC token if it exists.

    Returns:
        Tuple of (token_string, is_refresh_token) or (None, False).
    """
    user = db.query(User).filter(User.email == email).first()

    if user and user.gsc_token:
        is_refresh = getattr(user, 'gsc_token_is_refresh', False) or False
        return user.gsc_token, is_refresh

    return None, False


# ---------------------------------------------------------------------------
# Multi-Google-account helpers
# ---------------------------------------------------------------------------

def upsert_google_account(
    db: Session,
    user_email: str,
    google_email: str,
    refresh_token: str,
    display_name: str = None,
    picture: str = None,
) -> GoogleAccount:
    """Insert or update a connected Google account for a TBS user."""
    acct = (
        db.query(GoogleAccount)
        .filter(GoogleAccount.user_email == user_email, GoogleAccount.google_email == google_email)
        .first()
    )
    if acct:
        acct.refresh_token = refresh_token
        acct.connected_at = datetime.utcnow()
        if display_name:
            acct.display_name = display_name
        if picture:
            acct.picture = picture
    else:
        acct = GoogleAccount(
            user_email=user_email,
            google_email=google_email,
            refresh_token=refresh_token,
            display_name=display_name,
            picture=picture,
        )
        db.add(acct)
    db.commit()
    db.refresh(acct)
    return acct


def get_google_accounts(db: Session, user_email: str) -> List[Dict]:
    """Return all connected Google accounts for a TBS user (tokens excluded)."""
    rows = (
        db.query(GoogleAccount)
        .filter(GoogleAccount.user_email == user_email)
        .order_by(GoogleAccount.connected_at)
        .all()
    )
    return [
        {
            "id": r.id,
            "google_email": r.google_email,
            "display_name": r.display_name,
            "picture": r.picture,
            "connected_at": r.connected_at.isoformat() if r.connected_at else None,
        }
        for r in rows
    ]


def get_google_account_token(db: Session, user_email: str, account_id: int) -> Optional[str]:
    """Return the refresh token for a specific connected Google account."""
    acct = (
        db.query(GoogleAccount)
        .filter(GoogleAccount.user_email == user_email, GoogleAccount.id == account_id)
        .first()
    )
    return acct.refresh_token if acct else None


def delete_google_account(db: Session, user_email: str, account_id: int) -> bool:
    """Disconnect a Google account. Returns True if deleted, False if not found."""
    acct = (
        db.query(GoogleAccount)
        .filter(GoogleAccount.user_email == user_email, GoogleAccount.id == account_id)
        .first()
    )
    if not acct:
        return False
    db.delete(acct)
    db.commit()
    return True


# ---------------------------------------------------------------------------
# Bing Webmaster account helpers (mirror the Google helpers above)
# ---------------------------------------------------------------------------

def upsert_bing_account(
    db: Session,
    user_email: str,
    label: str,
    refresh_token: str,
) -> BingAccount:
    """Insert or update a connected Bing Webmaster account for a TBS user."""
    acct = (
        db.query(BingAccount)
        .filter(BingAccount.user_email == user_email, BingAccount.label == label)
        .first()
    )
    if acct:
        acct.refresh_token = refresh_token
        acct.connected_at = datetime.utcnow()
    else:
        acct = BingAccount(
            user_email=user_email,
            label=label,
            refresh_token=refresh_token,
        )
        db.add(acct)
    db.commit()
    db.refresh(acct)
    return acct


def get_bing_accounts(db: Session, user_email: str) -> List[Dict]:
    """Return all connected Bing accounts for a TBS user (tokens excluded)."""
    rows = (
        db.query(BingAccount)
        .filter(BingAccount.user_email == user_email)
        .order_by(BingAccount.connected_at)
        .all()
    )
    return [
        {
            "id": r.id,
            "label": r.label,
            "connected_at": r.connected_at.isoformat() if r.connected_at else None,
        }
        for r in rows
    ]


def get_bing_account_token(db: Session, user_email: str, account_id: int) -> Optional[str]:
    """Return the refresh token for a specific connected Bing account."""
    acct = (
        db.query(BingAccount)
        .filter(BingAccount.user_email == user_email, BingAccount.id == account_id)
        .first()
    )
    return acct.refresh_token if acct else None


def delete_bing_account(db: Session, user_email: str, account_id: int) -> bool:
    """Disconnect a Bing account. Returns True if deleted, False if not found."""
    acct = (
        db.query(BingAccount)
        .filter(BingAccount.user_email == user_email, BingAccount.id == account_id)
        .first()
    )
    if not acct:
        return False
    db.delete(acct)
    db.commit()
    return True
