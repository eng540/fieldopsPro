"""Epic 1 execution event pipeline.

Constitutional rules:
- execution_events is the source of truth and is append-only.
- unit_boq_progress is a materialized state updated only here, atomically with its event.
- Missing materialized state is not auto-created by API calls; controlled initialization/migration owns that path.
- Optimistic locking and row locking are mandatory for BOQ_ITEM events.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.execution.models import (
    EventClass, EventSyncLog, EventType, ExecutionEvent, MetricType,
    UnitBoQProgress, UnitBoQProgressStatus,
)
from app.modules.projects.models import UnitBoQAssignment

_REWORK_ROLES = {"PROJECT_MANAGER", "ORG_ADMIN", "SUPER_ADMIN"}
_CORRECTION_ROLES = {"ORG_ADMIN", "SUPER_ADMIN"}


def _uuid(value: str, name: str) -> None:
    try:
        UUID(str(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(status_code=422, detail=f"{name} must be a valid UUID") from exc


async def _cached_response(db: AsyncSession, sync_uuid: str, org_id: int) -> dict[str, Any] | None:
    result = await db.execute(select(EventSyncLog).where(
        EventSyncLog.operation_uuid == sync_uuid,
        EventSyncLog.org_id == org_id,
    ))
    log = result.scalar_one_or_none()
    return log.response_payload if log and log.status == "PROCESSED" else None


async def _get_state(db: AsyncSession, *, org_id: int, unit_id: int, boq_item_id: int) -> UnitBoQProgress | None:
    result = await db.execute(
        select(UnitBoQProgress).where(
            UnitBoQProgress.org_id == org_id,
            UnitBoQProgress.unit_id == unit_id,
            UnitBoQProgress.boq_item_id == boq_item_id,
        ).with_for_update()
    )
    return result.scalar_one_or_none()


async def apply_event(
    db: AsyncSession, *, org_id: int, user_id: int, entity_type: str, entity_id: str,
    unit_id: int, boq_item_id: int, event_class: EventClass, event_type: EventType,
    metric_type: MetricType, value: Any = None, unit_of_measure: str | None = None,
    occurred_at: datetime | None = None, effective_date: datetime | None = None,
    expected_version: int | None = None, sync_uuid: str | None = None,
    transaction_group_id: str | None = None, reason: str | None = None,
    notes: str | None = None, authorized_role: str | None = None,
) -> dict[str, Any]:
    """Apply exactly one event. Caller controls the outer transaction/savepoint."""
    sync_uuid = sync_uuid or str(uuid4())
    _uuid(sync_uuid, "sync_uuid")
    if transaction_group_id:
        _uuid(transaction_group_id, "transaction_group_id")

    cached = await _cached_response(db, sync_uuid, org_id)
    if cached is not None:
        return cached

    if entity_type != "BOQ_ITEM":
        raise HTTPException(status_code=422, detail=f"Unsupported entity_type: {entity_type}")
    if event_type == EventType.INITIAL_STATE:
        raise HTTPException(status_code=403, detail="INITIAL_STATE is migration-only")

    state = await _get_state(db, org_id=org_id, unit_id=unit_id, boq_item_id=boq_item_id)
    if state is None:
        raise HTTPException(
            status_code=409,
            detail="BOQ materialized state is not initialized. Use the controlled initialization/migration pipeline.",
        )
    assignment_result = await db.execute(select(UnitBoQAssignment.id).where(
        UnitBoQAssignment.org_id == org_id,
        UnitBoQAssignment.unit_id == unit_id,
        UnitBoQAssignment.boq_item_id == boq_item_id,
        UnitBoQAssignment.is_active.is_(True),
    ))
    if assignment_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=409,
            detail="BOQ item is not assigned to this unit. Apply the item in Project Configuration before entering progress.",
        )

    actual_version = state.state_version
    if expected_version is None:
        raise HTTPException(status_code=422, detail="expected_version is required for mutable execution events")
    if expected_version != actual_version:
        raise HTTPException(status_code=409, detail={
            "error": "CONCURRENT_MODIFICATION",
            "conflict_details": {
                "sync_uuid": sync_uuid, "expected_version": expected_version,
                "actual_version": actual_version,
                "current_state": {
                    "unit_id": state.unit_id, "boq_item_id": state.boq_item_id,
                    "completion_pct": state.completion_pct,
                    "actual_quantity": state.actual_quantity,
                    "financial_value": state.financial_value,
                    "status": state.status, "state_version": state.state_version,
                    "last_event_id": state.last_event_id,
                    "updated_by": state.updated_by,
                    "updated_at": state.updated_at.isoformat() if state.updated_at else None,
                },
            },
        })

    old_state = {
        "completion_pct": state.completion_pct,
        "actual_quantity": state.actual_quantity,
        "financial_value": state.financial_value,
        "status": state.status,
        "rework_flag": state.rework_flag,
        "rework_reason": state.rework_reason,
    }
    new_pct = float(state.completion_pct or 0.0)
    new_qty = state.actual_quantity
    new_financial = state.financial_value
    new_status = state.status
    new_rework_flag = state.rework_flag
    new_rework_reason = state.rework_reason

    if event_type == EventType.STATUS_CHANGE:
        if not isinstance(value, str):
            raise HTTPException(status_code=422, detail="STATUS_CHANGE requires a status string")
        transitions = {
            UnitBoQProgressStatus.NOT_STARTED.value: {UnitBoQProgressStatus.IN_PROGRESS.value},
            UnitBoQProgressStatus.IN_PROGRESS.value: {
                UnitBoQProgressStatus.PAUSED.value, UnitBoQProgressStatus.COMPLETED.value,
                UnitBoQProgressStatus.REWORK_REQUIRED.value,
            },
            UnitBoQProgressStatus.PAUSED.value: {UnitBoQProgressStatus.IN_PROGRESS.value},
            UnitBoQProgressStatus.REWORK_REQUIRED.value: {UnitBoQProgressStatus.IN_PROGRESS.value},
            UnitBoQProgressStatus.COMPLETED.value: {UnitBoQProgressStatus.REWORK_REQUIRED.value},
        }
        if value != new_status and value not in transitions.get(new_status, set()):
            raise HTTPException(status_code=409, detail=f"Invalid status transition: {new_status} -> {value}")
        if value == UnitBoQProgressStatus.REWORK_REQUIRED.value:
            if authorized_role not in _REWORK_ROLES:
                raise HTTPException(status_code=403, detail="REWORK_REQUIRED requires authorized role")
            if not reason or len(reason.strip()) < 20:
                raise HTTPException(status_code=422, detail="Rework status requires a reason of at least 20 characters")
            new_rework_flag, new_rework_reason = True, reason
        new_status = value

    elif event_type in {EventType.DELTA_ADD, EventType.SNAPSHOT_SET, EventType.DATA_CORRECTION, EventType.REWORK}:
        if metric_type not in {MetricType.PERCENTAGE, MetricType.QUANTITY, MetricType.FINANCIAL}:
            raise HTTPException(status_code=422, detail="This event requires a numeric metric")
        try:
            numeric = float(value)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="Event value must be numeric") from exc
        if event_type == EventType.DELTA_ADD and numeric < 0:
            raise HTTPException(status_code=422, detail="DELTA_ADD cannot be negative; use REWORK")
        if event_type == EventType.SNAPSHOT_SET and authorized_role != "SUPER_ADMIN":
            raise HTTPException(status_code=403, detail="SNAPSHOT_SET requires SUPER_ADMIN")
        if event_type == EventType.DATA_CORRECTION and authorized_role not in _CORRECTION_ROLES:
            raise HTTPException(status_code=403, detail="DATA_CORRECTION requires ORG_ADMIN or SUPER_ADMIN")
        if event_type == EventType.REWORK:
            if authorized_role not in _REWORK_ROLES:
                raise HTTPException(status_code=403, detail="REWORK requires authorized role")
            if not reason or len(reason.strip()) < 20:
                raise HTTPException(status_code=422, detail="REWORK requires a reason of at least 20 characters")
            numeric = -abs(numeric)
            new_rework_flag, new_rework_reason = True, reason

        if metric_type == MetricType.PERCENTAGE:
            new_pct = numeric if event_type in {EventType.SNAPSHOT_SET, EventType.DATA_CORRECTION} else new_pct + numeric
            if not 0.0 <= new_pct <= 100.0:
                raise HTTPException(status_code=422, detail="completion_pct must remain between 0 and 100")
            if event_type == EventType.REWORK:
                new_status = UnitBoQProgressStatus.REWORK_REQUIRED.value
            elif new_pct >= 100.0:
                new_status = UnitBoQProgressStatus.COMPLETED.value
            elif new_pct > 0.0:
                new_status = UnitBoQProgressStatus.IN_PROGRESS.value
            else:
                new_status = UnitBoQProgressStatus.NOT_STARTED.value
        elif metric_type == MetricType.QUANTITY:
            current = float(state.actual_quantity or 0.0)
            new_qty = numeric if event_type in {EventType.SNAPSHOT_SET, EventType.DATA_CORRECTION} else current + numeric
            if new_qty < 0:
                raise HTTPException(status_code=422, detail="actual_quantity cannot be negative")
        else:
            current = float(state.financial_value or 0.0)
            new_financial = numeric if event_type in {EventType.SNAPSHOT_SET, EventType.DATA_CORRECTION} else current + numeric
            if new_financial < 0:
                raise HTTPException(status_code=422, detail="financial_value cannot be negative")
    else:
        raise HTTPException(status_code=422, detail=f"Unsupported event_type: {event_type.value}")

    new_state = {
        "completion_pct": new_pct, "actual_quantity": new_qty,
        "financial_value": new_financial, "status": new_status,
        "rework_flag": new_rework_flag, "rework_reason": new_rework_reason,
    }
    event_id = str(uuid4())
    now = datetime.now(timezone.utc)

    response = {
        "event_id": event_id, "sync_uuid": sync_uuid,
        "transaction_group_id": transaction_group_id,
        "state_version": actual_version + 1, "current_state": new_state,
    }

    # The event row has a foreign key to event_sync_logs.operation_uuid.
    # Register the idempotency row BEFORE flushing the event so the FK can be
    # satisfied inside the same transaction. Both rows are committed atomically.
    db.add(EventSyncLog(
        org_id=org_id, operation_uuid=sync_uuid, status="PROCESSED",
        response_payload=response,
    ))
    db.add(ExecutionEvent(
        id=event_id, org_id=org_id, unit_id=unit_id,
        entity_type=entity_type, entity_id=entity_id,
        event_class=event_class, event_type=event_type, metric_type=metric_type,
        previous_value=old_state, new_value=new_state,
        delta_value={"value": value} if event_type == EventType.DELTA_ADD else None,
        unit_of_measure=unit_of_measure, occurred_at=occurred_at or now,
        effective_date=effective_date, recorded_at=now, user_id=user_id,
        reason=reason, notes=notes, sync_uuid=sync_uuid,
        transaction_group_id=transaction_group_id,
    ))

    state.completion_pct = new_pct
    state.actual_quantity = new_qty
    state.financial_value = new_financial
    state.status = new_status
    state.rework_flag = new_rework_flag
    state.rework_reason = new_rework_reason
    state.state_version = actual_version + 1
    state.last_event_id = event_id
    state.updated_by = user_id

    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Duplicate sync_uuid or event constraint violation") from exc

    return response
