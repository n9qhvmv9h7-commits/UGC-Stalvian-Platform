"""Panel webhook receiver: script.approved / script.retracted.

Auth is the HMAC signature (the panel's egress IP is not stable). Verify over
the RAW body bytes, check the signed sent_at freshness, then apply. Respond
fast — the upsert is cheap; anything heavier must go async.
"""
import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from app.config import settings
from app.database import async_session
from app.services.stories import apply_webhook_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])

_FRESHNESS_SECONDS = 600  # reject replayed deliveries older than 10 min


def _parse_sent_at(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        # Python 3.10's fromisoformat rejects the "Z" suffix
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


@router.post("/panel")
async def panel_webhook(request: Request):
    if not settings.PANEL_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook receiver not configured")

    raw = await request.body()
    expected = "sha256=" + hmac.new(
        settings.PANEL_WEBHOOK_SECRET.encode(), raw, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get("X-Stalvian-Signature", "")):
        raise HTTPException(status_code=401, detail="Bad signature")

    try:
        body = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    sent_at = _parse_sent_at(body.get("sent_at"))
    if sent_at is None or abs((datetime.now(timezone.utc) - sent_at).total_seconds()) > _FRESHNESS_SECONDS:
        raise HTTPException(status_code=400, detail="Stale or missing sent_at")

    event = body.get("event")
    data = body.get("data") or {}
    if event not in ("script.approved", "script.retracted") or data.get("id") is None:
        raise HTTPException(status_code=400, detail="Unsupported event")

    async with async_session() as db:
        outcome = await apply_webhook_event(db, event, data)
    logger.info("Panel webhook %s id=%s -> %s", event, data.get("id"), outcome)
    return {"status": "ok", **outcome}
