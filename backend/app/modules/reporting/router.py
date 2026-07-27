"""Reporting & Analytics Router — FieldOps V4.0 (Sprint-3)

Endpoints (3):
1. GET /reporting/summary          — Org-level dashboard KPIs
2. GET /reporting/project-progress — Per-project completion breakdown
3. GET /reporting/work-orders      — Work order status breakdown

All endpoints are read-only aggregations over existing tables.
org_id from JWT — always tenant-scoped.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.iam.dependencies import get_current_user
from app.modules.reporting.schemas import (
    OrgSummary, ProjectProgressItem, ProjectProgressResponse,
    WorkOrderStatusBreakdown, WorkOrderSummaryResponse,
)

router = APIRouter()


@router.get("/summary", response_model=OrgSummary)
async def org_summary(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Org-level dashboard KPIs — single query per table."""
    org_id = current_user["org_id"]

    from app.modules.projects.models import Project
    from app.modules.execution.models import WorkOrder, WorkOrderStatus
    from app.modules.quality.models import Remark, RemarkSeverity, RemarkStatus
    from app.modules.governance.models import GovernanceDecision
    from app.modules.sync.schemas import SyncEntityType

    total_projects = (await db.execute(
        select(func.count()).select_from(Project).where(Project.org_id == org_id, Project.is_active.is_(True))
    )).scalar_one()

    active_projects = (await db.execute(
        select(func.count()).select_from(Project).where(Project.org_id == org_id, Project.status == "ACTIVE")
    )).scalar_one()

    total_wo = (await db.execute(
        select(func.count()).select_from(WorkOrder).where(WorkOrder.org_id == org_id)
    )).scalar_one()

    completed_wo = (await db.execute(
        select(func.count()).select_from(WorkOrder).where(
            WorkOrder.org_id == org_id,
            WorkOrder.status == WorkOrderStatus.COMPLETED.value,
        )
    )).scalar_one()

    open_remarks = (await db.execute(
        select(func.count()).select_from(Remark).where(
            Remark.org_id == org_id,
            Remark.status == RemarkStatus.OPEN.value,
        )
    )).scalar_one()

    critical_remarks = (await db.execute(
        select(func.count()).select_from(Remark).where(
            Remark.org_id == org_id,
            Remark.severity == RemarkSeverity.CRITICAL.value,
            Remark.status == RemarkStatus.OPEN.value,
        )
    )).scalar_one()

    governance_holds = (await db.execute(
        select(func.count()).select_from(GovernanceDecision).where(
            GovernanceDecision.org_id == org_id,
            GovernanceDecision.decision == "HOLD",
            GovernanceDecision.is_overridden.is_(False),
        )
    )).scalar_one()

    # Pending sync ops from sync_log
    from app.modules.execution.models import WorkOrderSyncLog, SyncStatus
    pending_sync = (await db.execute(
        select(func.count()).select_from(WorkOrderSyncLog).where(
            WorkOrderSyncLog.org_id == org_id,
            WorkOrderSyncLog.sync_status == SyncStatus.PROCESSED.value,
        )
    )).scalar_one()

    return {
        "total_projects":       total_projects,
        "active_projects":      active_projects,
        "total_work_orders":    total_wo,
        "completed_work_orders": completed_wo,
        "pending_sync_ops":     pending_sync,
        "open_remarks":         open_remarks,
        "critical_remarks":     critical_remarks,
        "governance_holds":     governance_holds,
    }


@router.get("/project-progress", response_model=ProjectProgressResponse)
async def project_progress(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Per-project completion breakdown."""
    org_id = current_user["org_id"]

    from app.modules.projects.models import Project
    from app.modules.execution.models import WorkOrder, WorkOrderStatus
    from app.modules.quality.models import Remark, RemarkStatus

    projects = (await db.execute(
        select(Project).where(Project.org_id == org_id, Project.is_active.is_(True))
    )).scalars().all()

    items = []
    total_pct = 0.0

    for p in projects:
        open_remarks_count = (await db.execute(
            select(func.count()).select_from(Remark).where(
                Remark.org_id == org_id,
                Remark.unit_id.in_(
                    select(func.distinct(Remark.unit_id)).where(Remark.org_id == org_id)
                ),
                Remark.status == RemarkStatus.OPEN.value,
            )
        )).scalar_one()

        active_wo_count = (await db.execute(
            select(func.count()).select_from(WorkOrder).where(
                WorkOrder.org_id == org_id,
                WorkOrder.project_id == p.id,
                WorkOrder.status == WorkOrderStatus.IN_PROGRESS.value,
            )
        )).scalar_one()

        items.append(ProjectProgressItem(
            project_id=p.id,
            project_name=p.name,
            project_code=p.code,
            total_units=p.total_units,
            completion_pct=p.completion_pct,
            open_remarks=open_remarks_count,
            active_work_orders=active_wo_count,
        ))
        total_pct += p.completion_pct

    avg = total_pct / len(projects) if projects else 0.0
    return {"items": items, "org_avg_completion": round(avg, 2)}


@router.get("/work-orders", response_model=WorkOrderSummaryResponse)
async def work_order_summary(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Work order status breakdown with avg completion per status."""
    org_id = current_user["org_id"]
    from app.modules.execution.models import WorkOrder

    rows = (await db.execute(
        select(
            WorkOrder.status,
            func.count().label("count"),
            func.avg(WorkOrder.completion_pct).label("avg_pct"),
        ).where(WorkOrder.org_id == org_id)
        .group_by(WorkOrder.status)
        .order_by(func.count().desc())
    )).all()

    breakdown = [
        WorkOrderStatusBreakdown(
            status=r.status,
            count=r.count,
            avg_completion_pct=round(r.avg_pct or 0.0, 2),
        )
        for r in rows
    ]

    total = sum(b.count for b in breakdown)
    overall_avg = (
        sum(b.avg_completion_pct * b.count for b in breakdown) / total
        if total else 0.0
    )

    return {"breakdown": breakdown, "total": total, "overall_avg_pct": round(overall_avg, 2)}


# ═══════════════════════════════════════════════════════════════════════════
# ENDPOINT 4: IPC EXPORT — POST /reporting/ipc (Sprint-4 M2.2)
# ═══════════════════════════════════════════════════════════════════════════

from fastapi import Body
from fastapi.responses import StreamingResponse
import csv, io

@router.post(
    "/ipc",
    summary="Generate IPC (Interim Payment Certificate)",
    description=(
        "Generates a governed financial statement. "
        "Reads from Governance Layer (not raw progress). "
        "HOLD decisions appear with 0% payment in dedicated column. "
        "Returns CSV (default) or xlsx (if format=xlsx in body)."
    ),
    responses={
        200: {"description": "IPC file generated"},
        422: {"description": "Validation error"},
    },
)
async def generate_ipc(
    payload: dict = Body(default={"format": "csv", "include_holds": True}),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> StreamingResponse:
    org_id     = current_user["org_id"]
    fmt        = (payload.get("format") or "csv").lower()
    incl_holds = payload.get("include_holds", True)

    from app.modules.governance.models import GovernanceDecision
    from app.modules.projects.models import ProjectUnit, BOQItem

    # Fetch all active governance decisions for org
    decisions = (await db.execute(
        select(GovernanceDecision).where(
            GovernanceDecision.org_id == org_id,
        ).order_by(GovernanceDecision.unit_id, GovernanceDecision.created_at.desc())
    )).scalars().all()

    # Build IPC rows
    rows = []
    seen_units: set[int] = set()

    for d in decisions:
        # One entry per unique unit (latest decision wins)
        if d.unit_id in seen_units:
            continue
        seen_units.add(d.unit_id)

        if not incl_holds and d.decision == "HOLD":
            continue

        # Fetch unit code for label
        unit = (await db.execute(
            select(ProjectUnit).where(ProjectUnit.id == d.unit_id)
        )).scalar_one_or_none()

        rows.append({
            "decision_id":     d.id,
            "unit_id":         d.unit_id,
            "unit_code":       unit.code if unit else f"UNIT-{d.unit_id}",
            "boq_item_id":     d.boq_item_id or "",
            "decision":        d.decision,
            "payment_pct":     d.payment_pct,
            "blocked_pct":     0.0 if d.decision not in ("HOLD", "STOP") else 100.0 - d.payment_pct,
            "flag":            d.flag or "",
            "matched_rule":    d.matched_rule or "",
            "is_overridden":   d.is_overridden,
            "created_at":      d.created_at.isoformat() if d.created_at else "",
        })

    # Generate output
    if fmt == "csv":
        output = io.StringIO()
        if rows:
            writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        else:
            output.write("No decisions found\n")
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=IPC-{org_id}.csv"},
        )
    else:
        # xlsx output using csv2excel conversion (openpyxl if available, else CSV fallback)
        try:
            import openpyxl, io as _io
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "IPC Export"
            if rows:
                ws.append(list(rows[0].keys()))
                for row in rows:
                    ws.append(list(row.values()))
            else:
                ws.append(["No decisions found"])
            buf = _io.BytesIO()
            wb.save(buf)
            buf.seek(0)
            return StreamingResponse(
                buf,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f"attachment; filename=IPC-{org_id}.xlsx"},
            )
        except ImportError:
            # openpyxl not installed — return CSV with xlsx extension
            output = io.StringIO()
            if rows:
                writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()))
                writer.writeheader()
                writer.writerows(rows)
            output.seek(0)
            return StreamingResponse(
                iter([output.getvalue()]),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename=IPC-{org_id}.csv"},
            )


# ═══════════════════════════════════════════════════════════════════════════
# ENDPOINT 5: PROJECT DASHBOARD — GET /reporting/dashboard/{project_id}
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/dashboard/{project_id}")
async def project_dashboard(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Project 360° Dashboard — all metrics server-derived."""
    org_id = current_user["org_id"]
    from app.modules.projects.models import Project, ProjectUnit
    from app.modules.execution.models import WorkOrder, WorkOrderStatus
    from app.modules.quality.models import Remark, RemarkStatus, RemarkSeverity
    from app.modules.governance.models import GovernanceDecision

    project = (await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == org_id)
    )).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found.")

    total_units = (await db.execute(
        select(func.count()).select_from(ProjectUnit).where(
            ProjectUnit.project_id == project_id, ProjectUnit.org_id == org_id
        )
    )).scalar_one()

    total_wo = (await db.execute(
        select(func.count()).select_from(WorkOrder).where(
            WorkOrder.project_id == project_id, WorkOrder.org_id == org_id
        )
    )).scalar_one()

    in_progress_wo = (await db.execute(
        select(func.count()).select_from(WorkOrder).where(
            WorkOrder.project_id == project_id,
            WorkOrder.org_id == org_id,
            WorkOrder.status == WorkOrderStatus.IN_PROGRESS.value,
        )
    )).scalar_one()

    avg_pct = (await db.execute(
        select(func.avg(WorkOrder.completion_pct)).where(
            WorkOrder.project_id == project_id, WorkOrder.org_id == org_id
        )
    )).scalar_one() or 0.0

    return {
        "project_id":          project.id,
        "project_name":        project.name,
        "project_code":        project.code,
        "project_status":      project.status,
        "total_units":         total_units,
        "total_work_orders":   total_wo,
        "in_progress_units":   in_progress_wo,
        "overall_progress_pct": round(avg_pct, 2),
    }
