"""Shared story feeds: Breaking News and Movers ("caught the trade")."""
import asyncio
import time

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_approved_creator
from app.database import get_db
from app.models import Creator, Story
from app.services.stories import localized_payload, sync_all
from app.services.panel_client import PanelError

router = APIRouter(prefix="/api/feed", tags=["feed"])

# Manual refresh shares one panel sync at a time, at most once per minute.
_REFRESH_COOLDOWN = 60
_refresh_lock = asyncio.Lock()
_last_refresh: float = 0.0


async def _feed(db: AsyncSession, creator: Creator, kind: str, page: int, limit: int) -> dict:
    base = select(Story).where(
        Story.kind == kind, Story.creator_id.is_(None), Story.status == "active"
    )
    rows = (
        (
            await db.execute(
                # NULLS LAST spelled portably (older SQLite rejects the keyword)
                base.order_by(
                    Story.published_at.is_(None),
                    Story.published_at.desc(),
                    Story.id.desc(),
                )
                .offset((page - 1) * limit)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    items = []
    for story in rows:
        payload = await localized_payload(db, story, creator.language)
        items.append(
            {
                "id": story.id,
                "kind": story.kind,
                "language": creator.language,
                "published_at": story.published_at.isoformat() if story.published_at else None,
                **payload,
            }
        )
    return {"items": items, "page": page, "limit": limit}


@router.get("/breaking")
async def breaking_feed(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    return await _feed(db, creator, "breaking", page, limit)


@router.get("/movers")
async def movers_feed(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    return await _feed(db, creator, "mover", page, limit)


@router.post("/refresh")
async def refresh_feeds(
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    """Pull the latest stories from the Marketing Panel right now (min 1/min)."""
    global _last_refresh
    async with _refresh_lock:
        if time.monotonic() - _last_refresh < _REFRESH_COOLDOWN:
            return {"status": "ok", "new_breaking": 0, "new_movers": 0, "cooldown": True}
        # Cooldown applies to failures too — creators hammering refresh during
        # a panel outage must not amplify it into the panel's rate limit.
        _last_refresh = time.monotonic()
        try:
            result = await sync_all(db)
        except PanelError as exc:
            return {"status": "error", "detail": str(exc)}
    return {"status": "ok", **result}
