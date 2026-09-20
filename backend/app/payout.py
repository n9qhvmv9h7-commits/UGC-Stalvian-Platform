"""The creator payout formulas — one per surface.

Both are simple, transparent, and shown verbatim on the Earnings page.

Video (TikTok / Instagram / YouTube):
- A video starts earning at 1.000 verified views.
- Base pay: EUR 5,00 once the video passes 1.000 views.
- Growth pay: + EUR 1,00 for every additional 1.000 views (up to 50.000).
- Scale pay: + EUR 0,50 per 1.000 views beyond 50.000.
- Cap: EUR 250,00 per video.
  Examples: 1k -> EUR 5 · 10k -> EUR 14 · 50k -> EUR 54 · 100k -> EUR 79.

X posts — front-loaded, because a tweet from a growing account lands in the
hundreds of impressions and the program needs people posting, not waiting:
- A post starts earning at 500 impressions.
- Base pay: EUR 3,00 at 500.
- Growth pay: + EUR 2,00 for every 1.000 impressions after the first 1.000
  (up to 10.000).
- Scale pay: + EUR 0,50 per 1.000 beyond 10.000.
- Cap: EUR 150,00 per post.
  Examples: 500 -> EUR 3 · 2k -> EUR 5 · 10k -> EUR 21 · 50k -> EUR 41.
- First-posts bounty: a creator's first N verified posts earn a flat bonus
  on top, whatever their reach.
- Launch multiplier: posts submitted on or before PAYOUT_X_LAUNCH_UNTIL have
  their views pay multiplied (still capped). Switched off by the date.

Both surfaces share the earning window, the submission deadline, the strikes,
the referral share and the balance.
"""
from collections import defaultdict
from datetime import date, datetime
from typing import Iterable

from app.config import settings
from app.models import VideoSubmission

# Views only count for pay during the first N days after the video is posted
# (submission date is the proxy); after that the video's earnings lock in.
EARNING_WINDOW_DAYS = 10

# Because the submission date is that proxy, a link has to arrive soon after
# posting — otherwise an old video would monetize its whole lifetime at once.
# Enforced on submit (app/services/view_tracker.py), checkable for YouTube.
MAX_SUBMIT_AGE_DAYS = 3

X_PLATFORMS = ("x",)


def is_x(platform: str | None) -> bool:
    return (platform or "") in X_PLATFORMS


def _curve(views: int, min_views: int, base: int, tier1: int, tier1_max_k: int, tier2: int, cap: int) -> int:
    """The shared shape: nothing under the floor, a base at the floor, then a
    rate per whole 1.000 above the first 1.000, a lower rate past tier1_max_k
    thousand, and a cap."""
    if views < min_views:
        return 0
    thousands = views // 1000
    tier1_k = max(min(thousands - 1, tier1_max_k - 1), 0)
    tier2_k = max(thousands - tier1_max_k, 0)
    return min(base + tier1_k * tier1 + tier2_k * tier2, cap)


def video_payout_cents(views: int) -> int:
    """The video curve, on views alone."""
    return _curve(
        views,
        settings.PAYOUT_MIN_VIEWS,
        settings.PAYOUT_BASE_CENTS,
        settings.PAYOUT_TIER1_CENTS_PER_K,
        settings.PAYOUT_TIER1_MAX_K,
        settings.PAYOUT_TIER2_CENTS_PER_K,
        settings.PAYOUT_CAP_CENTS,
    )


def x_payout_cents(views: int) -> int:
    """The X curve, on impressions alone (no multiplier, no bounty)."""
    return _curve(
        views,
        settings.PAYOUT_X_MIN_VIEWS,
        settings.PAYOUT_X_BASE_CENTS,
        settings.PAYOUT_X_TIER1_CENTS_PER_K,
        settings.PAYOUT_X_TIER1_MAX_K,
        settings.PAYOUT_X_TIER2_CENTS_PER_K,
        settings.PAYOUT_X_CAP_CENTS,
    )


def views_payout_cents(views: int, platform: str | None) -> int:
    return x_payout_cents(views) if is_x(platform) else video_payout_cents(views)


def launch_until() -> date | None:
    """The last submission day the X launch multiplier applies to, or None
    when it is not configured."""
    raw = (settings.PAYOUT_X_LAUNCH_UNTIL or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def launch_active(today: date | None = None) -> bool:
    until = launch_until()
    return until is not None and (today or datetime.utcnow().date()) <= until


def launch_multiplier_for(video: VideoSubmission) -> float:
    """The multiplier a post keeps for life: it depends on when the post was
    submitted, not on when it is looked at, so a launch-period post does not
    lose money the day the launch ends."""
    if not is_x(video.platform):
        return 1.0
    until = launch_until()
    posted = video.created_at.date() if video.created_at else None
    if until is None or posted is None or posted > until:
        return 1.0
    return float(settings.PAYOUT_X_LAUNCH_MULTIPLIER)


def post_payout_cents(video: VideoSubmission, views: int) -> int:
    """What one verified post's views are worth: the surface's curve, times
    the launch multiplier it was submitted under, never above the cap."""
    base = views_payout_cents(views, video.platform)
    mult = launch_multiplier_for(video)
    if mult == 1.0:
        return base
    return min(int(round(base * mult)), settings.PAYOUT_X_CAP_CENTS)


def first_post_bonus_map(videos: Iterable[VideoSubmission]) -> dict[int, int]:
    """video_id -> bounty cents for the first N verified X posts of each
    creator, in submission order. Pass EVERY verified post of the creators
    involved: rank is over the whole account, so a partial list misranks."""
    n = settings.PAYOUT_X_FIRST_POSTS
    bonus = settings.PAYOUT_X_FIRST_POST_BONUS_CENTS
    if n <= 0 or bonus <= 0:
        return {}
    by_creator: dict[int, list[VideoSubmission]] = defaultdict(list)
    for v in videos:
        if v.status == "verified" and is_x(v.platform):
            by_creator[v.creator_id].append(v)
    out: dict[int, int] = {}
    for posts in by_creator.values():
        posts.sort(key=lambda v: (v.created_at or datetime.min, v.id))
        for v in posts[:n]:
            out[v.id] = bonus
    return out


def _examples(pay, views_list):
    return [{"views": v, "payout_cents": pay(v)} for v in views_list]


def formula_description(surface: str = "video") -> dict:
    """Machine-readable formula for one surface, rendered by the frontend
    explainer and simulator."""
    shared = {
        "currency": "EUR",
        "window_days": EARNING_WINDOW_DAYS,
        "submit_within_days": MAX_SUBMIT_AGE_DAYS,
        # Second income stream: share of every fee paid by referred clients.
        "commission_bps": settings.REFERRAL_COMMISSION_BPS,
        "commission_pct": settings.REFERRAL_COMMISSION_BPS / 100,
    }
    if surface == "tweets":
        until = launch_until()
        return {
            **shared,
            "kind": "x",
            "min_views": settings.PAYOUT_X_MIN_VIEWS,
            "base_cents": settings.PAYOUT_X_BASE_CENTS,
            "tier1_cents_per_1k": settings.PAYOUT_X_TIER1_CENTS_PER_K,
            "tier1_up_to_views": settings.PAYOUT_X_TIER1_MAX_K * 1000,
            "tier2_cents_per_1k": settings.PAYOUT_X_TIER2_CENTS_PER_K,
            "cap_cents": settings.PAYOUT_X_CAP_CENTS,
            "first_posts": settings.PAYOUT_X_FIRST_POSTS,
            "first_post_bonus_cents": settings.PAYOUT_X_FIRST_POST_BONUS_CENTS,
            "launch_multiplier": float(settings.PAYOUT_X_LAUNCH_MULTIPLIER),
            "launch_until": until.isoformat() if until else None,
            "launch_active": launch_active(),
            "examples": _examples(
                x_payout_cents, (500, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 300000)
            ),
        }
    return {
        **shared,
        "kind": "video",
        "min_views": settings.PAYOUT_MIN_VIEWS,
        "base_cents": settings.PAYOUT_BASE_CENTS,
        "tier1_cents_per_1k": settings.PAYOUT_TIER1_CENTS_PER_K,
        "tier1_up_to_views": settings.PAYOUT_TIER1_MAX_K * 1000,
        "tier2_cents_per_1k": settings.PAYOUT_TIER2_CENTS_PER_K,
        "cap_cents": settings.PAYOUT_CAP_CENTS,
        "first_posts": 0,
        "first_post_bonus_cents": 0,
        "launch_multiplier": 1.0,
        "launch_until": None,
        "launch_active": False,
        "examples": _examples(
            video_payout_cents, (500, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000)
        ),
    }
