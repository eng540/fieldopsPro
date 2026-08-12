"""Read-only query API for the Epic 1 execution event ledger and state."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.execution.models import ExecutionEvent, UnitBoQProgress
from app.modules.iam.dependencies import get_current_user

router = APIRouter()


def _event_payload(event: ExecutionEvent) -> dict:
    return {
        "event_id": event.id,
        "org_id": event.org_id,
        "project_id": event.project_id,
        "unit_id": event.unit_id,
        "entity_type": event.entity_type,
        "entity_id": event.entity_id,
        "event_class": event.event_class,
        "event_type": event.event_type,
        "metric_type": event.metric_type,
        "previous_value": event.previous_value,
        "new_value": event.new_value,
        "delta_value": event.delta_value,
        "unit_of_measure": event.unit_of_measure,
        "occurred_at": event.occurred_at,
        "effective_date": event.effective_date,
        "recorded_at": event.recorded_at,
        "user_id": event.user_id,
        "reason": event.reason,
        "notes": event.notes,
        "sync_uuid": event.sync_uuid,
        "transaction_group_id": event.transaction_group_id,
    }


@router.get("/events/history", response_model=dict, status_code=200)
async def list_execution_events(
    unit_id: int | None = Query(default=None, gt=0),
    boq_item_id: int | None = Query(default=None, gt=0),
    event_type: str | None = Query(default=None, min_length=1, max_length=50),
    event_class: str | None = Query(default=None, min_length=1, max_length=50),
    occurred_from: datetime | None = Query(default=None),
    occurred_to: datetime | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Return a deterministic tenant-scoped event timeline."""
    org_id = current_user["org_id"]
    filters = [ExecutionEvent.org_id == org_id]
    if unit_id is not None:
        filters.append(ExecutionEvent.unit_id == unit_id)
    if boq_item_id is not None:
        filters.extend([
            ExecutionEvent.entity_type == "BOQ_ITEM",
            ExecutionEvent.entity_id == str(boq_item_id),
        ])
    if event_type is not None:
        filters.append(ExecutionEvent.event_type == event_type)
    if event_class is not None:
        filters.append(ExecutionEvent.event_class == event_class)
    if occurred_from is not None:
        filters.append(ExecutionEvent.occurred_at >= occurred_from)
    if occurred_to is not None:
        filters.append(ExecutionEvent.occurred_at <= occurred_to)

    total = (await db.execute(select(func.count()).select_from(ExecutionEvent).where(*filters))).scalar_one()
    offset = (page - 1) * page_size
    events = (await db.execute(
        select(ExecutionEvent)
        .where(*filters)
        .order_by(ExecutionEvent.occurred_at.desc(), ExecutionEvent.recorded_at.desc(), ExecutionEvent.id.desc())
        .offset(offset)
        .limit(page_size)
    )).scalars().all()
    items = [_event_payload(event) for event in events]
    return {"items": items, "total": total, "page": page, "page_size": page_size, "has_more": offset + len(items) < total}


@router.get("/events/{event_id}", response_model=dict, status_code=200)
async def get_execution_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    event = (await db.execute(select(ExecutionEvent).where(
        ExecutionEvent.id == event_id,
        ExecutionEvent.org_id == current_user["org_id"],
    ))).scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Execution event not found")
    return _event_payload(event)


@router.get("/state/{unit_id}/{boq_item_id}", response_model=dict, status_code=200)
async def get_boq_state(
    unit_id: int,
    boq_item_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    state = (await db.execute(select(UnitBoQProgress).where(
        UnitBoQProgress.org_id == current_user["org_id"],
        UnitBoQProgress.unit_id == unit_id,
        UnitBoQProgress.boq_item_id == boq_item_id,
    ))).scalar_one_or_none()
    if state is None:
        raise HTTPException(status_code=404, detail="BOQ progress state not found")
    return {
        "id": state.id,
        "org_id": state.org_id,
        "unit_id": state.unit_id,
        "boq_item_id": state.boq_item_id,
        "completion_pct": state.completion_pct,
        "status": state.status,
        "measured_quantity": state.measured_quantity,
        "actual_quantity": state.actual_quantity,
        "financial_value": state.financial_value,
        "rework_flag": state.rework_flag,
        "rework_reason": state.rework_reason,
        "rework_authorized_by": state.rework_authorized_by,
        "updated_by": state.updated_by,
        "server_timestamp": state.server_timestamp,
        "updated_at": state.updated_at,
        "state_version": state.state_version,
        "last_event_id": state.last_event_id,
    }
