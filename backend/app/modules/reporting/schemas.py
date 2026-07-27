"""Reporting Schemas — FieldOps V4.0"""
from __future__ import annotations
from pydantic import BaseModel


class OrgSummary(BaseModel):
    total_projects: int
    active_projects: int
    total_work_orders: int
    completed_work_orders: int
    pending_sync_ops: int
    open_remarks: int
    critical_remarks: int
    governance_holds: int


class ProjectProgressItem(BaseModel):
    project_id: int
    project_name: str
    project_code: str
    total_units: int
    completion_pct: float
    open_remarks: int
    active_work_orders: int


class ProjectProgressResponse(BaseModel):
    items: list[ProjectProgressItem]
    org_avg_completion: float


class WorkOrderStatusBreakdown(BaseModel):
    status: str
    count: int
    avg_completion_pct: float


class WorkOrderSummaryResponse(BaseModel):
    breakdown: list[WorkOrderStatusBreakdown]
    total: int
    overall_avg_pct: float
