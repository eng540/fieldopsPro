"""EXECUTION Pydantic Schemas — FieldOps V4.0.

Backward-compatible contracts plus Epic 1 event pipeline contracts.
"""
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator


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

class EntityType(str, Enum):
    PROJECT = "PROJECT"
    UNIT = "UNIT"
    BOQ_ITEM = "BOQ_ITEM"
    WORK_ORDER = "WORK_ORDER"
    REMARK = "REMARK"

class EventClass(str, Enum):
    PROGRESS = "PROGRESS"
    STATUS = "STATUS"
    QC = "QC"
    RELATION = "RELATION"
    NOTE = "NOTE"

class EventType(str, Enum):
    DELTA_ADD = "DELTA_ADD"
    SNAPSHOT_SET = "SNAPSHOT_SET"
    DATA_CORRECTION = "DATA_CORRECTION"
    REWORK = "REWORK"
    STATUS_CHANGE = "STATUS_CHANGE"
    INITIAL_STATE = "INITIAL_STATE"

class MetricType(str, Enum):
    QUANTITY = "QUANTITY"
    PERCENTAGE = "PERCENTAGE"
    FINANCIAL = "FINANCIAL"
    NONE = "NONE"


class PaginatedResponse(BaseModel):
    items: list[Any] = Field(default_factory=list)
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=200)

class PaginationParams(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)

class WorkOrderCreate(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    project_id: int = Field(gt=0)
    unit_id: int | None = Field(default=None, gt=0)
    wo_type: WorkOrderType = WorkOrderType.CORRECTIVE
    priority: WorkOrderPriority = WorkOrderPriority.MEDIUM
    location_data: dict[str, Any] | None = None
    extra_data: dict[str, Any] | None = None

class WorkOrderUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    wo_type: WorkOrderType | None = None
    priority: WorkOrderPriority | None = None
    completion_pct: float | None = Field(default=None, ge=0, le=100)
    rework_flag: bool | None = None
    rework_reason: str | None = None
    rework_authorized_by: int | None = Field(default=None, gt=0)
    status: WorkOrderStatus | None = None
    location_data: dict[str, Any] | None = None
    extra_data: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_rework_fields(self) -> "WorkOrderUpdate":
        if self.rework_flag is True:
            if not self.rework_reason or len(self.rework_reason.strip()) < 20:
                raise ValueError("rework_reason is required (min 20 chars) when rework_flag is True")
            if not self.rework_authorized_by:
                raise ValueError("rework_authorized_by is required when rework_flag is True")
        return self

class WorkOrderRead(BaseModel):
    id: int; org_id: int; project_id: int; unit_id: int | None = None
    title: str; description: str | None = None; wo_type: WorkOrderType
    priority: WorkOrderPriority; status: WorkOrderStatus; completion_pct: float
    rework_flag: bool; rework_reason: str | None = None; rework_authorized_by: int | None = None
    created_by: int; device_timestamp: datetime | None = None; server_timestamp: datetime
    location_data: dict[str, Any] | None = None; extra_data: dict[str, Any] | None = None
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

class WorkOrderListItem(BaseModel):
    id: int; project_id: int; unit_id: int | None = None; title: str
    wo_type: WorkOrderType; priority: WorkOrderPriority; status: WorkOrderStatus
    completion_pct: float; server_timestamp: datetime; created_at: datetime
    model_config = {"from_attributes": True}

class WorkOrderListResponse(PaginatedResponse):
    items: list[WorkOrderListItem] = Field(default_factory=list)

class WorkOrderFilterParams(PaginationParams):
    status: WorkOrderStatus | None = None; priority: WorkOrderPriority | None = None
    wo_type: WorkOrderType | None = None; project_id: int | None = Field(default=None, gt=0)
    assigned_to: int | None = Field(default=None, gt=0)

class WorkOrderAssignmentCreate(BaseModel):
    user_id: int = Field(gt=0)
    notes: str | None = Field(default=None, max_length=2000)

class WorkOrderAssignmentRead(BaseModel):
    id: int; org_id: int; work_order_id: int; user_id: int; assigned_by: int
    status: AssignmentStatus; notes: str | None = None; assigned_at: datetime; created_at: datetime
    model_config = {"from_attributes": True}

class AssignmentListResponse(PaginatedResponse):
    items: list[WorkOrderAssignmentRead] = Field(default_factory=list)

class StatusHistoryRead(BaseModel):
    id: int; org_id: int; work_order_id: int; changed_by: int; from_status: str; to_status: str
    reason: str; rework_flag: bool; rework_reason: str | None = None
    rework_authorized_by: int | None = None; created_at: datetime
    model_config = {"from_attributes": True}

class StatusHistoryListResponse(PaginatedResponse):
    items: list[StatusHistoryRead] = Field(default_factory=list)

class SyncLogRead(BaseModel):
    id: int; org_id: int; work_order_id: int; operation_uuid: str
    operation_type: SyncOperationType; synced_by: int; sync_status: SyncStatus
    conflict_details: dict[str, Any] | None = None; device_timestamp: datetime | None = None
    server_timestamp: datetime; created_at: datetime
    model_config = {"from_attributes": True}

class SyncLogListResponse(PaginatedResponse):
    items: list[SyncLogRead] = Field(default_factory=list)

class BoQProgressCreate(BaseModel):
    unit_id: int; boq_item_id: int
    completion_pct: float = Field(ge=0.0, le=100.0)
    status: str | None = None
    measured_quantity: float | None = Field(default=None, ge=0.0)
    rework_flag: bool = False
    rework_reason: str | None = Field(default=None, min_length=20, max_length=2000)
    rework_authorized_by: int | None = None

class BoQProgressRead(BaseModel):
    id: int; org_id: int; unit_id: int; boq_item_id: int; completion_pct: float; status: str
    measured_quantity: float | None; rework_flag: bool; rework_reason: str | None
    rework_authorized_by: int | None; updated_by: int; server_timestamp: datetime; updated_at: datetime
    state_version: int = 1; actual_quantity: float | None = None; financial_value: float | None = None
    last_event_id: str | None = None
    model_config = {"from_attributes": True}

class BulkBoQProgressItem(BaseModel):
    unit_id: int; boq_item_id: int; completion_pct: float = Field(ge=0.0, le=100.0)
    status: str | None = None; measured_quantity: float | None = None; rework_flag: bool = False
    rework_reason: str | None = Field(default=None, min_length=20, max_length=2000)
    rework_authorized_by: int | None = None

class BulkBoQProgressRequest(BaseModel):
    updates: list[BulkBoQProgressItem] = Field(min_length=1, max_length=100)

class BulkConflict(BaseModel):
    unit_id: int; boq_item_id: int; current_pct: float; attempted_pct: float; reason: str

class BulkBoQProgressResponse(BaseModel):
    succeeded: int; failed: int; conflicts: list[BulkConflict]


class EventIntent(BaseModel):
    """Client event intent. unit_id is mandatory for BOQ_ITEM to avoid cross-unit ambiguity."""
    sync_uuid: str = Field(min_length=36, max_length=36)
    entity_type: EntityType
    entity_id: str
    unit_id: int | None = Field(default=None, gt=0)
    event_class: EventClass
    event_type: EventType
    metric_type: MetricType
    value: dict[str, Any] = Field(default_factory=dict)
    unit_of_measure: str | None = None
    occurred_at: datetime
    expected_version: int = Field(ge=1)
    reason: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def validate_entity_context(self) -> "EventIntent":
        if self.entity_type == EntityType.BOQ_ITEM and self.unit_id is None:
            raise ValueError("unit_id is required for BOQ_ITEM events")
        return self

class EventBatchRequest(BaseModel):
    transaction_group_id: str | None = None
    events: list[EventIntent] = Field(min_length=1, max_length=1000)

class EventConflictDetails(BaseModel):
    sync_uuid: str; expected_version: int; actual_version: int
    current_state: dict[str, Any]
    resolution_options: list[str] = Field(default_factory=lambda: ["FORCE_OVERRIDE_AS_CORRECTION", "DISCARD_LOCAL"])

class EventResponse(BaseModel):
    event_id: str; sync_uuid: str; new_version: int; status: str = "PROCESSED"; recorded_at: datetime

class EventBatchResponse(BaseModel):
    succeeded: list[EventResponse]; conflicts: list[EventConflictDetails]; failed: list[dict[str, Any]]
