"""Admin dashboards: overview KPIs + charts, per-creator metrics, content
performance, payout balances, audit trail.

Status policy (applies to every aggregate here):
- € figures count VERIFIED videos only, window-clamped (eligible) — they must
  reconcile to the cent with what creators see on their earnings pages.
- Views charts count verified videos only but show REAL growth (including
  after the earning window closes — reach, not pay).
- `pending` appears only as counts; rejected/removed only in the status
  breakdown; soft-deleted videos are hidden everywhere.
- Admin accounts are excluded from leaderboards, active counts, and balances.

All aggregation happens in Python over a handful of batched queries (portable
across SQLite/Postgres; datasets are small at this scale).
"""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_admin
from app.database import get_db
from app.models import AuditLog, Creator, Payout, Story, VideoSubmission
from app.payout import video_payout_cents
from app.services.earning_window import eligible_views_map
from app.services.metrics import daily_metrics, fetch_snapshots
from app.services.referrals import commission_totals, daily_commission

router = APIRouter(prefix="/api/admin", tags=["admin-metrics"])


async def _fetch_videos(db: AsyncSession) -> list[VideoSubmission]:
    return (
        (
            await db.execute(
                select(VideoSubmission).where(VideoSubmission.status != "deleted")
            )
        )
        .scalars()
        .all()
    )


async def _earned_by_creator(
    db: AsyncSession, verified: list[VideoSubmission]
) -> tuple[dict[int, int], dict[int, int]]:
    """(earned_cents, eligible_views) summed per creator_id — one batch."""
    eligible = await eligible_views_map(db, verified)
    earned: dict[int, int] = defaultdict(int)
    views: dict[int, int] = defaultdict(int)
    for v in verified:
        earned[v.creator_id] += video_payout_cents(eligible.get(v.id, 0))
        views[v.creator_id] += eligible.get(v.id, 0)
    return earned, views


@router.get("/overview")
async def overview(
    days: int = Query(default=30, ge=7, le=365),
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    videos = await _fetch_videos(db)
    verified = [v for v in videos if v.status == "verified"]
    creators = (await db.execute(select(Creator))).scalars().all()
    payouts = (await db.execute(select(Payout))).scalars().all()
    snaps = await fetch_snapshots(db, [v.id for v in verified])

    period = daily_metrics(verified, snaps, days)
    eligible = await eligible_views_map(db, verified)  # once, for everything below
    earned_by_creator: dict[int, int] = defaultdict(int)
    eligible_views_by_creator: dict[int, int] = defaultdict(int)
    for v in verified:
        earned_by_creator[v.creator_id] += video_payout_cents(eligible.get(v.id, 0))
        eligible_views_by_creator[v.creator_id] += eligible.get(v.id, 0)
    # Referral commission is the second stream in every € figure below —
    # balances must match what creators see, and they see one balance.
    commission = await commission_totals(db)
    views_earned_by_creator = dict(earned_by_creator)
    for cid, t in commission.items():
        earned_by_creator[cid] += t["commission_cents"]
    admins = {c.id for c in creators if c.is_admin}
    period_commission = await daily_commission(
        db, [c.id for c in creators if not c.is_admin], days
    )
    paid_by_creator: dict[int, int] = defaultdict(int)
    for p in payouts:
        if p.status == "paid":
            paid_by_creator[p.creator_id] += p.amount_cents
    # Clamped per creator — must equal the sum of creator-page balances.
    outstanding = sum(
        max(earned_by_creator.get(cid, 0) - paid_by_creator.get(cid, 0), 0)
        for cid in set(earned_by_creator) | set(paid_by_creator)
        if cid not in admins
    )

    platforms: dict[str, dict] = defaultdict(lambda: {"views": 0, "videos": 0})
    for v in verified:
        platforms[v.platform]["views"] += v.views
        platforms[v.platform]["videos"] += 1
    statuses: dict[str, int] = defaultdict(int)
    for v in videos:
        statuses[v.status] += 1

    # Top creators by period views gained — reuse the fetched snapshot dict,
    # never re-query per creator.
    by_creator_videos: dict[int, list[VideoSubmission]] = defaultdict(list)
    for v in verified:
        if v.creator_id not in admins:
            by_creator_videos[v.creator_id].append(v)
    creator_names = {c.id: c for c in creators}
    ranked = []
    for cid, vids in by_creator_videos.items():
        gained = sum(m.views_gained for m in daily_metrics(vids, snaps, days).values())
        spark = [
            m.views_gained
            for _, m in sorted(daily_metrics(vids, snaps, 14).items())
        ]
        c = creator_names[cid]
        ranked.append(
            {
                "id": cid,
                "name": c.name,
                "handle": c.handle,
                "views_gained": gained,
                "eligible_views": eligible_views_by_creator.get(cid, 0),
                "earned_cents": earned_by_creator.get(cid, 0),
                "spark": spark,
            }
        )
    ranked.sort(key=lambda r: (r["views_gained"], r["eligible_views"]), reverse=True)

    # Top videos by period view growth — which uploads are actually working.
    top_videos = []
    for v in verified:
        gained = sum(m.views_gained for m in daily_metrics([v], snaps, days).values())
        owner = creator_names.get(v.creator_id)
        top_videos.append(
            {
                "id": v.id,
                "url": v.url,
                "platform": v.platform,
                "title": v.title,
                "creator_name": owner.name if owner else f"Creator #{v.creator_id}",
                "views_gained": gained,
                "total_views": v.views,
                "eligible_views": eligible.get(v.id, 0),
                "payout_cents": video_payout_cents(eligible.get(v.id, 0)),
            }
        )
    top_videos.sort(key=lambda r: (r["views_gained"], r["total_views"]), reverse=True)
    top_videos = top_videos[:12]

    period_views_cents = sum(m.earned_cents for m in period.values())
    period_commission_cents = sum(period_commission.values())
    return {
        "kpis": {
            "views_gained": sum(m.views_gained for m in period.values()),
            "earned_cents": period_views_cents + period_commission_cents,
            "views_earned_cents": period_views_cents,
            "commission_cents": period_commission_cents,
            "total_earned_cents": sum(
                v for cid, v in earned_by_creator.items() if cid not in admins
            ),
            "total_views_earned_cents": sum(
                v for cid, v in views_earned_by_creator.items() if cid not in admins
            ),
            "total_commission_cents": sum(
                t["commission_cents"] for cid, t in commission.items() if cid not in admins
            ),
            "referred_clients": sum(
                t["clients"] for cid, t in commission.items() if cid not in admins
            ),
            "paid_cents": sum(
                v for cid, v in paid_by_creator.items() if cid not in admins
            ),
            "outstanding_cents": outstanding,
            "active_creators": sum(
                1 for c in creators if c.status == "approved" and not c.is_admin
            ),
            "pending_review": statuses.get("pending", 0),
        },
        "daily": [
            {
                "date": d.isoformat(),
                "views": m.views_gained,
                "views_cents": m.earned_cents,
                "commission_cents": period_commission.get(d, 0),
                "earned_cents": m.earned_cents + period_commission.get(d, 0),
            }
            for d, m in sorted(period.items())
        ],
        "platforms": [
            {"platform": p, **agg} for p, agg in sorted(platforms.items())
        ],
        "statuses": [
            {"status": s, "count": n}
            for s, n in sorted(statuses.items())
            if s != "deleted"
        ],
        "top_creators": ranked[:5],
        "top_videos": top_videos,
    }


@router.get("/creators/metrics")
async def creators_metrics(
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    videos = await _fetch_videos(db)
    verified = [v for v in videos if v.status == "verified"]
    creators = (await db.execute(select(Creator))).scalars().all()
    payouts = (await db.execute(select(Payout))).scalars().all()
    views_earned, eligible_views = await _earned_by_creator(db, verified)
    commission = await commission_totals(db)
    earned: dict[int, int] = defaultdict(int)
    for cid in set(views_earned) | set(commission):
        earned[cid] = views_earned.get(cid, 0) + commission.get(cid, {}).get("commission_cents", 0)

    videos_by_creator: dict[int, int] = defaultdict(int)
    verified_by_creator: dict[int, int] = defaultdict(int)
    total_views_by_creator: dict[int, int] = defaultdict(int)
    for v in videos:
        videos_by_creator[v.creator_id] += 1
        if v.status == "verified":
            verified_by_creator[v.creator_id] += 1
            total_views_by_creator[v.creator_id] += v.views
    paid: dict[int, int] = defaultdict(int)
    last_payout: dict[int, datetime] = {}
    for p in payouts:
        if p.status == "paid":
            paid[p.creator_id] += p.amount_cents
            if p.created_at and (
                p.creator_id not in last_payout or p.created_at > last_payout[p.creator_id]
            ):
                last_payout[p.creator_id] = p.created_at

    return {
        "items": [
            {
                "creator_id": c.id,
                "videos": videos_by_creator.get(c.id, 0),
                "verified_videos": verified_by_creator.get(c.id, 0),
                "eligible_views": eligible_views.get(c.id, 0),
                "total_views": total_views_by_creator.get(c.id, 0),
                "earned_cents": earned.get(c.id, 0),
                "views_earned_cents": views_earned.get(c.id, 0),
                "commission_cents": commission.get(c.id, {}).get("commission_cents", 0),
                "referred_clients": commission.get(c.id, {}).get("clients", 0),
                "paid_cents": paid.get(c.id, 0),
                "balance_cents": max(earned.get(c.id, 0) - paid.get(c.id, 0), 0),
                "last_payout_at": (
                    last_payout[c.id].isoformat() if c.id in last_payout else None
                ),
            }
            for c in creators
            if not c.is_admin
        ]
    }


@router.get("/content")
async def content_performance(
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    videos = await _fetch_videos(db)
    verified = [v for v in videos if v.status == "verified"]
    eligible = await eligible_views_map(db, verified)
    story_ids = {v.story_id for v in verified if v.story_id is not None}
    stories = {}
    if story_ids:
        rows = (
            (await db.execute(select(Story).where(Story.id.in_(story_ids)))).scalars().all()
        )
        stories = {s.id: s for s in rows}

    albums: dict[tuple, dict] = defaultdict(
        lambda: {"videos": 0, "eligible_views": 0, "earned_cents": 0}
    )
    kinds: dict[str, dict] = defaultdict(lambda: {"videos": 0, "eligible_views": 0})
    platforms: dict[str, dict] = defaultdict(lambda: {"videos": 0, "eligible_views": 0})
    per_story: dict[int, dict] = defaultdict(lambda: {"videos": 0, "eligible_views": 0})
    unlinked = {"videos": 0, "eligible_views": 0}

    for v in verified:
        ev = eligible.get(v.id, 0)
        platforms[v.platform]["videos"] += 1
        platforms[v.platform]["eligible_views"] += ev
        story = stories.get(v.story_id) if v.story_id else None
        if story is None:
            unlinked["videos"] += 1
            unlinked["eligible_views"] += ev
            continue
        kinds[story.kind]["videos"] += 1
        kinds[story.kind]["eligible_views"] += ev
        per_story[story.id]["videos"] += 1
        per_story[story.id]["eligible_views"] += ev
        if story.album_name:
            key = (story.album_name, story.album_kind or "")
            albums[key]["videos"] += 1
            albums[key]["eligible_views"] += ev
            albums[key]["earned_cents"] += video_payout_cents(ev)

    def story_title(s: Story) -> str:
        payload = s.payload or {}
        return payload.get("title") or payload.get("headline") or "Untitled"

    top_stories = sorted(
        (
            {
                "story_id": sid,
                "title": story_title(stories[sid]),
                "kind": stories[sid].kind,
                "album_name": stories[sid].album_name,
                **agg,
            }
            for sid, agg in per_story.items()
        ),
        key=lambda r: r["eligible_views"],
        reverse=True,
    )[:20]

    return {
        "albums": sorted(
            (
                {"album_name": name, "album_kind": kind, **agg}
                for (name, kind), agg in albums.items()
            ),
            key=lambda r: r["eligible_views"],
            reverse=True,
        ),
        "kinds": [
            {"kind": k, **agg}
            for k, agg in sorted(
                kinds.items(), key=lambda kv: kv[1]["eligible_views"], reverse=True
            )
        ],
        "platforms": [
            {"platform": p, **agg}
            for p, agg in sorted(
                platforms.items(), key=lambda kv: kv[1]["eligible_views"], reverse=True
            )
        ],
        "top_stories": top_stories,
        "unlinked": unlinked,
    }


@router.get("/payouts")
async def payouts_summary(
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    videos = await _fetch_videos(db)
    verified = [v for v in videos if v.status == "verified"]
    creators = (await db.execute(select(Creator))).scalars().all()
    views_earned, eligible_views = await _earned_by_creator(db, verified)
    commission = await commission_totals(db)
    earned: dict[int, int] = defaultdict(int)
    for cid in set(views_earned) | set(commission):
        earned[cid] = views_earned.get(cid, 0) + commission.get(cid, {}).get("commission_cents", 0)
    payout_rows = (
        (
            await db.execute(
                select(Payout, Creator)
                .join(Creator, Payout.creator_id == Creator.id)
                .order_by(Payout.created_at.desc())
            )
        )
        .all()
    )
    paid: dict[int, int] = defaultdict(int)
    last_payout: dict[int, datetime] = {}
    for p, _ in payout_rows:
        if p.status == "paid":
            paid[p.creator_id] += p.amount_cents
            if p.created_at and (
                p.creator_id not in last_payout or p.created_at > last_payout[p.creator_id]
            ):
                last_payout[p.creator_id] = p.created_at

    balances = [
        {
            "creator_id": c.id,
            "name": c.name,
            "email": c.email,
            "eligible_views": eligible_views.get(c.id, 0),
            "earned_cents": earned.get(c.id, 0),
            "views_earned_cents": views_earned.get(c.id, 0),
            "commission_cents": commission.get(c.id, {}).get("commission_cents", 0),
            "referred_clients": commission.get(c.id, {}).get("clients", 0),
            "paid_cents": paid.get(c.id, 0),
            "balance_cents": max(earned.get(c.id, 0) - paid.get(c.id, 0), 0),
            "payout_method": c.payout_method,
            "payout_ready": bool(c.payout_method and c.payout_details),
            "last_payout_at": last_payout[c.id].isoformat() if c.id in last_payout else None,
        }
        for c in creators
        if not c.is_admin and (c.status == "approved" or earned.get(c.id) or paid.get(c.id))
    ]
    balances.sort(key=lambda b: b["balance_cents"], reverse=True)

    return {
        "balances": balances,
        "history": [
            {
                "id": p.id,
                "creator": {"id": c.id, "name": c.name},
                "amount_cents": p.amount_cents,
                "note": p.note,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p, c in payout_rows
        ],
    }


@router.get("/audit")
async def audit_log(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        (
            await db.execute(
                select(AuditLog, Creator)
                .join(Creator, AuditLog.admin_id == Creator.id)
                .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
                .offset((page - 1) * limit)
                .limit(limit)
            )
        )
        .all()
    )
    return {
        "items": [
            {
                "id": entry.id,
                "admin": {"id": c.id, "name": c.name},
                "action": entry.action,
                "entity": entry.entity,
                "entity_id": entry.entity_id,
                "detail": entry.detail or {},
                "created_at": entry.created_at.isoformat() if entry.created_at else None,
            }
            for entry, c in rows
        ],
        "page": page,
        "limit": limit,
    }
