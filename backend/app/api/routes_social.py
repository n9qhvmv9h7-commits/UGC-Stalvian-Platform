"""Connected social accounts: what a creator has linked, and what they must.

Only the read and disconnect halves exist so far. The OAuth flow itself
(authorize / callback) lands next, once TikTok app review is underway — the
model, the policy and the gate are useful before then, because they let the
whole UI half ship and be exercised in production with the gate dormant.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_approved_creator
from app.database import get_db
from app.models import Creator, SocialConnection
from app.services.social import policy

router = APIRouter(prefix="/api/social", tags=["social"])


@router.get("/connections")
async def list_connections(
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    """Policy and connections in ONE response, so the two can never disagree.

    The app builds its connect panel and its submit gate from this, rather than
    hardcoding which platforms are gated — that set changes when a flag flips,
    and a frontend rebuild must not be required to keep up.
    """
    rows = (
        (
            await db.execute(
                select(SocialConnection).where(SocialConnection.creator_id == creator.id)
            )
        )
        .scalars()
        .all()
    )
    by_platform = {c.platform: c for c in rows}
    active = {c.platform for c in rows if c.status == "active"}

    platforms = []
    for platform in ("tiktok", "instagram", "youtube"):
        conn = by_platform.get(platform)
        platforms.append(
            {
                "platform": platform,
                "label": policy.label(platform),
                "requires_connection": policy.requires_connection(platform),
                # Whether we could start a flow at all — false for YouTube by
                # design, and false for a platform whose credentials are unset.
                "connectable": policy.connectable(platform),
                "connected": conn is not None and conn.status == "active",
                "status": conn.status if conn else None,
                "account_handle": conn.account_handle if conn else None,
                "last_synced_at": (
                    conn.last_synced_at.isoformat() if conn and conn.last_synced_at else None
                ),
                "can_submit": policy.can_submit(platform, active),
            }
        )

    return {
        "platforms": platforms,
        # Platforms the creator currently cannot submit for. The app shows the
        # connect prompt only when a pasted URL lands on one of these.
        "blocked_platforms": sorted(p for p in policy.required_platforms() if p not in active),
    }


@router.delete("/{platform}")
async def disconnect(
    platform: str,
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    """Unlink an account.

    Videos already verified through it stay verified — the evidence was true
    when it was recorded, and re-litigating past payouts because a creator
    unlinked an account would be wrong.
    """
    conn = (
        await db.execute(
            select(SocialConnection).where(
                SocialConnection.creator_id == creator.id,
                SocialConnection.platform == platform,
            )
        )
    ).scalar_one_or_none()
    if conn is None:
        raise HTTPException(status_code=404, detail="No connected account for that platform")
    # TODO when the OAuth flow lands: revoke with the platform too, not just
    # locally — deleting our row leaves their grant standing.
    await db.delete(conn)
    await db.commit()
    return {"status": "ok"}
