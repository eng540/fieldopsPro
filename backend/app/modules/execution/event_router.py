from uuid import uuid4

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.execution.event_schemas import ExecutionEventsRequest, ExecutionEventsResponse, ExecutionEventResult
from app.modules.execution.event_service import apply_event
from app.modules.execution.models import EventClass, EventType, MetricType
from app.modules.execution.schemas import BoQProgressCreate, BulkBoQProgressRequest
from app.modules.iam.dependencies import get_current_user

router = APIRouter()


async def _apply_item(item, db, current_user, *, group_id=None):
    return await apply_event(
        db,
        org_id=current_user["org_id"], user_id=current_user["id"],
        entity_type="BOQ_ITEM", entity_id=str(item.boq_item_id),
        unit_id=item.unit_id, boq_item_id=item.boq_item_id,
        event_class=EventClass.PROGRESS,
        event_type=EventType.REWORK if item.rework_flag else EventType.SNAPSHOT_SET,
        metric_type=MetricType.PERCENTAGE, value=item.completion_pct,
        sync_uuid=str(uuid4()), transaction_group_id=group_id,
        reason=item.rework_reason, authorized_role=current_user.get("role"),
    )


@router.post("/events", response_model=ExecutionEventsResponse, status_code=200)
async def post_execution_events(
    payload: ExecutionEventsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> ExecutionEventsResponse:
    results = []
    for item in payload.events:
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
            reason=item.reason, notes=item.notes, authorized_role=current_user.get("role"),
        )
        results.append(ExecutionEventResult(**result))
    return ExecutionEventsResponse(results=results)


@router.post("/progress", response_model=None, status_code=200)
async def legacy_progress_via_events(
    data: BoQProgressCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Backward-compatible legacy contract; mutation is delegated to Epic 1."""
    result = await _apply_item(data, db, current_user)
    state = result["current_state"]
    return {
        "id": None,
        "org_id": current_user["org_id"], "unit_id": data.unit_id,
        "boq_item_id": data.boq_item_id, "completion_pct": state["completion_pct"],
        "status": data.status or state["status"], "measured_quantity": data.measured_quantity,
        "rework_flag": state["rework_flag"], "rework_reason": state["rework_reason"],
        "rework_authorized_by": data.rework_authorized_by, "updated_by": current_user["id"],
        "state_version": result["state_version"], "last_event_id": result["event_id"],
    }


@router.post("/bulk-progress", response_model=None, status_code=200)
async def legacy_bulk_progress_via_events(
    data: BulkBoQProgressRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Backward-compatible bulk contract; each item is an event."""
    succeeded = 0
    failed = 0
    conflicts = []
    group_id = str(uuid4())
    for item in data.updates:
        try:
            await _apply_item(item, db, current_user, group_id=group_id)
            succeeded += 1
        except Exception as exc:
            failed += 1
            conflicts.append({
                "unit_id": item.unit_id, "boq_item_id": item.boq_item_id,
                "current_pct": 0.0, "attempted_pct": item.completion_pct,
                "reason": str(exc)[:200],
            })
    return {"succeeded": succeeded, "failed": failed, "conflicts": conflicts}
