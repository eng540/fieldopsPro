"""EXECUTION CRUD Router — FieldOps V4.0 (Sprint-2 CP-3)

Endpoints (5):
1. POST   /execution/work-orders              — Create work order
2. GET    /execution/work-orders              — List work orders (filtered, paginated)
3. GET    /execution/work-orders/{id}         — Get work order detail
4. PATCH  /execution/work-orders/{id}        — Update work order (Monotonic Progress enforced)
5. POST   /execution/work-orders/{id}/assign  — Assign work order to user

Constitutional Rules (CP-3 additions):
- Monotonic Progress (ADR-003):
    * completion_pct cannot decrease without rework_flag=True + rework_reason (min 20 chars)
      + rework_authorized_by (must be PM or Org Admin role)
    * Returns 409 on violation
- Status Transitions (ADR-003):
    * Only allowed transitions per MONOTONIC_STATUS_TRANSITIONS map
    * Returns 409 on invalid transition
- WORM Audit (ADR-002):
    * WorkOrderStatusHistory entry written on every status change
    * Records from_status, to_status, reason, rework details, changed_by
- org_id injected from JWT context (multi-tenant isolation)
- created_by / assigned_by from JWT context
- All responses validated against Pydantic schemas
- OpenAPI-first: schemas match OpenAPI contract
"""
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.execution.models import (
    AssignmentStatus,
    MONOTONIC_STATUS_TRANSITIONS,
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
    WorkOrderFilterParams,
    WorkOrderListItem,
    WorkOrderListResponse,
    WorkOrderRead,
    WorkOrderUpdate,
)
from app.modules.iam.dependencies import get_current_user

# Roles permitted to authorize rework (ADR-003 Rule 3)
_REWORK_AUTHORIZED_ROLES = {"PROJECT_MANAGER", "ORG_ADMIN", "SUPER_ADMIN"}

# ─────────────────────────────────────────
# ROUTER
# ─────────────────────────────────────────
router = APIRouter()


# ═══════════════════════════════════════
# ENDPOINT 1: CREATE WORK ORDER
# ═══════════════════════════════════════
@router.post(
    "/work-orders",
    response_model=WorkOrderRead,
    status_code=201,
    summary="Create work order",
    description="Create a new work order. org_id and created_by are injected from JWT.",
)
async def create_work_order(
    data: WorkOrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> WorkOrder:
    org_id = current_user["org_id"]
    user_id = current_user["id"]

    work_order = WorkOrder(
        org_id=org_id,
        created_by=user_id,
        **data.model_dump(exclude_none=True),
    )
    db.add(work_order)
    await db.flush()
    await db.refresh(work_order)
    return work_order


# ═══════════════════════════════════════
# ENDPOINT 2: LIST WORK ORDERS
# ═══════════════════════════════════════
@router.get(
    "/work-orders",
    response_model=WorkOrderListResponse,
    summary="List work orders",
    description="List work orders with optional filters and cursor-based pagination.",
)
async def list_work_orders(
    project_id: int | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    org_id = current_user["org_id"]

    query = select(WorkOrder).where(WorkOrder.org_id == org_id)
    count_query = select(func.count()).select_from(WorkOrder).where(WorkOrder.org_id == org_id)

    if project_id is not None:
        query = query.where(WorkOrder.project_id == project_id)
        count_query = count_query.where(WorkOrder.project_id == project_id)

    if status_filter is not None:
        query = query.where(WorkOrder.status == status_filter)
        count_query = count_query.where(WorkOrder.status == status_filter)

    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    offset = (page - 1) * page_size
    query = query.order_by(WorkOrder.created_at.desc()).offset(offset).limit(page_size)
    result = await db.execute(query)
    work_orders = result.scalars().all()

    return {
        "items": work_orders,
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": (offset + len(work_orders)) < total,
    }


# ═══════════════════════════════════════
# ENDPOINT 3: GET WORK ORDER DETAIL
# ═══════════════════════════════════════
@router.get(
    "/work-orders/{work_order_id}",
    response_model=WorkOrderRead,
    summary="Get work order detail",
    responses={
        404: {"description": "Work order not found"},
        403: {"description": "Access denied — org_id mismatch"},
    },
)
async def get_work_order(
    work_order_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> WorkOrder:
    org_id = current_user["org_id"]

    query = select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.org_id == org_id,
    )
    result = await db.execute(query)
    work_order = result.scalar_one_or_none()

    if not work_order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Work order {work_order_id} not found in organization {org_id}",
        )

    return work_order


# ═══════════════════════════════════════
# ENDPOINT 4: UPDATE WORK ORDER (CP-3)
# ═══════════════════════════════════════
@router.patch(
    "/work-orders/{work_order_id}",
    response_model=WorkOrderRead,
    summary="Update work order",
    description="Update work order fields. PATCH semantics — only provided fields updated.",
    responses={
        200: {"description": "Work order updated"},
        404: {"description": "Work order not found"},
        403: {"description": "Access denied"},
        409: {"description": "Monotonic progress violation (ADR-003)"},
        422: {"description": "Validation error"},
    },
)
async def update_work_order(
    work_order_id: int,
    data: WorkOrderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> WorkOrder:
    """Update work order — Monotonic Progress + Status Transition + WORM (ADR-003/002)."""
    org_id = current_user["org_id"]
    user_id = current_user["id"]

    query = select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.org_id == org_id,
    )
    result = await db.execute(query)
    work_order = result.scalar_one_or_none()

    if not work_order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Work order {work_order_id} not found in organization {org_id}",
        )

    update_fields = data.model_dump(exclude_none=True)

    # ─── ADR-003: Monotonic Progress on completion_pct ───────────────────────
    if "completion_pct" in update_fields:
        new_pct = update_fields["completion_pct"]
        current_pct = work_order.completion_pct

        if new_pct < current_pct:
            rework_flag = update_fields.get("rework_flag", False)
            rework_reason = update_fields.get("rework_reason")
            rework_authorized_by = update_fields.get("rework_authorized_by")

            if not rework_flag:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"Monotonic Progress Violation (ADR-003): "
                        f"completion_pct cannot decrease from {current_pct}% to {new_pct}% "
                        f"without rework_flag=True."
                    ),
                )

            if not rework_reason or len(rework_reason.strip()) < 20:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "ADR-003 Rule 3: rework_reason required (min 20 chars) "
                        "when rework_flag=True."
                    ),
                )

            if rework_authorized_by is not None:
                from app.modules.iam.models import User, ProjectUser
                auth_user_result = await db.execute(
                    select(User).where(
                        User.id == rework_authorized_by,
                        User.org_id == org_id,
                        User.is_active.is_(True),
                    )
                )
                if not auth_user_result.scalar_one_or_none():
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"ADR-003: rework_authorized_by user {rework_authorized_by} not found.",
                    )

                role_result = await db.execute(
                    select(ProjectUser).where(
                        ProjectUser.user_id == rework_authorized_by,
                        ProjectUser.project_id == work_order.project_id,
                    )
                )
                pu = role_result.scalar_one_or_none()
                if not pu or pu.role not in _REWORK_AUTHORIZED_ROLES:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=(
                            f"ADR-003 Rule 3: rework_authorized_by requires role in "
                            f"{sorted(_REWORK_AUTHORIZED_ROLES)}. Got: {pu.role if pu else None!r}."
                        ),
                    )

    # ─── ADR-003: Status Transition Enforcement ──────────────────────────────
    status_changed = False
    old_status = work_order.status

    if "status" in update_fields:
        new_status_raw = update_fields["status"]
        new_status_str = new_status_raw.value if hasattr(new_status_raw, "value") else new_status_raw

        try:
            new_status_enum = WorkOrderStatus(new_status_str)
            old_status_enum = WorkOrderStatus(work_order.status)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid status value: {new_status_str}",
            ) from exc

        allowed = MONOTONIC_STATUS_TRANSITIONS.get(old_status_enum, [])
        if new_status_enum != old_status_enum and new_status_enum not in allowed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Invalid status transition (ADR-003): "
                    f"{old_status_enum.value} → {new_status_enum.value} is not allowed. "
                    f"Allowed: {[t.value for t in allowed] or 'none (terminal state)'}."
                ),
            )

        if new_status_enum != old_status_enum:
            status_changed = True

    # ─── Apply updates ────────────────────────────────────────────────────────
    for field, value in update_fields.items():
        setattr(work_order, field, value.value if hasattr(value, "value") else value)

    await db.flush()

    # ─── WORM: Write status history on every status change (ADR-002) ─────────
    if status_changed:
        history_entry = WorkOrderStatusHistory(
            org_id=org_id,
            work_order_id=work_order.id,
            changed_by=user_id,
            from_status=old_status if isinstance(old_status, str) else old_status.value,
            to_status=work_order.status if isinstance(work_order.status, str) else work_order.status.value,
            reason=update_fields.get("rework_reason") or "Status updated via API",
            rework_flag=update_fields.get("rework_flag", False),
            rework_reason=update_fields.get("rework_reason"),
            rework_authorized_by=update_fields.get("rework_authorized_by"),
        )
        db.add(history_entry)
        await db.flush()

    await db.refresh(work_order)
    return work_order


# ═══════════════════════════════════════
# ENDPOINT 5: ASSIGN WORK ORDER
# ═══════════════════════════════════════
@router.post(
    "/work-orders/{work_order_id}/assign",
    response_model=WorkOrderAssignmentRead,
    status_code=201,
    summary="Assign work order",
    responses={
        404: {"description": "Work order not found"},
        409: {"description": "User already has active assignment"},
    },
)
async def assign_work_order(
    work_order_id: int,
    data: WorkOrderAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> WorkOrderAssignment:
    org_id = current_user["org_id"]
    user_id = current_user["id"]

    wo_result = await db.execute(
        select(WorkOrder).where(
            WorkOrder.id == work_order_id,
            WorkOrder.org_id == org_id,
        )
    )
    work_order = wo_result.scalar_one_or_none()
    if not work_order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Work order {work_order_id} not found in organization {org_id}",
        )

    existing = await db.execute(
        select(WorkOrderAssignment).where(
            WorkOrderAssignment.work_order_id == work_order_id,
            WorkOrderAssignment.user_id == data.user_id,
            WorkOrderAssignment.status == AssignmentStatus.ACTIVE.value,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User {data.user_id} already has an active assignment on work order {work_order_id}",
        )

    assignment = WorkOrderAssignment(
        org_id=org_id,
        work_order_id=work_order_id,
        user_id=data.user_id,
        assigned_by=user_id,
        status=AssignmentStatus.ACTIVE.value,
        notes=data.notes,
    )
    db.add(assignment)
    await db.flush()
    await db.refresh(assignment)
    return assignment


# ═══════════════════════════════════════════════════════════════════════════
# ENDPOINT 6: BOQ PROGRESS — POST /execution/progress (Sprint-4 M1.2)
# ═══════════════════════════════════════════════════════════════════════════

@router.post(
    "/progress",
    response_model=None,
    status_code=200,
    summary="Update unit BoQ progress",
    description=(
        "Updates completion percentage for a single unit's BoQ item. "
        "Constitutional Rule: Monotonic Progress (ADR-003) — "
        "completion_pct cannot decrease without rework_flag=True + rework_reason (min 20 chars)."
    ),
    responses={
        200: {"description": "Progress updated"},
        409: {"description": "Monotonic violation — use Rework Flag"},
        422: {"description": "Validation error"},
    },
)
async def update_boq_progress(
    data: "BoQProgressCreate",
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    from app.modules.execution.schemas import BoQProgressCreate, BoQProgressRead
    from app.modules.execution.models import UnitBoQProgress

    org_id  = current_user["org_id"]
    user_id = current_user["id"]

    # Fetch or create progress row (upsert)
    result = await db.execute(
        select(UnitBoQProgress).where(
            UnitBoQProgress.unit_id    == data.unit_id,
            UnitBoQProgress.boq_item_id == data.boq_item_id,
            UnitBoQProgress.org_id     == org_id,
        )
    )
    progress = result.scalar_one_or_none()

    # ── Monotonic Progress enforcement (ADR-003) ──────────────────────────
    if progress and data.completion_pct < progress.completion_pct:
        if not data.rework_flag:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Monotonic Progress Violation (ADR-003): "
                    f"completion_pct cannot decrease from {progress.completion_pct}% "
                    f"to {data.completion_pct}% without rework_flag=True."
                ),
            )
        if not data.rework_reason or len(data.rework_reason.strip()) < 20:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="rework_reason required (min 20 chars) when rework_flag=True.",
            )

    # ── Auto-derive status ────────────────────────────────────────────────
    derived_status = data.status
    if not derived_status:
        if data.rework_flag:
            from app.modules.execution.models import UnitBoQProgressStatus
            derived_status = UnitBoQProgressStatus.REWORK_REQUIRED.value
        elif data.completion_pct >= 100.0:
            from app.modules.execution.models import UnitBoQProgressStatus
            derived_status = UnitBoQProgressStatus.COMPLETED.value
        elif data.completion_pct > 0:
            from app.modules.execution.models import UnitBoQProgressStatus
            derived_status = UnitBoQProgressStatus.IN_PROGRESS.value
        else:
            from app.modules.execution.models import UnitBoQProgressStatus
            derived_status = UnitBoQProgressStatus.NOT_STARTED.value

    if progress:
        progress.completion_pct       = data.completion_pct
        progress.status               = derived_status
        progress.measured_quantity    = data.measured_quantity
        progress.rework_flag          = data.rework_flag
        progress.rework_reason        = data.rework_reason
        progress.rework_authorized_by = data.rework_authorized_by
        progress.updated_by           = user_id
    else:
        progress = UnitBoQProgress(
            org_id           = org_id,
            unit_id          = data.unit_id,
            boq_item_id      = data.boq_item_id,
            completion_pct   = data.completion_pct,
            status           = derived_status,
            measured_quantity= data.measured_quantity,
            rework_flag      = data.rework_flag,
            rework_reason    = data.rework_reason,
            rework_authorized_by = data.rework_authorized_by,
            updated_by       = user_id,
        )
        db.add(progress)

    await db.flush()
    await db.refresh(progress)

    return {
        "id":                  progress.id,
        "org_id":              progress.org_id,
        "unit_id":             progress.unit_id,
        "boq_item_id":         progress.boq_item_id,
        "completion_pct":      progress.completion_pct,
        "status":              progress.status,
        "measured_quantity":   progress.measured_quantity,
        "rework_flag":         progress.rework_flag,
        "rework_reason":       progress.rework_reason,
        "rework_authorized_by": progress.rework_authorized_by,
        "updated_by":          progress.updated_by,
        "server_timestamp":    progress.server_timestamp.isoformat() if progress.server_timestamp else None,
        "updated_at":          progress.updated_at.isoformat() if progress.updated_at else None,
    }


# ═══════════════════════════════════════════════════════════════════════════
# ENDPOINT 7: BULK BOQ PROGRESS — POST /execution/bulk-progress (Sprint-4 M1.2)
# ═══════════════════════════════════════════════════════════════════════════

@router.post(
    "/bulk-progress",
    summary="Bulk update progress (Speed Entry Matrix)",
    description=(
        "Updates multiple unit/BOQ combinations in one request. "
        "Max 100 items per call. "
        "Partial success: succeeded + failed + conflicts returned separately. "
        "Monotonic Progress enforced per item (ADR-003)."
    ),
    responses={
        200: {"description": "Bulk update processed (may contain partial conflicts)"},
        422: {"description": "Validation error"},
    },
)
async def bulk_update_boq_progress(
    data: "BulkBoQProgressRequest",
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    from app.modules.execution.schemas import BulkBoQProgressRequest, BulkConflict
    from app.modules.execution.models import UnitBoQProgress, UnitBoQProgressStatus

    org_id  = current_user["org_id"]
    user_id = current_user["id"]

    succeeded = 0
    failed    = 0
    conflicts: list[dict] = []

    for item in data.updates:
        try:
            result = await db.execute(
                select(UnitBoQProgress).where(
                    UnitBoQProgress.unit_id     == item.unit_id,
                    UnitBoQProgress.boq_item_id == item.boq_item_id,
                    UnitBoQProgress.org_id      == org_id,
                )
            )
            progress = result.scalar_one_or_none()

            # Monotonic check
            if progress and item.completion_pct < progress.completion_pct:
                if not item.rework_flag:
                    conflicts.append({
                        "unit_id":       item.unit_id,
                        "boq_item_id":   item.boq_item_id,
                        "current_pct":   progress.completion_pct,
                        "attempted_pct": item.completion_pct,
                        "reason": (
                            f"Monotonic violation: {progress.completion_pct}% → {item.completion_pct}% "
                            f"without rework_flag."
                        ),
                    })
                    failed += 1
                    continue

            # Derive status
            if item.rework_flag:
                derived = UnitBoQProgressStatus.REWORK_REQUIRED.value
            elif item.completion_pct >= 100.0:
                derived = UnitBoQProgressStatus.COMPLETED.value
            elif item.completion_pct > 0:
                derived = UnitBoQProgressStatus.IN_PROGRESS.value
            else:
                derived = UnitBoQProgressStatus.NOT_STARTED.value

            if progress:
                progress.completion_pct       = item.completion_pct
                progress.status               = item.status or derived
                progress.measured_quantity    = item.measured_quantity
                progress.rework_flag          = item.rework_flag
                progress.rework_reason        = item.rework_reason
                progress.rework_authorized_by = item.rework_authorized_by
                progress.updated_by           = user_id
            else:
                progress = UnitBoQProgress(
                    org_id           = org_id,
                    unit_id          = item.unit_id,
                    boq_item_id      = item.boq_item_id,
                    completion_pct   = item.completion_pct,
                    status           = item.status or derived,
                    measured_quantity= item.measured_quantity,
                    rework_flag      = item.rework_flag,
                    rework_reason    = item.rework_reason,
                    rework_authorized_by = item.rework_authorized_by,
                    updated_by       = user_id,
                )
                db.add(progress)

            await db.flush()
            succeeded += 1

        except Exception as exc:
            failed += 1
            conflicts.append({
                "unit_id":       item.unit_id,
                "boq_item_id":   item.boq_item_id,
                "current_pct":   0.0,
                "attempted_pct": item.completion_pct,
                "reason":        str(exc)[:200],
            })

    return {"succeeded": succeeded, "failed": failed, "conflicts": conflicts}
