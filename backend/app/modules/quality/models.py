"""Quality Control Models — FieldOps V4.0 (Sprint-3)

Models:
- RemarkTemplate: Org-level QC template library
- Remark:         Append-only QC observation (UUID PK for offline idempotency)

Constitutional:
- org_id mandatory in every table
- Remarks are APPEND-ONLY (UUID from client)
- CRITICAL/MAJOR severity auto-triggers Governance HOLD
"""
from __future__ import annotations
import enum

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Index,
    Integer, JSON, String, Text,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class RemarkSeverity(str, enum.Enum):
    CRITICAL    = "CRITICAL"
    MAJOR       = "MAJOR"
    MINOR       = "MINOR"
    OBSERVATION = "OBSERVATION"


class RemarkStatus(str, enum.Enum):
    OPEN      = "OPEN"
    IN_REVIEW = "IN_REVIEW"
    RESOLVED  = "RESOLVED"
    CLOSED    = "CLOSED"


class RemarkTemplate(Base):
    __tablename__ = "remark_templates"

    id: Mapped[int]        = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int]    = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    category: Mapped[str]  = mapped_column(String(30), nullable=False)
    issue: Mapped[str]     = mapped_column(String(500), nullable=False)
    severity: Mapped[str]  = mapped_column(String(20), nullable=False)
    recommended_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    auto_hold: Mapped[bool]  = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool]  = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[int]  = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_remark_templates_org_id", "org_id"),
        Index("ix_remark_templates_category", "category"),
    )


class Remark(Base):
    __tablename__ = "remarks"

    id: Mapped[str]        = mapped_column(String(36), primary_key=True)   # client UUID
    org_id: Mapped[int]    = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    unit_id: Mapped[int]   = mapped_column(Integer, ForeignKey("project_units.id"), nullable=False)
    work_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("work_orders.id"), nullable=True)
    template_id: Mapped[int | None]   = mapped_column(Integer, ForeignKey("remark_templates.id"), nullable=True)
    custom_issue: Mapped[str | None]  = mapped_column(String(1000), nullable=True)
    severity: Mapped[str]  = mapped_column(String(20), nullable=False)
    status: Mapped[str]    = mapped_column(String(20), nullable=False, default=RemarkStatus.OPEN.value)
    photos: Mapped[list | None]  = mapped_column(JSON, nullable=True)
    gps_tag: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    resolution_notes: Mapped[str | None]   = mapped_column(Text, nullable=True)
    resolution_photos: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[object]  = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    resolved_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_remarks_org_id", "org_id"),
        Index("ix_remarks_unit_id", "unit_id"),
        Index("ix_remarks_severity", "severity"),
        Index("ix_remarks_status", "status"),
    )
