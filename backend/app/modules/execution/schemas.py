"""EXECUTION Pydantic Schemas — FieldOps V4.0 (Sprint-2 CP-2)

All schemas enforce multi-tenant context where applicable.

Schema Categories:
- WorkOrder: Create, Read, Update, List filtering
- WorkOrderAssignment: Create, Read, Update
- WorkOrderStatusHistory: Read (WORM — create only via status transition API)
- WorkOrderSyncLog: Read (created internally by sync engine)

Constitutional Rules:
- All mutable schemas validate rework fields per ADR-003
- completion_pct is constrained [0, 100]
- rework_reason requires min 20 characters when rework_flag=True
"""
from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


# ─────────────────────────────────────────
# RE-USABLE ENUMS (match ORM models)
# ─────────────────────────────────────────
class WorkOrderType(str, Enum):
    CORRECTIVE = "CORRECTIVE"
    PREVENTIVE = "PREVENTIVE"
    INSTALLATION = "INSTALLATION"
    INSPECTION = "INSPECTION"
    MAINTENANCE = "MAINTENANCE"


class WorkOrderPriority(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class WorkOrderStatus(str, Enum):
    DRAFT = "DRAFT"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class AssignmentStatus(str, Enum):
    ACTIVE = "ACTIVE"
    RELEASED = "RELEASED"
    REASSIGNED = "REASSIGNED"


class SyncOperationType(str, Enum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    STATUS_CHANGE = "STATUS_CHANGE"


class SyncStatus(str, Enum):
    PENDING = "PENDING"
    PROCESSED = "PROCESSED"
    FAILED = "FAILED"
    CONFLICT = "CONFLICT"


# ─────────────────────────────────────────
# PAGINATION & LIST RESPONSES
# ─────────────────────────────────────────
class PaginatedResponse(BaseModel):
    """Standard paginated list response."""
    items: list[Any] = Field(default_factory=list)
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=200)


class PaginationParams(BaseModel):
    """Pagination query parameters."""
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)


# ─────────────────────────────────────────
# WORK ORDER SCHEMAS
# ─────────────────────────────────────────
class WorkOrderCreate(BaseModel):
    """Schema for creating a new work order.

    Required: title, project_id
    Optional: description, wo_type, priority, unit_id, location_data, extra_data
    Auto-set: org_id (from JWT context), status=DRAFT, created_by (from JWT)
    """
    title: str = Field(
        min_length=3,
        max_length=255,
        description="Brief descriptive title of the work order",
    )
    description: str | None = Field(
        default=None,
        max_length=5000,
        description="Detailed description of work required",
    )
    project_id: int = Field(
        gt=0,
        description="Project this work order belongs to",
    )
    unit_id: int | None = Field(
        default=None,
        gt=0,
        description="Optional specific unit this WO addresses",
    )
    wo_type: WorkOrderType = Field(
        default=WorkOrderType.CORRECTIVE,
        description="Classification of work order type",
    )
    priority: WorkOrderPriority = Field(
        default=WorkOrderPriority.MEDIUM,
        description="Priority level for scheduling",
    )
    location_data: dict[str, Any] | None = Field(
        default=None,
        description="GPS/location data: {lat, lng, accuracy, address}",
    )
    extra_data: dict[str, Any] | None = Field(
        default=None,
        description="Extensible metadata key-value store",
    )


class WorkOrderUpdate(BaseModel):
    """Schema for updating a work order (PATCH semantics).

    All fields are optional. Only provided fields are updated.
    Constitutional: completion_pct and rework fields validated per ADR-003.
    """
    title: str | None = Field(
        default=None,
        min_length=3,
        max_length=255,
    )
    description: str | None = Field(
        default=None,
        max_length=5000,
    )
    wo_type: WorkOrderType | None = None
    priority: WorkOrderPriority | None = None
    completion_pct: float | None = Field(
        default=None,
        ge=0,
        le=100,
        description="Completion percentage [0-100]. Monotonic — cannot decrease without rework.",
    )
    rework_flag: bool | None = Field(
        default=None,
        description="Required for any decrease in completion_pct (ADR-003 Rule 3)",
    )
    rework_reason: str | None = Field(
        default=None,
        description="Mandatory when rework_flag=True. Min 20 chars.",
    )
    rework_authorized_by: int | None = Field(
        default=None,
        gt=0,
        description="User ID who authorized the rework (PM or Org Admin)",
    )
    location_data: dict[str, Any] | None = None
    extra_data: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_rework_fields(self) -> "WorkOrderUpdate":
        """Validate rework field consistency per ADR-003 Rule 3."""
        if self.rework_flag is True:
            if not self.rework_reason or len(self.rework_reason.strip()) < 20:
                raise ValueError(
                    "rework_reason is required and must be at least 20 characters "
                    "when rework_flag is True (ADR-003 Rule 3)"
                )
            if not self.rework_authorized_by:
                raise ValueError(
                    "rework_authorized_by is required when rework_flag is True "
                    "(ADR-003 Rule 3)"
                )
        return self


class WorkOrderRead(BaseModel):
    """Schema for reading a work order (full detail)."""
    id: int
    org_id: int
    project_id: int
    unit_id: int | None = None
    title: str
    description: str | None = None
    wo_type: WorkOrderType
    priority: WorkOrderPriority
    status: WorkOrderStatus
    completion_pct: float
    rework_flag: bool
    rework_reason: str | None = None
    rework_authorized_by: int | None = None
    created_by: int
    device_timestamp: datetime | None = None
    server_timestamp: datetime
    location_data: dict[str, Any] | None = None
    extra_data: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkOrderListItem(BaseModel):
    """Lightweight schema for work order list views (excludes description/extra_data)."""
    id: int
    project_id: int
    unit_id: int | None = None
    title: str
    wo_type: WorkOrderType
    priority: WorkOrderPriority
    status: WorkOrderStatus
    completion_pct: float
    server_timestamp: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkOrderListResponse(PaginatedResponse):
    """Paginated response for work order lists."""
    items: list[WorkOrderListItem] = Field(default_factory=list)


class WorkOrderFilterParams(PaginationParams):
    """Query parameters for filtering work orders."""
    status: WorkOrderStatus | None = None
    priority: WorkOrderPriority | None = None
    wo_type: WorkOrderType | None = None
    project_id: int | None = Field(default=None, gt=0)
    assigned_to: int | None = Field(default=None, gt=0)


# ─────────────────────────────────────────
# WORK ORDER ASSIGNMENT SCHEMAS
# ─────────────────────────────────────────
class WorkOrderAssignmentCreate(BaseModel):
    """Schema for assigning a user to a work order."""
    user_id: int = Field(
        gt=0,
        description="User to assign to this work order",
    )
    notes: str | None = Field(
        default=None,
        max_length=2000,
        description="Optional assignment notes or instructions",
    )


class WorkOrderAssignmentRead(BaseModel):
    """Schema for reading a work order assignment."""
    id: int
    org_id: int
    work_order_id: int
    user_id: int
    assigned_by: int
    status: AssignmentStatus
    notes: str | None = None
    assigned_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class AssignmentListResponse(PaginatedResponse):
    """Paginated response for assignment lists."""
    items: list[WorkOrderAssignmentRead] = Field(default_factory=list)


# ─────────────────────────────────────────
# WORK ORDER STATUS HISTORY SCHEMAS
# ─────────────────────────────────────────
class StatusHistoryRead(BaseModel):
    """Schema for reading status history entries (WORM — read-only)."""
    id: int
    org_id: int
    work_order_id: int
    changed_by: int
    from_status: str
    to_status: str
    reason: str
    rework_flag: bool
    rework_reason: str | None = None
    rework_authorized_by: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class StatusHistoryListResponse(PaginatedResponse):
    """Paginated response for status history."""
    items: list[StatusHistoryRead] = Field(default_factory=list)


# ─────────────────────────────────────────
# WORK ORDER SYNC LOG SCHEMAS
# ─────────────────────────────────────────
class SyncLogRead(BaseModel):
    """Schema for reading sync log entries (internal/engine use)."""
    id: int
    org_id: int
    work_order_id: int
    operation_uuid: str
    operation_type: SyncOperationType
    synced_by: int
    sync_status: SyncStatus
    conflict_details: dict[str, Any] | None = None
    device_timestamp: datetime | None = None
    server_timestamp: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class SyncLogListResponse(PaginatedResponse):
    """Paginated response for sync logs."""
    items: list[SyncLogRead] = Field(default_factory=list)


# ═══════════════════════════════════════
# BOQ PROGRESS SCHEMAS (Sprint-4 M1.2)
# Matches OpenAPI UnitBoQProgress schema exactly
# ═══════════════════════════════════════

class BoQProgressCreate(BaseModel):
    """POST /execution/progress — single unit BOQ update."""
    unit_id: int
    boq_item_id: int
    completion_pct: float = Field(ge=0.0, le=100.0)
    status: str | None = None
    measured_quantity: float | None = Field(default=None, ge=0.0)
    rework_flag: bool = False
    rework_reason: str | None = Field(default=None, min_length=20, max_length=2000)
    rework_authorized_by: int | None = None


class BoQProgressRead(BaseModel):
    id: int
    org_id: int
    unit_id: int
    boq_item_id: int
    completion_pct: float
    status: str
    measured_quantity: float | None
    rework_flag: bool
    rework_reason: str | None
    rework_authorized_by: int | None
    updated_by: int
    server_timestamp: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class BulkBoQProgressItem(BaseModel):
    """Single item within a bulk progress update."""
    unit_id: int
    boq_item_id: int
    completion_pct: float = Field(ge=0.0, le=100.0)
    status: str | None = None
    measured_quantity: float | None = None
    rework_flag: bool = False
    rework_reason: str | None = Field(default=None, min_length=20, max_length=2000)
    rework_authorized_by: int | None = None


class BulkBoQProgressRequest(BaseModel):
    """POST /execution/bulk-progress — Speed Entry Matrix (max 100 items)."""
    updates: list[BulkBoQProgressItem] = Field(min_length=1, max_length=100)


class BulkConflict(BaseModel):
    unit_id: int
    boq_item_id: int
    current_pct: float
    attempted_pct: float
    reason: str


class BulkBoQProgressResponse(BaseModel):
    succeeded: int
    failed: int
    conflicts: list[BulkConflict]
