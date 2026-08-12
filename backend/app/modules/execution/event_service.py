"""Epic 1 execution event pipeline.

All BOQ progress mutations flow through this service. The event log is the
source of truth; unit_boq_progress is maintained as the materialized state.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.execution.models import (
    EventClass,
    EventSyncLog,
    EventType,
    ExecutionEvent,
    MetricType,
    UnitBoQProgress,
    UnitBoQProgressStatus,
)

_ALLOWED_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "NOT_STARTED": {"IN_PROGRESS"},
    "IN_PROGRESS": {"PAUSED", "COMPLETED", "REWORK_REQUIRED"},
    "PAUSED": {"IN_PROGRESS", "CANCELLED"},
    "REWORK_REQUIRED": {"IN_PROGRESS"},
    "COMPLETED": {"REWORK_REQUIRED"},
    "CANCELLED": set(),
}
_REWORK_ROLES = {"PROJECT_MANAGER", "ORG_ADMIN", "SUPER_ADMIN"}

async def _get_state(db: AsyncSession, *, org_id: int, unit_id: int, boq_item_id: int) -> UnitBoQProgress | None:
    result = await db.execute(
        select(UnitBoQProgress).where(
            UnitBoQProgress.org_id == org_id,
            UnitBoQProgress.unit_id == unit_id,
            UnitBoQProgress.boq_item_id == boq_item_id,
        ).with_for_update()
    )
    return result.scalar_one_or_none()

async def _cached_response(db: AsyncSession, sync_uuid: str) -> dict[str, Any] | None:
    result = await db.execute(select(EventSyncLog).where(EventSyncLog.operation_uuid == sync_uuid))
    log = result.scalar_one_or_none()
    return log.response_payload if log and log.status == "PROCESSED" else None

async def apply_event(
    db: AsyncSession, *, org_id: int, user_id: int, entity_type: str, entity_id: str,
    unit_id: int, boq_item_id: int, event_class: EventClass, event_type: EventType,
    metric_type: MetricType, value: Any = None, unit_of_measure: str | None = None,
    occurred_at: datetime | None = None, effective_date: datetime | None = None,
    expected_version: int | None = None, sync_uuid: str | None = None,
    transaction_group_id: str | None = None, reason: str | None = None,
    notes: str | None = None, authorized_role: str | None = None,
) -> dict[str, Any]:
    """Apply one event and update materialized state in the same DB transaction."""
    sync_uuid = sync_uuid or str(uuid4())
    cached = await _cached_response(db, sync_uuid)
    if cached is not None:
        return cached

    async with db.begin_nested():
        try:
            sync_log = EventSyncLog(org_id=org_id, operation_uuid=sync_uuid, status="PENDING")
            db.add(sync_log)
            await db.flush()
        except IntegrityError:
            cached = await _cached_response(db, sync_uuid)
            if cached is not None:
                return cached
            raise HTTPException(status_code=409, detail="Duplicate sync_uuid is already being processed")

        state = await _get_state(db, org_id=org_id, unit_id=unit_id, boq_item_id=boq_item_id)
        if state is None:
            state = UnitBoQProgress(
                org_id=org_id, unit_id=unit_id, boq_item_id=boq_item_id,
                completion_pct=0.0, status=UnitBoQProgressStatus.NOT_STARTED.value,
                updated_by=user_id, state_version=1,
            )
            db.add(state)
            await db.flush()

        actual_version = state.state_version
        if expected_version is not None and expected_version != actual_version:
            raise HTTPException(status_code=409, detail={
                "error": "CONCURRENT_MODIFICATION",
                "message": "تم تحديث هذا البند بواسطة مستخدم آخر.",
                "conflict_details": {
                    "sync_uuid": sync_uuid, "expected_version": expected_version,
                    "actual_version": actual_version,
                    "current_state": {
                        "actual_quantity": state.actual_quantity,
                        "completion_pct": state.completion_pct, "status": state.status,
                        "last_updated_by": state.updated_by,
                        "last_updated_at": state.updated_at.isoformat() if state.updated_at else None,
                    },
                },
            })

        old_state = {
            "completion_pct": state.completion_pct, "actual_quantity": state.actual_quantity,
            "financial_value": state.financial_value, "status": state.status,
            "rework_flag": state.rework_flag, "rework_reason": state.rework_reason,
        }

        if event_type == EventType.STATUS_CHANGE:
            if not isinstance(value, str):
                raise HTTPException(status_code=422, detail="STATUS_CHANGE requires a status value")
            if value != state.status and value not in _ALLOWED_STATUS_TRANSITIONS.get(state.status, set()):
                if not (state.status == "COMPLETED" and value == "REWORK_REQUIRED" and authorized_role in _REWORK_ROLES):
                    raise HTTPException(status_code=422, detail=f"Invalid status transition: {state.status} -> {value}")
            state.status = value
            if value == "REWORK_REQUIRED":
                state.rework_flag = True
                state.rework_reason = reason or notes

        elif event_type in {EventType.DELTA_ADD, EventType.SNAPSHOT_SET, EventType.DATA_CORRECTION, EventType.REWORK}:
            if event_type == EventType.SNAPSHOT_SET and authorized_role != "SUPER_ADMIN":
                raise HTTPException(status_code=403, detail="SNAPSHOT_SET requires SUPER_ADMIN")
            if event_type == EventType.DATA_CORRECTION and authorized_role not in {"ORG_ADMIN", "SUPER_ADMIN"}:
                raise HTTPException(status_code=403, detail="DATA_CORRECTION requires ORG_ADMIN or higher")
            if event_type == EventType.REWORK and authorized_role not in _REWORK_ROLES:
                raise HTTPException(status_code=403, detail="REWORK requires PROJECT_MANAGER or higher")

            numeric = float(value)
            if metric_type == MetricType.PERCENTAGE:
                current = float(state.completion_pct or 0.0)
                new_value = current + numeric if event_type == EventType.DELTA_ADD else numeric
                if not 0.0 <= new_value <= 100.0:
                    raise HTTPException(status_code=422, detail="completion_pct must remain between 0 and 100")
                if new_value < current and event_type not in {EventType.REWORK, EventType.DATA_CORRECTION}:
                    raise HTTPException(status_code=409, detail="Progress cannot decrease without REWORK or DATA_CORRECTION")
                state.completion_pct = new_value
                if event_type == EventType.REWORK:
                    state.rework_flag = True
                    state.rework_reason = reason or notes
                    state.status = UnitBoQProgressStatus.REWORK_REQUIRED.value
                elif state.completion_pct >= 100:
                    state.status = UnitBoQProgressStatus.COMPLETED.value
                elif state.completion_pct > 0:
                    state.status = UnitBoQProgressStatus.IN_PROGRESS.value
                else:
                    state.status = UnitBoQProgressStatus.NOT_STARTED.value
            elif metric_type == MetricType.QUANTITY:
                current = float(state.actual_quantity or 0.0)
                state.actual_quantity = current + numeric if event_type == EventType.DELTA_ADD else numeric
            elif metric_type == MetricType.FINANCIAL:
                current = float(state.financial_value or 0.0)
                state.financial_value = current + numeric if event_type == EventType.DELTA_ADD else numeric
            else:
                raise HTTPException(status_code=422, detail="Event requires QUANTITY, PERCENTAGE, or FINANCIAL metric")
        elif event_type == EventType.INITIAL_STATE:
            raise HTTPException(status_code=403, detail="INITIAL_STATE is migration-only")
        else:
            raise HTTPException(status_code=422, detail=f"Unsupported event_type: {event_type.value}")

        new_state = {
            "completion_pct": state.completion_pct, "actual_quantity": state.actual_quantity,
            "financial_value": state.financial_value, "status": state.status,
            "rework_flag": state.rework_flag, "rework_reason": state.rework_reason,
        }
        event_id = str(uuid4())
        db.add(ExecutionEvent(
            id=event_id, org_id=org_id, unit_id=unit_id, entity_type=entity_type,
            entity_id=entity_id, event_class=event_class, event_type=event_type,
            metric_type=metric_type, previous_value=old_state,
            new_value={"value": value, "state": new_state},
            delta_value={"value": value} if event_type == EventType.DELTA_ADD else None,
            unit_of_measure=unit_of_measure, occurred_at=occurred_at or datetime.now(timezone.utc),
            effective_date=effective_date, user_id=user_id, reason=reason, notes=notes,
            sync_uuid=sync_uuid, transaction_group_id=transaction_group_id,
        ))
        await db.flush()

        state.state_version = actual_version + 1
        state.last_event_id = event_id
        state.updated_by = user_id
        await db.flush()

        response = {
            "event_id": event_id, "sync_uuid": sync_uuid,
            "transaction_group_id": transaction_group_id,
            "state_version": state.state_version, "current_state": new_state,
        }
        sync_log.status = "PROCESSED"
        sync_log.response_payload = response
        await db.flush()
        return response
