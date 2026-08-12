from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.execution.event_schemas import ExecutionEventsRequest, ExecutionEventsResponse, ExecutionEventResult
from app.modules.execution.event_service import apply_event
from app.modules.execution.models import EventType
from app.modules.iam.dependencies import get_current_user

router = APIRouter()


@router.post("/events", response_model=ExecutionEventsResponse, status_code=200)
async def post_execution_events(
    payload: ExecutionEventsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> ExecutionEventsResponse:
    """Append execution events and atomically materialize current state."""
    org_id = current_user["org_id"]
    user_id = current_user["id"]
    role = current_user.get("role")

    results: list[ExecutionEventResult] = []
    for item in payload.events:
        result = await apply_event(
            db,
            org_id=org_id,
            user_id=user_id,
            entity_type=item.entity_type.value,
            entity_id=item.entity_id,
            unit_id=item.unit_id,
            boq_item_id=item.boq_item_id,
            event_class=item.event_class,
            event_type=item.event_type,
            metric_type=item.metric_type,
            value=item.value,
            unit_of_measure=item.unit_of_measure,
            occurred_at=item.occurred_at,
            effective_date=item.effective_date,
            expected_version=item.expected_version,
            sync_uuid=str(item.sync_uuid),
            transaction_group_id=str(item.transaction_group_id) if item.transaction_group_id else None,
            reason=item.reason,
            notes=item.notes,
            authorized_role=role,
        )
        results.append(ExecutionEventResult(**result))

    return ExecutionEventsResponse(results=results)
