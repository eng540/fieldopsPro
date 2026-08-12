"""Execution Event Pipeline service.

The event log is the source of truth. UnitBoQProgress is a materialized read model
and is mutated only inside this pipeline transaction.
"""
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.execution.models import (
    EventSyncLog,
    ExecutionEvent,
    EventType,
    MetricType,
    MONOTONIC_STATUS_TRANSITIONS,
    UnitBoQProgress,
    UnitBoQProgressStatus,
    WorkOrderStatus,
)
from app.modules.execution.schemas import EventConflictDetails, EventIntent, EventResponse


class ConcurrentModificationError(Exception):
    def __init__(self, conflict_details: EventConflictDetails):
        self.conflict_details = conflict_details
        super().__init__("Concurrent modification detected.")


class BusinessRuleError(Exception):
    pass


def _require_uuid(value: str, field_name: str) -> str:
    try:
        UUID(value)
    except (ValueError, TypeError, AttributeError) as exc:
        raise BusinessRuleError(f"{field_name} must be a valid UUID.") from exc
    return value


def _number(value: Any, key: str) -> float:
    try:
        return float(value[key])
    except (KeyError, TypeError, ValueError) as exc:
        raise BusinessRuleError(f"value.{key} must be numeric.") from exc


def _validate_status_transition(current: str, requested: str) -> str:
    try:
        current_enum = WorkOrderStatus(current)
        requested_enum = WorkOrderStatus(requested)
    except ValueError as exc:
        raise BusinessRuleError(f"Invalid status transition value: {current} -> {requested}") from exc
    if requested_enum != current_enum and requested_enum not in MONOTONIC_STATUS_TRANSITIONS.get(current_enum, []):
        raise BusinessRuleError(
            f"Invalid status transition: {current_enum.value} -> {requested_enum.value}."
        )
    return requested_enum.value


async def process_event_intent(
    db: AsyncSession,
    intent: EventIntent,
    org_id: int,
    user_id: int,
    transaction_group_id: str | None = None,
) -> EventResponse:
    """Process exactly one event inside the caller's transaction/savepoint."""
    _require_uuid(intent.sync_uuid, "sync_uuid")
    if transaction_group_id:
        _require_uuid(transaction_group_id, "transaction_group_id")

    existing = await db.execute(
        select(EventSyncLog).where(
            EventSyncLog.operation_uuid == intent.sync_uuid,
            EventSyncLog.org_id == org_id,
        )
    )
    existing_log = existing.scalar_one_or_none()
    if existing_log:
        if existing_log.response_payload:
            return EventResponse(**existing_log.response_payload)
        raise BusinessRuleError("Event is already registered but has no cached response.")

    if intent.entity_type.value != "BOQ_ITEM":
        raise BusinessRuleError(
            f"State tracking for entity type {intent.entity_type.value} is not implemented."
        )

    try:
        boq_item_id = int(intent.entity_id)
    except (TypeError, ValueError) as exc:
        raise BusinessRuleError("entity_id must be an integer for BOQ_ITEM.") from exc

    state_result = await db.execute(
        select(UnitBoQProgress)
        .where(
            UnitBoQProgress.org_id == org_id,
            UnitBoQProgress.unit_id == intent.unit_id,
            UnitBoQProgress.boq_item_id == boq_item_id,
        )
        .with_for_update()
    )
    current_state = state_result.scalar_one_or_none()
    if current_state is None:
        raise BusinessRuleError(
            f"BOQ state not found for unit {intent.unit_id}, item {boq_item_id}."
        )

    if current_state.state_version != intent.expected_version:
        conflict = EventConflictDetails(
            sync_uuid=intent.sync_uuid,
            expected_version=intent.expected_version,
            actual_version=current_state.state_version,
            current_state={
                "unit_id": current_state.unit_id,
                "boq_item_id": current_state.boq_item_id,
                "completion_pct": current_state.completion_pct,
                "actual_quantity": current_state.actual_quantity,
                "status": current_state.status,
                "state_version": current_state.state_version,
                "last_event_id": current_state.last_event_id,
                "updated_by": current_state.updated_by,
                "updated_at": current_state.updated_at.isoformat(),
            },
        )
        raise ConcurrentModificationError(conflict)

    previous_value = {
        "pct": current_state.completion_pct,
        "qty": current_state.actual_quantity,
        "status": current_state.status,
    }
    new_pct = current_state.completion_pct
    new_qty = current_state.actual_quantity
    new_status = current_state.status

    if intent.event_type == EventType.DELTA_ADD:
        if intent.metric_type == MetricType.PERCENTAGE:
            delta = _number(intent.value, "pct")
            if delta < 0:
                raise BusinessRuleError("DELTA_ADD percentage cannot be negative; use REWORK.")
            new_pct = min(100.0, current_state.completion_pct + delta)
        elif intent.metric_type == MetricType.QUANTITY:
            delta = _number(intent.value, "qty")
            if delta < 0:
                raise BusinessRuleError("DELTA_ADD quantity cannot be negative; use REWORK.")
            new_qty = (current_state.actual_quantity or 0.0) + delta
        else:
            raise BusinessRuleError("DELTA_ADD supports PERCENTAGE or QUANTITY only.")

    elif intent.event_type in {EventType.SNAPSHOT_SET, EventType.DATA_CORRECTION}:
        if intent.event_type == EventType.SNAPSHOT_SET:
            if intent.metric_type == MetricType.PERCENTAGE:
                new_pct = _number(intent.value, "pct")
            elif intent.metric_type == MetricType.QUANTITY:
                new_qty = _number(intent.value, "qty")
            else:
                raise BusinessRuleError("SNAPSHOT_SET supports PERCENTAGE or QUANTITY only.")
        else:
            if not intent.reason or len(intent.reason.strip()) < 10:
                raise BusinessRuleError("DATA_CORRECTION requires a reason of at least 10 characters.")
            if intent.metric_type == MetricType.PERCENTAGE:
                new_pct = _number(intent.value, "pct")
            elif intent.metric_type == MetricType.QUANTITY:
                new_qty = _number(intent.value, "qty")
            else:
                raise BusinessRuleError("DATA_CORRECTION supports PERCENTAGE or QUANTITY only.")

    elif intent.event_type == EventType.REWORK:
        if not intent.reason or len(intent.reason.strip()) < 20:
            raise BusinessRuleError("REWORK requires a detailed reason of at least 20 characters.")
        if intent.metric_type == MetricType.PERCENTAGE:
            delta = abs(_number(intent.value, "pct"))
            new_pct = max(0.0, current_state.completion_pct - delta)
        elif intent.metric_type == MetricType.QUANTITY:
            delta = abs(_number(intent.value, "qty"))
            new_qty = max(0.0, (current_state.actual_quantity or 0.0) - delta)
        else:
            raise BusinessRuleError("REWORK supports PERCENTAGE or QUANTITY only.")
        new_status = UnitBoQProgressStatus.REWORK_REQUIRED.value

    elif intent.event_type == EventType.STATUS_CHANGE:
        requested = str(intent.value.get("status", ""))
        new_status = _validate_status_transition(current_state.status, requested)

    elif intent.event_type == EventType.INITIAL_STATE:
        raise BusinessRuleError("INITIAL_STATE is reserved for controlled data migration.")

    if intent.event_type not in {EventType.STATUS_CHANGE, EventType.REWORK}:
        if not 0.0 <= new_pct <= 100.0:
            raise BusinessRuleError("completion_pct must remain within [0, 100].")
        if new_pct >= 100.0:
            new_status = UnitBoQProgressStatus.COMPLETED.value
        elif new_pct > 0.0:
            new_status = UnitBoQProgressStatus.IN_PROGRESS.value
        elif new_pct == 0.0:
            new_status = UnitBoQProgressStatus.NOT_STARTED.value

    event_id = str(uuid4())
    server_now = datetime.now(timezone.utc)
    new_value = {"pct": new_pct, "qty": new_qty, "status": new_status}

    event = ExecutionEvent(
        id=event_id,
        org_id=org_id,
        project_id=None,
        unit_id=current_state.unit_id,
        entity_type=intent.entity_type,
        entity_id=intent.entity_id,
        event_class=intent.event_class,
        event_type=intent.event_type,
        metric_type=intent.metric_type,
        previous_value=previous_value,
        new_value=new_value,
        delta_value=intent.value,
        unit_of_measure=intent.unit_of_measure,
        occurred_at=intent.occurred_at,
        recorded_at=server_now,
        user_id=user_id,
        reason=intent.reason,
        notes=intent.notes,
        sync_uuid=intent.sync_uuid,
        transaction_group_id=transaction_group_id,
    )
    db.add(event)

    current_state.completion_pct = new_pct
    current_state.actual_quantity = new_qty
    current_state.status = new_status
    current_state.state_version += 1
    current_state.last_event_id = event_id
    current_state.updated_by = user_id

    response_payload = {
        "event_id": event_id,
        "sync_uuid": intent.sync_uuid,
        "new_version": current_state.state_version,
        "status": "PROCESSED",
        "recorded_at": server_now.isoformat(),
    }
    db.add(
        EventSyncLog(
            org_id=org_id,
            operation_uuid=intent.sync_uuid,
            status="PROCESSED",
            response_payload=response_payload,
        )
    )

    try:
        await db.flush()
    except IntegrityError as exc:
        raise BusinessRuleError(
            "Event could not be committed because its sync_uuid already exists. Retry as idempotent request."
        ) from exc

    return EventResponse(**response_payload)
