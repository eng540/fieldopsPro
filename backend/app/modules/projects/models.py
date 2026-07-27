"""PROJECTS Models — FieldOps V4.0

Models:
- Project: Top-level construction project per org
- ProjectUnit: Physical unit within a project (apartment, floor, block)
- BOQItem: Bill of Quantities line item per unit

Constitutional: Every model MUST include org_id.
"""
from __future__ import annotations
import enum

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Index,
    Integer, JSON, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class ProjectStatus(str, enum.Enum):
    PLANNING   = "PLANNING"
    ACTIVE     = "ACTIVE"
    ON_HOLD    = "ON_HOLD"
    COMPLETED  = "COMPLETED"
    CANCELLED  = "CANCELLED"


class UnitStatus(str, enum.Enum):
    PENDING    = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED  = "COMPLETED"
    SNAGGED    = "SNAGGED"


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int]         = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int]     = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    name: Mapped[str]       = mapped_column(String(255), nullable=False)
    code: Mapped[str]       = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str]     = mapped_column(String(30), nullable=False, default=ProjectStatus.PLANNING.value)
    location: Mapped[str | None]    = mapped_column(String(500), nullable=True)
    start_date: Mapped[str | None]  = mapped_column(String(20), nullable=True)
    end_date: Mapped[str | None]    = mapped_column(String(20), nullable=True)
    total_units: Mapped[int]        = mapped_column(Integer, nullable=False, default=0)
    completion_pct: Mapped[float]   = mapped_column(Float, nullable=False, default=0.0)
    created_by: Mapped[int]         = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    is_active: Mapped[bool]         = mapped_column(Boolean, nullable=False, default=True)
    extra_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[object]      = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[object]      = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    units: Mapped[list[ProjectUnit]] = relationship("ProjectUnit", back_populates="project", lazy="select")

    __table_args__ = (
        UniqueConstraint("org_id", "code", name="uq_projects_org_code"),
        Index("ix_projects_org_id", "org_id"),
        Index("ix_projects_status", "status"),
    )


class ProjectUnit(Base):
    __tablename__ = "project_units"

    id: Mapped[int]          = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int]      = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    project_id: Mapped[int]  = mapped_column(Integer, ForeignKey("projects.id"), nullable=False)
    name: Mapped[str]        = mapped_column(String(255), nullable=False)
    code: Mapped[str]        = mapped_column(String(50), nullable=False)
    unit_type: Mapped[str | None]    = mapped_column(String(100), nullable=True)
    floor: Mapped[int | None]        = mapped_column(Integer, nullable=True)
    area_sqm: Mapped[float | None]   = mapped_column(Float, nullable=True)
    status: Mapped[str]              = mapped_column(String(30), nullable=False, default=UnitStatus.PENDING.value)
    completion_pct: Mapped[float]    = mapped_column(Float, nullable=False, default=0.0)
    is_active: Mapped[bool]          = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[object]       = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[object]       = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    project: Mapped[Project] = relationship("Project", back_populates="units")
    boq_items: Mapped[list[BOQItem]] = relationship("BOQItem", back_populates="unit", lazy="select")

    __table_args__ = (
        UniqueConstraint("project_id", "code", name="uq_units_project_code"),
        Index("ix_project_units_org_id", "org_id"),
        Index("ix_project_units_project_id", "project_id"),
    )


class BOQItem(Base):
    """Bill of Quantities item — tracks progress per trade per unit."""
    __tablename__ = "boq_items"

    id: Mapped[int]         = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int]     = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    unit_id: Mapped[int]    = mapped_column(Integer, ForeignKey("project_units.id"), nullable=False)
    trade: Mapped[str]      = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[float]  = mapped_column(Float, nullable=False, default=0.0)
    unit_of_measure: Mapped[str] = mapped_column(String(50), nullable=False, default="item")
    completion_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    is_active: Mapped[bool]  = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    unit: Mapped[ProjectUnit] = relationship("ProjectUnit", back_populates="boq_items")

    __table_args__ = (
        Index("ix_boq_items_org_id", "org_id"),
        Index("ix_boq_items_unit_id", "unit_id"),
    )
