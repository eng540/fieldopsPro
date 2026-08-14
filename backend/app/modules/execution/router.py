"""EXECUTION router — work orders and event-driven BOQ execution."""
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.execution.models import (
    AssignmentStatus,
    EntityType,
    EventClass,
    EventType,
    MetricType,
    MONOTONIC_STATUS_TRANSITIONS,
    ExecutionEvent,
    UnitBoQProgress,
    UnitBoQProgressStatus,
    WorkOrder,
    WorkOrderAssignment,
    WorkOrderStatus,
    WorkOrderStatusHistory,
)
from app.modules.execution.schemas import (
    AssignmentListResponse,
    StatusHistoryListResponse,
    WorkOrderAssignmentCreate,
    WorkOrderAssignmentRead,
    WorkOrderCreate,
    WorkOrderListItem,
    WorkOrderListResponse,
    WorkOrderRead,
    WorkOrderUpdate,
    BoQProgressCreate,
    BulkBoQProgressRequest,
    EventBatchRequest,
    EventBatchResponse,
    EventIntent,
)
from app.modules.execution.service import (
    BusinessRuleError,
    ConcurrentModificationError,
    initialize_boq_state,
    process_event_intent,
)
from app.modules.iam.dependencies import get_current_user

_REWORK_AUTHORIZED_ROLES = {"PROJECT_MANAGER", "ORG_ADMIN", "SUPER_ADMIN"}
router = APIRouter()


@router.post("/work-orders", response_model=WorkOrderRead, status_code=201)
async def create_work_order(data: WorkOrderCreate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> WorkOrder:
    work_order = WorkOrder(org_id=current_user["org_id"], created_by=current_user["id"], **data.model_dump(exclude_none=True))
    db.add(work_order)
    await db.flush()
    await db.refresh(work_order)
    return work_order


@router.get("/work-orders", response_model=WorkOrderListResponse)
async def list_work_orders(
    project_id: int | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    base = select(WorkOrder).where(WorkOrder.org_id == current_user["org_id"])
    count = select(func.count()).select_from(WorkOrder).where(WorkOrder.org_id == current_user["org_id"])
    if project_id is not None:
        base = base.where(WorkOrder.project_id == project_id)
        count = count.where(WorkOrder.project_id == project_id)
    if status_filter is not None:
        base = base.where(WorkOrder.status == status_filter)
        count = count.where(WorkOrder.status == status_filter)
    total = (await db.execute(count)).scalar_one()
    offset = (page - 1) * page_size
    rows = (await db.execute(base.order_by(WorkOrder.created_at.desc()).offset(offset).limit(page_size))).scalars().all()
    return {"items": rows, "total": total, "page": page, "page_size": page_size, "has_more": offset + len(rows) < total}


@router.get("/work-orders/{work_order_id}", response_model=WorkOrderRead)
async def get_work_order(work_order_id: int, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> WorkOrder:
    row = (await db.execute(select(WorkOrder).where(WorkOrder.id == work_order_id, WorkOrder.org_id == current_user["org_id"]))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Work order not found")
    return row


@router.patch("/work-orders/{work_order_id}", response_model=WorkOrderRead)
async def update_work_order(work_order_id: int, data: WorkOrderUpdate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> WorkOrder:
    org_id, user_id = current_user["org_id"], current_user["id"]
    row = (await db.execute(select(WorkOrder).where(WorkOrder.id == work_order_id, WorkOrder.org_id == org_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Work order not found")
    fields = data.model_dump(exclude_none=True)
    if "completion_pct" in fields and fields["completion_pct"] < row.completion_pct:
        if not fields.get("rework_flag") or not fields.get("rework_reason") or len(fields["rework_reason"].strip()) < 20:
            raise HTTPException(status_code=409, detail="Progress decrease requires rework_flag and a reason of at least 20 characters")
        auth_id = fields.get("rework_authorized_by")
        if not auth_id:
            raise HTTPException(status_code=422, detail="rework_authorized_by is required for progress reduction")
        from app.modules.iam.models import ProjectUser, Role
        auth = (await db.execute(select(ProjectUser, Role).join(Role, ProjectUser.role_id == Role.id).where(ProjectUser.user_id == auth_id, ProjectUser.project_id == row.project_id, Role.name.in_(_REWORK_AUTHORIZED_ROLES)))).first()
        if not auth:
            raise HTTPException(status_code=403, detail="Invalid rework authorizer role")
    old_status = row.status
    status_changed = False
    if "status" in fields:
        try:
            new_status = WorkOrderStatus(fields["status"].value if hasattr(fields["status"], "value") else fields["status"])
            old_status_enum = WorkOrderStatus(old_status)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid status") from exc
        if new_status != old_status_enum and new_status not in MONOTONIC_STATUS_TRANSITIONS.get(old_status_enum, []):
            raise HTTPException(status_code=409, detail="Invalid status transition")
        status_changed = new_status != old_status_enum
    for key, value in fields.items():
        setattr(row, key, value.value if hasattr(value, "value") else value)
    await db.flush()
    if status_changed:
        db.add(WorkOrderStatusHistory(org_id=org_id, work_order_id=row.id, changed_by=user_id, from_status=str(old_status), to_status=str(row.status), reason=fields.get("rework_reason") or "Status updated via API", rework_flag=fields.get("rework_flag", False), rework_reason=fields.get("rework_reason"), rework_authorized_by=fields.get("rework_authorized_by")))
        await db.flush()
    await db.refresh(row)
    return row


@router.post("/work-orders/{work_order_id}/assign", response_model=WorkOrderAssignmentRead, status_code=201)
async def assign_work_order(work_order_id: int, data: WorkOrderAssignmentCreate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> WorkOrderAssignment:
    org_id, user_id = current_user["org_id"], current_user["id"]
    if not (await db.execute(select(WorkOrder).where(WorkOrder.id == work_order_id, WorkOrder.org_id == org_id))).scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Work order not found")
    existing = (await db.execute(select(WorkOrderAssignment).where(WorkOrderAssignment.work_order_id == work_order_id, WorkOrderAssignment.user_id == data.user_id, WorkOrderAssignment.status == AssignmentStatus.ACTIVE.value))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="User already assigned")
    assignment = WorkOrderAssignment(org_id=org_id, work_order_id=work_order_id, user_id=data.user_id, assigned_by=user_id, status=AssignmentStatus.ACTIVE.value, notes=data.notes)
    db.add(assignment)
    await db.flush()
    await db.refresh(assignment)
    return assignment


@router.post("/events", response_model=EventBatchResponse)
async def submit_events(request: EventBatchRequest, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> EventBatchResponse:
    org_id, user_id = current_user["org_id"], current_user["id"]
    role = current_user.get("role", "VIEWER")
    succeeded, conflicts, failed = [], [], []
    for intent in request.events:
        if role == "VIEWER":
            failed.append({"sync_uuid": intent.sync_uuid, "error": "VIEWER cannot submit events"})
            continue
        if intent.event_type == EventType.SNAPSHOT_SET and role != "SUPER_ADMIN":
            failed.append({"sync_uuid": intent.sync_uuid, "error": "SNAPSHOT_SET requires SUPER_ADMIN"})
            continue
        if intent.event_type == EventType.DATA_CORRECTION and role not in {"ORG_ADMIN", "SUPER_ADMIN"}:
            failed.append({"sync_uuid": intent.sync_uuid, "error": "DATA_CORRECTION requires ORG_ADMIN"})
            continue
        if intent.event_type == EventType.REWORK and role not in _REWORK_AUTHORIZED_ROLES:
            failed.append({"sync_uuid": intent.sync_uuid, "error": "REWORK requires an authorized role"})
            continue
        try:
            async with db.begin_nested():
                succeeded.append(await process_event_intent(db, intent, org_id, user_id, request.transaction_group_id))
        except ConcurrentModificationError as exc:
            conflicts.append(exc.conflict_details)
        except BusinessRuleError as exc:
            failed.append({"sync_uuid": intent.sync_uuid, "error": str(exc)})
        except Exception:
            failed.append({"sync_uuid": intent.sync_uuid, "error": "Event processing failed"})
    return EventBatchResponse(succeeded=succeeded, conflicts=conflicts, failed=failed)


@router.get("/events/history")
async def execution_event_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    event_type: str | None = Query(None),
    unit_id: int | None = Query(None),
    boq_item_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Tenant-scoped, read-only execution timeline for the Operations Center."""
    org_id = current_user["org_id"]
    base = select(ExecutionEvent).where(ExecutionEvent.org_id == org_id)
    count = select(func.count()).select_from(ExecutionEvent).where(ExecutionEvent.org_id == org_id)
    if event_type:
        base = base.where(ExecutionEvent.event_type == event_type)
        count = count.where(ExecutionEvent.event_type == event_type)
    if unit_id is not None:
        base = base.where(ExecutionEvent.unit_id == unit_id)
        count = count.where(ExecutionEvent.unit_id == unit_id)
    if boq_item_id is not None:
        base = base.where(ExecutionEvent.entity_type == EntityType.BOQ_ITEM.value, ExecutionEvent.entity_id == str(boq_item_id))
        count = count.where(ExecutionEvent.entity_type == EntityType.BOQ_ITEM.value, ExecutionEvent.entity_id == str(boq_item_id))
    total = (await db.execute(count)).scalar_one()
    offset = (page - 1) * page_size
    rows = (await db.execute(base.order_by(ExecutionEvent.occurred_at.desc(), ExecutionEvent.recorded_at.desc()).offset(offset).limit(page_size))).scalars().all()
    items = [{
        "event_id": row.id,
        "sync_uuid": row.sync_uuid,
        "entity_type": row.entity_type.value if hasattr(row.entity_type, "value") else row.entity_type,
        "entity_id": row.entity_id,
        "event_class": row.event_class.value if hasattr(row.event_class, "value") else row.event_class,
        "event_type": row.event_type.value if hasattr(row.event_type, "value") else row.event_type,
        "metric_type": row.metric_type.value if hasattr(row.metric_type, "value") else row.metric_type,
        "previous_value": row.previous_value,
        "new_value": row.new_value,
        "delta_value": row.delta_value,
        "unit_of_measure": row.unit_of_measure,
        "occurred_at": row.occurred_at,
        "recorded_at": row.recorded_at,
        "user_id": row.user_id,
        "reason": row.reason,
        "notes": row.notes,
        "transaction_group_id": row.transaction_group_id,
    } for row in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size, "has_more": offset + len(items) < total}


async def _legacy_event(data, db: AsyncSession, current_user: dict, group_id: str | None = None):
    org_id, user_id = current_user["org_id"], current_user["id"]
    state = (await db.execute(select(UnitBoQProgress).where(UnitBoQProgress.org_id == org_id, UnitBoQProgress.unit_id == data.unit_id, UnitBoQProgress.boq_item_id == data.boq_item_id).with_for_update())).scalar_one_or_none()
    if state is None:
        state = await initialize_boq_state(db, org_id=org_id, unit_id=data.unit_id, boq_item_id=data.boq_item_id, user_id=user_id)
    delta = data.completion_pct - state.completion_pct
    if delta == 0:
        return state, None
    event_type = EventType.REWORK if delta < 0 else EventType.DELTA_ADD
    if delta < 0 and not data.rework_flag:
        raise HTTPException(status_code=409, detail="Progress decrease requires rework_flag=True")
    intent = EventIntent(sync_uuid=str(uuid4()), entity_type=EntityType.BOQ_ITEM, entity_id=str(data.boq_item_id), unit_id=data.unit_id, event_class=EventClass.PROGRESS, event_type=event_type, metric_type=MetricType.PERCENTAGE, value={"pct": abs(delta)}, occurred_at=datetime.now(timezone.utc), expected_version=state.state_version, reason=data.rework_reason)
    async with db.begin_nested():
        response = await process_event_intent(db, intent, org_id, user_id, group_id)
    await db.refresh(state)
    return state, response


@router.post("/progress", status_code=200)
async def update_boq_progress(data: BoQProgressCreate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> dict:
    state, _ = await _legacy_event(data, db, current_user)
    return {"id": state.id, "org_id": state.org_id, "unit_id": state.unit_id, "boq_item_id": state.boq_item_id, "completion_pct": state.completion_pct, "status": state.status, "measured_quantity": state.measured_quantity, "rework_flag": state.rework_flag, "rework_reason": state.rework_reason, "rework_authorized_by": state.rework_authorized_by, "updated_by": state.updated_by, "server_timestamp": state.server_timestamp.isoformat() if state.server_timestamp else None, "updated_at": state.updated_at.isoformat() if state.updated_at else None, "state_version": state.state_version, "actual_quantity": state.actual_quantity, "last_event_id": state.last_event_id}


@router.post("/bulk-progress")
async def bulk_update_boq_progress(data: BulkBoQProgressRequest, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> dict:
    succeeded = failed = 0
    conflicts = []
    group_id = str(uuid4())
    for item in data.updates:
        try:
            state, _ = await _legacy_event(item, db, current_user, group_id)
            succeeded += 1
        except HTTPException as exc:
            failed += 1
            conflicts.append({"unit_id": item.unit_id, "boq_item_id": item.boq_item_id, "current_pct": 0.0, "attempted_pct": item.completion_pct, "reason": str(exc.detail)})
        except (BusinessRuleError, ConcurrentModificationError) as exc:
            failed += 1
            reason = exc.conflict_details.model_dump() if isinstance(exc, ConcurrentModificationError) else str(exc)
            conflicts.append({"unit_id": item.unit_id, "boq_item_id": item.boq_item_id, "current_pct": 0.0, "attempted_pct": item.completion_pct, "reason": str(reason)})
    return {"succeeded": succeeded, "failed": failed, "conflicts": conflicts}
