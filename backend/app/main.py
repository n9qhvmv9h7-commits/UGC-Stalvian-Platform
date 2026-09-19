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
from app.models import Base, Creator, Story, VideoSubmission
from app.services.referrals import backfill_referral_codes
from app.services.view_tracker import canonical_key

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
            "referral_code": "ALTER TABLE creators ADD COLUMN referral_code VARCHAR(16)",
            "account_type": "ALTER TABLE creators ADD COLUMN account_type VARCHAR(8) "
                            "NOT NULL DEFAULT 'video'",
        },
        "video_submissions": {
            "ownership_state": "ALTER TABLE video_submissions ADD COLUMN ownership_state "
                               "VARCHAR(16) NOT NULL DEFAULT 'unconfirmed'",
            "ownership_note": "ALTER TABLE video_submissions ADD COLUMN ownership_note VARCHAR(255)",
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
    # ALTER TABLE ADD COLUMN cannot carry UNIQUE portably, and create_all skips
    # indexes on tables that already exist — so the uniqueness guarantee
    # behind referral codes is created here, idempotently.
    if "creators" in tables:
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_creators_referral_code "
                "ON creators (referral_code)"
            )
        )


async def _bootstrap_admin() -> None:
    """Create the first admin when the database holds none — or reset one.

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

    if settings.BOOTSTRAP_ADMIN_RESET:
        # Explicit recovery for a lost admin password. Skips every guard below
        # on purpose: the point is to overwrite an account that already exists.
        async with async_session() as db:
            creator = (
                await db.execute(select(Creator).where(Creator.email == email))
            ).scalar_one_or_none()
            if creator is None:
                creator = Creator(
                    email=email,
                    password_hash=hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD),
                    name=(settings.BOOTSTRAP_ADMIN_NAME or email.split("@")[0]).strip(),
                    status="approved",
                    is_admin=True,
                )
                db.add(creator)
            else:
                creator.password_hash = hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD)
                # A recovered admin is no use if the account is also suspended.
                creator.is_admin = True
                creator.status = "approved"
            await db.commit()
        logging.warning(
            "BOOTSTRAP_ADMIN_RESET is set: password for %s was reset on boot. "
            "Clear BOOTSTRAP_ADMIN_RESET now — it re-applies on every restart.",
            email,
        )
        return

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


async def _backfill_canonical_keys() -> None:
    """Recompute video identity keys whose stored value predates a parser fix.

    `canonical_key` reduces every URL shape for a video to one string, and the
    uniqueness of that string is what stops the same video being submitted —
    and paid — twice. When the parser learns a shape it used to miss (Instagram's
    /<user>/reel/<code>/ form, TikTok share links), rows stored under the old
    key would never collide with a newly-submitted correct key, so the hole
    stays open for every video already in the table.

    Runs after create_all rather than inside _migrate: _migrate is sync, runs
    before the tables are guaranteed to exist, and only handles DDL.
    """
    async with async_session() as db:
        rows = (await db.execute(select(VideoSubmission))).scalars().all()
        seen = {r.canonical_key: r.id for r in rows}
        fixed = collisions = 0
        for video in rows:
            correct = canonical_key(video.url, video.platform)
            if correct == video.canonical_key:
                continue
            owner = seen.get(correct)
            if owner is not None and owner != video.id:
                # Two rows are genuinely the same video — the double-submission
                # this fix prevents going forward. The column is unique, so
                # rewriting would crash the boot. Leave both and let a human
                # decide which one earned.
                logging.error(
                    "Duplicate video detected while backfilling keys: rows %d and %d "
                    "are both %s — resolve manually (one may have been paid twice)",
                    owner, video.id, correct,
                )
                collisions += 1
                continue
            del seen[video.canonical_key]
            seen[correct] = video.id
            video.canonical_key = correct
            fixed += 1
        if fixed:
            await db.commit()
            logging.warning("Backfilled %d video canonical keys", fixed)
        if collisions:
            logging.error("%d duplicate videos need manual review", collisions)


async def _fail_orphaned_generations() -> None:
    """Album-story generation runs as a background task, so a story left in
    `generating` belongs to a process that is gone — a deploy, a restart, a
    crash. Nothing will ever finish it, so fail it now rather than leave a
    creator watching a spinner forever."""
    async with async_session() as db:
        rows = (
            (await db.execute(select(Story).where(Story.status == "generating")))
            .scalars()
            .all()
        )
        if not rows:
            return
        for story in rows:
            story.status = "failed"
            story.payload = {"error": "Generation was interrupted — please try again."}
        await db.commit()
        logging.warning("Failed %d story generations interrupted by a restart", len(rows))


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _prepare_database()
    await _bootstrap_admin()
    await _backfill_canonical_keys()
    await _fail_orphaned_generations()
    async with async_session() as db:
        await backfill_referral_codes(db)
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
from app.api.routes_threads import router as threads_router
from app.api.routes_feed import router as feed_router
from app.api.routes_videos import router as videos_router
from app.api.routes_earnings import router as earnings_router
from app.api.routes_admin import router as admin_router
from app.api.routes_admin_metrics import router as admin_metrics_router
from app.api.routes_webhooks import router as webhooks_router
from app.api.routes_referrals import router as referrals_router
from app.api.routes_social import router as social_router

app.include_router(auth_router)
app.include_router(stories_router)
app.include_router(threads_router)
app.include_router(feed_router)
app.include_router(videos_router)
app.include_router(earnings_router)
app.include_router(admin_router)
app.include_router(admin_metrics_router)
app.include_router(webhooks_router)
app.include_router(referrals_router)
app.include_router(social_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
