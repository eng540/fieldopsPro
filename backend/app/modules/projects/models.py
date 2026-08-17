"""PROJECTS Models — FieldOps V4.0

Core relationship:
Project -> BOQItem (single project-scoped definition)
Project -> ProjectUnit
ProjectUnit <-> BOQItem through UnitBoQAssignment (applicability/planned quantity)

Execution state is tracked separately by UnitBoQProgress.
"""
from __future__ import annotations

import enum
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.core.database import Base


class ProjectStatus(str, enum.Enum):
    PLANNING = "PLANNING"
    ACTIVE = "ACTIVE"
    ON_HOLD = "ON_HOLD"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class UnitStatus(str, enum.Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    SNAGGED = "SNAGGED"


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default=ProjectStatus.PLANNING.value)
    location: Mapped[str | None] = mapped_column(String(500), nullable=True)
    start_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    end_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    total_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    extra_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    units: Mapped[list["ProjectUnit"]] = relationship("ProjectUnit", back_populates="project", lazy="select")
    boq_items: Mapped[list["BOQItem"]] = relationship("BOQItem", back_populates="project", lazy="select", cascade="all, delete-orphan")
    __table_args__ = (
        UniqueConstraint("org_id", "code", name="uq_projects_org_code"),
        Index("ix_projects_org_id", "org_id"),
        Index("ix_projects_status", "status"),
    )


class ProjectUnit(Base):
    __tablename__ = "project_units"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    unit_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    floor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    area_sqm: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default=UnitStatus.PENDING.value)
    completion_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    project: Mapped[Project] = relationship("Project", back_populates="units")
    boq_assignments: Mapped[list["UnitBoQAssignment"]] = relationship("UnitBoQAssignment", back_populates="unit", cascade="all, delete-orphan")
    boq_items: Mapped[list["BOQItem"]] = relationship(
        "BOQItem", secondary="unit_boq_assignments", viewonly=True, lazy="select"
    )
    __table_args__ = (
        UniqueConstraint("project_id", "code", name="uq_units_project_code"),
        Index("ix_project_units_org_id", "org_id"),
        Index("ix_project_units_project_id", "project_id"),
    )


class BOQItem(Base):
    """Project-scoped BOQ definition. It is NOT a per-unit row."""
    __tablename__ = "boq_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(80), nullable=False)
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    trade: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    unit_of_measure: Mapped[str] = mapped_column(String(50), nullable=False, default="item")
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    extra_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Deprecated compatibility column. New code MUST use UnitBoQAssignment.
    unit_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("project_units.id"), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    project: Mapped[Project] = relationship("Project", back_populates="boq_items")
    assignments: Mapped[list["UnitBoQAssignment"]] = relationship("UnitBoQAssignment", back_populates="boq_item", cascade="all, delete-orphan")
    __table_args__ = (
        UniqueConstraint("project_id", "code", name="uq_boq_items_project_code"),
        Index("ix_boq_items_org_id", "org_id"),
        Index("ix_boq_items_project_id", "project_id"),
        Index("ix_boq_items_unit_id_legacy", "unit_id"),
    )


class UnitBoQAssignment(Base):
    """Applicability of a project BOQ item to a unit.

    This is configuration/planning, not execution state.
    """
    __tablename__ = "unit_boq_assignments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    unit_id: Mapped[int] = mapped_column(Integer, ForeignKey("project_units.id", ondelete="CASCADE"), nullable=False)
    boq_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("boq_items.id", ondelete="CASCADE"), nullable=False)
    planned_quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    extra_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    unit: Mapped[ProjectUnit] = relationship("ProjectUnit", back_populates="boq_assignments")
    boq_item: Mapped[BOQItem] = relationship("BOQItem", back_populates="assignments")
    __table_args__ = (
        UniqueConstraint("unit_id", "boq_item_id", name="uq_unit_boq_assignment"),
        Index("ix_unit_boq_assignment_org", "org_id"),
        Index("ix_unit_boq_assignment_unit", "unit_id"),
        Index("ix_unit_boq_assignment_boq", "boq_item_id"),
    )


class ProjectDictionary(Base):
    """Configurable vocabulary shared by an org or scoped to one project."""
    __tablename__ = "project_dictionaries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("projects.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(80), nullable=False)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    extra_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    __table_args__ = (
        Index("ix_project_dict_org_kind", "org_id", "kind"),
        Index("ix_project_dict_project_kind", "project_id", "kind"),
        UniqueConstraint("org_id", "project_id", "kind", "key", name="uq_project_dict_scope_key"),
    )
