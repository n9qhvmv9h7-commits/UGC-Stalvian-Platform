"""Client referrals: codes, attribution, fee events, and the creator's share.

Every creator carries a referral code. A prospective Stalvian client types it
during the product's onboarding; the product then tells us (REFERRAL_API_KEY
endpoints in routes_referrals.py, or an admin by hand) who signed up and every
fee they pay. The creator earns REFERRAL_COMMISSION_BPS of each fee — computed
and stored per event, so history never moves when the rate does.

Commission runs for REFERRAL_COMMISSION_DAYS from the client's FIRST trade,
not from signup. Fees after that window are still recorded (they are real
revenue and belong in the client's history) but carry a zero share, so every
total stays a plain SUM over commission_cents.
"""
import secrets
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Sequence

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Creator, FeeEvent, ReferredClient
from app.services.earning_window import naive

# No 0/O/1/I — codes get read out loud and typed on phones.
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_SUFFIX_LEN = 4


def commission_cents(fee_cents: int, bps: int | None = None) -> int:
    """Creator's share of one fee, rounded half-up to the cent."""
    rate = settings.REFERRAL_COMMISSION_BPS if bps is None else bps
    return (fee_cents * rate + 5000) // 10000


async def commission_window(
    db: AsyncSession, client: ReferredClient, including: datetime | None = None
) -> tuple[datetime, datetime] | None:
    """(first trade, last day that still earns) for a client, or None if they
    have never traded.

    The clock starts at the client's FIRST fee, not at signup: someone who
    opens an account and trades six months later still gets the creator a full
    year. `including` lets a fee being written right now act as that first
    trade.
    """
    earliest = (
        await db.execute(
            select(func.min(FeeEvent.occurred_at)).where(FeeEvent.client_id == client.id)
        )
    ).scalar()
    if isinstance(earliest, str):  # SQLite hands min() back as text
        earliest = datetime.fromisoformat(earliest)
    candidates = [d for d in (naive(earliest), naive(including)) if d is not None]
    if not candidates:
        return None
    first = min(candidates)
    return first, first + timedelta(days=settings.REFERRAL_COMMISSION_DAYS)


def normalize_code(value: str) -> str:
    """Codes are case-insensitive and tolerant of spaces/dashes when typed:
    "pol 7k3m", "POL7K3M" and "pol-7k3m" all mean POL-7K3M."""
    cleaned = "".join(ch for ch in (value or "").upper() if ch.isalnum())
    if len(cleaned) <= _SUFFIX_LEN:
        return cleaned
    return f"{cleaned[:-_SUFFIX_LEN]}-{cleaned[-_SUFFIX_LEN:]}"


def _prefix_for(creator: Creator) -> str:
    """Up to 4 letters of the first name, so the code is recognisably theirs
    (POL-7K3M). Non-latin or empty names fall back to STV."""
    first = (creator.name or "").strip().split(" ")[0]
    letters = "".join(ch for ch in first.upper() if "A" <= ch <= "Z")[:4]
    return letters if len(letters) >= 2 else "STV"


def _random_suffix() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(_SUFFIX_LEN))


async def assign_referral_code(db: AsyncSession, creator: Creator) -> str:
    """Set a fresh unique code on the creator (flushes; caller commits)."""
    prefix = _prefix_for(creator)
    for _ in range(20):
        candidate = f"{prefix}-{_random_suffix()}"
        taken = (
            await db.execute(select(Creator.id).where(Creator.referral_code == candidate))
        ).first()
        if taken is None:
            creator.referral_code = candidate
            await db.flush()
            return candidate
    raise RuntimeError("Could not allocate a unique referral code")


async def backfill_referral_codes(db: AsyncSession) -> int:
    """Give every creator without a code one. Runs on every boot; no-op once
    everyone has one."""
    missing = (
        (await db.execute(select(Creator).where(Creator.referral_code.is_(None))))
        .scalars()
        .all()
    )
    for creator in missing:
        await assign_referral_code(db, creator)
    if missing:
        await db.commit()
    return len(missing)


async def find_creator_by_code(db: AsyncSession, code: str) -> Creator | None:
    normalized = normalize_code(code)
    if not normalized:
        return None
    return (
        await db.execute(select(Creator).where(Creator.referral_code == normalized))
    ).scalar_one_or_none()


def code_usable(creator: Creator) -> bool:
    """Only creators in good standing can bring in clients."""
    return creator.status == "approved" or creator.is_admin


class AttributionError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def attribute_client(
    db: AsyncSession,
    creator: Creator,
    external_ref: str,
    label: str | None = None,
    attributed_at: datetime | None = None,
    source: str = "api",
) -> tuple[ReferredClient, bool]:
    """Link a client to a creator. Returns (client, created). A client already
    attributed to the same creator is returned unchanged (idempotent); one
    attributed to a different creator is a 409 — first code wins."""
    ref = external_ref.strip()
    if not ref:
        raise AttributionError(400, "client_ref is required")
    existing = (
        await db.execute(select(ReferredClient).where(ReferredClient.external_ref == ref))
    ).scalar_one_or_none()
    if existing is not None:
        if existing.creator_id != creator.id:
            raise AttributionError(409, "Client is already attributed to another creator")
        return existing, False
    client = ReferredClient(
        creator_id=creator.id,
        external_ref=ref,
        label=(label or "").strip()[:64] or None,
        source=source,
        attributed_at=attributed_at or datetime.now(timezone.utc),
    )
    db.add(client)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise AttributionError(409, "Client was attributed concurrently — retry")
    return client, True


async def record_fee(
    db: AsyncSession,
    client: ReferredClient,
    fee_cents: int,
    occurred_at: datetime | None = None,
    external_ref: str | None = None,
    currency: str = "EUR",
    note: str | None = None,
    source: str = "api",
) -> tuple[FeeEvent, bool]:
    """Store a fee + the creator's share. Returns (event, created); a repeated
    external_ref returns the stored event untouched."""
    if fee_cents <= 0:
        raise AttributionError(400, "fee must be positive")
    ref = (external_ref or "").strip() or None
    if ref:
        existing = (
            await db.execute(select(FeeEvent).where(FeeEvent.external_ref == ref))
        ).scalar_one_or_none()
        if existing is not None:
            return existing, False
    bps = settings.REFERRAL_COMMISSION_BPS
    when = occurred_at or datetime.now(timezone.utc)
    # A fee outside the client's one-year window is still recorded — it is real
    # revenue and belongs in their fee history — but it pays the creator
    # nothing. Storing the zero keeps every sum a plain SUM over this column.
    window = await commission_window(db, client, including=when)
    earns = window is None or naive(when) <= window[1]
    event = FeeEvent(
        client_id=client.id,
        creator_id=client.creator_id,
        external_ref=ref,
        fee_cents=fee_cents,
        commission_bps=bps,
        commission_cents=commission_cents(fee_cents, bps) if earns else 0,
        currency=(currency or "EUR").upper()[:3],
        note=(note or "").strip()[:255] or None,
        source=source,
        occurred_at=when,
    )
    db.add(event)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise AttributionError(409, "Fee was recorded concurrently — retry")
    return event, True


# ---- Aggregates ---------------------------------------------------------


async def commission_totals(
    db: AsyncSession, creator_ids: Iterable[int] | None = None
) -> dict[int, dict]:
    """creator_id -> {fees_cents, commission_cents, clients, active_clients}.
    One grouped query for money, one for client counts."""
    ids = list(creator_ids) if creator_ids is not None else None
    totals: dict[int, dict] = defaultdict(
        lambda: {"fees_cents": 0, "commission_cents": 0, "clients": 0, "active_clients": 0}
    )
    if ids is not None and not ids:
        return totals
    money = select(
        FeeEvent.creator_id,
        func.coalesce(func.sum(FeeEvent.fee_cents), 0),
        func.coalesce(func.sum(FeeEvent.commission_cents), 0),
    ).group_by(FeeEvent.creator_id)
    clients = select(
        ReferredClient.creator_id, ReferredClient.status, func.count(ReferredClient.id)
    ).group_by(ReferredClient.creator_id, ReferredClient.status)
    if ids is not None:
        money = money.where(FeeEvent.creator_id.in_(ids))
        clients = clients.where(ReferredClient.creator_id.in_(ids))
    for cid, fees, commission in (await db.execute(money)).all():
        totals[cid]["fees_cents"] = int(fees)
        totals[cid]["commission_cents"] = int(commission)
    for cid, status, count in (await db.execute(clients)).all():
        totals[cid]["clients"] += int(count)
        if status == "active":
            totals[cid]["active_clients"] += int(count)
    return totals


async def daily_commission(
    db: AsyncSession, creator_ids: Sequence[int] | None, days: int, today: date | None = None
) -> dict[date, int]:
    """date -> commission_cents over [today - days + 1, today], summed across
    the given creators (None = everyone). Fees are dated by occurred_at."""
    if today is None:
        today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)
    series: dict[date, int] = {start + timedelta(days=i): 0 for i in range(days)}
    if creator_ids is not None and not creator_ids:
        return series
    query = select(FeeEvent.occurred_at, FeeEvent.commission_cents).where(
        FeeEvent.occurred_at >= datetime.combine(start, datetime.min.time())
    )
    if creator_ids is not None:
        query = query.where(FeeEvent.creator_id.in_(list(creator_ids)))
    for occurred_at, cents in (await db.execute(query)).all():
        day = naive(occurred_at).date()
        if day in series:
            series[day] += int(cents)
    return series


def client_view(
    client: ReferredClient,
    fees_cents: int,
    commission: int,
    last_fee: datetime | None,
    first_fee: datetime | None = None,
) -> dict:
    """What a creator sees about one of their clients: a label, never the
    identity behind it, plus how long this client still earns."""
    first = naive(first_fee)
    earning_until = (
        first + timedelta(days=settings.REFERRAL_COMMISSION_DAYS) if first else None
    )
    return {
        "id": client.id,
        "label": client.label or f"Client #{client.id}",
        "status": client.status,
        "attributed_at": client.attributed_at.isoformat() if client.attributed_at else None,
        "fees_cents": fees_cents,
        "commission_cents": commission,
        "last_fee_at": last_fee.isoformat() if last_fee else None,
        # None until they place their first trade — the clock has not started.
        "first_fee_at": first.isoformat() if first else None,
        "earning_until": earning_until.isoformat() if earning_until else None,
        "window_open": earning_until is None or datetime.utcnow() <= earning_until,
    }


async def clients_with_totals(
    db: AsyncSession, creator_id: int
) -> list[dict]:
    clients = (
        (
            await db.execute(
                select(ReferredClient)
                .where(ReferredClient.creator_id == creator_id)
                .order_by(ReferredClient.attributed_at.desc())
            )
        )
        .scalars()
        .all()
    )
    if not clients:
        return []
    rows = (
        await db.execute(
            select(
                FeeEvent.client_id,
                func.coalesce(func.sum(FeeEvent.fee_cents), 0),
                func.coalesce(func.sum(FeeEvent.commission_cents), 0),
                func.max(FeeEvent.occurred_at),
                func.min(FeeEvent.occurred_at),
            )
            .where(FeeEvent.client_id.in_([c.id for c in clients]))
            .group_by(FeeEvent.client_id)
        )
    ).all()
    by_client = {cid: (int(f), int(c), last, first) for cid, f, c, last, first in rows}
    out = []
    for client in clients:
        fees, commission, last, first = by_client.get(client.id, (0, 0, None, None))
        # SQLite may hand min()/max() back as text
        if isinstance(last, str):
            last = datetime.fromisoformat(last)
        if isinstance(first, str):
            first = datetime.fromisoformat(first)
        out.append(client_view(client, fees, commission, last, first))
    return out


def program_description() -> dict:
    return {
        "commission_bps": settings.REFERRAL_COMMISSION_BPS,
        "commission_pct": settings.REFERRAL_COMMISSION_BPS / 100,
        "commission_days": settings.REFERRAL_COMMISSION_DAYS,
        "signup_url": settings.REFERRAL_SIGNUP_URL or None,
    }
