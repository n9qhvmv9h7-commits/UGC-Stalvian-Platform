"""Earnings: transparent formula, live balance, payout history, daily chart."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_approved_creator
from app.database import get_db
from app.models import Creator, Payout, VideoSubmission
from app.payout import formula_description, video_payout_cents
from app.services.earning_window import eligible_views_map
from app.services.metrics import daily_metrics_db

router = APIRouter(prefix="/api/earnings", tags=["earnings"])


@router.get("/formula")
async def get_formula():
    """Public — shown on the landing page too."""
    return formula_description()


@router.get("/daily")
async def daily_earnings(
    days: int = Query(default=30, ge=7, le=365),
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    """Earnings attributed per day: for each verified video, the payout delta
    produced by that day's view growth (from ViewSnapshot history)."""
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
    metrics = await daily_metrics_db(db, videos, days)
    return {
        "days": [
            {"date": day.isoformat(), "earned_cents": metrics[day].earned_cents}
            for day in sorted(metrics)
        ],
        "total_cents": sum(m.earned_cents for m in metrics.values()),
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
    earned = sum(video_payout_cents(eligible[v.id]) for v in verified)
    paid = sum(p.amount_cents for p in payouts if p.status == "paid")
    total_views = sum(eligible[v.id] for v in verified)

    return {
        "earned_cents": earned,
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
