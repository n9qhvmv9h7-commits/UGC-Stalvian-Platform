"""Album Stories: pick an album + angle, get a localized script."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_approved_creator
from app.database import get_db
from app.models import Creator, Story
from app.services.panel_client import FUND_ANGLES, POLITICIAN_ANGLES, PanelError, panel
from app.services.stories import (
    cache_get,
    cache_set,
    cached_fetch,
    localized_payload,
    normalize_scenes,
)
from app.services.translator import translate_payload

import asyncio

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/stories", tags=["stories"])

ANGLE_LABELS = {
    "origin_story": "Origin story",
    "performance": "Performance",
    "trading_record": "Trading record",
    "scandal": "Scandal / drama",
    "positions": "Current positions",
    "committee_trades": "Committee conflicts",
    "hypocrisy": "Hypocrisy",
    "best_trades": "Best trades",
    "strategy": "Strategy",
    "ceo_founder": "The founder",
    "funny_quirky": "Funny / quirky",
    "comparison": "Head-to-head",
}


class GenerateStoryRequest(BaseModel):
    album_kind: str  # fund | politician
    album_name: str
    album_slug: str | None = None  # preferred exact key; name is the fallback
    angle: str


@router.get("/albums")
async def list_albums(
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    """All albums a creator can tell stories about, with allowed angles.

    Served from the locally stored catalog (refreshed by the single panel sync
    pipeline). A live fetch happens only if the cache was never filled, so a
    panel outage never blanks the album picker."""
    cached = await cache_get(db, "albums")
    if cached is None:
        try:
            cached = await panel.list_albums()
            await cache_set(db, "albums", cached)
        except PanelError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
    funds, politicians = cached.get("funds", []), cached.get("politicians", [])
    return {
        "funds": funds,
        "politicians": politicians,
        "fund_angles": [{"key": a, "label": ANGLE_LABELS[a]} for a in FUND_ANGLES],
        "politician_angles": [{"key": a, "label": ANGLE_LABELS[a]} for a in POLITICIAN_ANGLES],
    }


@router.get("/albums/{slug}/history")
async def album_history(
    slug: str,
    range: str = "all",  # 1y | all
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    """Portfolio-vs-S&P series for the album chart (index values, 100 = start).
    Proxied from the panel's public portfolios API and cached locally."""
    if range not in ("1y", "all"):
        raise HTTPException(status_code=400, detail="range must be 1y or all")
    try:
        return await cached_fetch(
            db, f"phist:{slug}:{range}", lambda: panel.portfolio_history(slug, range)
        )
    except PanelError as exc:
        raise HTTPException(status_code=503, detail=f"Chart data unavailable: {exc}")


@router.get("/albums/{slug}/detail")
async def album_detail(
    slug: str,
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    """Current holdings + full summary (incl. beta) for one album."""
    try:
        return await cached_fetch(db, f"pdetail:{slug}", lambda: panel.portfolio_detail(slug))
    except PanelError as exc:
        raise HTTPException(status_code=503, detail=f"Holdings unavailable: {exc}")


@router.post("/generate")
async def generate_story(
    request: GenerateStoryRequest,
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    if request.album_kind not in ("fund", "politician"):
        raise HTTPException(status_code=400, detail="album_kind must be fund or politician")
    valid = FUND_ANGLES if request.album_kind == "fund" else POLITICIAN_ANGLES
    if request.angle not in valid:
        raise HTTPException(status_code=400, detail=f"Angle must be one of {valid}")

    try:
        result = await panel.generate_album_story(
            kind=request.album_kind,
            name=request.album_name,
            angle=request.angle,
            slug=request.album_slug,
        )
    except PanelError as exc:
        raise HTTPException(status_code=502, detail=f"Story generation failed: {exc}")

    payload = {
        "title": result.get("title"),
        "hook": result.get("hook"),
        "script_body": result.get("script_body"),
        "scenes": normalize_scenes(result.get("scenes")),
        "alternative_hooks": result.get("alternative_hooks") or [],
        "call_to_action": result.get("call_to_action"),
        "hashtags": result.get("hashtags") or [],
        "virality_score": result.get("virality_score"),
        "sources": result.get("sources") or [],
    }
    english_payload = payload
    story_language = "en"
    if creator.language != "en":
        translated = await asyncio.get_event_loop().run_in_executor(
            None, lambda: translate_payload(payload, creator.language)
        )
        if translated is not None:
            payload = translated
            story_language = creator.language
        # else: keep English and language="en" — localized_payload retries later

    story = Story(
        creator_id=creator.id,
        kind="album_story",
        panel_ref=str(result.get("id")) if result.get("id") is not None else None,
        album_name=request.album_name,
        album_kind=request.album_kind,
        angle=request.angle,
        language=story_language,
        payload=payload,
        raw=result,  # the exact panel response, untrimmed
        # keep the English source alongside a translated primary payload
        translations={"en": english_payload} if story_language != "en" else {},
    )
    db.add(story)
    await db.commit()
    await db.refresh(story)
    return _story_response(story, payload)


@router.get("/mine")
async def my_stories(
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        (
            await db.execute(
                select(Story)
                .where(Story.creator_id == creator.id, Story.kind == "album_story")
                .order_by(Story.created_at.desc())
                .limit(100)
            )
        )
        .scalars()
        .all()
    )
    out = []
    for story in rows:
        payload = await localized_payload(db, story, creator.language)
        out.append(_story_response(story, payload))
    return {"items": out}


def _story_response(story: Story, payload: dict) -> dict:
    return {
        "id": story.id,
        "kind": story.kind,
        "album_name": story.album_name,
        "album_kind": story.album_kind,
        "angle": story.angle,
        "angle_label": ANGLE_LABELS.get(story.angle or "", story.angle),
        "language": story.language,
        "created_at": story.created_at.isoformat() if story.created_at else None,
        **payload,
    }
