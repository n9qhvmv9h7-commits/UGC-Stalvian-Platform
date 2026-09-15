"""Video submissions: creators drop their published video links here."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_approved_creator
from app.database import get_db
from app.models import Creator, Story, VideoSubmission, ViewSnapshot
from app.payout import video_payout_cents
from app.services.earning_window import eligible_views_map, window_cutoff, window_open
from app.services.view_tracker import (
    MAX_SUBMIT_AGE_DAYS,
    canonical_key,
    channel_matches_handle,
    resolve_short_link,
    detect_platform,
    fetch_youtube_stats,
    fetch_youtube_views,
)

from datetime import datetime, timezone

router = APIRouter(prefix="/api/videos", tags=["videos"])


class SubmitVideoRequest(BaseModel):
    url: str = Field(min_length=10, max_length=512)
    story_id: int | None = None
    title: str | None = Field(default=None, max_length=255)


def _video_response(video: VideoSubmission, eligible: int | None = None) -> dict:
    if eligible is None:
        eligible = video.views
    payout = video_payout_cents(eligible) if video.status == "verified" else 0
    return {
        "id": video.id,
        "url": video.url,
        "platform": video.platform,
        "title": video.title,
        "status": video.status,
        "views": video.views,
        "eligible_views": eligible,
        "window_open": window_open(video),
        "earning_until": window_cutoff(video).date().isoformat(),
        "views_updated_at": video.views_updated_at.isoformat() if video.views_updated_at else None,
        "payout_cents": payout,
        "ownership_state": video.ownership_state,
        "review_note": video.review_note,
        "story_id": video.story_id,
        "created_at": video.created_at.isoformat() if video.created_at else None,
    }


@router.post("")
async def submit_video(
    request: SubmitVideoRequest,
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    url = request.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Please paste a full video URL")
    platform = detect_platform(url)
    if platform == "other":
        raise HTTPException(
            status_code=400,
            detail="Only TikTok, Instagram, and YouTube links are supported",
        )
    # A share-sheet link hides the video id behind a redirect, so it must be
    # resolved BEFORE the key is computed — otherwise the same video submitted
    # once short and once in full yields two keys, passes the check below, and
    # is paid twice. Resolution is best-effort and returns the original on
    # failure, so a slow TikTok never blocks a submission.
    url = await resolve_short_link(url)
    key = canonical_key(url, platform)

    # Match on the canonical key alone. It IS the video's identity, and since
    # resolution can rewrite `url`, a pasted link could otherwise match one row
    # by url and a different row by key — which made scalar_one_or_none() raise
    # MultipleResultsFound and 500 the request.
    duplicate = (
        await db.execute(
            select(VideoSubmission)
            .where(VideoSubmission.canonical_key == key)
            .order_by(VideoSubmission.id)
        )
    ).scalars().first()
    if duplicate and not (
        duplicate.status == "deleted" and duplicate.creator_id == creator.id
    ):
        raise HTTPException(status_code=409, detail="This video has already been submitted")

    if request.story_id is not None:
        story = (
            await db.execute(select(Story).where(Story.id == request.story_id))
        ).scalar_one_or_none()
        if story is None or story.creator_id not in (None, creator.id):
            raise HTTPException(status_code=404, detail="Story not found")

    if duplicate is not None:
        # Reactivate the soft-deleted row: created_at and snapshot history are
        # kept, so delete + resubmit can never restart the earning window.
        duplicate.status = "pending"
        duplicate.story_id = request.story_id
        duplicate.title = request.title or duplicate.title
        if platform == "youtube":
            views = await fetch_youtube_views(url)
            if views is not None and views != duplicate.views:
                db.add(ViewSnapshot(video_id=duplicate.id, views=views))
                duplicate.views = views
                duplicate.views_updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(duplicate)
        return _video_response(duplicate)

    video = VideoSubmission(
        creator_id=creator.id,
        story_id=request.story_id,
        url=url,
        canonical_key=key,
        platform=platform,
        title=request.title,
    )

    # YouTube views are queryable immediately, but verification stays a human
    # decision — otherwise anyone could farm payouts by submitting other
    # people's viral videos. The channel comparison below is evidence FOR that
    # decision, not a substitute: it tells the admin whether the video is even
    # on the creator's own channel, which nothing checked before.
    if platform == "youtube":
        stats = await fetch_youtube_stats(url)
        if stats is not None:
            owned = channel_matches_handle(stats.get("channel_title"), creator.youtube_handle)
            if owned is True:
                video.ownership_state = "owned"
            elif owned is False:
                video.ownership_state = "foreign"
                video.ownership_note = (
                    f"Posted by \"{stats.get('channel_title')}\", "
                    f"but the creator's YouTube handle is @{creator.youtube_handle}"
                )
            # The submission date is the earning-window proxy: an old video
            # would monetize its lifetime views instantly.
            published_at = stats.get("published_at")
            if published_at is not None:
                age = datetime.now(timezone.utc) - published_at
                if age.days > MAX_SUBMIT_AGE_DAYS:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"This video was published {age.days} days ago — submit "
                            f"links within {MAX_SUBMIT_AGE_DAYS} days of posting so "
                            "the earning window can be tracked"
                        ),
                    )
            video.views = stats["views"]
            video.views_updated_at = datetime.now(timezone.utc)

    db.add(video)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="This video has already been submitted")
    await db.refresh(video)
    if video.views:
        db.add(ViewSnapshot(video_id=video.id, views=video.views))
        await db.commit()
    return _video_response(video)


@router.get("")
async def my_videos(
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    videos = (
        (
            await db.execute(
                select(VideoSubmission)
                .where(
                    VideoSubmission.creator_id == creator.id,
                    VideoSubmission.status != "deleted",
                )
                .order_by(VideoSubmission.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    eligible = await eligible_views_map(db, videos)
    return {"items": [_video_response(v, eligible.get(v.id)) for v in videos]}


@router.delete("/{video_id}")
async def delete_video(
    video_id: int,
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    video = (
        await db.execute(
            select(VideoSubmission).where(
                VideoSubmission.id == video_id, VideoSubmission.creator_id == creator.id
            )
        )
    ).scalar_one_or_none()
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found")
    # Same eligibility basis as the payout the creator sees: a video that has
    # earned (window-limited) money must keep its record.
    eligible = await eligible_views_map(db, [video])
    if video.status == "verified" and video_payout_cents(eligible.get(video.id, video.views)) > 0:
        raise HTTPException(status_code=400, detail="Verified earning videos can't be deleted")
    # Soft delete: the row and its snapshot history stay, so resubmitting the
    # same video reactivates the ORIGINAL earning window instead of a fresh one.
    video.status = "deleted"
    await db.commit()
    return {"status": "deleted"}
