import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routers import (
    auth, gsc, analytics, ads, ranking, reports, decks, analysis, content, alerts, audit, accounts,
)
from config import settings
from database import init_db

# Surface application (services.*) INFO logs — without this the root logger defaults
# to WARNING and our diagnostics (deck continuation, validation/repair) never print.
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s: %(message)s")

# Create FastAPI app
app = FastAPI(
    title="Web Analysis Platform API",
    description="AI-powered website analysis with knowledge graphs and topical mapping",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    """Initialize database tables on startup"""
    init_db()

    # Bound the executor that runs blocking Google API calls (asyncio.to_thread).
    # The Google client's underlying HTTP layer is not thread-safe; an unbounded burst
    # (e.g. dashboards fetching dozens of properties at once) can spawn enough
    # concurrent threads to crash the process. Cap it to a safe, still-parallel size.
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    asyncio.get_running_loop().set_default_executor(
        ThreadPoolExecutor(max_workers=8, thread_name_prefix="google-io")
    )

    # Daily anomaly-detection job. In-process scheduler — run the backend
    # single-worker, or each gunicorn worker would schedule its own copy.
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
        from services.alert_service import evaluate_all_users

        scheduler = AsyncIOScheduler()
        scheduler.add_job(evaluate_all_users, CronTrigger(hour=7, minute=0),
                          id="daily_alerts", replace_existing=True)
        scheduler.start()
        app.state.scheduler = scheduler
        print("⏰ Alert scheduler started (daily 07:00)")
    except Exception as e:
        print(f"⚠️  Alert scheduler not started: {e}")

    print("✅ Database initialized successfully")
    print(f"🌍 Allowed Origins: {settings.allowed_origins_list}")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes — one router per domain (paths unchanged, mounted with no prefix)
for _router in (auth, gsc, analytics, ads, ranking, reports, decks, analysis, content, alerts, audit, accounts):
    app.include_router(_router.router)


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return None

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Web Analysis Platform API",
        "version": "2.0.0",
        "status": "running",
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "environment": settings.ENVIRONMENT
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True if settings.ENVIRONMENT == "development" else False
    )
