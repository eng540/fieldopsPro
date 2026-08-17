"""Execution Event Pipeline service.

The event ledger is the source of truth. UnitBoQProgress is a materialized
read model and is mutated only inside this service's transaction boundary.
Project/Unit/BOQ completion percentages are refreshed from that read model so
all operational screens see the same execution result after an event is saved.
"""
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.execution.models import (
    EventSyncLog,
    ExecutionEvent,
    EventType,
    MetricType,
    UnitBoQProgress,
    UnitBoQProgressStatus,
)
from app.modules.execution.schemas import EventConflictDetails, EventIntent, EventResponse
from app.modules.projects.models import BOQItem, Project, ProjectUnit, UnitBoQAssignment


class ConcurrentModificationError(Exception):
    def __init__(self, conflict_details: EventConflictDetails):
        self.conflict_details = conflict_details
        super().__init__("Concurrent modification detected.")


class BusinessRuleError(Exception):
    pass


_BOQ_STATUS_TRANSITIONS: dict[str, set[str]] = {
    UnitBoQProgressStatus.NOT_STARTED.value: {
        UnitBoQProgressStatus.NOT_STARTED.value,
        UnitBoQProgressStatus.IN_PROGRESS.value,
        UnitBoQProgressStatus.COMPLETED.value,
    },
    UnitBoQProgressStatus.IN_PROGRESS.value: {
        UnitBoQProgressStatus.IN_PROGRESS.value,
        UnitBoQProgressStatus.COMPLETED.value,
        UnitBoQProgressStatus.REWORK_REQUIRED.value,
    },
    UnitBoQProgressStatus.REWORK_REQUIRED.value: {
        UnitBoQProgressStatus.REWORK_REQUIRED.value,
        UnitBoQProgressStatus.IN_PROGRESS.value,
        UnitBoQProgressStatus.COMPLETED.value,
    },
    UnitBoQProgressStatus.COMPLETED.value: {
        UnitBoQProgressStatus.COMPLETED.value,
        UnitBoQProgressStatus.REWORK_REQUIRED.value,
    },
}


def _require_uuid(value: str, field_name: str) -> str:
    try:
        UUID(value)
    except (ValueError, TypeError, AttributeError) as exc:
        raise BusinessRuleError(f"{field_name} must be a valid UUID.") from exc
    return value


def _number(value: Any, key: str) -> float:
    try:
        number = float(value[key])
    except (KeyError, TypeError, ValueError) as exc:
        raise BusinessRuleError(f"value.{key} must be numeric.") from exc
    if number != number or number in (float("inf"), float("-inf")):
        raise BusinessRuleError(f"value.{key} must be finite.")
    return number


def _validate_status_transition(current: str, requested: str) -> str:
    allowed = _BOQ_STATUS_TRANSITIONS.get(current)
    if allowed is None:
        raise BusinessRuleError(f"Unknown BOQ status: {current}.")
    if requested not in _BOQ_STATUS_TRANSITIONS:
        raise BusinessRuleError(f"Invalid BOQ status: {requested}.")
    if requested not in allowed:
        raise BusinessRuleError(f"Invalid BOQ status transition: {current} -> {requested}.")
    return requested


async def initialize_boq_state(db: AsyncSession, *, org_id: int, unit_id: int, boq_item_id: int, user_id: int) -> UnitBoQProgress:
    existing = await db.execute(select(UnitBoQProgress).where(UnitBoQProgress.org_id == org_id, UnitBoQProgress.unit_id == unit_id, UnitBoQProgress.boq_item_id == boq_item_id).with_for_update())
    state = existing.scalar_one_or_none()
    if state is not None:
        return state
    event_id = str(uuid4())
    sync_uuid = str(uuid4())
    now = datetime.now(timezone.utc)
    initial_value = {"pct": 0.0, "qty": 0.0, "status": UnitBoQProgressStatus.NOT_STARTED.value}
    db.add(EventSyncLog(org_id=org_id, operation_uuid=sync_uuid, status="PROCESSED", response_payload={"event_id": event_id, "sync_uuid": sync_uuid, "new_version": 1, "status": "PROCESSED", "recorded_at": now.isoformat()}))
    state = UnitBoQProgress(org_id=org_id, unit_id=unit_id, boq_item_id=boq_item_id, completion_pct=0.0, status=UnitBoQProgressStatus.NOT_STARTED.value, measured_quantity=None, actual_quantity=0.0, state_version=1, rework_flag=False, updated_by=user_id, last_event_id=event_id)
    db.add(state)
    db.add(ExecutionEvent(id=event_id, org_id=org_id, unit_id=unit_id, entity_type="BOQ_ITEM", entity_id=str(boq_item_id), event_class="PROGRESS", event_type="INITIAL_STATE", metric_type="PERCENTAGE", previous_value=None, new_value=initial_value, delta_value=None, occurred_at=now, recorded_at=now, user_id=user_id, notes="Initialized by execution pipeline", sync_uuid=sync_uuid))
    try:
        await db.flush()
    except IntegrityError as exc:
        raise BusinessRuleError("BOQ state could not be initialized due to a concurrent change.") from exc
    return state


async def _refresh_materialized_progress(db: AsyncSession, *, org_id: int, unit_id: int, boq_item_id: int) -> None:
    """Materialize execution state into the project/BOQ/unit read models.

    Unit completion is the average of its active BOQ assignments. BOQ completion
    is weighted by planned quantity per unit. Project completion is weighted by
    the BOQ master quantities. These are derived values; the event ledger remains
    authoritative.
    """
    unit_avg = (await db.execute(
        select(func.avg(UnitBoQProgress.completion_pct))
        .join(UnitBoQAssignment, UnitBoQAssignment.unit_id == UnitBoQProgress.unit_id)
        .where(UnitBoQAssignment.org_id == org_id, UnitBoQAssignment.unit_id == unit_id, UnitBoQAssignment.is_active.is_(True), UnitBoQProgress.boq_item_id == UnitBoQAssignment.boq_item_id)
    )).scalar_one()
    unit = (await db.execute(select(ProjectUnit).where(ProjectUnit.id == unit_id, ProjectUnit.org_id == org_id))).scalar_one_or_none()
    if unit is not None:
        unit.completion_pct = float(unit_avg or 0.0)
        unit.status = "COMPLETED" if unit.completion_pct >= 100 else ("IN_PROGRESS" if unit.completion_pct > 0 else "PENDING")

    weighted = (await db.execute(
        select(func.sum(UnitBoQProgress.completion_pct * UnitBoQAssignment.planned_quantity), func.sum(UnitBoQAssignment.planned_quantity))
        .join(UnitBoQAssignment, UnitBoQAssignment.unit_id == UnitBoQProgress.unit_id)
        .where(UnitBoQAssignment.org_id == org_id, UnitBoQAssignment.boq_item_id == boq_item_id, UnitBoQAssignment.is_active.is_(True), UnitBoQProgress.boq_item_id == boq_item_id)
    )).one()
    numerator, denominator = weighted
    if denominator and float(denominator) > 0:
        boq_pct = float(numerator or 0.0) / float(denominator) 
    else:
        avg = (await db.execute(select(func.avg(UnitBoQProgress.completion_pct)).join(UnitBoQAssignment, UnitBoQAssignment.unit_id == UnitBoQProgress.unit_id).where(UnitBoQAssignment.org_id == org_id, UnitBoQAssignment.boq_item_id == boq_item_id, UnitBoQAssignment.is_active.is_(True), UnitBoQProgress.boq_item_id == boq_item_id))).scalar_one()
        boq_pct = float(avg or 0.0)
    item = (await db.execute(select(BOQItem).where(BOQItem.id == boq_item_id, BOQItem.org_id == org_id))).scalar_one_or_none()
    if item is None:
        return
    item.completion_pct = max(0.0, min(100.0, boq_pct))

    project = (await db.execute(select(Project).where(Project.id == item.project_id, Project.org_id == org_id))).scalar_one_or_none()
    if project is None:
        return
    project_weighted = (await db.execute(
        select(func.sum(BOQItem.completion_pct * BOQItem.quantity), func.sum(BOQItem.quantity))
        .where(BOQItem.project_id == project.id, BOQItem.org_id == org_id, BOQItem.is_active.is_(True))
    )).one()
    project_num, project_den = project_weighted
    if project_den and float(project_den) > 0:
        project.completion_pct = max(0.0, min(100.0, float(project_num or 0.0) / float(project_den)))
    else:
        avg_project = (await db.execute(select(func.avg(BOQItem.completion_pct)).where(BOQItem.project_id == project.id, BOQItem.org_id == org_id, BOQItem.is_active.is_(True)))).scalar_one()
        project.completion_pct = float(avg_project or 0.0)


async def process_event_intent(db: AsyncSession, intent: EventIntent, org_id: int, user_id: int, transaction_group_id: str | None = None) -> EventResponse:
    _require_uuid(intent.sync_uuid, "sync_uuid")
    if transaction_group_id:
        _require_uuid(transaction_group_id, "transaction_group_id")
    existing = await db.execute(select(EventSyncLog).where(EventSyncLog.operation_uuid == intent.sync_uuid, EventSyncLog.org_id == org_id))
    existing_log = existing.scalar_one_or_none()
    if existing_log:
        if existing_log.response_payload:
            return EventResponse(**existing_log.response_payload)
        raise BusinessRuleError("Event is already registered but has no cached response.")
    if intent.entity_type.value != "BOQ_ITEM":
        raise BusinessRuleError(f"State tracking for entity type {intent.entity_type.value} is not implemented.")
    if intent.unit_id is None:
        raise BusinessRuleError("unit_id is required for BOQ_ITEM events.")
    try:
        boq_item_id = int(intent.entity_id)
    except (TypeError, ValueError) as exc:
        raise BusinessRuleError("entity_id must be an integer for BOQ_ITEM.") from exc
    state_result = await db.execute(select(UnitBoQProgress).where(UnitBoQProgress.org_id == org_id, UnitBoQProgress.unit_id == intent.unit_id, UnitBoQProgress.boq_item_id == boq_item_id).with_for_update())
    current_state = state_result.scalar_one_or_none()
    if current_state is None:
        raise BusinessRuleError(f"BOQ state not found for unit {intent.unit_id}, item {boq_item_id}.")
    if current_state.state_version != intent.expected_version:
        raise ConcurrentModificationError(EventConflictDetails(sync_uuid=intent.sync_uuid, expected_version=intent.expected_version, actual_version=current_state.state_version, current_state={"unit_id": current_state.unit_id, "boq_item_id": current_state.boq_item_id, "completion_pct": current_state.completion_pct, "actual_quantity": current_state.actual_quantity, "status": current_state.status, "state_version": current_state.state_version, "last_event_id": current_state.last_event_id, "updated_by": current_state.updated_by, "updated_at": current_state.updated_at.isoformat()}))
    previous_value = {"pct": current_state.completion_pct, "qty": current_state.actual_quantity, "status": current_state.status}
    new_pct, new_qty, new_status = current_state.completion_pct, current_state.actual_quantity, current_state.status
    if intent.event_type == EventType.DELTA_ADD:
        if intent.metric_type == MetricType.PERCENTAGE:
            delta = _number(intent.value, "pct")
            if delta < 0: raise BusinessRuleError("DELTA_ADD percentage cannot be negative; use REWORK.")
            new_pct = min(100.0, current_state.completion_pct + delta)
        elif intent.metric_type == MetricType.QUANTITY:
            delta = _number(intent.value, "qty")
            if delta < 0: raise BusinessRuleError("DELTA_ADD quantity cannot be negative; use REWORK.")
            new_qty = (current_state.actual_quantity or 0.0) + delta
        else: raise BusinessRuleError("DELTA_ADD supports PERCENTAGE or QUANTITY only.")
    elif intent.event_type in {EventType.SNAPSHOT_SET, EventType.DATA_CORRECTION}:
        if intent.event_type == EventType.DATA_CORRECTION and (not intent.reason or len(intent.reason.strip()) < 10): raise BusinessRuleError("DATA_CORRECTION requires a reason of at least 10 characters.")
        if intent.metric_type == MetricType.PERCENTAGE: new_pct = _number(intent.value, "pct")
        elif intent.metric_type == MetricType.QUANTITY: new_qty = _number(intent.value, "qty")
        else: raise BusinessRuleError("Snapshot/correction supports PERCENTAGE or QUANTITY only.")
    elif intent.event_type == EventType.REWORK:
        if not intent.reason or len(intent.reason.strip()) < 20: raise BusinessRuleError("REWORK requires a detailed reason of at least 20 characters.")
        if intent.metric_type == MetricType.PERCENTAGE: new_pct = max(0.0, current_state.completion_pct - abs(_number(intent.value, "pct")))
        elif intent.metric_type == MetricType.QUANTITY: new_qty = max(0.0, (current_state.actual_quantity or 0.0) - abs(_number(intent.value, "qty")))
        else: raise BusinessRuleError("REWORK supports PERCENTAGE or QUANTITY only.")
        new_status = UnitBoQProgressStatus.REWORK_REQUIRED.value
    elif intent.event_type == EventType.STATUS_CHANGE:
        new_status = _validate_status_transition(current_state.status, str(intent.value.get("status", "")))
    elif intent.event_type == EventType.INITIAL_STATE:
        raise BusinessRuleError("INITIAL_STATE is reserved for controlled initialization/migration.")
    if intent.event_type not in {EventType.STATUS_CHANGE, EventType.REWORK}:
        if not 0.0 <= new_pct <= 100.0: raise BusinessRuleError("completion_pct must remain within [0, 100].")
        if new_pct >= 100.0: new_status = UnitBoQProgressStatus.COMPLETED.value
        elif new_pct > 0.0: new_status = UnitBoQProgressStatus.IN_PROGRESS.value
        else: new_status = UnitBoQProgressStatus.NOT_STARTED.value
    event_id = str(uuid4())
    server_now = datetime.now(timezone.utc)
    new_value = {"pct": new_pct, "qty": new_qty, "status": new_status}
    db.add(ExecutionEvent(id=event_id, org_id=org_id, unit_id=current_state.unit_id, entity_type=intent.entity_type, entity_id=intent.entity_id, event_class=intent.event_class, event_type=intent.event_type, metric_type=intent.metric_type, previous_value=previous_value, new_value=new_value, delta_value=intent.value, unit_of_measure=intent.unit_of_measure, occurred_at=intent.occurred_at, recorded_at=server_now, user_id=user_id, reason=intent.reason, notes=intent.notes, sync_uuid=intent.sync_uuid, transaction_group_id=transaction_group_id))
    current_state.completion_pct = new_pct
    current_state.actual_quantity = new_qty
    current_state.status = new_status
    current_state.state_version += 1
    current_state.last_event_id = event_id
    current_state.updated_by = user_id
    current_state.rework_flag = intent.event_type == EventType.REWORK
    current_state.rework_reason = intent.reason if intent.event_type == EventType.REWORK else None
    await _refresh_materialized_progress(db, org_id=org_id, unit_id=current_state.unit_id, boq_item_id=boq_item_id)
    response_payload = {"event_id": event_id, "sync_uuid": intent.sync_uuid, "new_version": current_state.state_version, "status": "PROCESSED", "recorded_at": server_now.isoformat()}
    db.add(EventSyncLog(org_id=org_id, operation_uuid=intent.sync_uuid, status="PROCESSED", response_payload=response_payload))
    try:
        await db.flush()
    except IntegrityError as exc:
        raise BusinessRuleError("Event could not be committed because its sync_uuid already exists. Retry the request.") from exc
    return EventResponse(**response_payload)
