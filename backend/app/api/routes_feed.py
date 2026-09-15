"""Daily Scripts: the shared story feeds creators shoot from.

Every feed is one entry in FEED_TYPES, and both the list endpoint and the
selector in the app are driven by it — adding a third feed is one entry here
plus the panel emitting that kind, with no frontend change required.
"""
import asyncio
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_approved_creator
from app.database import get_db
from app.models import Creator, FeedRead, Story
from app.services.stories import localized_payload, sync_all
from app.services.panel_client import PanelError

router = APIRouter(prefix="/api/feed", tags=["feed"])

# One option in the Daily Scripts selector. `kinds` is a LIST because a feed
# the creator picks need not be one panel feed: Top Trades presents hindsight
# and trending together, since to a creator they are one idea — the trade that
# turned out to matter — even though the panel generates them separately.
FEED_TYPES: list[dict] = [
    {
        "key": "breaking",
        "kinds": ["breaking"],
        "label": "Breaking News",
        "description": (
            "Fresh market stories with the insider angle: how the politicians and funds "
            "in Stalvian's albums are placed. New scripts arrive through the day."
        ),
    },
    {
        "key": "movers",
        "kinds": ["mover"],
        "label": "Movers",
        "description": (
            "A stock that moved a lot, and the politician or hedge fund in Stalvian's "
            "albums that was already in the trade. Built for the \"they knew\" hook."
        ),
    },
    {
        "key": "top-trades",
        "kinds": ["hindsight", "trending"],
        "label": "Top Trades",
        "description": (
            "The trades worth talking about: what a disclosed position turned out to be "
            "worth, and the ones people are watching right now."
        ),
    },
]
_BY_KEY = {t["key"]: t for t in FEED_TYPES}

# Manual refresh shares one panel sync at a time, at most once per minute.
_REFRESH_COOLDOWN = 60
_refresh_lock = asyncio.Lock()
_last_refresh: float = 0.0


async def _feed(
    db: AsyncSession, creator: Creator, kinds: list[str], page: int, limit: int
) -> dict:
    """Newest-first across every kind this feed covers, so a feed backed by two
    panel feeds reads as one interleaved list rather than two blocks."""
    base = select(Story).where(
        Story.kind.in_(kinds), Story.creator_id.is_(None), Story.status == "active"
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


@router.get("/types")
async def feed_types(
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    """The feeds this app serves, with how many stories are live in each — the
    app builds its type selector from this, so a new feed appears without a
    frontend release."""
    live = Story.creator_id.is_(None), Story.status == "active"
    rows = (
        await db.execute(
            select(Story.kind, func.count()).where(*live).group_by(Story.kind)
        )
    ).all()
    counts = {kind: int(n) for kind, n in rows}

    seen = {
        r.feed_key: r.last_seen_at
        for r in (
            (await db.execute(select(FeedRead).where(FeedRead.creator_id == creator.id)))
            .scalars()
            .all()
        )
    }
    # One query for every feed: "newer than this creator last looked", or the
    # whole feed for one they have never opened.
    unread_rows = (
        await db.execute(
            select(Story.kind, func.count())
            .where(
                *live,
                or_(
                    *[
                        and_(Story.kind.in_(t["kinds"]), Story.created_at > seen[t["key"]])
                        if t["key"] in seen
                        else Story.kind.in_(t["kinds"])
                        for t in FEED_TYPES
                    ]
                ),
            )
            .group_by(Story.kind)
        )
    ).all()
    unread = {kind: int(n) for kind, n in unread_rows}

    return {
        "items": [
            {
                "key": t["key"],
                "label": t["label"],
                "description": t["description"],
                "count": sum(counts.get(k, 0) for k in t["kinds"]),
                "unread": sum(unread.get(k, 0) for k in t["kinds"]),
            }
            for t in FEED_TYPES
        ]
    }


@router.post("/{key}/seen")
async def mark_feed_seen(
    key: str,
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    """Called when a creator looks at a feed. Everything stored before now
    stops counting as unread for them."""
    if key not in _BY_KEY:
        raise HTTPException(status_code=404, detail=f"Unknown feed: {key}")
    row = (
        await db.execute(
            select(FeedRead).where(FeedRead.creator_id == creator.id, FeedRead.feed_key == key)
        )
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row is None:
        db.add(FeedRead(creator_id=creator.id, feed_key=key, last_seen_at=now))
    else:
        row.last_seen_at = now
    await db.commit()
    return {"status": "ok", "last_seen_at": now.isoformat()}


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


# Declared last on purpose: FastAPI matches routes in order, so /types and
# /refresh above are reached before this catches everything else. The old
# /api/feed/breaking and /api/feed/movers URLs still resolve here unchanged,
# which keeps any already-loaded browser tab working across the deploy.
@router.get("/{key}")
async def feed(
    key: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    feed_type = _BY_KEY.get(key)
    if feed_type is None:
        raise HTTPException(status_code=404, detail=f"Unknown feed: {key}")
    return await _feed(db, creator, feed_type["kinds"], page, limit)
