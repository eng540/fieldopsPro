"""Read-only query endpoints for the Epic 1 execution event ledger."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.execution.models import ExecutionEvent
from app.modules.iam.dependencies import get_current_user

router = APIRouter()


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
    """Return a tenant-scoped, paginated read-only event timeline."""
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

    total = (await db.execute(
        select(func.count()).select_from(ExecutionEvent).where(*filters)
    )).scalar_one()

    offset = (page - 1) * page_size
    events = (await db.execute(
        select(ExecutionEvent)
        .where(*filters)
        .order_by(ExecutionEvent.occurred_at.desc(), ExecutionEvent.recorded_at.desc())
        .offset(offset)
        .limit(page_size)
    )).scalars().all()

    items = [
        {
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
        for event in events
    ]

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": offset + len(items) < total,
    }
