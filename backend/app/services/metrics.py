"""Daily views/earnings series from ViewSnapshot history.

Shared by the creator earnings chart and the admin dashboard so both always
agree to the cent. Two series come out of one walk per video:

- views_gained: REAL view growth — every recorded increase counts, including
  after the 10-day earning window closes (admins want true reach).
- earned_cents: window-clamped — the payout delta produced by view growth
  inside the earning window only, matching eligible_views_map exactly.
"""
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import VideoSubmission, ViewSnapshot
from app.payout import EARNING_WINDOW_DAYS, video_payout_cents
from app.services.earning_window import naive


@dataclass
class DayMetrics:
    views_gained: int = 0
    earned_cents: int = 0


def _as_date(dt: datetime | None) -> date | None:
    normalized = naive(dt)
    return normalized.date() if normalized else None


async def fetch_snapshots(
    db: AsyncSession, video_ids: Sequence[int]
) -> dict[int, list[tuple[date, int]]]:
    """All snapshots for the given videos in one query, ordered by created_at,
    grouped as video_id -> [(date, views)]."""
    by_video: dict[int, list[tuple[date, int]]] = {vid: [] for vid in video_ids}
    if not video_ids:
        return by_video
    snapshots = (
        (
            await db.execute(
                select(ViewSnapshot)
                .where(ViewSnapshot.video_id.in_(list(video_ids)))
                .order_by(ViewSnapshot.created_at)
            )
        )
        .scalars()
        .all()
    )
    for snap in snapshots:
        snap_date = _as_date(snap.created_at)
        if snap_date is not None:
            by_video[snap.video_id].append((snap_date, snap.views))
    return by_video


def _observations(
    video: VideoSubmission, snaps: list[tuple[date, int]]
) -> tuple[list[tuple[date, int]], date]:
    """Normalized observation series + effective earning cutoff for one video.

    Verbatim port of the earnings-walk edge cases:
    - no observation inside the window -> the earliest recording is the trusted
      day-10 figure (series collapses to it, cutoff extends to its date);
    - the live count is the newest datapoint even if never snapshotted; a video
      with zero snapshots contributes its full count on its recorded day.
    """
    series = list(snaps)
    cutoff = (naive(video.created_at) + timedelta(days=EARNING_WINDOW_DAYS)).date()
    if series and not any(d <= cutoff for d, _ in series):
        earliest = min(series)
        series = [earliest]
        cutoff = max(cutoff, earliest[0])
    current_date = _as_date(video.views_updated_at) or _as_date(video.created_at)
    if current_date and (not series or video.views >= series[-1][1]):
        if not series:
            series.append((current_date, video.views))
            cutoff = max(cutoff, current_date)
        elif current_date <= cutoff:
            series.append((current_date, video.views))
    return sorted(series), cutoff


def daily_metrics(
    videos: Iterable[VideoSubmission],
    snaps_by_video: dict[int, list[tuple[date, int]]],
    days: int,
    today: date | None = None,
) -> dict[date, DayMetrics]:
    """Per-day views-gained + earned-cents over [today - days + 1, today]."""
    if today is None:
        today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)
    totals: dict[date, DayMetrics] = {
        start + timedelta(days=i): DayMetrics() for i in range(days)
    }

    for video in videos:
        series, cutoff = _observations(video, snaps_by_video.get(video.id, []))
        if not series:
            continue
        # Carry the running max forward twice: once over everything (real
        # views) and once clamped to the earning window (money). A running max
        # makes negative deltas structurally impossible.
        views_before_all = 0
        views_before_eligible = 0
        for snap_date, views in series:
            if snap_date < start:
                views_before_all = max(views_before_all, views)
                if snap_date <= cutoff:
                    views_before_eligible = max(views_before_eligible, views)
        carried_all = views_before_all
        carried_eligible = views_before_eligible
        prev_payout = video_payout_cents(carried_eligible)
        idx = 0
        for i in range(days):
            day = start + timedelta(days=i)
            prev_all = carried_all
            while idx < len(series) and series[idx][0] <= day:
                obs_date, views = series[idx]
                carried_all = max(carried_all, views)
                if obs_date <= cutoff:
                    carried_eligible = max(carried_eligible, views)
                idx += 1
            payout = video_payout_cents(carried_eligible)
            totals[day].views_gained += carried_all - prev_all
            totals[day].earned_cents += max(payout - prev_payout, 0)
            prev_payout = payout

    return totals


async def daily_metrics_db(
    db: AsyncSession, videos: Sequence[VideoSubmission], days: int
) -> dict[date, DayMetrics]:
    snaps = await fetch_snapshots(db, [v.id for v in videos])
    return daily_metrics(videos, snaps, days)
