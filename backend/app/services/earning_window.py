"""The 10-day earning window.

Views only count for pay until EARNING_WINDOW_DAYS after the video was
submitted; the eligible count is frozen at the last snapshot inside the
window. A video verified once by an admin (no snapshot history) is trusted
as the day-10 figure — admins record the closing count.
"""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import VideoSubmission, ViewSnapshot
from app.payout import EARNING_WINDOW_DAYS


def naive(dt: datetime | None) -> datetime | None:
    """SQLite round-trips naive datetimes; normalize for comparisons."""
    if dt is None:
        return None
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def window_cutoff(video: VideoSubmission) -> datetime:
    return naive(video.created_at) + timedelta(days=EARNING_WINDOW_DAYS)


def window_open(video: VideoSubmission, now: datetime | None = None) -> bool:
    return (now or datetime.utcnow()) <= window_cutoff(video)


async def eligible_views_map(
    db: AsyncSession, videos: list[VideoSubmission]
) -> dict[int, int]:
    """video_id -> the view count that counts toward pay."""
    now = datetime.utcnow()
    result: dict[int, int] = {}
    closed = []
    for video in videos:
        if window_open(video, now):
            result[video.id] = video.views
        else:
            closed.append(video)
    if not closed:
        return result

    snapshots = (
        (
            await db.execute(
                select(ViewSnapshot).where(
                    ViewSnapshot.video_id.in_([v.id for v in closed])
                )
            )
        )
        .scalars()
        .all()
    )
    by_video: dict[int, list[tuple[datetime, int]]] = {}
    for snap in snapshots:
        by_video.setdefault(snap.video_id, []).append((naive(snap.created_at), snap.views))

    for video in closed:
        history = sorted(by_video.get(video.id, []))
        in_window = [views for ts, views in history if ts <= window_cutoff(video)]
        if in_window:
            result[video.id] = max(in_window)
        elif history:
            # No observation inside the window (e.g. a TikTok verified by an
            # admin during the payout run) — the EARLIEST recorded count is the
            # closest thing to the day-10 figure, and admins are instructed to
            # record exactly that. Never zero out a video for being recorded
            # late.
            result[video.id] = history[0][1]
        else:
            result[video.id] = video.views  # single trusted admin figure
    return result
