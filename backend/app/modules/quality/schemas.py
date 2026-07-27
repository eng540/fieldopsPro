"""Quality Control Schemas — FieldOps V4.0"""
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, Field


class RemarkTemplateCreate(BaseModel):
    category: str = Field(min_length=2, max_length=30)
    issue: str = Field(min_length=5, max_length=500)
    severity: str
    recommended_action: str | None = None
    auto_hold: bool = False


class RemarkTemplateRead(BaseModel):
    id: int
    org_id: int
    category: str
    issue: str
    severity: str
    recommended_action: str | None
    auto_hold: bool
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class RemarkCreate(BaseModel):
    id: str = Field(min_length=36, max_length=36, description="Client UUID for idempotency")
    unit_id: int
    work_order_id: int | None = None
    template_id: int | None = None
    custom_issue: str | None = Field(default=None, max_length=1000)
    severity: str
    photos: list[str] | None = None
    gps_tag: dict | None = None


class RemarkStatusUpdate(BaseModel):
    status: str
    resolution_notes: str | None = None
    resolution_photos: list[str] | None = None


class RemarkRead(BaseModel):
    id: str
    org_id: int
    unit_id: int
    work_order_id: int | None
    template_id: int | None
    custom_issue: str | None
    severity: str
    status: str
    photos: list[str] | None
    gps_tag: dict | None
    resolution_notes: str | None
    resolution_photos: list[str] | None
    created_by: int
    created_at: datetime
    resolved_at: datetime | None
    model_config = {"from_attributes": True}


class RemarkListResponse(BaseModel):
    items: list[RemarkRead]
    total: int
    open_count: int
    critical_count: int
