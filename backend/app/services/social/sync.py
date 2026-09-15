"""Read views from connected accounts, and let the platform prove ownership.

For each active connection: ask the platform what the creator posted recently,
match it against what they submitted, and where the two agree, record the views
and mark the video verified. A video the platform does not list stays pending
for a human — that is the honest outcome, because it means the video is not on
the connected account.

What this deliberately does NOT do: reject, strike, or terminate. A video
missing from the list has innocent explanations (platform indexing lag, a
private-then-public post, region restrictions), and marking one `removed`
increments a strike that at two ends the partnership. Automating account
termination off an API absence would be the most dangerous thing in this file.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import OAuthState, SocialConnection, VideoSubmission, ViewSnapshot
from app.payout import EARNING_WINDOW_DAYS, MAX_SUBMIT_AGE_DAYS
from app.services import crypto
from app.services.social.base import SocialProviderError
from app.services.social.registry import get as get_provider

logger = logging.getLogger(__name__)

# How far back to ask. Anything still submittable or still earning is inside
# this window by construction, so an incomplete page can never cause a
# correctness failure — only a delay until the next run.
LOOKBACK_DAYS = MAX_SUBMIT_AGE_DAYS + EARNING_WINDOW_DAYS + 7


async def _ensure_fresh_token(db: AsyncSession, conn: SocialConnection) -> str | None:
    """Return a usable access token, refreshing early if it is close to expiry.

    Refreshing early is free and removes a whole class of failure: with a 24h
    TikTok token and a 6h job, one missed cycle plus a deploy window is enough
    to drift into expiry.
    """
    access = crypto.decrypt(conn.access_token)
    expires = conn.access_expires_at
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    fresh_enough = expires is None or expires > datetime.now(timezone.utc) + timedelta(hours=6)
    if access and fresh_enough:
        return access

    refresh = crypto.decrypt(conn.refresh_token)
    if not refresh:
        conn.status = "needs_reauth"
        conn.last_error = "No refresh token stored — reconnect required"
        return None

    provider = get_provider(conn.platform)
    if provider is None:
        return None
    try:
        bundle = await provider.refresh(refresh)
    except SocialProviderError as exc:
        if exc.retryable:
            # A timeout must never tell a creator their account is broken.
            conn.consecutive_failures += 1
            conn.last_error = str(exc)[:255]
            return None
        conn.status = "needs_reauth"
        conn.last_error = str(exc)[:255]
        return None

    conn.access_token = crypto.encrypt(bundle.access_token)
    # TikTok rotates the refresh token on every refresh — keeping the old one
    # would kill the connection within a day.
    if bundle.refresh_token:
        conn.refresh_token = crypto.encrypt(bundle.refresh_token)
    conn.access_expires_at = bundle.access_expires_at
    conn.refresh_expires_at = bundle.refresh_expires_at
    conn.consecutive_failures = 0
    conn.last_error = None
    return bundle.access_token


async def sync_connection(db: AsyncSession, conn: SocialConnection) -> dict:
    """One creator, one platform. Returns a small summary for logging."""
    result = {"matched": 0, "verified": 0, "views_updated": 0}
    provider = get_provider(conn.platform)
    if provider is None:
        return result

    access = await _ensure_fresh_token(db, conn)
    if not access:
        return result

    since = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    try:
        remote = await provider.list_recent_media(access, since)
    except SocialProviderError as exc:
        if exc.retryable:
            conn.consecutive_failures += 1
        else:
            conn.status = "needs_reauth"
        conn.last_error = str(exc)[:255]
        logger.warning("%s sync failed for creator %s: %s", conn.platform, conn.creator_id, exc)
        return result

    by_key = {v.canonical_key: v for v in remote}
    if not by_key:
        conn.last_synced_at = datetime.now(timezone.utc)
        conn.consecutive_failures = 0
        return result

    submissions = (
        (
            await db.execute(
                select(VideoSubmission).where(
                    VideoSubmission.creator_id == conn.creator_id,
                    VideoSubmission.platform == conn.platform,
                    VideoSubmission.status.in_(("pending", "verified")),
                )
            )
        )
        .scalars()
        .all()
    )

    for video in submissions:
        match = by_key.get(video.canonical_key)
        if match is None:
            continue
        result["matched"] += 1

        # The platform listed it under this creator's own account: that is the
        # ownership proof the admin was previously supplying by eye.
        video.ownership_state = "owned"
        video.ownership_note = None

        if match.views is not None and match.views != video.views:
            db.add(ViewSnapshot(video_id=video.id, views=match.views))
            video.views = match.views
            video.views_updated_at = datetime.now(timezone.utc)
            result["views_updated"] += 1

        if video.status == "pending":
            video.status = "verified"
            result["verified"] += 1

    conn.last_synced_at = datetime.now(timezone.utc)
    conn.consecutive_failures = 0
    conn.last_error = None
    return result


async def sync_all_connections(db: AsyncSession) -> dict:
    """Scheduler entry point. One bad connection never stops the others."""
    totals = {"connections": 0, "matched": 0, "verified": 0, "views_updated": 0}
    connections = (
        (
            await db.execute(
                select(SocialConnection).where(SocialConnection.status == "active")
            )
        )
        .scalars()
        .all()
    )
    for conn in connections:
        totals["connections"] += 1
        try:
            outcome = await sync_connection(db, conn)
        except Exception:
            logger.exception(
                "Unexpected error syncing %s for creator %s", conn.platform, conn.creator_id
            )
            continue
        for key in ("matched", "verified", "views_updated"):
            totals[key] += outcome[key]
    await db.commit()
    return totals


async def sweep_oauth_states(db: AsyncSession) -> int:
    """Drop abandoned authorisation attempts. No user-visible effect — an
    expired row is already unusable; this just stops the table growing."""
    rows = (
        (
            await db.execute(
                select(OAuthState).where(OAuthState.expires_at < datetime.now(timezone.utc))
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        await db.delete(row)
    if rows:
        await db.commit()
    return len(rows)
