"""The creator payout formula.

Simple, transparent, and shown verbatim on the Earnings page:

- A video starts earning at 1.000 verified views.
- Base pay: EUR 5,00 once the video passes 1.000 views.
- Growth pay: + EUR 1,00 for every additional 1.000 views (up to 50.000 views).
- Scale pay: + EUR 0,50 per 1.000 views beyond 50.000.
- Cap: EUR 250,00 per video.

Examples: 1k -> EUR 5 · 10k -> EUR 14 · 50k -> EUR 54 · 100k -> EUR 79 · cap at ~442k.
"""
from app.config import settings

# Views only count for pay during the first N days after the video is posted
# (submission date is the proxy); after that the video's earnings lock in.
EARNING_WINDOW_DAYS = 10


def video_payout_cents(views: int) -> int:
    if views < settings.PAYOUT_MIN_VIEWS:
        return 0
    thousands = views // 1000
    tier1_k = min(thousands - 1, settings.PAYOUT_TIER1_MAX_K - 1)
    tier2_k = max(thousands - settings.PAYOUT_TIER1_MAX_K, 0)
    total = (
        settings.PAYOUT_BASE_CENTS
        + tier1_k * settings.PAYOUT_TIER1_CENTS_PER_K
        + tier2_k * settings.PAYOUT_TIER2_CENTS_PER_K
    )
    return min(total, settings.PAYOUT_CAP_CENTS)


def formula_description() -> dict:
    """Machine-readable formula, rendered by the frontend explainer."""
    return {
        "currency": "EUR",
        "window_days": EARNING_WINDOW_DAYS,
        "min_views": settings.PAYOUT_MIN_VIEWS,
        "base_cents": settings.PAYOUT_BASE_CENTS,
        "tier1_cents_per_1k": settings.PAYOUT_TIER1_CENTS_PER_K,
        "tier1_up_to_views": settings.PAYOUT_TIER1_MAX_K * 1000,
        "tier2_cents_per_1k": settings.PAYOUT_TIER2_CENTS_PER_K,
        "cap_cents": settings.PAYOUT_CAP_CENTS,
        "examples": [
            {"views": v, "payout_cents": video_payout_cents(v)}
            for v in (500, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000)
        ],
    }
