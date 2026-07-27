"""EXECUTION Models — FieldOps V4.0 (Sprint-2 CP-1)

Constitutional: Every model MUST include org_id unless in System Table Registry.
Implements: Monotonic Progress (ADR-003), WORM Audit, Exactly-Once Sync (ADR-002).

Models:
- WorkOrder: Core work order entity with multi-tenant isolation
- WorkOrderAssignment: Personnel assignment tracking
- WorkOrderStatusHistory: WORM (Write-Once-Read-Many) audit trail
- WorkOrderSyncLog: Exactly-Once sync deduplication
"""
import enum
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


# ─────────────────────────────────────────
# ENUMS
# ─────────────────────────────────────────
class WorkOrderType(str, enum.Enum):
    """Work order classification types."""
    CORRECTIVE = "CORRECTIVE"
    PREVENTIVE = "PREVENTIVE"
    INSTALLATION = "INSTALLATION"
    INSPECTION = "INSPECTION"
    MAINTENANCE = "MAINTENANCE"


class WorkOrderPriority(str, enum.Enum):
    """Work order priority levels."""
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class WorkOrderStatus(str, enum.Enum):
    """Work order lifecycle statuses.

    Constitutional Rule (ADR-003): Status transitions are Monotonic Progress.
    Allowed transitions:
        DRAFT -> PENDING_APPROVAL -> APPROVED -> IN_PROGRESS -> COMPLETED
        Any non-terminal -> CANCELLED
    """
    DRAFT = "DRAFT"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class AssignmentStatus(str, enum.Enum):
    """Assignment lifecycle statuses."""
    ACTIVE = "ACTIVE"
    RELEASED = "RELEASED"
    REASSIGNED = "REASSIGNED"


class SyncOperationType(str, enum.Enum):
    """Sync operation classifications."""
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    STATUS_CHANGE = "STATUS_CHANGE"


class SyncStatus(str, enum.Enum):
    """Sync processing statuses."""
    PENDING = "PENDING"
    PROCESSED = "PROCESSED"
    FAILED = "FAILED"
    CONFLICT = "CONFLICT"


# Monotonic status transition map (ADR-003)
MONOTONIC_STATUS_TRANSITIONS: dict[WorkOrderStatus, list[WorkOrderStatus]] = {
    WorkOrderStatus.DRAFT: [WorkOrderStatus.PENDING_APPROVAL, WorkOrderStatus.CANCELLED],
    WorkOrderStatus.PENDING_APPROVAL: [WorkOrderStatus.APPROVED, WorkOrderStatus.CANCELLED],
    WorkOrderStatus.APPROVED: [WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.CANCELLED],
    WorkOrderStatus.IN_PROGRESS: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED],
    WorkOrderStatus.COMPLETED: [],  # Terminal state
    WorkOrderStatus.CANCELLED: [],  # Terminal state
}


class WorkOrder(Base):
    """Core Work Order entity.

    Constitutional:
    - org_id: Multi-tenant isolation (MANDATORY)
    - completion_pct: Monotonic Progress (ADR-003) — cannot decrease without rework
    - server_timestamp: Authoritative timestamp for conflict resolution

    Relationships:
    - assignments: One-to-many WorkOrderAssignment
    - status_history: One-to-many WorkOrderStatusHistory (WORM audit)
    - sync_logs: One-to-many WorkOrderSyncLog
    """

    __tablename__ = "work_orders"

    # ─────────────────────────────────────────
    # PRIMARY KEY
    # ─────────────────────────────────────────
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # ─────────────────────────────────────────
    # MULTI-TENANT ISOLATION (Constitutional)
    # ─────────────────────────────────────────
    org_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("organizations.id"),
        nullable=False,
        index=True,
        comment="Organization ID for multi-tenant isolation",
    )

    # ─────────────────────────────────────────
    # PROJECT / UNIT SCOPING
    # ─────────────────────────────────────────
    project_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("projects.id"),
        nullable=False,
        index=True,
        comment="Project this work order belongs to",
    )
    unit_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("project_units.id"),
        nullable=True,
        index=True,
        comment="Optional specific unit this WO addresses",
    )

    # ─────────────────────────────────────────
    # WORK ORDER DATA
    # ─────────────────────────────────────────
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Brief descriptive title of the work order",
    )
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Detailed description of work required",
    )
    wo_type: Mapped[WorkOrderType] = mapped_column(
        String(20),
        nullable=False,
        default=WorkOrderType.CORRECTIVE,
        comment="Classification of work order type",
    )
    priority: Mapped[WorkOrderPriority] = mapped_column(
        String(10),
        nullable=False,
        default=WorkOrderPriority.MEDIUM,
        comment="Priority level for scheduling",
    )
    status: Mapped[WorkOrderStatus] = mapped_column(
        String(20),
        nullable=False,
        default=WorkOrderStatus.DRAFT,
        index=True,
        comment="Current lifecycle status (Monotonic Progress)",
    )

    # ─────────────────────────────────────────
    # MONOTONIC PROGRESS (ADR-003)
    # ─────────────────────────────────────────
    completion_pct: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
        comment="Completion percentage [0-100]. Monotonic — cannot decrease without rework.",
    )
    rework_flag: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Required for any decrease in completion_pct (ADR-003 Rule 3)",
    )
    rework_reason: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Mandatory when rework_flag=True. Min 20 chars.",
    )
    rework_authorized_by: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
        comment="User ID who authorized the rework (PM or Org Admin)",
    )

    # ─────────────────────────────────────────
    # OWNERSHIP & TRACKING
    # ─────────────────────────────────────────
    created_by: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        index=True,
        comment="User who created this work order",
    )

    # ─────────────────────────────────────────
    # TIMESTAMPS (ADR-002: server_timestamp is authoritative)
    # ─────────────────────────────────────────
    device_timestamp: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Client-side timestamp (display/logging only, NOT for conflict resolution)",
    )
    server_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="Server-side timestamp (authoritative for conflict resolution)",
    )

    # ─────────────────────────────────────────
    # EXTENDED DATA
    # ─────────────────────────────────────────
    location_data: Mapped[dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
        comment="GPS/location data: {lat, lng, accuracy, address}",
    )
    extra_data: Mapped[dict[str, Any] | None] = mapped_column(
        "extra_data",
        JSON,
        nullable=True,
        comment="Extensible metadata key-value store",
    )

    # ─────────────────────────────────────────
    # AUTO-MANAGED TIMESTAMPS
    # ─────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # ─────────────────────────────────────────
    # RELATIONSHIPS
    # ─────────────────────────────────────────
    assignments: Mapped[list["WorkOrderAssignment"]] = relationship(
        "WorkOrderAssignment",
        back_populates="work_order",
        cascade="all, delete-orphan",
    )
    status_history: Mapped[list["WorkOrderStatusHistory"]] = relationship(
        "WorkOrderStatusHistory",
        back_populates="work_order",
        cascade="all, delete-orphan",
        order_by="WorkOrderStatusHistory.created_at",
    )
    sync_logs: Mapped[list["WorkOrderSyncLog"]] = relationship(
        "WorkOrderSyncLog",
        back_populates="work_order",
        cascade="all, delete-orphan",
    )

    # ─────────────────────────────────────────
    # TABLE CONSTRAINTS
    # ─────────────────────────────────────────
    __table_args__ = (
        UniqueConstraint(
            "org_id", "id",
            name="uq_work_orders_org_id",
        ),
        {"comment": "Core work order entity with multi-tenant isolation"},
    )

    def is_transition_allowed(self, new_status: WorkOrderStatus) -> bool:
        """Check if a status transition is allowed per Monotonic Progress (ADR-003)."""
        allowed = MONOTONIC_STATUS_TRANSITIONS.get(self.status, [])
        return new_status in allowed


class WorkOrderAssignment(Base):
    """Personnel assignment to a work order.

    Constitutional:
    - org_id: Multi-tenant isolation
    - Tracks assignment lifecycle (active, released, reassigned)
    """

    __tablename__ = "work_order_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Multi-tenant isolation
    org_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("organizations.id"),
        nullable=False,
        index=True,
    )

    # Foreign keys
    work_order_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("work_orders.id"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        index=True,
        comment="User assigned to this work order",
    )
    assigned_by: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        comment="User who made this assignment",
    )

    # Assignment data
    status: Mapped[AssignmentStatus] = mapped_column(
        String(15),
        nullable=False,
        default=AssignmentStatus.ACTIVE,
    )
    notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Optional assignment notes or instructions",
    )

    # Timestamps
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Relationships
    work_order: Mapped["WorkOrder"] = relationship(
        "WorkOrder",
        back_populates="assignments",
    )

    __table_args__ = (
        {"comment": "Personnel assignments for work orders"},
    )


class WorkOrderStatusHistory(Base):
    """WORM (Write-Once-Read-Many) audit trail for work order status changes.

    Constitutional:
    - Once written, rows MUST NEVER be modified or deleted
    - Provides full audit trail for governance compliance
    - Records rework authorization details per ADR-003
    """

    __tablename__ = "work_order_status_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Multi-tenant isolation
    org_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("organizations.id"),
        nullable=False,
        index=True,
    )

    # Foreign keys
    work_order_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("work_orders.id"),
        nullable=False,
        index=True,
    )
    changed_by: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        index=True,
        comment="User who initiated the status change",
    )

    # Status transition data
    from_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="Previous status value",
    )
    to_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="New status value",
    )
    reason: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="Reason/justification for the status change",
    )

    # Rework tracking (ADR-003)
    rework_flag: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether this transition was a rework (backward progress)",
    )
    rework_reason: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Rework justification. Required if rework_flag=True.",
    )
    rework_authorized_by: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
        comment="PM/Org Admin who authorized the rework",
    )

    # Timestamp (WORM: set once, never modified)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Relationships
    work_order: Mapped["WorkOrder"] = relationship(
        "WorkOrder",
        back_populates="status_history",
    )

    __table_args__ = (
        {"comment": "WORM audit trail — records MUST NOT be modified or deleted"},
    )


class WorkOrderSyncLog(Base):
    """Sync deduplication log for Exactly-Once processing (ADR-002).

    Constitutional:
    - operation_uuid: Guarantees exactly-once processing
    - Tracks sync conflicts for offline-first reconciliation
    """

    __tablename__ = "work_order_sync_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Multi-tenant isolation
    org_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("organizations.id"),
        nullable=False,
        index=True,
    )

    # Foreign key
    work_order_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("work_orders.id"),
        nullable=False,
        index=True,
    )

    # Exactly-Once Sync (ADR-002)
    operation_uuid: Mapped[str] = mapped_column(
        String(36),
        nullable=False,
        unique=True,
        index=True,
        comment="UUID for idempotency. Prevents duplicate processing.",
    )
    operation_type: Mapped[SyncOperationType] = mapped_column(
        String(15),
        nullable=False,
        comment="Type of sync operation",
    )
    synced_by: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        comment="User/device that initiated the sync",
    )

    # Sync state
    sync_status: Mapped[SyncStatus] = mapped_column(
        String(15),
        nullable=False,
        default=SyncStatus.PENDING,
        index=True,
        comment="Current processing status of this sync operation",
    )
    conflict_details: Mapped[dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
        comment="Details of any sync conflict for resolution",
    )

    # Timestamps
    device_timestamp: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Device-local timestamp (advisory only)",
    )
    server_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="Server-side authoritative timestamp",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Relationships
    work_order: Mapped["WorkOrder"] = relationship(
        "WorkOrder",
        back_populates="sync_logs",
    )

    __table_args__ = (
        UniqueConstraint(
            "operation_uuid",
            name="uq_work_order_sync_operation_uuid",
        ),
        {"comment": "Exactly-Once sync deduplication log"},
    )


class UnitBoQProgressStatus(str, enum.Enum):
    NOT_STARTED      = "NOT_STARTED"
    IN_PROGRESS      = "IN_PROGRESS"
    COMPLETED        = "COMPLETED"
    REWORK_REQUIRED  = "REWORK_REQUIRED"


class UnitBoQProgress(Base):
    """Monotonic progress record for a single BOQ item on a unit.

    Constitutional (ADR-003):
    - completion_pct is MONOTONIC — cannot decrease without rework_flag=True
    - Composite PK (unit_id, boq_item_id) — one row per unit/boq combination
    - server_timestamp always set by DB (authoritative)
    - rework_flag=True requires rework_reason (min 20 chars) and rework_authorized_by
    """
    __tablename__ = "unit_boq_progress"

    id: Mapped[int]          = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int]      = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    unit_id: Mapped[int]     = mapped_column(Integer, ForeignKey("project_units.id"), nullable=False)
    boq_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("boq_items.id"), nullable=False)
    completion_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    status: Mapped[str]      = mapped_column(
        String(30), nullable=False, default=UnitBoQProgressStatus.NOT_STARTED.value
    )
    measured_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    rework_flag: Mapped[bool]   = mapped_column(Boolean, nullable=False, default=False)
    rework_reason: Mapped[str | None]       = mapped_column(Text, nullable=True)
    rework_authorized_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    updated_by: Mapped[int]  = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    server_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("unit_id", "boq_item_id", name="uq_unit_boq_progress"),
        Index("ix_unit_boq_progress_org_id", "org_id"),
        Index("ix_unit_boq_progress_unit_id", "unit_id"),
    )
