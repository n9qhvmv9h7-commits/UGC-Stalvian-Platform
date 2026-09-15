"""Earnings: transparent formula, live balance, payout history, daily chart."""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_approved_creator
from app.database import get_db
from app.models import Creator, Payout, VideoSubmission
from app.payout import formula_description, video_payout_cents
from app.services.earning_window import eligible_views_map, naive
from app.services.metrics import daily_metrics_db
from app.services.referrals import commission_totals, daily_commission

router = APIRouter(prefix="/api/earnings", tags=["earnings"])


@router.get("/formula")
async def get_formula():
    """Public — shown on the landing page too."""
    return formula_description()


# A chart is drawn one bar per day, so an unbounded range is just a way to ask
# for an unreadable chart and a slow query.
MAX_RANGE_DAYS = 1095  # three years


@router.get("/daily")
async def daily_earnings(
    days: int = Query(default=30, ge=1, le=MAX_RANGE_DAYS),
    start: date | None = Query(default=None, description="First day, inclusive (YYYY-MM-DD)"),
    end: date | None = Query(default=None, description="Last day, inclusive; defaults to today"),
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    """Earnings attributed per day: for each verified video, the payout delta
    produced by that day's view growth (from ViewSnapshot history), plus the
    referral commission dated that day.

    Either pass `days` for a trailing window, or `start`/`end` for an explicit
    range — the date picker sends the latter."""
    span, last_day = days, None
    if start is not None or end is not None:
        # Nothing can be earned in the future, so an end past today is a clamp,
        # not an error — it just means "up to now".
        today = datetime.now(timezone.utc).date()
        last_day = min(end or today, today)
        first_day = start if start is not None else last_day - timedelta(days=days - 1)
        if first_day > last_day:
            raise HTTPException(status_code=400, detail="start must be on or before end")
        span = (last_day - first_day).days + 1
        if span > MAX_RANGE_DAYS:
            raise HTTPException(
                status_code=400, detail=f"Range is longer than {MAX_RANGE_DAYS} days"
            )

    videos = (
        (
            await db.execute(
                select(VideoSubmission).where(
                    VideoSubmission.creator_id == creator.id,
                    VideoSubmission.status == "verified",
                )
            )
        )
        .scalars()
        .all()
    )
    metrics = await daily_metrics_db(db, videos, span, last_day)
    commission = await daily_commission(db, [creator.id], span, last_day)
    return {
        "days": [
            {
                "date": day.isoformat(),
                "views_cents": metrics[day].earned_cents,
                "commission_cents": commission.get(day, 0),
                "earned_cents": metrics[day].earned_cents + commission.get(day, 0),
            }
            for day in sorted(metrics)
        ],
        "views_cents": sum(m.earned_cents for m in metrics.values()),
        "commission_cents": sum(commission.values()),
        "total_cents": sum(m.earned_cents for m in metrics.values()) + sum(commission.values()),
    }


@router.get("")
async def my_earnings(
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    videos = (
        (
            await db.execute(
                select(VideoSubmission).where(VideoSubmission.creator_id == creator.id)
            )
        )
        .scalars()
        .all()
    )
    payouts = (
        (
            await db.execute(
                select(Payout)
                .where(Payout.creator_id == creator.id)
                .order_by(Payout.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    verified = [v for v in videos if v.status == "verified"]
    eligible = await eligible_views_map(db, verified)
    views_earned = sum(video_payout_cents(eligible[v.id]) for v in verified)
    referral = (await commission_totals(db, [creator.id])).get(creator.id) or {
        "fees_cents": 0, "commission_cents": 0, "clients": 0, "active_clients": 0,
    }
    # One balance, two streams: views pay + share of referred clients' fees.
    earned = views_earned + referral["commission_cents"]
    paid = sum(p.amount_cents for p in payouts if p.status == "paid")
    total_views = sum(eligible[v.id] for v in verified)

    # "Pending to pay" is THIS MONTH's earnings that have not been settled —
    # balances are paid out monthly, so what a creator is waiting on is the
    # month in progress, not the all-time gap between earned and paid.
    today = datetime.now(timezone.utc).date()
    month_start = today.replace(day=1)
    month_days = (today - month_start).days + 1
    month_metrics = await daily_metrics_db(db, verified, month_days)
    month_commission = await daily_commission(db, [creator.id], month_days)
    month_earned = sum(m.earned_cents for m in month_metrics.values()) + sum(
        month_commission.values()
    )
    month_paid = sum(
        p.amount_cents
        for p in payouts
        if p.status == "paid" and naive(p.created_at) and naive(p.created_at).date() >= month_start
    )
    pending = max(month_earned - month_paid, 0)

    return {
        "earned_cents": earned,
        # This calendar month only — see the comment above.
        "month_earned_cents": month_earned,
        "pending_cents": pending,
        "views_earned_cents": views_earned,
        "commission_earned_cents": referral["commission_cents"],
        "referral": {
            "code": creator.referral_code,
            "clients": referral["clients"],
            "active_clients": referral["active_clients"],
            "fees_cents": referral["fees_cents"],
            "commission_cents": referral["commission_cents"],
        },
        "paid_cents": paid,
        "balance_cents": max(earned - paid, 0),
        "total_views": total_views,
        "verified_videos": sum(1 for v in videos if v.status == "verified"),
        "pending_videos": sum(1 for v in videos if v.status == "pending"),
        "payouts": [
            {
                "id": p.id,
                "amount_cents": p.amount_cents,
                "status": p.status,
                "note": p.note,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in payouts
        ],
        "formula": formula_description(),
    }
