"""Creator signup / login / profile."""
import time
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_creator, hash_password, issue_token, verify_password
from app.database import get_db
from app.models import Creator
from app.services.translator import SUPPORTED_LANGUAGES

router = APIRouter(prefix="/api/auth", tags=["auth"])

# In-process brute-force throttle: 10 attempts / 5 min per email or IP.
_LOGIN_WINDOW = 300
_LOGIN_MAX = 10
_login_attempts: dict[str, list[float]] = defaultdict(list)


def _check_throttle(keys: list[str]):
    """Only failed attempts count (see _record_failure) — successful logins
    must never lock an account out, e.g. the dev auto-login on every reload."""
    now = time.monotonic()
    for key in keys:
        attempts = _login_attempts[key] = [
            t for t in _login_attempts[key] if now - t < _LOGIN_WINDOW
        ]
        if len(attempts) >= _LOGIN_MAX:
            raise HTTPException(status_code=429, detail="Too many attempts — try again later")


def _record_failure(keys: list[str]):
    now = time.monotonic()
    # Unbounded growth guard: drop entries whose window has fully expired.
    if len(_login_attempts) > 10_000:
        for key in [
            k for k, ts in _login_attempts.items() if not ts or now - ts[-1] > _LOGIN_WINDOW
        ]:
            del _login_attempts[key]
    for key in keys:
        _login_attempts[key].append(now)


def _clean_handle(value: str | None) -> str | None:
    """Normalize '@user', 'user' or a pasted profile URL down to the bare handle."""
    if not value:
        return None
    cleaned = value.strip().rstrip("/")
    if "/" in cleaned:
        cleaned = cleaned.rsplit("/", 1)[-1]
    cleaned = cleaned.split("?", 1)[0].lstrip("@").strip()
    return cleaned[:64] or None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=72)


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    handle: str | None = Field(default=None, max_length=64)
    tiktok_handle: str | None = Field(default=None, max_length=255)
    instagram_handle: str | None = Field(default=None, max_length=255)
    youtube_handle: str | None = Field(default=None, max_length=255)
    language: str | None = None
    country: str | None = Field(default=None, max_length=64)
    payout_method: str | None = Field(default=None, max_length=16)
    payout_details: str | None = Field(default=None, max_length=255)
    # Change password: both must be sent together (initial passwords are
    # handed out by the team — accounts are invite-only).
    current_password: str | None = Field(default=None, max_length=72)
    new_password: str | None = Field(default=None, min_length=8, max_length=72)


def _profile(creator: Creator) -> dict:
    return {
        "id": creator.id,
        "email": creator.email,
        "name": creator.name,
        "handle": creator.handle,
        "status": creator.status,
        "review_note": creator.review_note,
        "strikes": creator.strikes,
        "tiktok_handle": creator.tiktok_handle,
        "instagram_handle": creator.instagram_handle,
        "youtube_handle": creator.youtube_handle,
        "language": creator.language,
        "country": creator.country,
        "payout_method": creator.payout_method,
        "payout_details": creator.payout_details,
        "is_admin": creator.is_admin,
        "created_at": creator.created_at.isoformat() if creator.created_at else None,
    }


# NOTE: there is deliberately no signup endpoint — access is invite-only.
# The Stalvian team creates accounts via POST /api/admin/creators.


@router.post("/login")
async def login(request: LoginRequest, http_request: Request, db: AsyncSession = Depends(get_db)):
    email = request.email.lower().strip()
    client_ip = http_request.client.host if http_request.client else "unknown"
    throttle_keys = [f"email:{email}", f"ip:{client_ip}"]
    _check_throttle(throttle_keys)
    creator = (
        await db.execute(select(Creator).where(Creator.email == email))
    ).scalar_one_or_none()
    if creator is None or not verify_password(request.password, creator.password_hash):
        _record_failure(throttle_keys)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    creator.last_login = datetime.now(timezone.utc)
    await db.commit()
    return {"token": issue_token(creator), "creator": _profile(creator)}


@router.get("/me")
async def me(creator: Creator = Depends(get_current_creator)):
    return _profile(creator)


@router.patch("/me")
async def update_me(
    request: ProfileUpdate,
    creator: Creator = Depends(get_current_creator),
    db: AsyncSession = Depends(get_db),
):
    if request.language is not None:
        if request.language not in SUPPORTED_LANGUAGES:
            raise HTTPException(status_code=400, detail=f"Language must be one of {SUPPORTED_LANGUAGES}")
        creator.language = request.language
    if request.name is not None:
        creator.name = request.name.strip() or creator.name
    if request.handle is not None:
        creator.handle = request.handle.strip().lstrip("@") or None
    if request.tiktok_handle is not None:
        creator.tiktok_handle = _clean_handle(request.tiktok_handle)
    if request.instagram_handle is not None:
        creator.instagram_handle = _clean_handle(request.instagram_handle)
    if request.youtube_handle is not None:
        creator.youtube_handle = _clean_handle(request.youtube_handle)
    if request.country is not None:
        creator.country = request.country or None
    if request.payout_method is not None:
        if request.payout_method not in ("iban", "paypal", ""):
            raise HTTPException(status_code=400, detail="payout_method must be iban or paypal")
        creator.payout_method = request.payout_method or None
    if request.payout_details is not None:
        creator.payout_details = request.payout_details or None
    changed_password = False
    if request.new_password:
        # Same brute-force budget as login — a stolen session must not be able
        # to guess the current password freely.
        throttle_keys = [f"pwchange:{creator.id}"]
        _check_throttle(throttle_keys)
        if not request.current_password or not verify_password(
            request.current_password, creator.password_hash
        ):
            _record_failure(throttle_keys)
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        creator.password_hash = hash_password(request.new_password)
        changed_password = True
    await db.commit()
    await db.refresh(creator)
    profile = _profile(creator)
    if changed_password:
        # The old token died with the old password — hand back a fresh one.
        profile["token"] = issue_token(creator)
    return profile
