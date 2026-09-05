"""Background jobs (APScheduler — no Celery/Redis needed at this scale)."""
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.database import async_session
from app.services import stories, view_tracker
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
    scheduler.add_job(_sync_feeds, "interval", minutes=30, id="sync_feeds")
    scheduler.add_job(_refresh_views, "interval", hours=6, id="refresh_views")
    scheduler.start()
    logger.info("Scheduler started (feed sync 30m, view refresh 6h)")
