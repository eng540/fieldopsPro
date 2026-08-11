# --- START OF FILE backend/app/modules/execution/models.py ---

"""EXECUTION Models — FieldOps V4.0 (Epic 1: Event-Logged State)

Constitutional Architecture:
1. execution_events: The ABSOLUTE Source of Truth (WORM: Insert/Select Only).
2. unit_boq_progress: Materialized Current State (Read Model). 
   MUST ONLY be updated via the Event Pipeline in a single DB Transaction.
3. Optimistic Locking enforced via state_version.
4. Idempotency enforced via event_sync_logs with response_payload caching.
"""
import enum
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean, Index, DateTime, Float, ForeignKey,
    Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


# ─────────────────────────────────────────
# ENUMS
# ─────────────────────────────────────────
class WorkOrderType(str, enum.Enum):
    CORRECTIVE = "CORRECTIVE"
    PREVENTIVE = "PREVENTIVE"
    INSTALLATION = "INSTALLATION"
    INSPECTION = "INSPECTION"
    MAINTENANCE = "MAINTENANCE"

class WorkOrderPriority(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

class WorkOrderStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"

class AssignmentStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    RELEASED = "RELEASED"
    REASSIGNED = "REASSIGNED"

class SyncOperationType(str, enum.Enum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    STATUS_CHANGE = "STATUS_CHANGE"

class SyncStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSED = "PROCESSED"
    FAILED = "FAILED"
    CONFLICT = "CONFLICT"

# ── Epic 1: Event & Entity Enums (Entity Registry) ──
class EntityType(str, enum.Enum):
    """Entity Registry: Strict list of supported entities to prevent Generic EAV chaos."""
    PROJECT = "PROJECT"
    UNIT = "UNIT"
    BOQ_ITEM = "BOQ_ITEM"
    WORK_ORDER = "WORK_ORDER"
    REMARK = "REMARK"

class EventClass(str, enum.Enum):
    PROGRESS = "PROGRESS"
    STATUS = "STATUS"
    QC = "QC"
    RELATION = "RELATION"
    NOTE = "NOTE"

class EventType(str, enum.Enum):
    DELTA_ADD = "DELTA_ADD"
    SNAPSHOT_SET = "SNAPSHOT_SET"       # Strictly for SysAdmins/Migrations
    DATA_CORRECTION = "DATA_CORRECTION" # Admin correction, not actual rework
    REWORK = "REWORK"                   # Actual physical regression/rejection
    STATUS_CHANGE = "STATUS_CHANGE"
    INITIAL_STATE = "INITIAL_STATE"     # Used for legacy data migration

class MetricType(str, enum.Enum):
    QUANTITY = "QUANTITY"
    PERCENTAGE = "PERCENTAGE"
    FINANCIAL = "FINANCIAL"
    NONE = "NONE"


MONOTONIC_STATUS_TRANSITIONS: dict[WorkOrderStatus, list[WorkOrderStatus]] = {
    WorkOrderStatus.DRAFT: [WorkOrderStatus.PENDING_APPROVAL, WorkOrderStatus.CANCELLED],
    WorkOrderStatus.PENDING_APPROVAL: [WorkOrderStatus.APPROVED, WorkOrderStatus.CANCELLED],
    WorkOrderStatus.APPROVED: [WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.CANCELLED],
    WorkOrderStatus.IN_PROGRESS: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED],
    WorkOrderStatus.COMPLETED: [],
    WorkOrderStatus.CANCELLED: [],
}


# ─────────────────────────────────────────
# WORK ORDER MODELS (Legacy / Current)
# ─────────────────────────────────────────
class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    unit_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("project_units.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    wo_type: Mapped[WorkOrderType] = mapped_column(String(20), nullable=False, default=WorkOrderType.CORRECTIVE)
    priority: Mapped[WorkOrderPriority] = mapped_column(String(10), nullable=False, default=WorkOrderPriority.MEDIUM)
    status: Mapped[WorkOrderStatus] = mapped_column(String(20), nullable=False, default=WorkOrderStatus.DRAFT, index=True)
    completion_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    rework_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rework_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    rework_authorized_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    device_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    server_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    location_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    extra_data: Mapped[dict[str, Any] | None] = mapped_column("extra_data", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    assignments: Mapped[list["WorkOrderAssignment"]] = relationship("WorkOrderAssignment", back_populates="work_order", cascade="all, delete-orphan")
    status_history: Mapped[list["WorkOrderStatusHistory"]] = relationship("WorkOrderStatusHistory", back_populates="work_order", cascade="all, delete-orphan", order_by="WorkOrderStatusHistory.created_at")
    sync_logs: Mapped[list["WorkOrderSyncLog"]] = relationship("WorkOrderSyncLog", back_populates="work_order", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("org_id", "id", name="uq_work_orders_org_id"),)


class WorkOrderAssignment(Base):
    __tablename__ = "work_order_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    work_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("work_orders.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    assigned_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    status: Mapped[AssignmentStatus] = mapped_column(String(15), nullable=False, default=AssignmentStatus.ACTIVE)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    work_order: Mapped["WorkOrder"] = relationship("WorkOrder", back_populates="assignments")


class WorkOrderStatusHistory(Base):
    __tablename__ = "work_order_status_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    work_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("work_orders.id"), nullable=False, index=True)
    changed_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    from_status: Mapped[str] = mapped_column(String(20), nullable=False)
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    rework_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rework_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    rework_authorized_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    work_order: Mapped["WorkOrder"] = relationship("WorkOrder", back_populates="status_history")


class WorkOrderSyncLog(Base):
    __tablename__ = "work_order_sync_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    work_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("work_orders.id"), nullable=False, index=True)
    operation_uuid: Mapped[str] = mapped_column(String(36), nullable=False, unique=True, index=True)
    operation_type: Mapped[SyncOperationType] = mapped_column(String(15), nullable=False)
    synced_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    sync_status: Mapped[SyncStatus] = mapped_column(String(15), nullable=False, default=SyncStatus.PENDING, index=True)
    conflict_details: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    device_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    server_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    work_order: Mapped["WorkOrder"] = relationship("WorkOrder", back_populates="sync_logs")


# ─────────────────────────────────────────
# EPIC 1: EVENT-LOGGED STATE ARCHITECTURE
# ─────────────────────────────────────────

class EventSyncLog(Base):
    """Idempotency registry for the Event Pipeline.
    Stores the exact response payload to return identical responses for retried syncs.
    """
    __tablename__ = "event_sync_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    operation_uuid: Mapped[str] = mapped_column(String(36), nullable=False, unique=True, index=True, comment="Per-Event UUID")
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    response_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True, comment="Cached response for idempotency")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ExecutionEvent(Base):
    """The WORM Event Log. The absolute source of truth for what happened in the field."""
    __tablename__ = "execution_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, comment="UUID of the event")
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("projects.id"), nullable=True, index=True)
    unit_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("project_units.id"), nullable=True, index=True)
    
    # Entity Registry (Strict)
    entity_type: Mapped[EntityType] = mapped_column(String(50), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    
    # Event Classification
    event_class: Mapped[EventClass] = mapped_column(String(50), nullable=False)
    event_type: Mapped[EventType] = mapped_column(String(50), nullable=False)
    metric_type: Mapped[MetricType] = mapped_column(String(50), nullable=False)
    
    # Values (JSONB to support multiple types: int, float, string)
    previous_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    new_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    delta_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    unit_of_measure: Mapped[str | None] = mapped_column(String(50), nullable=True)
    
    # Dynamic Time
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, comment="When it happened in the field")
    effective_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, comment="When it is financially/administratively effective")
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), comment="When it reached the server")
    
    # Traceability
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    # Batch & Idempotency
    sync_uuid: Mapped[str] = mapped_column(String(36), ForeignKey("event_sync_logs.operation_uuid"), nullable=False, unique=True)
    transaction_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True, comment="For grouping multiple events in one logical batch")

    __table_args__ = (
        Index("ix_execution_events_timeline", "org_id", "unit_id", "occurred_at"),
    )


class UnitBoQProgressStatus(str, enum.Enum):
    NOT_STARTED      = "NOT_STARTED"
    IN_PROGRESS      = "IN_PROGRESS"
    PAUSED           = "PAUSED"
    COMPLETED        = "COMPLETED"
    REWORK_REQUIRED  = "REWORK_REQUIRED"


class UnitBoQProgress(Base):
    """The Read Model / Current State. 
    Updated ONLY atomically alongside an ExecutionEvent.
    Maintains backward compatibility with V3/V4-Legacy APIs.
    """
    __tablename__ = "unit_boq_progress"

    id: Mapped[int]          = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int]      = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    unit_id: Mapped[int]     = mapped_column(Integer, ForeignKey("project_units.id"), nullable=False)
    boq_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("boq_items.id"), nullable=False)
    
    # Legacy Fields
    completion_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    status: Mapped[str]      = mapped_column(String(30), nullable=False, default=UnitBoQProgressStatus.NOT_STARTED.value)
    measured_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    rework_flag: Mapped[bool]   = mapped_column(Boolean, nullable=False, default=False)
    rework_reason: Mapped[str | None]       = mapped_column(Text, nullable=True)
    rework_authorized_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by: Mapped[int]  = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    server_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # ── Epic 1: New State Fields ──
    state_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, comment="Optimistic Locking Version")
    actual_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    financial_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_event_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("execution_events.id", name="fk_unit_boq_progress_last_event_id"), nullable=True)

    __table_args__ = (
        UniqueConstraint("unit_id", "boq_item_id", name="uq_unit_boq_progress"),
        Index("ix_unit_boq_progress_org_id", "org_id"),
        Index("ix_unit_boq_progress_unit_id", "unit_id"),
    )