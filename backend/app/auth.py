"""Creator auth: bcrypt passwords + self-issued HS256 JWTs."""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import Creator

bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def issue_token(creator: Creator) -> str:
    if not settings.AUTH_SECRET:
        raise HTTPException(status_code=500, detail="AUTH_SECRET not configured")
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(creator.id),
        "email": creator.email,
        "name": creator.name,
        "lang": creator.language,
        # Ties the token to the current password: changing the password
        # invalidates every outstanding token immediately.
        "pwv": creator.password_hash[:12],
        "iat": now,
        "exp": now + timedelta(hours=settings.TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, settings.AUTH_SECRET, algorithm="HS256")


def decode_token(token: str) -> dict:
    if not settings.AUTH_SECRET:
        raise HTTPException(status_code=500, detail="AUTH_SECRET not configured")
    try:
        return jwt.decode(token, settings.AUTH_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def get_current_creator(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> Creator:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    creator = (
        await db.execute(select(Creator).where(Creator.id == int(payload["sub"])))
    ).scalar_one_or_none()
    if creator is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found")
    if payload.get("pwv") != creator.password_hash[:12]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired — log in again"
        )
    return creator


async def get_current_approved_creator(
    creator: Creator = Depends(get_current_creator),
) -> Creator:
    """Content/earnings routes require an approved application (admins pass)."""
    if creator.is_admin or creator.status == "approved":
        return creator
    detail = {
        "rejected": "Application rejected",
        "terminated": "Partnership ended",
    }.get(creator.status, "Application pending review")
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


async def get_current_admin(creator: Creator = Depends(get_current_creator)) -> Creator:
    if not creator.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return creator
