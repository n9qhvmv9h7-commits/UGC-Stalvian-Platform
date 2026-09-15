"""Connected social accounts: what a creator has linked, and what they must.

Only the read and disconnect halves exist so far. The OAuth flow itself
(authorize / callback) lands next, once TikTok app review is underway — the
model, the policy and the gate are useful before then, because they let the
whole UI half ship and be exercised in production with the gate dormant.
"""
import base64
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_approved_creator
from app.config import settings
from app.database import async_session, get_db
from app.models import Creator, OAuthState, SocialConnection
from app.services import crypto
from app.services.social import policy
from app.services.social.base import SocialProviderError
from app.services.social.registry import get as get_provider

logger = logging.getLogger(__name__)

# Long enough that an abandoned flow expires before it could be reused, short
# enough that a creator finishing normally never hits it.
_STATE_TTL_MINUTES = 10

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


def _redirect_uri(platform: str) -> str:
    """Must match what is registered with the platform exactly.

    Render hostnames are not predictable, so this is configured rather than
    derived from the request — a Host header is attacker-controlled anyway.
    """
    base = (settings.SOCIAL_OAUTH_REDIRECT_BASE or "").rstrip("/")
    if not base:
        raise HTTPException(
            status_code=503, detail="Social connections are not configured on this server"
        )
    return f"{base}/api/social/{platform}/callback"


def _frontend(path: str) -> str:
    return f"{(settings.FRONTEND_URL or '').rstrip('/')}{path}"


@router.post("/{platform}/authorize")
async def authorize(
    platform: str,
    creator: Creator = Depends(get_current_approved_creator),
    db: AsyncSession = Depends(get_db),
):
    """Start a connection. Returns the URL for the app to navigate to.

    This is an authenticated XHR, which is the whole point: the state row it
    writes is bound to THIS creator, so the unauthenticated callback later can
    identify them. An attacker cannot mint state bound to someone else.
    """
    provider = get_provider(platform)
    if provider is None or not provider.is_configured():
        raise HTTPException(status_code=404, detail=f"{policy.label(platform)} is not available yet")
    if not crypto.available():
        # Fail closed: never store a token we cannot encrypt.
        raise HTTPException(
            status_code=503, detail="Social connections are not configured on this server"
        )

    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)[:128]
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )
    db.add(
        OAuthState(
            state=state,
            creator_id=creator.id,
            platform=platform,
            code_verifier=verifier,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=_STATE_TTL_MINUTES),
        )
    )
    await db.commit()
    return {"authorize_url": provider.authorize_url(state, challenge, _redirect_uri(platform))}


@router.get("/{platform}/callback")
async def callback(platform: str, code: str | None = None, state: str | None = None):
    """Where the platform sends the creator back.

    DELIBERATELY UNAUTHENTICATED — this arrives as a top-level navigation from
    the platform, carrying no Authorization header and no cookie for this
    origin. The OAuthState row is the credential. It must never grow a
    get_current_approved_creator dependency, which is an easy copy-paste
    mistake in a file where every other route has one.

    Always redirects to the web app: API and frontend are separate origins, so
    there is no UI to render here.
    """
    if not code or not state:
        return RedirectResponse(_frontend("/settings?connect_error=cancelled"))

    provider = get_provider(platform)
    if provider is None:
        return RedirectResponse(_frontend("/settings?connect_error=unavailable"))

    async with async_session() as db:
        row = (
            await db.execute(select(OAuthState).where(OAuthState.state == state))
        ).scalar_one_or_none()
        now = datetime.now(timezone.utc)
        expires = row.expires_at if row else None
        if expires is not None and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if (
            row is None
            or row.platform != platform
            or row.used_at is not None
            or (expires is not None and expires < now)
        ):
            return RedirectResponse(_frontend("/settings?connect_error=expired"))

        # Single-use, marked BEFORE the exchange so a replayed callback cannot
        # race a second exchange through.
        row.used_at = now
        await db.commit()
        creator_id, verifier = row.creator_id, row.code_verifier

        try:
            bundle = await provider.exchange_code(code, verifier, _redirect_uri(platform))
        except SocialProviderError as exc:
            logger.warning("%s connect failed for creator %s: %s", platform, creator_id, exc)
            reason = "scope" if not exc.retryable else "failed"
            return RedirectResponse(_frontend(f"/settings?connect_error={reason}"))

        existing = (
            await db.execute(
                select(SocialConnection).where(
                    SocialConnection.creator_id == creator_id,
                    SocialConnection.platform == platform,
                )
            )
        ).scalar_one_or_none()
        # Upsert in place rather than delete-and-recreate: reconnecting must
        # not discard history tied to the connection.
        conn = existing or SocialConnection(creator_id=creator_id, platform=platform)
        conn.platform_account_id = bundle.account_id
        conn.account_handle = bundle.account_handle
        conn.scopes = ",".join(bundle.scopes)
        conn.access_token = crypto.encrypt(bundle.access_token)
        conn.refresh_token = crypto.encrypt(bundle.refresh_token)
        conn.access_expires_at = bundle.access_expires_at
        conn.refresh_expires_at = bundle.refresh_expires_at
        conn.status = "active"
        conn.last_error = None
        conn.consecutive_failures = 0
        if existing is None:
            db.add(conn)
        await db.commit()

    return RedirectResponse(_frontend(f"/settings?connected={platform}"))


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
