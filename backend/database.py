from sqlalchemy import create_engine, Column, String, DateTime, Text, JSON, Boolean
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
