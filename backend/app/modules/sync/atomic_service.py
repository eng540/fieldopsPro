"""Atomic offline-sync orchestration — FieldOps V4.

This module is the transaction boundary for offline operations.
The legacy entity handlers remain in ``sync.service``; this layer guarantees
that one rejected operation cannot roll back previously accepted operations.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.execution.models import SyncStatus, WorkOrderSyncLog
from app.modules.sync.schemas import (
    SyncConflict,
    SyncConflictType,
    SyncOperation,
    SyncPushResponse,
)
from app.modules.sync.service import (
    _CLOCK_SKEW_SECONDS,
    _process_remark,
    _process_unit_progress,
    _process_work_order,
    _register_sync_log,
)


async def push_sync_atomic(
    db: AsyncSession,
    user_context: dict,
    operations: list[SyncOperation],
) -> SyncPushResponse:
    """Process an offline batch with an independent SAVEPOINT per operation.

    The outer request transaction remains usable after any individual failure.
    Duplicate detection is tenant-scoped and only a previously PROCESSED UUID
    is treated as idempotent success.
    """
    org_id = user_context["org_id"]
    user_id = user_context["id"]
    server_now = datetime.now(timezone.utc)

    processed: list[str] = []
    conflicts: list[SyncConflict] = []

    for op in operations:
        uuid = op.operation_uuid

        try:
            # Tenant-scoped exactly-once check before opening the savepoint.
            existing = await db.execute(
                select(WorkOrderSyncLog).where(
                    WorkOrderSyncLog.org_id == org_id,
                    WorkOrderSyncLog.operation_uuid == uuid,
                    WorkOrderSyncLog.sync_status == SyncStatus.PROCESSED.value,
                )
            )
            if existing.scalar_one_or_none():
                processed.append(uuid)
                continue

            async with db.begin_nested():
                # Clock validation belongs inside the operation boundary so a
                # conflict log is committed without affecting other operations.
                if op.device_timestamp:
                    device_ts = op.device_timestamp
                    if device_ts.tzinfo is None:
                        device_ts = device_ts.replace(tzinfo=timezone.utc)
                    skew_seconds = abs((server_now - device_ts).total_seconds())
                    if skew_seconds > _CLOCK_SKEW_SECONDS:
                        conflict = SyncConflict(
                            operation_uuid=uuid,
                            conflict_type=SyncConflictType.TIMESTAMP_SKEW,
                            server_value={"server_timestamp": server_now.isoformat()},
                            client_value={"device_timestamp": op.device_timestamp.isoformat()},
                            resolution_hint=(
                                f"Device clock skew of {skew_seconds:.0f}s exceeds 5-minute threshold. "
                                "Sync the device clock and retry."
                            ),
                        )
                        await _register_sync_log(
                            db, uuid, op, org_id, user_id, SyncStatus.CONFLICT, 0,
                            {"type": "TIMESTAMP_SKEW", "skew_seconds": skew_seconds},
                        )
                        conflicts.append(conflict)
                        continue

                entity_type = op.entity_type.value
                if entity_type == "WORK_ORDER":
                    result = await _process_work_order(
                        db, op, org_id, user_id, server_now
                    )
                elif entity_type == "UNIT_PROGRESS":
                    result = await _process_unit_progress(
                        db, op, org_id, user_id, server_now
                    )
                elif entity_type == "REMARK":
                    result = await _process_remark(
                        db, op, org_id, user_id, server_now
                    )
                else:
                    conflict = SyncConflict(
                        operation_uuid=uuid,
                        conflict_type=SyncConflictType.POLICY_BLOCK,
                        server_value={},
                        client_value={"entity_type": entity_type},
                        resolution_hint=(
                            f"Entity type {entity_type!r} is not supported by the offline sync engine."
                        ),
                    )
                    await _register_sync_log(
                        db, uuid, op, org_id, user_id, SyncStatus.FAILED, 0,
                        {"type": "UNSUPPORTED_ENTITY", "entity_type": entity_type},
                    )
                    conflicts.append(conflict)
                    continue

                if result["success"]:
                    processed.append(uuid)
                else:
                    conflicts.extend(result["conflicts"])

        except Exception as exc:
            # SAVEPOINT rollback happens automatically here. The outer
            # transaction remains available for the next operation.
            conflicts.append(
                SyncConflict(
                    operation_uuid=uuid,
                    conflict_type=SyncConflictType.POLICY_BLOCK,
                    server_value={},
                    client_value=op.payload,
                    resolution_hint=f"Operation rolled back safely: {str(exc)[:200]}",
                )
            )

    return SyncPushResponse(
        processed=processed,
        conflicts=conflicts,
        next_sync_version=server_now.isoformat(),
    )
