"""Background jobs (APScheduler — no Celery/Redis needed at this scale)."""
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.database import async_session
from app.services import stories, view_tracker
from app.services.social.sync import sweep_oauth_states, sync_all_connections
from app.services.panel_client import PanelError

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def _sync_feeds():
    """The single panel connection: one pass pulls catalog + all feeds."""
    try:
        async with async_session() as db:
            result = await stories.sync_all(db)
            logger.info("Panel sync: %s", result)
    except PanelError as exc:
        logger.warning("Panel sync skipped: %s", exc)
    except Exception:
        logger.exception("Panel sync failed")


async def _sync_social():
    """Read views from connected accounts and auto-verify what the platform
    confirms is the creator's. Also sweeps expired OAuth state rows."""
    try:
        async with async_session() as db:
            result = await sync_all_connections(db)
            if result["connections"]:
                logger.info("Social sync: %s", result)
            deleted = await sweep_oauth_states(db)
            if deleted:
                logger.info("Swept %d expired OAuth states", deleted)
    except Exception:
        logger.exception("Social sync failed")


async def _refresh_views():
    try:
        async with async_session() as db:
            n = await view_tracker.refresh_youtube_views(db)
            if n:
                logger.info("Refreshed views for %d YouTube videos", n)
    except Exception:
        logger.exception("View refresh failed")


def start():
    # Panel generates breaking scripts ~5x/day and movers daily; 30 min keeps us fresh.
    #
    # The first run is a few seconds after boot rather than a full interval
    # later. An interval job's first fire is one interval away, so a deploy
    # that adds a feed served creators an empty page for half an hour with
    # nothing wrong and nothing to do about it. Off the request path, so a
    # slow or unreachable panel still never delays startup.
    scheduler.add_job(
        _sync_feeds,
        "interval",
        minutes=30,
        id="sync_feeds",
        next_run_time=datetime.now(timezone.utc) + timedelta(seconds=15),
    )
    scheduler.add_job(_refresh_views, "interval", hours=6, id="refresh_views")
    scheduler.add_job(_sync_social, "interval", hours=6, id="sync_social")
    scheduler.start()
    logger.info(
        "Scheduler started (feed sync in 15s then every 30m, view refresh 6h, social sync 6h)"
    )
