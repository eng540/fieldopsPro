"""Sync Engine Schemas — FieldOps V4.0 (Sprint-2 CP-4)

Pydantic schemas matching OpenAPI v0.1 spec exactly.

Constitutional (ADR-002 Offline-First Sync Protocol):
- SyncPullRequest  → POST /sync/pull   input
- SyncPullResponse → POST /sync/pull   output  (cursor-based, has_more pagination)
- SyncPushRequest  → POST /sync/push   input   (batch ≤1000 operations)
- SyncPushResponse → POST /sync/push   output  (processed UUIDs + conflicts list)
- SyncOperation    → single offline operation from device
- SyncConflict     → conflict detail returned to client for display/resolution
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


# ─────────────────────────────────────────
# ENUMS (mirror OpenAPI spec exactly)
# ─────────────────────────────────────────

class SyncOperationType(str, Enum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"


class SyncEntityType(str, Enum):
    """Entity types supported in sync operations."""
    WORK_ORDER       = "WORK_ORDER"
    UNIT_PROGRESS    = "UNIT_PROGRESS"
    REMARK           = "REMARK"
    DAILY_LOG        = "DAILY_LOG"


class SyncConflictType(str, Enum):
    """Conflict classification (ADR-002 § Conflict Resolution)."""
    MONOTONIC_VIOLATION = "MONOTONIC_VIOLATION"   # completion_pct decreased without rework
    TIMESTAMP_SKEW      = "TIMESTAMP_SKEW"        # device clock > 5 min from server
    CONCURRENT_EDIT     = "CONCURRENT_EDIT"       # two devices edited same entity concurrently
    POLICY_BLOCK        = "POLICY_BLOCK"          # operation blocked by governance rule


# ─────────────────────────────────────────
# SYNC PULL
# ─────────────────────────────────────────

class SyncPullRequest(BaseModel):
    """Request body for POST /sync/pull.

    last_sync_version: ISO-8601 timestamp cursor from previous pull.
                       Use None (or omit) for initial full sync.
    project_ids: Limit pull to specific projects the user has access to.
    """
    last_sync_version: str | None = Field(
        default=None,
        description="ISO-8601 cursor from previous pull. Omit for initial sync.",
        example="2024-05-30T12:00:00Z",
    )
    project_ids: list[int] | None = Field(
        default=None,
        description="Projects to sync. Defaults to all user-accessible projects.",
        example=[12, 15],
    )


class WorkOrderSummary(BaseModel):
    """Lightweight work order summary for sync bundle."""
    id: int
    org_id: int
    project_id: int
    title: str
    status: str
    completion_pct: float
    rework_flag: bool
    server_timestamp: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SyncBundle(BaseModel):
    """Payload returned by /sync/pull. Contains all data for offline work."""
    work_orders: list[WorkOrderSummary] = Field(default_factory=list)
    sync_version: str = Field(description="ISO-8601 server timestamp for next pull cursor")


class SyncPullResponse(BaseModel):
    """Response body for POST /sync/pull (OpenAPI SyncPullResponse)."""
    sync_version: str = Field(
        description="Use this as last_sync_version on next pull.",
        example="2024-05-30T14:30:00Z",
    )
    bundle: SyncBundle
    has_more: bool = Field(
        description="True if there are more records beyond SYNC_BATCH_SIZE.",
        example=False,
    )


# ─────────────────────────────────────────
# SYNC PUSH
# ─────────────────────────────────────────

class SyncOperation(BaseModel):
    """A single offline operation from a device (OpenAPI SyncOperation).

    Constitutional (ADR-002 CR-02 Idempotency):
    - operation_uuid MUST be globally unique per operation
    - Server tracks processed UUIDs for 72 hours
    - Duplicate UUID → 200 OK without re-processing (idempotent)
    """
    operation_uuid: str = Field(
        description="UUID for idempotency. Prevents duplicate processing.",
        example="6ba7b810-9dad-11d1-80b4-00c04fd430c8",
        min_length=36,
        max_length=36,
    )
    operation_type: SyncOperationType = Field(
        description="CREATE | UPDATE | DELETE",
        example="UPDATE",
    )
    entity_type: SyncEntityType = Field(
        description="Type of entity being modified.",
        example="WORK_ORDER",
    )
    entity_id: str = Field(
        description="Server-side entity identifier (e.g. work_order id as string).",
        example="123",
    )
    payload: dict[str, Any] = Field(
        description="Operation-specific payload. Fields depend on entity_type.",
        example={"completion_pct": 75.0, "status": "IN_PROGRESS"},
    )
    device_timestamp: datetime = Field(
        description="Device-local timestamp (advisory — server_timestamp is authoritative).",
        example="2024-05-30T10:05:00Z",
    )
    server_timestamp: datetime | None = Field(
        default=None,
        description="Last known server timestamp for this entity (for conflict detection).",
    )

    @field_validator("operation_uuid")
    @classmethod
    def validate_uuid_format(cls, v: str) -> str:
        import re
        pattern = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        if not re.match(pattern, v.lower()):
            raise ValueError(f"operation_uuid must be a valid UUID v4 format. Got: {v!r}")
        return v.lower()


class SyncPushRequest(BaseModel):
    """Request body for POST /sync/push (OpenAPI SyncPushRequest).

    Constitutional: max 1000 operations per batch (SYNC_BATCH_SIZE).
    """
    operations: list[SyncOperation] = Field(
        description="Batch of offline operations to push.",
        max_length=1000,
        min_length=1,
    )


class SyncConflict(BaseModel):
    """A single conflict returned in SyncPushResponse (OpenAPI SyncConflict)."""
    operation_uuid: str
    conflict_type: SyncConflictType
    server_value: dict[str, Any] = Field(description="Current server-side value")
    client_value: dict[str, Any] = Field(description="Value the client attempted to set")
    resolution_hint: str = Field(description="Human-readable resolution guidance")


class SyncPushResponse(BaseModel):
    """Response body for POST /sync/push (OpenAPI SyncPushResponse).

    processed:         List of operation_uuids that were applied successfully.
    conflicts:         List of operations that were rejected with conflict details.
    next_sync_version: Use as last_sync_version on next pull.
    """
    processed: list[str] = Field(
        description="operation_uuids of successfully processed operations.",
    )
    conflicts: list[SyncConflict] = Field(
        default_factory=list,
        description="Operations that could not be applied — returned for client resolution.",
    )
    next_sync_version: str = Field(
        description="ISO-8601 timestamp to use as last_sync_version on next pull.",
        example="2024-05-30T14:35:00Z",
    )
