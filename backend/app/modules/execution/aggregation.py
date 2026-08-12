"""Server-derived execution aggregation queries.

The Event Ledger remains immutable; these endpoints aggregate the materialized
UnitBoQProgress read model and never write progress snapshots.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.execution.models import UnitBoQProgress, WorkOrder, WorkOrderStatus
from app.modules.iam.dependencies import get_current_user
from app.modules.projects.models import Project, ProjectUnit
from app.modules.quality.models import Remark, RemarkStatus, RemarkSeverity
from app.modules.governance.models import GovernanceDecision

router = APIRouter()


@router.get("/aggregation/project/{project_id}")
async def project_execution_aggregation(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Return the execution 360 view for one project, derived from current state."""
    org_id = current_user["org_id"]
    project = (await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id)
    )).scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    units = (await db.execute(
        select(ProjectUnit.id, ProjectUnit.code, ProjectUnit.name, ProjectUnit.status)
        .where(ProjectUnit.project_id == project_id, ProjectUnit.org_id == org_id, ProjectUnit.is_active.is_(True))
        .order_by(ProjectUnit.id)
    )).all()
    unit_ids = [u.id for u in units]

    states = []
    if unit_ids:
        states = (await db.execute(
            select(UnitBoQProgress)
            .where(UnitBoQProgress.org_id == org_id, UnitBoQProgress.unit_id.in_(unit_ids))
            .order_by(UnitBoQProgress.unit_id, UnitBoQProgress.boq_item_id)
        )).scalars().all()

    by_unit: dict[int, list[UnitBoQProgress]] = {}
    for state in states:
        by_unit.setdefault(state.unit_id, []).append(state)

    unit_items = []
    all_pcts: list[float] = []
    for unit in units:
        unit_states = by_unit.get(unit.id, [])
        pct = sum(float(s.completion_pct) for s in unit_states) / len(unit_states) if unit_states else 0.0
        all_pcts.extend(float(s.completion_pct) for s in unit_states)
        unit_items.append({
            "unit_id": unit.id,
            "unit_code": unit.code,
            "unit_name": unit.name,
            "status": unit.status,
            "completion_pct": round(pct, 2),
            "tracked_boq_items": len(unit_states),
            "completed_boq_items": sum(1 for s in unit_states if float(s.completion_pct) >= 100.0),
            "rework_items": sum(1 for s in unit_states if s.status == "REWORK_REQUIRED"),
            "last_event_ids": [s.last_event_id for s in unit_states if s.last_event_id],
        })

    open_remarks = critical_remarks = holds = 0
    if unit_ids:
        open_remarks = (await db.execute(
            select(func.count()).select_from(Remark).where(
                Remark.org_id == org_id, Remark.unit_id.in_(unit_ids), Remark.status == RemarkStatus.OPEN.value
            )
        )).scalar_one()
        critical_remarks = (await db.execute(
            select(func.count()).select_from(Remark).where(
                Remark.org_id == org_id, Remark.unit_id.in_(unit_ids),
                Remark.severity == RemarkSeverity.CRITICAL.value, Remark.status == RemarkStatus.OPEN.value
            )
        )).scalar_one()
        holds = (await db.execute(
            select(func.count()).select_from(GovernanceDecision).where(
                GovernanceDecision.org_id == org_id, GovernanceDecision.unit_id.in_(unit_ids),
                GovernanceDecision.decision == "HOLD", GovernanceDecision.is_overridden.is_(False)
            )
        )).scalar_one()

    wo_total = (await db.execute(
        select(func.count()).select_from(WorkOrder).where(WorkOrder.org_id == org_id, WorkOrder.project_id == project_id)
    )).scalar_one()
    wo_active = (await db.execute(
        select(func.count()).select_from(WorkOrder).where(
            WorkOrder.org_id == org_id, WorkOrder.project_id == project_id,
            WorkOrder.status == WorkOrderStatus.IN_PROGRESS.value
        )
    )).scalar_one()

    return {
        "project": {"id": project.id, "code": project.code, "name": project.name, "status": project.status},
        "summary": {
            "total_units": len(units),
            "tracked_boq_items": len(states),
            "overall_progress_pct": round(sum(all_pcts) / len(all_pcts), 2) if all_pcts else 0.0,
            "open_remarks": open_remarks,
            "critical_remarks": critical_remarks,
            "governance_holds": holds,
            "total_work_orders": wo_total,
            "active_work_orders": wo_active,
        },
        "units": unit_items,
    }


@router.get("/aggregation/organization")
async def organization_execution_aggregation(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
    project_id: int | None = Query(default=None, gt=0),
) -> dict:
    """Aggregate execution state by project for dashboard/portfolio consumers."""
    org_id = current_user["org_id"]
    query = (
        select(Project.id, Project.code, Project.name, Project.status, UnitBoQProgress.completion_pct)
        .select_from(Project)
        .join(ProjectUnit, ProjectUnit.project_id == Project.id)
        .outerjoin(UnitBoQProgress, (UnitBoQProgress.unit_id == ProjectUnit.id) & (UnitBoQProgress.org_id == org_id))
        .where(Project.org_id == org_id, Project.is_active.is_(True), ProjectUnit.is_active.is_(True))
    )
    if project_id is not None:
        query = query.where(Project.id == project_id)

    rows = (await db.execute(query)).all()
    grouped: dict[int, dict] = {}
    for row in rows:
        item = grouped.setdefault(row.id, {"project_id": row.id, "project_code": row.code, "project_name": row.name, "status": row.status, "values": []})
        if row.completion_pct is not None:
            item["values"].append(float(row.completion_pct))

    projects = []
    for item in grouped.values():
        values = item.pop("values")
        item["completion_pct"] = round(sum(values) / len(values), 2) if values else 0.0
        item["tracked_states"] = len(values)
        projects.append(item)

    projects.sort(key=lambda x: x["project_id"])
    return {
        "projects": projects,
        "project_count": len(projects),
        "portfolio_avg_completion_pct": round(sum(p["completion_pct"] for p in projects) / len(projects), 2) if projects else 0.0,
    }
