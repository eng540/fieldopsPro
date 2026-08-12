"""Quality Control Schemas — FieldOps V4.0."""
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from app.modules.quality.models import RemarkSeverity, RemarkStatus


class RemarkTemplateCreate(BaseModel):
    category: str = Field(min_length=2, max_length=30)
    issue: str = Field(min_length=5, max_length=500)
    severity: RemarkSeverity
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
    unit_id: int = Field(gt=0)
    work_order_id: int | None = Field(default=None, gt=0)
    template_id: int | None = Field(default=None, gt=0)
    custom_issue: str | None = Field(default=None, min_length=5, max_length=1000)
    severity: RemarkSeverity
    photos: list[str] | None = None
    gps_tag: dict | None = None

    @field_validator("id")
    @classmethod
    def validate_uuid(cls, value: str) -> str:
        import uuid
        try:
            uuid.UUID(value)
        except ValueError as exc:
            raise ValueError("id must be a valid UUID") from exc
        return value


class RemarkStatusUpdate(BaseModel):
    status: RemarkStatus
    reason: str | None = Field(default=None, max_length=2000)
    resolution_notes: str | None = Field(default=None, max_length=5000)
    resolution_photos: list[str] | None = None

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str | None) -> str | None:
        return value.strip() if value else value


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


class RemarkStatusEventRead(BaseModel):
    id: int
    org_id: int
    remark_id: str
    from_status: str | None
    to_status: str
    reason: str | None
    resolution_notes: str | None
    actor_id: int
    occurred_at: datetime
    event_metadata: dict
    model_config = {"from_attributes": True}


class RemarkListResponse(BaseModel):
    items: list[RemarkRead]
    total: int
    open_count: int
    critical_count: int


class RemarkStatusEventListResponse(BaseModel):
    items: list[RemarkStatusEventRead]
    total: int
