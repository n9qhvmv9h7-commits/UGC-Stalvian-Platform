"""Stalvian UGC Creator Platform — FastAPI entry point."""
import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import InterfaceError, OperationalError

from app.auth import hash_password
from app.config import settings
from app.database import async_session, engine
from app.models import Base, Creator

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


async def _bootstrap_admin() -> None:
    """Create the first admin when the database holds none.

    Access is invite-only: there is no signup endpoint, and POST
    /api/admin/creators requires an existing admin. A fresh production database
    would therefore have no way in. This runs on every boot and does nothing at
    all once any admin exists, so the env vars are safe to leave set.

    An existing account with the same email is promoted rather than replaced —
    its password is never overwritten from the environment.
    """
    if not (settings.BOOTSTRAP_ADMIN_EMAIL and settings.BOOTSTRAP_ADMIN_PASSWORD):
        return
    email = settings.BOOTSTRAP_ADMIN_EMAIL.lower().strip()
    async with async_session() as db:
        has_admin = (
            await db.execute(select(Creator.id).where(Creator.is_admin.is_(True)).limit(1))
        ).first()
        if has_admin is not None:
            return
        existing = (
            await db.execute(select(Creator).where(Creator.email == email))
        ).scalar_one_or_none()
        if existing is not None:
            existing.is_admin = True
            existing.status = "approved"
            await db.commit()
            logging.warning(
                "Bootstrap: promoted existing account %s to admin "
                "(its current password is unchanged)",
                email,
            )
            return
        db.add(
            Creator(
                email=email,
                password_hash=hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD),
                name=(settings.BOOTSTRAP_ADMIN_NAME or email.split("@")[0]).strip(),
                status="approved",
                is_admin=True,
            )
        )
        await db.commit()
        logging.warning(
            "Bootstrap: created first admin %s — log in and change this password", email
        )


# Connection errors worth waiting out: the socket is refused, DNS has not
# published the host yet, or Postgres is up but still starting.
_DB_NOT_READY = (OSError, InterfaceError, OperationalError)


async def _prepare_database(max_wait_seconds: int = 150) -> None:
    """Create/migrate tables, waiting for the database to accept connections.

    Render provisions the database and the service in parallel, so on a first
    deploy the API can boot before Postgres is listening. Exiting on the first
    refused connection gets the whole deploy marked failed — even though the
    next container start would have succeeded. Retrying here also covers
    routine restarts and failovers, where the database briefly goes away.
    """
    deadline = time.monotonic() + max_wait_seconds
    delay = 1.0
    attempt = 0
    while True:
        attempt += 1
        try:
            async with engine.begin() as conn:
                await conn.run_sync(_migrate)
                await conn.run_sync(Base.metadata.create_all)
            if attempt > 1:
                logging.info("Database ready after %d attempts", attempt)
            return
        except _DB_NOT_READY as exc:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                logging.error("Database unreachable after %ds — giving up", max_wait_seconds)
                raise
            logging.warning(
                "Database not ready (attempt %d: %s) — retrying in %.0fs",
                attempt,
                type(exc).__name__,
                delay,
            )
            await asyncio.sleep(min(delay, remaining))
            delay = min(delay * 2, 10.0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _prepare_database()
    await _bootstrap_admin()
    from app.services import scheduler
    scheduler.start()
    yield


app = FastAPI(title="Stalvian UGC Platform", lifespan=lifespan)

# The creator app and the admin panel are separate deployments with separate
# URLs in production, so CORS has to allow both. dict.fromkeys dedupes while
# keeping order (the two can be equal when one host serves everything).
_configured = [settings.FRONTEND_URL, settings.ADMIN_URL]
if settings.ENVIRONMENT != "production":
    _configured += ["http://localhost:3100", "http://localhost:3000"]
# dict.fromkeys dedupes while keeping order — the two URLs are equal whenever a
# single host serves both surfaces, and locally they equal the dev origin too.
_origins = list(
    dict.fromkeys(url.strip().rstrip("/") for url in _configured if url and url.strip())
)

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
