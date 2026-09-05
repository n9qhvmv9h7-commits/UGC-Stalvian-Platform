"""Audit trail for admin mutations.

audit() only stages the row — the call site's own commit persists it, so the
log entry and the mutation it describes commit atomically.
"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Creator


async def audit(
    db: AsyncSession,
    admin: Creator,
    action: str,
    entity: str,
    entity_id: int | None = None,
    detail: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            admin_id=admin.id,
            action=action,
            entity=entity,
            entity_id=entity_id,
            detail=detail or {},
        )
    )
