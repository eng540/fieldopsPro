from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.execution.event_schemas import ExecutionEventsRequest, ExecutionEventsResponse, ExecutionEventResult
from app.modules.execution.event_service import apply_event
from app.modules.execution.models import EventClass, EventType, MetricType, UnitBoQProgress
from app.modules.execution.schemas import BoQProgressCreate, BulkBoQProgressRequest
from app.modules.iam.dependencies import get_current_user

router = APIRouter()
_MUTATION_ROLES = {"FIELD_ENGINEER", "SITE_ENGINEER", "PROJECT_MANAGER", "ORG_ADMIN", "SUPER_ADMIN"}
_REWORK_ROLES = {"PROJECT_MANAGER", "ORG_ADMIN", "SUPER_ADMIN"}
_CORRECTION_ROLES = {"ORG_ADMIN", "SUPER_ADMIN"}


def _authorize(event_type: EventType, role: str) -> None:
    if role not in _MUTATION_ROLES:
        raise HTTPException(status_code=403, detail="User role cannot submit execution events")
    if event_type == EventType.SNAPSHOT_SET and role != "SUPER_ADMIN":
        raise HTTPException(status_code=403, detail="SNAPSHOT_SET requires SUPER_ADMIN")
    if event_type == EventType.DATA_CORRECTION and role not in _CORRECTION_ROLES:
        raise HTTPException(status_code=403, detail="DATA_CORRECTION requires ORG_ADMIN or SUPER_ADMIN")
    if event_type == EventType.REWORK and role not in _REWORK_ROLES:
        raise HTTPException(status_code=403, detail="REWORK requires PROJECT_MANAGER or higher")
    if event_type == EventType.INITIAL_STATE:
        raise HTTPException(status_code=403, detail="INITIAL_STATE is migration-only")


async def _get_state(db: AsyncSession, org_id: int, unit_id: int, boq_item_id: int) -> UnitBoQProgress | None:
    result = await db.execute(select(UnitBoQProgress).where(
        UnitBoQProgress.org_id == org_id,
        UnitBoQProgress.unit_id == unit_id,
        UnitBoQProgress.boq_item_id == boq_item_id,
    ))
    return result.scalar_one_or_none()


async def _legacy_intent(data: BoQProgressCreate, db: AsyncSession, user: dict) -> tuple[object | None, UnitBoQProgress | None]:
    org_id = user["org_id"]
    state = await _get_state(db, org_id, data.unit_id, data.boq_item_id)
    if state is None:
        raise HTTPException(status_code=409, detail="BOQ progress state is not initialized")
    delta = data.completion_pct - state.completion_pct
    if delta == 0:
        return None, state
    event_type = EventType.REWORK if delta < 0 else EventType.DELTA_ADD
    if delta < 0 and not data.rework_flag:
        raise HTTPException(status_code=409, detail="Monotonic Progress Violation: rework_flag is required")
    return type("Intent", (), {
        "sync_uuid": str(uuid4()), "entity_type": "BOQ_ITEM", "entity_id": str(data.boq_item_id),
        "unit_id": data.unit_id, "boq_item_id": data.boq_item_id, "event_class": EventClass.PROGRESS,
        "event_type": event_type, "metric_type": MetricType.PERCENTAGE,
        "value": abs(delta) if delta < 0 else delta, "unit_of_measure": None,
        "occurred_at": datetime.now(timezone.utc), "effective_date": None,
        "expected_version": state.state_version, "transaction_group_id": None,
        "reason": data.rework_reason, "notes": None,
    })(), state


@router.post("/events", response_model=ExecutionEventsResponse, status_code=200)
async def post_execution_events(
    payload: ExecutionEventsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> ExecutionEventsResponse:
    role = current_user.get("role", "VIEWER")
    results = []
    for item in payload.events:
        _authorize(item.event_type, role)
        try:
            async with db.begin_nested():
                result = await apply_event(
                    db, org_id=current_user["org_id"], user_id=current_user["id"],
                    entity_type=item.entity_type.value, entity_id=item.entity_id,
                    unit_id=item.unit_id, boq_item_id=item.boq_item_id,
                    event_class=item.event_class, event_type=item.event_type,
                    metric_type=item.metric_type, value=item.value,
                    unit_of_measure=item.unit_of_measure, occurred_at=item.occurred_at,
                    effective_date=item.effective_date, expected_version=item.expected_version,
                    sync_uuid=str(item.sync_uuid),
                    transaction_group_id=str(item.transaction_group_id) if item.transaction_group_id else None,
                    reason=item.reason, notes=item.notes, authorized_role=role,
                )
            results.append(ExecutionEventResult(**result))
        except HTTPException as exc:
            # A single event must not abort successful siblings in the batch.
            results.append(ExecutionEventResult(
                event_id="FAILED", sync_uuid=item.sync_uuid,
                transaction_group_id=item.transaction_group_id,
                state_version=item.expected_version,
                current_state={"error": exc.detail},
            ))
    return ExecutionEventsResponse(results=results)


@router.post("/progress", response_model=None, status_code=200)
async def legacy_progress_via_events(
    data: BoQProgressCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    intent, state = await _legacy_intent(data, db, current_user)
    if intent is None:
        return {"id": state.id, "org_id": state.org_id, "unit_id": state.unit_id,
                "boq_item_id": state.boq_item_id, "completion_pct": state.completion_pct,
                "status": state.status, "state_version": state.state_version,
                "last_event_id": state.last_event_id}
    role = current_user.get("role", "VIEWER")
    _authorize(intent.event_type, role)
    try:
        async with db.begin_nested():
            result = await apply_event(
                db, org_id=current_user["org_id"], user_id=current_user["id"],
                entity_type=intent.entity_type, entity_id=intent.entity_id,
                unit_id=intent.unit_id, boq_item_id=intent.boq_item_id,
                event_class=intent.event_class, event_type=intent.event_type,
                metric_type=intent.metric_type, value=intent.value,
                occurred_at=intent.occurred_at, expected_version=intent.expected_version,
                sync_uuid=intent.sync_uuid, reason=intent.reason, authorized_role=role,
            )
    except HTTPException:
        raise
    state = await _get_state(db, current_user["org_id"], data.unit_id, data.boq_item_id)
    return {"id": state.id, "org_id": state.org_id, "unit_id": state.unit_id,
            "boq_item_id": state.boq_item_id, "completion_pct": state.completion_pct,
            "status": state.status, "measured_quantity": state.measured_quantity,
            "rework_flag": state.rework_flag, "rework_reason": state.rework_reason,
            "updated_by": state.updated_by, "state_version": state.state_version,
            "actual_quantity": state.actual_quantity, "last_event_id": result["event_id"]}


@router.post("/bulk-progress", response_model=None, status_code=200)
async def legacy_bulk_progress_via_events(
    data: BulkBoQProgressRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    succeeded, failed, conflicts = 0, 0, []
    group_id = str(uuid4())
    role = current_user.get("role", "VIEWER")
    for item in data.updates:
        try:
            intent, _ = await _legacy_intent(item, db, current_user)
            if intent is None:
                succeeded += 1
                continue
            _authorize(intent.event_type, role)
            async with db.begin_nested():
                await apply_event(
                    db, org_id=current_user["org_id"], user_id=current_user["id"],
                    entity_type=intent.entity_type, entity_id=intent.entity_id,
                    unit_id=intent.unit_id, boq_item_id=intent.boq_item_id,
                    event_class=intent.event_class, event_type=intent.event_type,
                    metric_type=intent.metric_type, value=intent.value,
                    occurred_at=intent.occurred_at, expected_version=intent.expected_version,
                    sync_uuid=intent.sync_uuid, transaction_group_id=group_id,
                    reason=intent.reason, authorized_role=role,
                )
            succeeded += 1
        except HTTPException as exc:
            failed += 1
            conflicts.append({"unit_id": item.unit_id, "boq_item_id": item.boq_item_id,
                              "current_pct": None, "attempted_pct": item.completion_pct,
                              "reason": str(exc.detail)[:300]})
    return {"succeeded": succeeded, "failed": failed, "conflicts": conflicts}
