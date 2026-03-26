"""User management utilities"""
from sqlalchemy.orm import Session
from database import User
from datetime import datetime
from typing import Optional


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
