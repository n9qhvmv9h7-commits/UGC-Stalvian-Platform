"""Stalvian UGC Creator Platform — FastAPI entry point."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from app.config import settings
from app.database import engine
from app.models import Base

logging.basicConfig(level=logging.INFO)


def _migrate(conn):
    """Additive column migrations — create_all never ALTERs existing tables.

    Existing creators predate application review and are grandfathered in as
    'approved' via the column default; new signups get 'pending' from the model.
    """
    inspector = inspect(conn)
    tables = inspector.get_table_names()
    ddl = {
        "creators": {
            "status": "ALTER TABLE creators ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'approved'",
            "review_note": "ALTER TABLE creators ADD COLUMN review_note VARCHAR(255)",
            "tiktok_handle": "ALTER TABLE creators ADD COLUMN tiktok_handle VARCHAR(64)",
            "instagram_handle": "ALTER TABLE creators ADD COLUMN instagram_handle VARCHAR(64)",
            "youtube_handle": "ALTER TABLE creators ADD COLUMN youtube_handle VARCHAR(64)",
            "strikes": "ALTER TABLE creators ADD COLUMN strikes INTEGER NOT NULL DEFAULT 0",
        },
        "stories": {
            "raw": "ALTER TABLE stories ADD COLUMN raw JSON",
            "status": "ALTER TABLE stories ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active'",
        },
    }
    for table, columns_ddl in ddl.items():
        if table not in tables:
            continue
        columns = {c["name"] for c in inspector.get_columns(table)}
        for name, stmt in columns_ddl.items():
            if name not in columns:
                conn.execute(text(stmt))


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(_migrate)
        await conn.run_sync(Base.metadata.create_all)
    from app.services import scheduler
    scheduler.start()
    yield


app = FastAPI(title="Stalvian UGC Platform", lifespan=lifespan)

_origins = [settings.FRONTEND_URL.rstrip("/")]
if settings.ENVIRONMENT != "production":
    _origins += ["http://localhost:3100", "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

from app.api.routes_auth import router as auth_router
from app.api.routes_stories import router as stories_router
from app.api.routes_feed import router as feed_router
from app.api.routes_videos import router as videos_router
from app.api.routes_earnings import router as earnings_router
from app.api.routes_admin import router as admin_router
from app.api.routes_admin_metrics import router as admin_metrics_router
from app.api.routes_webhooks import router as webhooks_router

app.include_router(auth_router)
app.include_router(stories_router)
app.include_router(feed_router)
app.include_router(videos_router)
app.include_router(earnings_router)
app.include_router(admin_router)
app.include_router(admin_metrics_router)
app.include_router(webhooks_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
