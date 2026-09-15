"""Video link parsing + view tracking.

- YouTube: views auto-refresh via the YouTube Data API (if configured).
- TikTok / Instagram: no public stats API — submissions stay `pending` until a
  Stalvian admin verifies them and records views (refreshed manually during
  payout runs). This is stated clearly to creators in the UI.
"""
import logging
import re
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import VideoSubmission, ViewSnapshot

logger = logging.getLogger(__name__)

# Hostname allowlists — substring matching would let evil.example/youtube.com pass.
_PLATFORM_HOSTS = {
    "youtube": {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"},
    "tiktok": {
        "tiktok.com", "www.tiktok.com", "m.tiktok.com",
        # Share-sheet short hosts. These carry no /video/<id>, so a link from
        # one canonicalizes differently from the full URL for the same video —
        # see _SHORT_LINK_HOSTS below.
        "vm.tiktok.com", "vt.tiktok.com",
    },
    "instagram": {"instagram.com", "www.instagram.com"},
}

_YT_ID = re.compile(r"^[\w-]{11}$")

# TikTok serves short-link redirects differently to non-browser clients.
_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0 Safari/537.36"
)


def detect_platform(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return "other"
    for platform, hosts in _PLATFORM_HOSTS.items():
        if host in hosts:
            return platform
    return "other"


def youtube_video_id(url: str) -> str | None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host not in _PLATFORM_HOSTS["youtube"]:
        return None
    candidate = None
    if host == "youtu.be":
        candidate = parsed.path.lstrip("/").split("/")[0]
    elif parsed.path == "/watch":
        candidate = (parse_qs(parsed.query).get("v") or [None])[0]
    elif parsed.path.startswith(("/shorts/", "/embed/", "/live/")):
        candidate = parsed.path.split("/")[2] if len(parsed.path.split("/")) > 2 else None
    if candidate and _YT_ID.match(candidate):
        return candidate
    return None


# Instagram serves the same media as /reel/<code>/ AND /<username>/reel/<code>/
# (its own share sheet emits the latter). Both must reduce to one key.
_IG_MEDIA = re.compile(r"^/(?:[\w.]+/)?(?:p|reel|reels|tv)/([\w-]+)")
_TIKTOK_VIDEO = re.compile(r"/video/(\d+)")

# Share-sheet links that hide the real video id behind a redirect. Canonicalizing
# one of these without resolving it yields a key that cannot match the same
# video's full URL — so the same video could be submitted, and paid, twice.
_SHORT_LINK_HOSTS = {"vm.tiktok.com", "vt.tiktok.com"}


def is_short_link(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host in _SHORT_LINK_HOSTS:
        return True
    # tiktok.com/t/<code> is the same thing on the main host.
    return host.endswith("tiktok.com") and parsed.path.startswith("/t/")


async def resolve_short_link(url: str) -> str:
    """Follow a share-sheet link to the canonical video URL.

    Returns the original URL unchanged on any failure — a submission must never
    fail because TikTok was slow. The caller still gets a usable (if
    unresolved) key, and the duplicate check stays best-effort rather than
    becoming a hard dependency on a third party.
    """
    if not is_short_link(url):
        return url
    try:
        async with httpx.AsyncClient(
            timeout=6, follow_redirects=True, max_redirects=5
        ) as client:
            resp = await client.get(url, headers={"User-Agent": _BROWSER_UA})
    except httpx.HTTPError as exc:
        logger.warning("Could not resolve short link %s: %s", url, exc)
        return url
    resolved = str(resp.url)
    # Only trust a resolution that actually landed on a video URL.
    if _TIKTOK_VIDEO.search(urlparse(resolved).path):
        return resolved
    logger.warning("Short link %s did not resolve to a video URL", url)
    return url


def canonical_key(url: str, platform: str) -> str:
    """Stable identity for a video so URL variants can't be paid twice.

    Same media through different URL shapes (watch vs live, /p/ vs /reel/)
    must collapse to one key. Shortcodes are case-sensitive — never lowercase
    them.
    """
    parsed = urlparse(url)
    if platform == "youtube":
        video_id = youtube_video_id(url)
        if video_id:
            return f"youtube:{video_id}"
    if platform == "instagram":
        match = _IG_MEDIA.match(parsed.path)
        if match:
            return f"instagram:{match.group(1)}"
    if platform == "tiktok":
        match = _TIKTOK_VIDEO.search(parsed.path)
        if match:
            return f"tiktok:{match.group(1)}"
    host = (parsed.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    return f"{platform}:{host}{parsed.path.rstrip('/')}"


# Re-exported so submit-path callers keep importing it from here, but the rule
# itself lives with the rest of the pay formula.
from app.payout import MAX_SUBMIT_AGE_DAYS  # noqa: E402,F401


async def fetch_youtube_stats(url: str) -> dict | None:
    """{views, published_at} for a YouTube URL, or None if unavailable."""
    if not settings.YOUTUBE_API_KEY:
        return None
    video_id = youtube_video_id(url)
    if not video_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                "https://www.googleapis.com/youtube/v3/videos",
                params={
                    "part": "statistics,snippet",
                    "id": video_id,
                    "key": settings.YOUTUBE_API_KEY,
                },
            )
    except httpx.HTTPError as exc:
        logger.warning("YouTube API request failed: %s", exc)
        return None
    if resp.status_code != 200:
        logger.warning("YouTube API %s: %s", resp.status_code, resp.text[:200])
        return None
    items = resp.json().get("items", [])
    if not items:
        return None
    try:
        published_raw = items[0].get("snippet", {}).get("publishedAt")
        published_at = (
            datetime.fromisoformat(published_raw.replace("Z", "+00:00"))
            if published_raw
            else None
        )
        return {
            "views": int(items[0]["statistics"].get("viewCount", 0)),
            "published_at": published_at,
        }
    except (KeyError, TypeError, ValueError):
        return None


async def fetch_youtube_views(url: str) -> int | None:
    stats = await fetch_youtube_stats(url)
    return stats["views"] if stats else None


async def refresh_youtube_views(db: AsyncSession) -> int:
    """Scheduler job: refresh view counts for YouTube videos.

    Only updates the numbers — verification stays a human decision, so a
    creator can't farm payouts by submitting someone else's viral video.
    """
    if not settings.YOUTUBE_API_KEY:
        return 0
    videos = (
        (
            await db.execute(
                select(VideoSubmission).where(
                    VideoSubmission.platform == "youtube",
                    VideoSubmission.status != "rejected",
                )
            )
        )
        .scalars()
        .all()
    )
    updated = 0
    for video in videos:
        views = await fetch_youtube_views(video.url)
        if views is not None:
            if views != video.views:
                db.add(ViewSnapshot(video_id=video.id, views=views))
            video.views = views
            video.views_updated_at = datetime.now(timezone.utc)
            updated += 1
    await db.commit()
    return updated
