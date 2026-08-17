"""Canonical project BOQ configuration endpoints.

These endpoints deliberately separate:
- project BOQ definitions
- unit applicability/planned quantities
- execution state initialization

They are the supported V4 path for project configuration. Legacy per-unit BOQ
creation remains available only for backward compatibility and must not be used
by the V4 UI.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.execution.service import initialize_boq_state
from app.modules.projects.models import BOQItem, Project, ProjectUnit, UnitBoQAssignment
from app.modules.projects.schemas import BOQItemRead
from app.modules.iam.dependencies import get_current_user

router = APIRouter()


class CanonicalBOQCreate(BaseModel):
    code: str | None = Field(default=None, max_length=80)
    category: str | None = Field(default=None, max_length=120)
    trade: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1)
    quantity: float = Field(ge=0)
    rate: float = Field(default=0, ge=0)
    unit_of_measure: str = Field(min_length=1, max_length=50)
    sequence: int = Field(default=0, ge=0)
    extra_data: dict[str, Any] | None = None


class ApplyBOQRequest(BaseModel):
    unit_ids: list[int] = Field(min_length=1)
    planned_quantity: float = Field(default=0, ge=0)


@router.get("/{project_id}/canonical-boq")
async def canonical_boq(project_id: int, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> dict[str, Any]:
    org_id = current_user["org_id"]
    project = (await db.execute(select(Project).where(Project.id == project_id, Project.org_id == org_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    boq = list((await db.execute(select(BOQItem).where(
        BOQItem.project_id == project_id, BOQItem.org_id == org_id, BOQItem.is_active.is_(True)
    ).order_by(BOQItem.sequence, BOQItem.code))).scalars().all())
    units = list((await db.execute(select(ProjectUnit).where(
        ProjectUnit.project_id == project_id, ProjectUnit.org_id == org_id, ProjectUnit.is_active.is_(True)
    ).order_by(ProjectUnit.code, ProjectUnit.id))).scalars().all())
    assignments = list((await db.execute(select(UnitBoQAssignment).join(BOQItem, BOQItem.id == UnitBoQAssignment.boq_item_id).where(
        BOQItem.project_id == project_id, UnitBoQAssignment.org_id == org_id, UnitBoQAssignment.is_active.is_(True)
    ).order_by(UnitBoQAssignment.unit_id, UnitBoQAssignment.boq_item_id))).scalars().all())
    return {
        "project_id": project_id,
        "boq_items": boq,
        "units": units,
        "assignments": [{
            "id": a.id, "org_id": a.org_id, "unit_id": a.unit_id, "boq_item_id": a.boq_item_id,
            "planned_quantity": a.planned_quantity, "is_active": a.is_active,
            "extra_data": a.extra_data, "created_at": a.created_at, "updated_at": a.updated_at,
        } for a in assignments],
    }


@router.post("/{project_id}/canonical-boq", response_model=BOQItemRead, status_code=201)
async def create_canonical_boq(project_id: int, data: CanonicalBOQCreate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> BOQItem:
    org_id = current_user["org_id"]
    project = (await db.execute(select(Project).where(Project.id == project_id, Project.org_id == org_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    code = (data.code or "").strip().upper()
    if code:
        duplicate = (await db.execute(select(BOQItem).where(
            BOQItem.project_id == project_id, BOQItem.code == code, BOQItem.is_active.is_(True)
        ))).scalar_one_or_none()
        if duplicate:
            raise HTTPException(status_code=409, detail="BOQ code already exists in this project")
    else:
        count = (await db.execute(select(func.count()).select_from(BOQItem).where(BOQItem.project_id == project_id))).scalar_one()
        code = f"BOQ-{count + 1:04d}"
    item = BOQItem(
        org_id=org_id, project_id=project_id, code=code, category=data.category,
        trade=data.trade.strip(), description=data.description.strip(), quantity=data.quantity,
        rate=data.rate, amount=data.quantity * data.rate, unit_of_measure=data.unit_of_measure.strip(),
        sequence=data.sequence, extra_data=data.extra_data,
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return item


@router.post("/{project_id}/canonical-boq/{boq_item_id}/apply", status_code=200)
async def apply_canonical_boq(project_id: int, boq_item_id: int, data: ApplyBOQRequest, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> dict[str, Any]:
    org_id, user_id = current_user["org_id"], current_user["id"]
    item = (await db.execute(select(BOQItem).where(
        BOQItem.id == boq_item_id, BOQItem.project_id == project_id, BOQItem.org_id == org_id, BOQItem.is_active.is_(True)
    ))).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="BOQ item not found in project")
    unit_ids = list(dict.fromkeys(data.unit_ids))
    units = list((await db.execute(select(ProjectUnit).where(
        ProjectUnit.id.in_(unit_ids), ProjectUnit.project_id == project_id,
        ProjectUnit.org_id == org_id, ProjectUnit.is_active.is_(True)
    ))).scalars().all())
    if len(units) != len(unit_ids):
        raise HTTPException(status_code=400, detail="One or more selected units are not in this project")
    created = updated = 0
    for unit in units:
        assignment = (await db.execute(select(UnitBoQAssignment).where(
            UnitBoQAssignment.unit_id == unit.id, UnitBoQAssignment.boq_item_id == item.id
        ))).scalar_one_or_none()
        if assignment is None:
            assignment = UnitBoQAssignment(org_id=org_id, unit_id=unit.id, boq_item_id=item.id, planned_quantity=data.planned_quantity, is_active=True)
            db.add(assignment)
            created += 1
        else:
            assignment.planned_quantity = data.planned_quantity
            assignment.is_active = True
            updated += 1
        await db.flush()
        await initialize_boq_state(db, org_id=org_id, unit_id=unit.id, boq_item_id=item.id, user_id=user_id)
    await db.flush()
    return {"project_id": project_id, "boq_item_id": boq_item_id, "created": created, "updated": updated, "total": created + updated}


@router.post("/{project_id}/canonical-boq/{boq_item_id}/unapply", status_code=200)
async def unapply_canonical_boq(project_id: int, boq_item_id: int, data: ApplyBOQRequest, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> dict[str, Any]:
    org_id = current_user["org_id"]
    rows = list((await db.execute(select(UnitBoQAssignment).join(BOQItem, BOQItem.id == UnitBoQAssignment.boq_item_id).where(
        BOQItem.id == boq_item_id, BOQItem.project_id == project_id, UnitBoQAssignment.org_id == org_id,
        UnitBoQAssignment.unit_id.in_(list(dict.fromkeys(data.unit_ids)))
    ))).scalars().all())
    for row in rows: row.is_active = False
    await db.flush()
    return {"project_id": project_id, "boq_item_id": boq_item_id, "deactivated": len(rows)}
