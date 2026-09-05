"""Admin: invite creators, verify videos, record view counts, log payouts."""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_admin, hash_password
from app.database import get_db
from app.models import Creator, Payout, VideoSubmission, ViewSnapshot
from app.payout import video_payout_cents
from app.services.audit import audit
from app.services.earning_window import eligible_views_map, window_cutoff
from app.services.translator import SUPPORTED_LANGUAGES

from datetime import datetime, timezone

router = APIRouter(prefix="/api/admin", tags=["admin"])


class ReviewVideoRequest(BaseModel):
    # removed = the creator deleted the posted video -> records a strike;
    # two strikes terminate the partnership.
    status: str | None = None  # verified | rejected | pending | removed
    views: int | None = Field(default=None, ge=0)
    review_note: str | None = None


class RecordPayoutRequest(BaseModel):
    creator_id: int
    amount_cents: int = Field(gt=0)
    note: str | None = None


class ReviewCreatorRequest(BaseModel):
    status: str  # approved | rejected | pending | terminated
    review_note: str | None = Field(default=None, max_length=255)


class CreateCreatorRequest(BaseModel):
    """Invite-only access: the team adds an email here; there is no signup."""

    email: EmailStr
    name: str | None = Field(default=None, max_length=120)
    language: str = "en"
    # omit to have a one-time password generated and returned in the response
    password: str | None = Field(default=None, min_length=8, max_length=72)


@router.post("/creators")
async def create_creator(
    request: CreateCreatorRequest,
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    email = request.email.lower().strip()
    if request.language not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=400, detail=f"Language must be one of {SUPPORTED_LANGUAGES}")
    existing = (
        await db.execute(select(Creator).where(Creator.email == email))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    generated = request.password is None
    password = request.password or secrets.token_urlsafe(12)
    creator = Creator(
        email=email,
        password_hash=hash_password(password),
        name=(request.name or email.split("@")[0]).strip(),
        language=request.language,
        status="approved",
    )
    db.add(creator)
    try:
        await db.flush()  # creator.id for the audit row, committed atomically
        await audit(
            db, admin, "creator.invite", "creator", creator.id,
            {"email": email, "name": creator.name, "language": creator.language,
             "password_generated": generated},
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    await db.refresh(creator)
    return {
        "creator": {"id": creator.id, "email": creator.email, "name": creator.name},
        # shown once to the admin, who shares it with the creator
        "password": password if generated else None,
    }


def _socials(creator: Creator) -> list[dict]:
    links = [
        ("tiktok", creator.tiktok_handle, "https://www.tiktok.com/@{}"),
        ("instagram", creator.instagram_handle, "https://www.instagram.com/{}"),
        ("youtube", creator.youtube_handle, "https://www.youtube.com/@{}"),
    ]
    return [
        {"platform": platform, "handle": handle, "url": url.format(handle)}
        for platform, handle, url in links
        if handle
    ]


@router.get("/creators")
async def list_creators(
    status: str | None = "pending",
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    query = select(Creator)
    if status:
        query = query.where(Creator.status == status)
    creators = (
        (await db.execute(query.order_by(Creator.created_at.desc()).limit(500))).scalars().all()
    )
    return {
        "items": [
            {
                "id": c.id,
                "name": c.name,
                "email": c.email,
                "language": c.language,
                "country": c.country,
                "status": c.status,
                "review_note": c.review_note,
                "strikes": c.strikes,
                "payout_method": c.payout_method,
                "payout_ready": bool(c.payout_method and c.payout_details),
                "socials": _socials(c),
                "is_admin": c.is_admin,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in creators
        ]
    }


@router.patch("/creators/{creator_id}")
async def review_creator(
    creator_id: int,
    request: ReviewCreatorRequest,
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if request.status not in ("pending", "approved", "rejected", "terminated"):
        raise HTTPException(status_code=400, detail="Invalid status")
    creator = (
        await db.execute(select(Creator).where(Creator.id == creator_id))
    ).scalar_one_or_none()
    if creator is None:
        raise HTTPException(status_code=404, detail="Creator not found")
    old_status = creator.status
    creator.status = request.status
    if request.review_note is not None:
        creator.review_note = request.review_note or None
    await audit(
        db, admin, "creator.review", "creator", creator.id,
        {"from": old_status, "to": request.status, "note": request.review_note},
    )
    await db.commit()
    return {"status": "ok"}


@router.get("/videos")
async def all_videos(
    status: str | None = None,
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    query = select(VideoSubmission, Creator).join(Creator, VideoSubmission.creator_id == Creator.id)
    if status:
        query = query.where(VideoSubmission.status == status)
    rows = (await db.execute(query.order_by(VideoSubmission.created_at.desc()).limit(500))).all()
    # Payout shown to admins must match what the creator sees: window-limited.
    eligible = await eligible_views_map(db, [v for v, _ in rows])
    return {
        "items": [
            {
                "id": v.id,
                "url": v.url,
                "platform": v.platform,
                "title": v.title,
                "story_id": v.story_id,
                "status": v.status,
                "review_note": v.review_note,
                "views": v.views,
                "eligible_views": eligible.get(v.id, v.views),
                "earning_until": window_cutoff(v).date().isoformat(),
                "payout_cents": (
                    video_payout_cents(eligible.get(v.id, v.views))
                    if v.status == "verified"
                    else 0
                ),
                "creator": {"id": c.id, "name": c.name, "email": c.email, "handle": c.handle},
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v, c in rows
        ]
    }


@router.patch("/videos/{video_id}")
async def review_video(
    video_id: int,
    request: ReviewVideoRequest,
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    video = (
        await db.execute(select(VideoSubmission).where(VideoSubmission.id == video_id))
    ).scalar_one_or_none()
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found")
    old_status, old_views = video.status, video.views
    strike_info = None
    if request.status is not None:
        if request.status not in ("pending", "verified", "rejected", "removed"):
            raise HTTPException(status_code=400, detail="Invalid status")
        if request.status == "removed" and video.status != "removed":
            owner = (
                await db.execute(select(Creator).where(Creator.id == video.creator_id))
            ).scalar_one()
            owner.strikes += 1
            if owner.strikes >= 2 and not owner.is_admin:
                owner.status = "terminated"
                owner.review_note = "Two deleted videos — partnership ended"
            strike_info = {"strikes": owner.strikes, "creator_status": owner.status}
        video.status = request.status
    if request.views is not None:
        if request.views != video.views:
            db.add(ViewSnapshot(video_id=video.id, views=request.views))
        video.views = request.views
        video.views_updated_at = datetime.now(timezone.utc)
    if request.review_note is not None:
        video.review_note = request.review_note
    detail = {}
    if request.status is not None and request.status != old_status:
        detail["from_status"] = old_status
        detail["to_status"] = request.status
    if request.views is not None and request.views != old_views:
        detail["views_from"] = old_views
        detail["views_to"] = request.views
    if request.review_note:
        detail["note"] = request.review_note
    if strike_info:
        detail["strike"] = strike_info
    if detail:
        await audit(db, admin, "video.review", "video", video.id, detail)
    await db.commit()
    return {"status": "ok", "strike": strike_info}


@router.post("/payouts")
async def record_payout(
    request: RecordPayoutRequest,
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    creator = (
        await db.execute(select(Creator).where(Creator.id == request.creator_id))
    ).scalar_one_or_none()
    if creator is None:
        raise HTTPException(status_code=404, detail="Creator not found")
    payout = Payout(
        creator_id=request.creator_id,
        amount_cents=request.amount_cents,
        status="paid",
        note=request.note,
    )
    db.add(payout)
    await db.flush()
    await audit(
        db, admin, "payout.record", "payout", payout.id,
        {"creator_id": request.creator_id, "amount_cents": request.amount_cents,
         "note": request.note},
    )
    await db.commit()
    return {"status": "ok"}
