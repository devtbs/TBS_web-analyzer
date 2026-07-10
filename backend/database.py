from sqlalchemy import create_engine, Column, String, DateTime, Text, JSON, Boolean, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database setup - DATABASE_URL must be set in .env file
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError(
        "DATABASE_URL environment variable is required. "
        "Please set it in your .env file. "
        "Example: DATABASE_URL=postgresql://user:password@localhost:5432/dbname"
    )

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,   # Checks connection health before use — prevents stale SSL crashes
    pool_recycle=1800,    # Recycle connections every 30 mins (before DB server drops them)
    pool_size=5,          # Max persistent connections in the pool
    max_overflow=10,      # Extra connections allowed under heavy load
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    """Database model for users"""
    __tablename__ = "users"
    
    email = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=True)
    picture = Column(String, nullable=True)
    gsc_token = Column(Text, nullable=True)  # Google Search Console OAuth token
    gsc_token_is_refresh = Column(Boolean, default=False, nullable=False)  # True = refresh token (permanent)
    gsc_connected_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_login = Column(DateTime, default=datetime.utcnow, nullable=False)


class GoogleAccount(Base):
    """A Google account (Gmail) connected to a TBS app user.

    One app user can connect multiple Google accounts. Each row stores the refresh token
    for one Gmail so the app can query GSC/GA4/Ads for that account without re-login.
    """
    __tablename__ = "google_accounts"
    __table_args__ = (UniqueConstraint("user_email", "google_email", name="uq_user_google"),)

    id            = Column(Integer, primary_key=True, autoincrement=True)
    user_email    = Column(String, ForeignKey("users.email"), index=True, nullable=False)
    google_email  = Column(String, nullable=False)
    display_name  = Column(String, nullable=True)
    picture       = Column(String, nullable=True)
    refresh_token = Column(Text, nullable=False)
    connected_at  = Column(DateTime, default=datetime.utcnow, nullable=False)


class BingAccount(Base):
    """A Bing Webmaster Tools account connected to a TBS app user via OAuth.

    Mirrors GoogleAccount: one app user can connect multiple Bing accounts (each often a
    Google-based Bing login). Each row stores the OAuth refresh token so the app can query
    Bing Webmaster data for that account without re-login. `label` is a user-facing name
    for the account (the sites it owns), since Bing's token response has no email/profile.
    """
    __tablename__ = "bing_accounts"
    __table_args__ = (UniqueConstraint("user_email", "label", name="uq_user_bing"),)

    id            = Column(Integer, primary_key=True, autoincrement=True)
    user_email    = Column(String, ForeignKey("users.email"), index=True, nullable=False)
    label         = Column(String, nullable=False)
    refresh_token = Column(Text, nullable=False)
    connected_at  = Column(DateTime, default=datetime.utcnow, nullable=False)


class Analysis(Base):
    """Database model for analysis results"""
    __tablename__ = "analyses"
    
    analysis_id = Column(String, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    urls = Column(JSON, nullable=False)  # List of URLs
    label = Column(String, nullable=True)  # Optional user-defined name for the analysis
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    status = Column(String, default="processing", nullable=False)
    
    # Analysis results stored as JSON
    scraped_data = Column(JSON, nullable=True)
    knowledge_graph = Column(JSON, nullable=True)
    topical_maps = Column(JSON, nullable=True)
    comparison = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)


class Document(Base):
    """Database model for generated documents (content briefs, etc)"""
    __tablename__ = "documents"
    
    id = Column(String, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    analysis_id = Column(String, index=True, nullable=True)
    title = Column(String, nullable=False)
    content_type = Column(String, default="Content Brief", nullable=False)
    content = Column(JSON, nullable=False)
    folder = Column(String, nullable=True)
    deadline = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class Audit(Base):
    """A technical-SEO crawl/audit run for one property."""
    __tablename__ = "audits"

    audit_id = Column(String, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    property_url = Column(String, nullable=False)
    status = Column(String, default="processing", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True, nullable=False)
    summary = Column(JSON, nullable=True)   # {pages_crawled, score, counts_by_severity, ...}
    issues = Column(JSON, nullable=True)    # [{type, severity, message, urls:[...]}]
    error = Column(Text, nullable=True)


class AlertRule(Base):
    """A user-configurable threshold for anomaly detection on a GSC property.

    property_url NULL means the rule applies to all of the user's properties.
    metric: clicks | impressions | ctr | position
    direction: drop | spike | worsen  (worsen used for position = rank going up)
    """
    __tablename__ = "alert_rules"

    id = Column(String, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    property_url = Column(String, nullable=True)
    metric = Column(String, nullable=False)
    direction = Column(String, nullable=False)
    threshold_pct = Column(String, nullable=False)  # stored as string; parsed to float
    enabled = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AlertEvent(Base):
    """A fired alert — something crossed a rule's threshold."""
    __tablename__ = "alert_events"

    id = Column(String, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    property_url = Column(String, index=True, nullable=False)
    type = Column(String, nullable=False)          # e.g. "clicks_drop"
    metric = Column(String, nullable=False)
    severity = Column(String, default="warning", nullable=False)  # info|warning|critical
    message = Column(String, nullable=False)
    data = Column(JSON, nullable=True)             # {current, previous, delta_pct}
    created_at = Column(DateTime, default=datetime.utcnow, index=True, nullable=False)
    read_at = Column(DateTime, nullable=True)


# Create tables
def init_db():
    """Initialize database tables"""
    Base.metadata.create_all(bind=engine)


# Dependency to get DB session
def get_db():
    """Get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
