"""Read-only current-state APIs for execution progress."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.execution.models import UnitBoQProgress
from app.modules.iam.dependencies import get_current_user

router = APIRouter()


def _item(row: UnitBoQProgress) -> dict:
    return {
        "id": row.id,
        "org_id": row.org_id,
        "unit_id": row.unit_id,
        "boq_item_id": row.boq_item_id,
        "completion_pct": row.completion_pct,
        "status": row.status,
        "measured_quantity": row.measured_quantity,
        "rework_flag": row.rework_flag,
        "rework_reason": row.rework_reason,
        "rework_authorized_by": row.rework_authorized_by,
        "updated_by": row.updated_by,
        "server_timestamp": row.server_timestamp,
        "updated_at": row.updated_at,
        "state_version": row.state_version,
        "actual_quantity": row.actual_quantity,
        "financial_value": row.financial_value,
        "last_event_id": row.last_event_id,
    }


@router.get("/state", response_model=dict)
async def list_execution_state(
    unit_id: int | None = Query(default=None, gt=0),
    boq_item_id: int | None = Query(default=None, gt=0),
    status_filter: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Return tenant-scoped materialized execution state."""
    org_id = current_user["org_id"]
    filters = [UnitBoQProgress.org_id == org_id]
    if unit_id is not None:
        filters.append(UnitBoQProgress.unit_id == unit_id)
    if boq_item_id is not None:
        filters.append(UnitBoQProgress.boq_item_id == boq_item_id)
    if status_filter is not None:
        filters.append(UnitBoQProgress.status == status_filter)

    total = (await db.execute(
        select(func.count()).select_from(UnitBoQProgress).where(*filters)
    )).scalar_one()
    offset = (page - 1) * page_size
    rows = (await db.execute(
        select(UnitBoQProgress)
        .where(*filters)
        .order_by(UnitBoQProgress.unit_id, UnitBoQProgress.boq_item_id)
        .offset(offset).limit(page_size)
    )).scalars().all()
    return {"items": [_item(r) for r in rows], "total": total, "page": page,
            "page_size": page_size, "has_more": offset + len(rows) < total}


@router.get("/state/{unit_id}/{boq_item_id}", response_model=dict)
async def get_execution_state(
    unit_id: int,
    boq_item_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    org_id = current_user["org_id"]
    row = (await db.execute(
        select(UnitBoQProgress).where(
            UnitBoQProgress.org_id == org_id,
            UnitBoQProgress.unit_id == unit_id,
            UnitBoQProgress.boq_item_id == boq_item_id,
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Execution state not found")
    return _item(row)
