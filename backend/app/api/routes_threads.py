"""Thread images: the picture a creator attaches to one tweet.

The panel composes the words and deliberately keeps its imagery to itself (its
chart_data holds inline base64 that the forwarding layer strips), so the
picture on a tweet is the creator's own. It is stored here, per creator, so it
survives a reload and a change of device, and so two creators working the same
thread never share one picture.

Images come back as data URLs rather than files on a public path: this API is
reached with a Bearer token, which an <img src> cannot send, and an
unauthenticated image URL would put a creator's unpublished work on the open
web for anyone who guessed the id.
"""
import base64

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_approved_creator
from app.database import get_db
from app.models import Creator, Story, ThreadImage
from app.services.stories import is_thread_kind

router = APIRouter(prefix="/api/threads", tags=["threads"])

# X accepts far larger, but this is a preview and it lives in a database row.
MAX_IMAGE_BYTES = 4 * 1024 * 1024

# What X itself displays. Anything else would preview here and fail there.
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}

# Pictures per tweet. Slot 0 is the tweet's own picture; the panel's
# composite cards use more — one logo per company (up to 3), one face per
# smart-money buyer (up to 5).
MAX_SLOT = 7


def _data_url(image: ThreadImage) -> str:
    return f"data:{image.content_type};base64,{base64.b64encode(image.data).decode()}"


def _view(image: ThreadImage) -> dict:
    return {
        "tweet_order": image.tweet_order,
        "slot": image.slot,
        "size": image.size,
        "data_url": _data_url(image),
    }


async def _find(db: AsyncSession, creator: Creator, story_id: int, order: int, slot: int) -> ThreadImage | None:
    return (
        await db.execute(
            select(ThreadImage).where(
                ThreadImage.creator_id == creator.id,
                ThreadImage.story_id == story_id,
                ThreadImage.tweet_order == order,
                ThreadImage.slot == slot,
            )
        )
    ).scalar_one_or_none()


async def _thread_tweet(
    db: AsyncSession, creator: Creator, story_id: int, order: int
) -> Story:
    """The thread a creator is allowed to attach a picture to, with `order`
    checked against the tweets it actually has."""
    if creator.account_type != "tweets":
        raise HTTPException(status_code=403, detail="Threads are for X accounts")
    story = (
        await db.execute(select(Story).where(Story.id == story_id))
    ).scalar_one_or_none()
    # A shared feed item (creator_id null) of a thread kind — the same rows the
    # threads feed serves. Anything else is not a thread to this creator.
    if story is None or story.creator_id is not None or not is_thread_kind(story.kind):
        raise HTTPException(status_code=404, detail="Thread not found")
    tweets = (story.payload or {}).get("tweets") or []
    if not 1 <= order <= len(tweets):
        raise HTTPException(
            status_code=404, detail=f"This thread has {len(tweets)} tweets"
        )
    return story


@router.put("/{story_id}/tweets/{order}/image")
async def upload_tweet_image(
    story_id: int,
    order: int,
    file: UploadFile = File(...),
    slot: int = Query(default=0, ge=0, le=MAX_SLOT),
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    """Attach (or replace) a picture on one tweet."""
    await _thread_tweet(db, creator, story_id, order)
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400, detail="Use a PNG, JPEG, WebP or GIF image"
        )
    # Read one byte past the cap rather than the whole upload: a too-large file
    # is refused without being held in memory in full.
    data = await file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Images must be {MAX_IMAGE_BYTES // (1024 * 1024)} MB or smaller",
        )
    if not data:
        raise HTTPException(status_code=400, detail="That file is empty")

    existing = await _find(db, creator, story_id, order, slot)
    if existing is None:
        existing = ThreadImage(
            creator_id=creator.id, story_id=story_id, tweet_order=order, slot=slot,
            content_type=content_type, data=data, size=len(data),
        )
        db.add(existing)
    else:
        existing.content_type = content_type
        existing.data = data
        existing.size = len(data)
    await db.commit()
    await db.refresh(existing)
    return _view(existing)


@router.get("/{story_id}/tweets/{order}/image")
async def get_tweet_images(
    story_id: int,
    order: int,
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    """Every picture on one tweet, by slot. Fetched only for the tweet on
    screen, so a feed of threads never drags every image down with it."""
    rows = (
        (
            await db.execute(
                select(ThreadImage)
                .where(
                    ThreadImage.creator_id == creator.id,
                    ThreadImage.story_id == story_id,
                    ThreadImage.tweet_order == order,
                )
                .order_by(ThreadImage.slot)
            )
        )
        .scalars()
        .all()
    )
    return {"tweet_order": order, "images": [_view(i) for i in rows]}


@router.delete("/{story_id}/tweets/{order}/image")
async def delete_tweet_image(
    story_id: int,
    order: int,
    slot: int = Query(default=0, ge=0, le=MAX_SLOT),
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    image = await _find(db, creator, story_id, order, slot)
    if image is None:
        raise HTTPException(status_code=404, detail="No image on this tweet")
    await db.delete(image)
    await db.commit()
    return {"status": "ok"}
