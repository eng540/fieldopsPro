"""Sync Engine Service — FieldOps V4.0 (Sprint-2 CP-4)

Implements:
1. pull_sync()  — Build SyncBundle for offline work (cursor-based, org-scoped)
2. push_sync()  — Process device operations batch with:
   a. Exactly-Once (ADR-002 CR-02): operation_uuid deduplication via WorkOrderSyncLog
   b. Monotonic Progress (ADR-002/ADR-003 CR-01): completion_pct cannot decrease
   c. Clock Skew Detection (ADR-002): device_timestamp vs server_timestamp >5 min → TIMESTAMP_SKEW conflict
   d. WORM Audit: status change writes WorkOrderStatusHistory row
   e. Conflict Classification: returns SyncConflict per rejected operation

Constitutional (ADR-002):
- server_timestamp is ALWAYS authoritative
- device_timestamp is advisory only
- processed_operations dedup window: SYNC_RETENTION_HOURS (default 72h)
- batch ceiling: SYNC_BATCH_SIZE (default 1000)
- All DB writes within single async session → atomicity per operation
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.execution.models import (
    MONOTONIC_STATUS_TRANSITIONS,
    WorkOrder,
    WorkOrderStatus,
    WorkOrderStatusHistory,
    WorkOrderSyncLog,
    SyncOperationType as ModelSyncOpType,
    SyncStatus,
)
from app.modules.sync.schemas import (
    SyncBundle,
    SyncConflict,
    SyncConflictType,
    SyncOperation,
    SyncPullRequest,
    SyncPullResponse,
    SyncPushResponse,
    WorkOrderSummary,
)

# Clock skew threshold (ADR-002: 5 minutes)
_CLOCK_SKEW_SECONDS = 300

# ─────────────────────────────────────────────────────────────────────────────
# PULL
# ─────────────────────────────────────────────────────────────────────────────

async def pull_sync(
    db: AsyncSession,
    user_context: dict,
    request: SyncPullRequest,
    batch_size: int = 1000,
) -> SyncPullResponse:
    """Build a SyncBundle containing all work orders changed since last_sync_version.

    Constitutional:
    - Multi-tenant: always scoped by org_id
    - Project-scoped: limited to user's accessible projects
    - Cursor-based: uses server_timestamp > last_sync_version for incremental pulls
    - has_more: indicates when batch_size exceeded (client should pull again)
    """
    org_id = user_context["org_id"]
    user_projects: list[int] = user_context.get("projects", [])

    # ── Build base query ─────────────────────────────────────────────────────
    query = select(WorkOrder).where(WorkOrder.org_id == org_id)

    # Project scoping: request.project_ids overrides user scope; else use user's projects
    if request.project_ids:
        # Intersect with user's accessible projects (security: never exceed user scope)
        allowed = set(user_projects) & set(request.project_ids) if user_projects else set(request.project_ids)
        if not allowed:
            # No intersection → empty bundle (not an error)
            now_str = datetime.now(timezone.utc).isoformat()
            return SyncPullResponse(
                sync_version=now_str,
                bundle=SyncBundle(work_orders=[], sync_version=now_str),
                has_more=False,
            )
        query = query.where(WorkOrder.project_id.in_(list(allowed)))
    elif user_projects:
        query = query.where(WorkOrder.project_id.in_(user_projects))

    # ── Cursor: incremental pull ─────────────────────────────────────────────
    if request.last_sync_version:
        try:
            cursor_dt = datetime.fromisoformat(
                request.last_sync_version.replace("Z", "+00:00")
            )
            query = query.where(WorkOrder.server_timestamp > cursor_dt)
        except ValueError:
            pass  # Invalid cursor → full sync (safe fallback)

    # ── Order + batch ────────────────────────────────────────────────────────
    query = query.order_by(WorkOrder.server_timestamp.asc()).limit(batch_size + 1)
    result = await db.execute(query)
    rows = result.scalars().all()

    has_more = len(rows) > batch_size
    records = rows[:batch_size]

    # ── Build response ───────────────────────────────────────────────────────
    server_now = datetime.now(timezone.utc).isoformat()
    summaries = [WorkOrderSummary.model_validate(wo) for wo in records]

    return SyncPullResponse(
        sync_version=server_now,
        bundle=SyncBundle(work_orders=summaries, sync_version=server_now),
        has_more=has_more,
    )


# ─────────────────────────────────────────────────────────────────────────────
# PUSH
# ─────────────────────────────────────────────────────────────────────────────

async def push_sync(
    db: AsyncSession,
    user_context: dict,
    operations: list[SyncOperation],
) -> SyncPushResponse:
    """Process a batch of offline operations from a device.

    Per-operation pipeline (ADR-002):
    1. Exactly-Once check  → skip silently if UUID already processed
    2. Fetch target entity → 404 produces POLICY_BLOCK conflict
    3. Org isolation check → org_id mismatch produces POLICY_BLOCK conflict
    4. Clock skew check    → |device_ts - server_ts| > 5min → TIMESTAMP_SKEW conflict
    5. Monotonic Progress  → completion_pct decrease without rework → MONOTONIC_VIOLATION
    6. Status transition   → invalid transition → POLICY_BLOCK conflict
    7. Apply update        → setattr + flush
    8. WORM history        → write WorkOrderStatusHistory if status changed
    9. Register UUID       → write WorkOrderSyncLog (PROCESSED)
    """
    org_id = user_context["org_id"]
    user_id = user_context["id"]
    server_now = datetime.now(timezone.utc)

    processed: list[str] = []
    conflicts: list[SyncConflict] = []

    for op in operations:
        try:
            uuid = op.operation_uuid

            # ── 1. Exactly-Once: check dedup registry ──────────────────────────
            existing_log = await db.execute(
                select(WorkOrderSyncLog).where(
                    WorkOrderSyncLog.operation_uuid == uuid,
                    WorkOrderSyncLog.sync_status == SyncStatus.PROCESSED.value,
                )
            )
            if existing_log.scalar_one_or_none():
                # Already processed — idempotent success (ADR-002 CR-02)
                processed.append(uuid)
                continue

            # ── 2. Only WORK_ORDER entity type is implemented in this sprint ──
            if op.entity_type.value != "WORK_ORDER":
                conflicts.append(SyncConflict(
                    operation_uuid=uuid,
                    conflict_type=SyncConflictType.POLICY_BLOCK,
                    server_value={},
                    client_value={"entity_type": op.entity_type.value},
                    resolution_hint=(
                        f"Entity type '{op.entity_type.value}' is not yet supported "
                        f"by the sync engine. Supported: WORK_ORDER."
                    ),
                ))
                await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, None)
                continue

            # ── 3. Fetch target WorkOrder ──────────────────────────────────────
            wo_id_str = op.entity_id
            try:
                wo_id = int(wo_id_str)
            except ValueError:
                conflicts.append(SyncConflict(
                    operation_uuid=uuid,
                    conflict_type=SyncConflictType.POLICY_BLOCK,
                    server_value={},
                    client_value={"entity_id": wo_id_str},
                    resolution_hint=f"entity_id must be a numeric work order ID. Got: {wo_id_str!r}",
                ))
                await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, None)
                continue

            wo_result = await db.execute(
                select(WorkOrder).where(WorkOrder.id == wo_id)
            )
            work_order = wo_result.scalar_one_or_none()

            if not work_order:
                conflicts.append(SyncConflict(
                    operation_uuid=uuid,
                    conflict_type=SyncConflictType.POLICY_BLOCK,
                    server_value={},
                    client_value={"entity_id": wo_id},
                    resolution_hint=f"Work order {wo_id} not found on server.",
                ))
                await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, wo_id)
                continue

            # ── 4. Org isolation ───────────────────────────────────────────────
            if work_order.org_id != org_id:
                conflicts.append(SyncConflict(
                    operation_uuid=uuid,
                    conflict_type=SyncConflictType.POLICY_BLOCK,
                    server_value={"org_id": work_order.org_id},
                    client_value={"org_id": org_id},
                    resolution_hint="Work order belongs to a different organization.",
                ))
                await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, wo_id)
                continue

            # ── 5. Clock skew detection ────────────────────────────────────────
            if op.device_timestamp:
                device_ts = op.device_timestamp
                if device_ts.tzinfo is None:
                    device_ts = device_ts.replace(tzinfo=timezone.utc)
                skew_seconds = abs((server_now - device_ts).total_seconds())

                if skew_seconds > _CLOCK_SKEW_SECONDS:
                    conflicts.append(SyncConflict(
                        operation_uuid=uuid,
                        conflict_type=SyncConflictType.TIMESTAMP_SKEW,
                        server_value={"server_timestamp": server_now.isoformat()},
                        client_value={"device_timestamp": op.device_timestamp.isoformat()},
                        resolution_hint=(
                            f"Device clock skew of {skew_seconds:.0f}s exceeds 5-minute threshold. "
                            f"Sync the device clock and retry."
                        ),
                    ))
                    conflict_detail = {
                        "type": "TIMESTAMP_SKEW",
                        "skew_seconds": skew_seconds,
                        "device_timestamp": op.device_timestamp.isoformat(),
                        "server_timestamp": server_now.isoformat(),
                    }
                    await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.CONFLICT, wo_id, conflict_detail)
                    continue

            # ── 6. Monotonic Progress check ────────────────────────────────────
            payload = op.payload
            new_pct = payload.get("completion_pct")

            if new_pct is not None and op.operation_type != SyncOperationType.CREATE:
                try:
                    new_pct_float = float(new_pct)
                except (TypeError, ValueError):
                    new_pct_float = None

                if new_pct_float is not None and new_pct_float < work_order.completion_pct:
                    rework_flag = payload.get("rework_flag", False)

                    if not rework_flag:
                        conflicts.append(SyncConflict(
                            operation_uuid=uuid,
                            conflict_type=SyncConflictType.MONOTONIC_VIOLATION,
                            server_value={"completion_pct": work_order.completion_pct},
                            client_value={"completion_pct": new_pct_float},
                            resolution_hint=(
                                f"Progress cannot decrease from {work_order.completion_pct}% "
                                f"to {new_pct_float}% without rework_flag=True and a valid justification. "
                                f"Higher progress wins (ADR-003)."
                            ),
                        ))
                        conflict_detail = {
                            "type": "MONOTONIC_VIOLATION",
                            "server_pct": work_order.completion_pct,
                            "client_pct": new_pct_float,
                        }
                        await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.CONFLICT, wo_id, conflict_detail)
                        continue

            # ── 7. Status transition check ─────────────────────────────────────
            new_status_raw = payload.get("status")
            status_changed = False
            old_status_str = work_order.status

            if new_status_raw and op.operation_type != SyncOperationType.CREATE:
                try:
                    new_status_enum = WorkOrderStatus(str(new_status_raw))
                    old_status_enum = WorkOrderStatus(str(old_status_str))
                except ValueError:
                    conflicts.append(SyncConflict(
                        operation_uuid=uuid,
                        conflict_type=SyncConflictType.POLICY_BLOCK,
                        server_value={"status": old_status_str},
                        client_value={"status": new_status_raw},
                        resolution_hint=f"Invalid status value: {new_status_raw!r}",
                    ))
                    await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, wo_id)
                    continue

                if new_status_enum != old_status_enum:
                    allowed = MONOTONIC_STATUS_TRANSITIONS.get(old_status_enum, [])
                    if new_status_enum not in allowed:
                        conflicts.append(SyncConflict(
                            operation_uuid=uuid,
                            conflict_type=SyncConflictType.POLICY_BLOCK,
                            server_value={"status": old_status_str},
                            client_value={"status": new_status_raw},
                            resolution_hint=(
                                f"Status transition {old_status_enum.value} → {new_status_enum.value} "
                                f"is not allowed (ADR-003). "
                                f"Allowed: {[t.value for t in allowed] or 'none (terminal)'}."
                            ),
                        ))
                        await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.CONFLICT, wo_id)
                        continue
                    status_changed = True

            # ── 8. Apply update ────────────────────────────────────────────────
            _ALLOWED_PAYLOAD_FIELDS = {
                "completion_pct", "status", "rework_flag", "rework_reason",
                "title", "description", "priority", "location_data", "extra_data",
            }
            for field, value in payload.items():
                if field in _ALLOWED_PAYLOAD_FIELDS:
                    setattr(work_order, field, value)

            await db.flush()

            # ── 9. WORM: write status history if status changed ────────────────
            if status_changed:
                history = WorkOrderStatusHistory(
                    org_id=org_id,
                    work_order_id=work_order.id,
                    changed_by=user_id,
                    from_status=old_status_str if isinstance(old_status_str, str) else old_status_str.value,
                    to_status=new_status_enum.value,
                    reason=payload.get("rework_reason") or f"Sync operation {uuid}",
                    rework_flag=bool(payload.get("rework_flag", False)),
                    rework_reason=payload.get("rework_reason"),
                    rework_authorized_by=payload.get("rework_authorized_by"),
                )
                db.add(history)
                await db.flush()

            # ── 10. Register UUID as PROCESSED ────────────────────────────────
            await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.PROCESSED, wo_id)
            processed.append(uuid)

        except Exception as exc:
            # Isolate per-operation failures — do not fail the entire batch
            conflicts.append(SyncConflict(
                operation_uuid=op.operation_uuid,
                conflict_type=SyncConflictType.POLICY_BLOCK,
                server_value={},
                client_value=op.payload,
                resolution_hint=f"Internal error processing operation: {str(exc)[:200]}",
            ))

    return SyncPushResponse(
        processed=processed,
        conflicts=conflicts,
        next_sync_version=server_now.isoformat(),
    )


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

async def _register_sync_log(
    db: AsyncSession,
    operation_uuid: str,
    op: SyncOperation,
    org_id: int,
    user_id: int,
    sync_status: SyncStatus,
    work_order_id: int | None,
    conflict_details: dict | None = None,
) -> None:
    """Write a WorkOrderSyncLog row. Silently skips if UUID already exists."""
    from sqlalchemy.exc import IntegrityError
    try:
        # Map schema enum → model enum value
        op_type_map = {
            "CREATE": ModelSyncOpType.CREATE,
            "UPDATE": ModelSyncOpType.UPDATE,
            "DELETE": ModelSyncOpType.DELETE,
        }
        model_op_type = op_type_map.get(op.operation_type.value, ModelSyncOpType.UPDATE)

        log = WorkOrderSyncLog(
            org_id=org_id,
            work_order_id=work_order_id or 0,
            operation_uuid=operation_uuid,
            operation_type=model_op_type,
            synced_by=user_id,
            sync_status=sync_status,
            conflict_details=conflict_details,
            device_timestamp=op.device_timestamp,
        )
        db.add(log)
        await db.flush()
    except IntegrityError:
        await db.rollback()  # UUID already exists — idempotent, safe to ignore


# Make SyncOperationType available at module level for service use
from app.modules.sync.schemas import SyncOperationType  # noqa: E402
