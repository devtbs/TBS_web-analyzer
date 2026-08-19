from sqlalchemy import create_engine, Column, String, DateTime, Date, Text, JSON, Boolean, Integer, ForeignKey, UniqueConstraint
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
    # Optional link to a Client (agency book). Standalone id, not an FK — the Client table is
    # intentionally FK-free. NULL = unlinked. On existing DBs this column is added via a one-time
    # manual ALTER (create_all() never ALTERs an existing table).
    client_id = Column(String, index=True, nullable=True)
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


class Client(Base):
    """A managed client — one business, with the platform assets that belong to it.

    The agency thinks in clients, not properties. This is a self-contained MAPPING row: it links a
    client name/domain to its GSC property, GA4 property, Ads customer and Bing site, plus the brand
    terms to exclude. It deliberately has NO foreign keys INTO analyses/documents/audits — the app
    still runs off the resolved property ids, so no existing table needs altering (create_all only
    adds missing tables, it never ALTERs). Rows auto-seed from GSC properties across every connected
    account, which is also what makes a 2nd/3rd Google account's sites visible in one place.

    `google_account_id` names which connected account owns the assets (NULL = the primary token on
    the User row), so a client resolves to the right token even across multiple Gmails.
    """
    __tablename__ = "clients"
    # One client per GSC property per user, so auto-seed is idempotent (re-seeding creates no dupes).
    __table_args__ = (UniqueConstraint("user_email", "gsc_property", name="uq_user_client_gsc"),)

    id                = Column(String, primary_key=True, index=True)
    user_email        = Column(String, index=True, nullable=False)
    name              = Column(String, nullable=False)
    domain            = Column(String, nullable=True)
    google_account_id = Column(Integer, nullable=True)   # NULL = primary token; else GoogleAccount.id
    gsc_property      = Column(String, nullable=True)
    ga4_property_id   = Column(String, nullable=True)
    ads_customer_id   = Column(String, nullable=True)
    bing_site         = Column(String, nullable=True)
    brand_terms       = Column(Text, nullable=True)
    archived          = Column(Boolean, default=False, nullable=False)
    created_at        = Column(DateTime, default=datetime.utcnow, nullable=False)


class ResearchRun(Base):
    """A saved keyword-research session from the research wizard.

    Persists the whole wizard state (site, market, AI queries, competitors, keywords, clusters, plus
    which items were selected and the current step) as one JSON `state` blob so a run can be reopened
    and continued later, or revisited from the client hub. `client_id` optionally ties it to a Client
    (standalone id, not an FK — same convention as Document). `analysis_id` is set once the topical map
    is built from the run. New table — create_all() adds it; no existing table is altered.
    """
    __tablename__ = "research_runs"

    id          = Column(String, primary_key=True, index=True)
    user_email  = Column(String, index=True, nullable=False)
    client_id   = Column(String, index=True, nullable=True)
    name        = Column(String, nullable=False)
    domain      = Column(String, index=True, nullable=True)
    site_url    = Column(String, nullable=True)
    gl          = Column(String, nullable=True)
    location_id = Column(Integer, nullable=True)
    step        = Column(Integer, default=1, nullable=False)
    state       = Column(JSON, nullable=False)   # full wizard state (see ResearchWizard.jsx)
    analysis_id = Column(String, index=True, nullable=True)   # set once the map is built
    created_at  = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TrackedKeyword(Base):
    """A keyword whose Google position we monitor over time (self-hosted rank tracker — replaces the
    SE Ranking dependency). One row per keyword per client/site/market. `client_id` is a standalone id
    (not an FK), same convention as Document/ResearchRun. New table — create_all() adds it."""
    __tablename__ = "tracked_keywords"
    __table_args__ = (UniqueConstraint("user_email", "client_id", "keyword", "location_id",
                                       name="uq_tracked_keyword"),)

    id          = Column(Integer, primary_key=True, autoincrement=True)
    user_email  = Column(String, index=True, nullable=False)
    client_id   = Column(String, index=True, nullable=True)
    domain      = Column(String, index=True, nullable=False)   # the site we look for in the SERP
    keyword     = Column(String, nullable=False)
    gl          = Column(String, nullable=True)                # SERP country code (th/us/uk…)
    location_id = Column(Integer, nullable=True)               # kept for parity with research market
    active      = Column(Boolean, default=True, nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow, nullable=False)


class RankSnapshot(Base):
    """One position reading for a TrackedKeyword on a given day. position NULL = not in the top 100.
    Unique on (tracked_keyword_id, checked_on) so a same-day re-run updates rather than duplicates."""
    __tablename__ = "rank_snapshots"
    __table_args__ = (UniqueConstraint("tracked_keyword_id", "checked_on", name="uq_rank_snapshot_day"),)

    id                = Column(Integer, primary_key=True, autoincrement=True)
    tracked_keyword_id = Column(Integer, index=True, nullable=False)
    checked_on        = Column(Date, index=True, nullable=False)
    position          = Column(Integer, nullable=True)   # 1-100, or NULL = outside top 100
    url               = Column(Text, nullable=True)      # the ranking URL on our domain
    created_at        = Column(DateTime, default=datetime.utcnow, nullable=False)


class SerpSnapshot(Base):
    """The FULL SERP behind a rank check, kept instead of discarded.

    The rank probe already pays SerpAPI for the whole top-100 page and previously read only our own
    position out of it. Storing the rest costs no extra API spend and is what powers SERP
    competitors, share of voice, visibility, SERP features and the AI Overview tracker.
    """
    __tablename__ = "serp_snapshots"
    __table_args__ = (UniqueConstraint("tracked_keyword_id", "checked_on", name="uq_serp_snapshot_day"),)

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    tracked_keyword_id = Column(Integer, index=True, nullable=False)
    checked_on         = Column(Date, index=True, nullable=False)
    organic            = Column(JSON, nullable=True)   # [{position, domain, url, title}] top 100
    features           = Column(JSON, nullable=True)   # {featured_snippet, paa, local_pack, ...}
    ai_overview        = Column(JSON, nullable=True)   # {present, cited, sources:[{domain,url,title}]}
    created_at         = Column(DateTime, default=datetime.utcnow, nullable=False)


class RankRunMarker(Base):
    """One row per day the collector has claimed. gunicorn runs -w 4 and each worker starts its own
    scheduler; the collector INSERTs today's marker first and bails if the insert conflicts, so only
    one worker actually spends SerpAPI credits."""
    __tablename__ = "rank_run_markers"

    run_on     = Column(Date, primary_key=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ClusteringRun(Base):
    """A keyword-clustering job + its saved result (Keyword-Insights-style SERP-overlap clustering).

    Doubles as the async job store: the POST creates a `queued` row, a background task flips it to
    `running` (updating `progress`) then `done`/`error`, and the frontend polls the row. Persisting the
    result matters because SERP fetching is expensive (1 SerpAPI credit per keyword) — a run must never
    be throwaway. `client_id` is a standalone id (same convention as ResearchRun). create_all() adds it.
    """
    __tablename__ = "clustering_runs"

    id          = Column(String, primary_key=True, index=True)
    user_email  = Column(String, index=True, nullable=False)
    client_id   = Column(String, index=True, nullable=True)
    name        = Column(String, nullable=False)
    domain      = Column(String, nullable=True)
    gl          = Column(String, nullable=True)
    location_id = Column(Integer, nullable=True)
    params      = Column(JSON, nullable=True)   # {min_overlap, top_n, mode, keyword_count}
    status      = Column(String, default="queued", nullable=False)  # queued|running|done|error
    progress    = Column(JSON, nullable=True)   # {done, total}
    result      = Column(JSON, nullable=True)   # [{pillar, intent, brief, gsc_status, keywords:[...]}]
    error       = Column(Text, nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)



class ChatSession(Base):
    """One assistant conversation. Kept server-side so a refresh (or another device)
    doesn't lose the thread — the widget only held messages in React state before."""
    __tablename__ = "chat_sessions"

    id         = Column(String, primary_key=True, index=True)
    user_email = Column(String, index=True, nullable=False)
    title      = Column(String, nullable=True)   # first user message, trimmed
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, index=True, nullable=False)


class ChatMessage(Base):
    """A single turn in a ChatSession. Tool calls are not stored — only what the user sees."""
    __tablename__ = "chat_messages"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, index=True, nullable=False)
    role       = Column(String, nullable=False)   # user | assistant
    content    = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


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
