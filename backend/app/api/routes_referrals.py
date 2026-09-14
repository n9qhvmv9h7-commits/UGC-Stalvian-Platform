"""Client referrals — three audiences on one router.

1. The Stalvian product (X-API-Key = REFERRAL_API_KEY): validate a code typed
   during onboarding, attribute the new client, report each fee they pay.
   Contract in REFERRAL_API_REQUIREMENTS.md.
2. Creators: their code, their clients (labels only), their share.
3. Admins: every creator's referral numbers, plus manual attribution and fee
   entry for as long as the product integration is not live (or as a
   correction path once it is).
"""
import hmac
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_admin, get_current_approved_creator
from app.config import settings
from app.database import get_db
from app.models import Creator, FeeEvent, ReferredClient
from app.services.audit import audit
from app.services.referrals import (
    AttributionError,
    assign_referral_code,
    attribute_client,
    clients_with_totals,
    code_usable,
    commission_cents,
    commission_totals,
    find_creator_by_code,
    program_description,
    record_fee,
)

router = APIRouter(tags=["referrals"])


# ---------------------------------------------------------------------------
# Product-facing (API key)
# ---------------------------------------------------------------------------


async def require_product_key(x_api_key: str | None = Header(default=None)) -> None:
    if not settings.REFERRAL_API_KEY:
        raise HTTPException(status_code=503, detail="Referral API not configured")
    if not x_api_key or not hmac.compare_digest(x_api_key, settings.REFERRAL_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid API key")


def _parse_when(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class AttributeClientRequest(BaseModel):
    code: str = Field(max_length=32)
    client_ref: str = Field(min_length=1, max_length=128)
    label: str | None = Field(default=None, max_length=64)
    attributed_at: datetime | None = None


class ReportFeeRequest(BaseModel):
    client_ref: str = Field(min_length=1, max_length=128)
    fee_cents: int = Field(gt=0)
    currency: str = Field(default="EUR", max_length=3)
    fee_ref: str | None = Field(default=None, max_length=128)
    occurred_at: datetime | None = None
    note: str | None = Field(default=None, max_length=255)


class ClientStatusRequest(BaseModel):
    status: str  # active | churned


@router.get("/api/referrals/codes/{code}", dependencies=[Depends(require_product_key)])
async def validate_code(code: str, db: AsyncSession = Depends(get_db)):
    """Called by the onboarding form as the client types. Returns whether the
    code is usable and who to show it belongs to."""
    creator = await find_creator_by_code(db, code)
    if creator is None or not code_usable(creator):
        return {"valid": False}
    return {
        "valid": True,
        "code": creator.referral_code,
        "creator": {"id": creator.id, "name": creator.name, "handle": creator.handle},
        **program_description(),
    }


@router.post("/api/referrals/clients", dependencies=[Depends(require_product_key)], status_code=201)
async def product_attribute_client(
    request: AttributeClientRequest, db: AsyncSession = Depends(get_db)
):
    creator = await find_creator_by_code(db, request.code)
    if creator is None or not code_usable(creator):
        raise HTTPException(status_code=404, detail="Unknown or inactive referral code")
    try:
        client, created = await attribute_client(
            db, creator, request.client_ref, request.label,
            _parse_when(request.attributed_at), source="api",
        )
    except AttributionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    await db.commit()
    return {
        "created": created,
        "client_ref": client.external_ref,
        "creator": {"id": creator.id, "code": creator.referral_code},
    }


@router.post("/api/referrals/fees", dependencies=[Depends(require_product_key)], status_code=201)
async def product_report_fee(request: ReportFeeRequest, db: AsyncSession = Depends(get_db)):
    client = (
        await db.execute(
            select(ReferredClient).where(ReferredClient.external_ref == request.client_ref.strip())
        )
    ).scalar_one_or_none()
    if client is None:
        raise HTTPException(status_code=404, detail="Client not attributed to any creator")
    try:
        event, created = await record_fee(
            db, client, request.fee_cents, _parse_when(request.occurred_at),
            request.fee_ref, request.currency, request.note, source="api",
        )
    except AttributionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    await db.commit()
    return {
        "created": created,
        "fee_ref": event.external_ref,
        "fee_cents": event.fee_cents,
        "commission_cents": event.commission_cents,
        "commission_bps": event.commission_bps,
    }


@router.patch("/api/referrals/clients/{client_ref}", dependencies=[Depends(require_product_key)])
async def product_client_status(
    client_ref: str, request: ClientStatusRequest, db: AsyncSession = Depends(get_db)
):
    if request.status not in ("active", "churned"):
        raise HTTPException(status_code=400, detail="status must be active or churned")
    client = (
        await db.execute(select(ReferredClient).where(ReferredClient.external_ref == client_ref))
    ).scalar_one_or_none()
    if client is None:
        raise HTTPException(status_code=404, detail="Client not attributed to any creator")
    client.status = request.status
    await db.commit()
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Creator-facing
# ---------------------------------------------------------------------------


@router.get("/api/referrals/me")
async def my_referrals(
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    if not creator.referral_code:
        await assign_referral_code(db, creator)
        await db.commit()
    totals = (await commission_totals(db, [creator.id])).get(creator.id) or {
        "fees_cents": 0, "commission_cents": 0, "clients": 0, "active_clients": 0,
    }
    return {
        "code": creator.referral_code,
        **program_description(),
        **totals,
        "clients": await clients_with_totals(db, creator.id),
    }


# ---------------------------------------------------------------------------
# Admin-facing
# ---------------------------------------------------------------------------


class AdminAttributeRequest(BaseModel):
    creator_id: int
    client_ref: str = Field(min_length=1, max_length=128)
    label: str | None = Field(default=None, max_length=64)
    attributed_at: datetime | None = None


class AdminFeeRequest(BaseModel):
    client_id: int
    fee_cents: int = Field(gt=0)
    occurred_at: datetime | None = None
    note: str | None = Field(default=None, max_length=255)


@router.get("/api/admin/referrals")
async def admin_referrals(
    limit: int = Query(default=50, ge=1, le=200),
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    creators = (
        (await db.execute(select(Creator).where(Creator.is_admin.is_(False)))).scalars().all()
    )
    totals = await commission_totals(db)
    clients = (
        (await db.execute(select(ReferredClient).order_by(ReferredClient.attributed_at.desc())))
        .scalars()
        .all()
    )
    recent = (
        await db.execute(
            select(FeeEvent, ReferredClient, Creator)
            .join(ReferredClient, FeeEvent.client_id == ReferredClient.id)
            .join(Creator, FeeEvent.creator_id == Creator.id)
            .order_by(FeeEvent.occurred_at.desc(), FeeEvent.id.desc())
            .limit(limit)
        )
    ).all()
    names = {c.id: c for c in creators}
    rows = []
    for c in creators:
        t = totals.get(c.id, {"fees_cents": 0, "commission_cents": 0, "clients": 0, "active_clients": 0})
        rows.append(
            {
                "creator_id": c.id,
                "name": c.name,
                "email": c.email,
                "status": c.status,
                "code": c.referral_code,
                **t,
            }
        )
    rows.sort(key=lambda r: (r["commission_cents"], r["clients"]), reverse=True)
    return {
        **program_description(),
        "totals": {
            "clients": sum(r["clients"] for r in rows),
            "active_clients": sum(r["active_clients"] for r in rows),
            "fees_cents": sum(r["fees_cents"] for r in rows),
            "commission_cents": sum(r["commission_cents"] for r in rows),
        },
        "creators": rows,
        "clients": [
            {
                "id": cl.id,
                "creator_id": cl.creator_id,
                "creator_name": names[cl.creator_id].name if cl.creator_id in names else f"Creator #{cl.creator_id}",
                "client_ref": cl.external_ref,
                "label": cl.label,
                "status": cl.status,
                "source": cl.source,
                "attributed_at": cl.attributed_at.isoformat() if cl.attributed_at else None,
            }
            for cl in clients
        ],
        "recent_fees": [
            {
                "id": e.id,
                "creator": {"id": c.id, "name": c.name},
                "client": {"id": cl.id, "client_ref": cl.external_ref, "label": cl.label},
                "fee_cents": e.fee_cents,
                "commission_cents": e.commission_cents,
                "commission_bps": e.commission_bps,
                "currency": e.currency,
                "source": e.source,
                "note": e.note,
                "occurred_at": e.occurred_at.isoformat() if e.occurred_at else None,
            }
            for e, cl, c in recent
        ],
    }


@router.post("/api/admin/referrals/clients", status_code=201)
async def admin_attribute_client(
    request: AdminAttributeRequest,
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    creator = (
        await db.execute(select(Creator).where(Creator.id == request.creator_id))
    ).scalar_one_or_none()
    if creator is None:
        raise HTTPException(status_code=404, detail="Creator not found")
    try:
        client, created = await attribute_client(
            db, creator, request.client_ref, request.label,
            _parse_when(request.attributed_at), source="admin",
        )
    except AttributionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    if created:
        await audit(
            db, admin, "referral.attribute", "client", client.id,
            {"creator_id": creator.id, "client_ref": client.external_ref, "label": client.label},
        )
    await db.commit()
    return {"created": created, "client_id": client.id}


@router.post("/api/admin/referrals/fees", status_code=201)
async def admin_record_fee(
    request: AdminFeeRequest,
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    client = (
        await db.execute(select(ReferredClient).where(ReferredClient.id == request.client_id))
    ).scalar_one_or_none()
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    try:
        event, _ = await record_fee(
            db, client, request.fee_cents, _parse_when(request.occurred_at),
            None, "EUR", request.note, source="admin",
        )
    except AttributionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    await audit(
        db, admin, "referral.fee", "fee", event.id,
        {"creator_id": client.creator_id, "client_id": client.id,
         "fee_cents": event.fee_cents, "commission_cents": event.commission_cents,
         "note": event.note},
    )
    await db.commit()
    return {
        "fee_id": event.id,
        "fee_cents": event.fee_cents,
        "commission_cents": event.commission_cents,
    }


@router.patch("/api/admin/referrals/clients/{client_id}")
async def admin_client_status(
    client_id: int,
    request: ClientStatusRequest,
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if request.status not in ("active", "churned"):
        raise HTTPException(status_code=400, detail="status must be active or churned")
    client = (
        await db.execute(select(ReferredClient).where(ReferredClient.id == client_id))
    ).scalar_one_or_none()
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    old = client.status
    client.status = request.status
    if old != request.status:
        await audit(
            db, admin, "referral.client_status", "client", client.id,
            {"from": old, "to": request.status},
        )
    await db.commit()
    return {"status": "ok"}


@router.post("/api/admin/referrals/creators/{creator_id}/code")
async def admin_regenerate_code(
    creator_id: int,
    admin: Creator = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Issue a new code (the old one stops working immediately — existing
    attributions are untouched)."""
    creator = (
        await db.execute(select(Creator).where(Creator.id == creator_id))
    ).scalar_one_or_none()
    if creator is None:
        raise HTTPException(status_code=404, detail="Creator not found")
    old = creator.referral_code
    new = await assign_referral_code(db, creator)
    await audit(db, admin, "referral.code", "creator", creator.id, {"from": old, "to": new})
    await db.commit()
    return {"code": new}


@router.get("/api/admin/referrals/preview")
async def admin_commission_preview(
    fee_cents: int = Query(gt=0), admin: Creator = Depends(get_current_admin)
):
    return {"fee_cents": fee_cents, "commission_cents": commission_cents(fee_cents)}
