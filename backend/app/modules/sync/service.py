"""Sync Engine Service — FieldOps V4.0 (Sprint-5)

Implements:
1. pull_sync()  — Build SyncBundle for offline work (cursor-based, org-scoped)
2. push_sync()  — Process device operations batch with:
   a. Exactly-Once (ADR-002 CR-02): operation_uuid deduplication via WorkOrderSyncLog
   b. Monotonic Progress (ADR-002/ADR-003 CR-01): completion_pct cannot decrease
   c. Clock Skew Detection (ADR-002): device_timestamp vs server_timestamp >5 min → TIMESTAMP_SKEW conflict
   d. WORM Audit: status change writes WorkOrderStatusHistory row
   e. Conflict Classification: returns SyncConflict per rejected operation
   f. Multi-Entity Support: WORK_ORDER, UNIT_PROGRESS, REMARK (Phase 3)

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
    UnitBoQProgress,
    SyncOperationType as ModelSyncOpType,
    SyncStatus,
)
from app.modules.quality.models import Remark, RemarkStatus
from app.modules.projects.models import UnitBoQAssignment
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
# PUSH — Multi-Entity Support (WORK_ORDER, UNIT_PROGRESS, REMARK)
# ─────────────────────────────────────────────────────────────────────────────

async def push_sync(
    db: AsyncSession,
    user_context: dict,
    operations: list[SyncOperation],
) -> SyncPushResponse:
    """Process a batch of offline operations from a device.

    Per-operation pipeline (ADR-002):
    1. Exactly-Once check  → skip silently if UUID already processed
    2. Route by entity_type → WORK_ORDER | UNIT_PROGRESS | REMARK
    3. Fetch target entity → 404 produces POLICY_BLOCK conflict
    4. Org isolation check → org_id mismatch produces POLICY_BLOCK conflict
    5. Clock skew check    → |device_ts - server_ts| > 5min → TIMESTAMP_SKEW conflict
    6. Entity-specific validation:
       - WORK_ORDER: Monotonic Progress + Status transition
       - UNIT_PROGRESS: Monotonic Progress on completion_pct
       - REMARK: Append-only (UUID idempotency), severity auto-hold
    7. Apply update → setattr + flush
    8. WORM history → write status history if status changed
    9. Register UUID → write WorkOrderSyncLog (PROCESSED)
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

            # ── 2. Clock skew detection (applies to ALL entity types) ──────────
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
                    await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.CONFLICT, 0, {
                        "type": "TIMESTAMP_SKEW",
                        "skew_seconds": skew_seconds,
                    })
                    continue

            # ── 3. Route by entity_type ────────────────────────────────────────
            entity_type = op.entity_type.value

            if entity_type == "WORK_ORDER":
                result = await _process_work_order(db, op, org_id, user_id, server_now)
            elif entity_type == "UNIT_PROGRESS":
                result = await _process_unit_progress(db, op, org_id, user_id, server_now)
            elif entity_type == "REMARK":
                result = await _process_remark(db, op, org_id, user_id, server_now)
            elif entity_type == "DAILY_LOG":
                # DAILY_LOG not yet implemented — POLICY_BLOCK
                conflicts.append(SyncConflict(
                    operation_uuid=uuid,
                    conflict_type=SyncConflictType.POLICY_BLOCK,
                    server_value={},
                    client_value={"entity_type": "DAILY_LOG"},
                    resolution_hint="DAILY_LOG entity type is not yet supported by the sync engine.",
                ))
                await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, 0)
                continue
            else:
                conflicts.append(SyncConflict(
                    operation_uuid=uuid,
                    conflict_type=SyncConflictType.POLICY_BLOCK,
                    server_value={},
                    client_value={"entity_type": entity_type},
                    resolution_hint=f"Unknown entity type: {entity_type}",
                ))
                await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, 0)
                continue

            # Process result from entity handler
            if result["success"]:
                processed.append(uuid)
            else:
                conflicts.extend(result["conflicts"])

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
# WORK_ORDER Handler
# ─────────────────────────────────────────────────────────────────────────────

async def _process_work_order(
    db: AsyncSession,
    op: SyncOperation,
    org_id: int,
    user_id: int,
    server_now: datetime,
) -> dict:
    """Process a WORK_ORDER sync operation.

    Implements Monotonic Progress (ADR-003) and status transition checks.
    """
    uuid = op.operation_uuid
    payload = op.payload
    conflicts: list[SyncConflict] = []

    # Fetch target WorkOrder
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
        await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, 0)
        return {"success": False, "conflicts": conflicts}

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
        return {"success": False, "conflicts": conflicts}

    # Org isolation
    if work_order.org_id != org_id:
        conflicts.append(SyncConflict(
            operation_uuid=uuid,
            conflict_type=SyncConflictType.POLICY_BLOCK,
            server_value={"org_id": work_order.org_id},
            client_value={"org_id": org_id},
            resolution_hint="Work order belongs to a different organization.",
        ))
        await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, wo_id)
        return {"success": False, "conflicts": conflicts}

    # Monotonic Progress check
    new_pct = payload.get("completion_pct")
    if new_pct is not None and op.operation_type.value != "CREATE":
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
                        f"to {new_pct_float}% without rework_flag=True. Higher progress wins (ADR-003)."
                    ),
                ))
                await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.CONFLICT, wo_id, {
                    "type": "MONOTONIC_VIOLATION",
                    "server_pct": work_order.completion_pct,
                    "client_pct": new_pct_float,
                })
                return {"success": False, "conflicts": conflicts}

    # Status transition check
    new_status_raw = payload.get("status")
    status_changed = False
    old_status_str = work_order.status

    if new_status_raw and op.operation_type.value != "CREATE":
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
            return {"success": False, "conflicts": conflicts}

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
                return {"success": False, "conflicts": conflicts}
            status_changed = True

    # Apply update
    _ALLOWED_PAYLOAD_FIELDS = {
        "completion_pct", "status", "rework_flag", "rework_reason",
        "title", "description", "priority", "location_data", "extra_data",
    }
    for field, value in payload.items():
        if field in _ALLOWED_PAYLOAD_FIELDS:
            setattr(work_order, field, value)

    await db.flush()

    # WORM: write status history if status changed
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

    # Register UUID as PROCESSED
    await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.PROCESSED, wo_id)
    return {"success": True, "conflicts": []}


# ─────────────────────────────────────────────────────────────────────────────
# UNIT_PROGRESS Handler
# ─────────────────────────────────────────────────────────────────────────────

async def _process_unit_progress(
    db: AsyncSession,
    op: SyncOperation,
    org_id: int,
    user_id: int,
    server_now: datetime,
) -> dict:
    """Process a UNIT_PROGRESS sync operation.

    Updates UnitBoQProgress rows with Monotonic Progress enforcement.
    Entity_id format: "{unit_id}:{boq_item_id}" or just the progress record id.
    """
    uuid = op.operation_uuid
    payload = op.payload
    conflicts: list[SyncConflict] = []

    # Parse entity_id — try numeric first, then unit_id:boq_item_id format
    entity_id = op.entity_id
    progress_id = None
    unit_id = None
    boq_item_id = None

    try:
        progress_id = int(entity_id)
    except ValueError:
        # Try unit_id:boq_item_id format
        if ":" in entity_id:
            parts = entity_id.split(":", 1)
            try:
                unit_id = int(parts[0])
                boq_item_id = int(parts[1])
            except ValueError:
                conflicts.append(SyncConflict(
                    operation_uuid=uuid,
                    conflict_type=SyncConflictType.POLICY_BLOCK,
                    server_value={},
                    client_value={"entity_id": entity_id},
                    resolution_hint=f"entity_id must be a numeric progress ID or 'unit_id:boq_item_id' format. Got: {entity_id!r}",
                ))
                await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, 0)
                return {"success": False, "conflicts": conflicts}
        else:
            conflicts.append(SyncConflict(
                operation_uuid=uuid,
                conflict_type=SyncConflictType.POLICY_BLOCK,
                server_value={},
                client_value={"entity_id": entity_id},
                resolution_hint=f"Invalid entity_id format: {entity_id!r}",
            ))
            await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, 0)
            return {"success": False, "conflicts": conflicts}

    # Fetch UnitBoQProgress
    if progress_id:
        query = select(UnitBoQProgress).where(UnitBoQProgress.id == progress_id)
    else:
        query = select(UnitBoQProgress).where(
            UnitBoQProgress.unit_id == unit_id,
            UnitBoQProgress.boq_item_id == boq_item_id,
        )

    result = await db.execute(query)
    progress = result.scalar_one_or_none()

    if not progress:
        # If CREATE operation, create a new progress record only after
        # configuration proves that the BOQ item applies to the unit.
        if op.operation_type.value == "CREATE":
            resolved_unit_id = unit_id or payload.get("unit_id", 0)
            resolved_boq_item_id = boq_item_id or payload.get("boq_item_id", 0)
            assignment_result = await db.execute(select(UnitBoQAssignment.id).where(
                UnitBoQAssignment.org_id == org_id,
                UnitBoQAssignment.unit_id == resolved_unit_id,
                UnitBoQAssignment.boq_item_id == resolved_boq_item_id,
                UnitBoQAssignment.is_active.is_(True),
            ))
            if assignment_result.scalar_one_or_none() is None:
                conflicts.append(SyncConflict(
                    operation_uuid=uuid,
                    conflict_type=SyncConflictType.POLICY_BLOCK,
                    server_value={},
                    client_value={"unit_id": resolved_unit_id, "boq_item_id": resolved_boq_item_id},
                    resolution_hint="Apply the BOQ item to the unit before syncing execution progress.",
                ))
                await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, 0)
                return {"success": False, "conflicts": conflicts}
            new_progress = UnitBoQProgress(
                org_id=org_id,
                unit_id=resolved_unit_id,
                boq_item_id=resolved_boq_item_id,
                completion_pct=payload.get("completion_pct", 0.0),
                status=payload.get("status", "NOT_STARTED"),
                measured_quantity=payload.get("measured_quantity"),
                rework_flag=payload.get("rework_flag", False),
                rework_reason=payload.get("rework_reason"),
                updated_by=user_id,
            )
            db.add(new_progress)
            await db.flush()
            await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.PROCESSED, 0)
            return {"success": True, "conflicts": []}

        conflicts.append(SyncConflict(
            operation_uuid=uuid,
            conflict_type=SyncConflictType.POLICY_BLOCK,
            server_value={},
            client_value={"entity_id": entity_id},
            resolution_hint=f"UnitBoQProgress {entity_id} not found on server.",
        ))
        await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, 0)
        return {"success": False, "conflicts": conflicts}

    # Org isolation
    if progress.org_id != org_id:
        conflicts.append(SyncConflict(
            operation_uuid=uuid,
            conflict_type=SyncConflictType.POLICY_BLOCK,
            server_value={"org_id": progress.org_id},
            client_value={"org_id": org_id},
            resolution_hint="Progress record belongs to a different organization.",
        ))
        await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.FAILED, 0)
        return {"success": False, "conflicts": conflicts}

    # Monotonic Progress check (ADR-003)
    new_pct = payload.get("completion_pct")
    if new_pct is not None:
        try:
            new_pct_float = float(new_pct)
        except (TypeError, ValueError):
            new_pct_float = None

        if new_pct_float is not None and new_pct_float < progress.completion_pct:
            rework_flag = payload.get("rework_flag", False)
            if not rework_flag:
                conflicts.append(SyncConflict(
                    operation_uuid=uuid,
                    conflict_type=SyncConflictType.MONOTONIC_VIOLATION,
                    server_value={"completion_pct": progress.completion_pct},
                    client_value={"completion_pct": new_pct_float},
                    resolution_hint=(
                        f"BOQ progress cannot decrease from {progress.completion_pct}% "
                        f"to {new_pct_float}% without rework_flag=True (ADR-003)."
                    ),
                ))
                await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.CONFLICT, 0, {
                    "type": "MONOTONIC_VIOLATION",
                    "server_pct": progress.completion_pct,
                    "client_pct": new_pct_float,
                })
                return {"success": False, "conflicts": conflicts}

    # Apply update
    _ALLOWED_FIELDS = {
        "completion_pct", "status", "measured_quantity",
        "rework_flag", "rework_reason", "rework_authorized_by",
    }
    for field, value in payload.items():
        if field in _ALLOWED_FIELDS:
            setattr(progress, field, value)

    progress.updated_by = user_id
    await db.flush()

    # Register UUID as PROCESSED
    await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.PROCESSED, 0)
    return {"success": True, "conflicts": []}


# ─────────────────────────────────────────────────────────────────────────────
# REMARK Handler
# ─────────────────────────────────────────────────────────────────────────────

async def _process_remark(
    db: AsyncSession,
    op: SyncOperation,
    org_id: int,
    user_id: int,
    server_now: datetime,
) -> dict:
    """Process a REMARK sync operation.

    Remarks are append-only with UUID-based idempotency.
    If a remark with the same UUID already exists, it's treated as idempotent success.
    CRITICAL/MAJOR severity auto-triggers governance HOLD.
    """
    uuid = op.operation_uuid
    payload = op.payload
    conflicts: list[SyncConflict] = []

    # For REMARK, entity_id is the UUID of the remark itself
    remark_id = op.entity_id

    # Check if remark already exists (idempotent — append-only)
    existing = await db.execute(
        select(Remark).where(Remark.id == remark_id)
    )
    if existing.scalar_one_or_none():
        # Already exists — idempotent success (append-only)
        await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.PROCESSED, 0)
        return {"success": True, "conflicts": []}

    # Create new remark
    severity = payload.get("severity", "MINOR")
    new_remark = Remark(
        id=remark_id,
        org_id=org_id,
        unit_id=payload.get("unit_id", 0),
        work_order_id=payload.get("work_order_id"),
        template_id=payload.get("template_id"),
        custom_issue=payload.get("custom_issue"),
        severity=severity,
        status=payload.get("status", RemarkStatus.OPEN.value),
        photos=payload.get("photos"),
        gps_tag=payload.get("gps_tag"),
        created_by=user_id,
    )

    db.add(new_remark)
    await db.flush()

    # Auto-trigger governance HOLD for CRITICAL/MAJOR severity
    if severity in ("CRITICAL", "MAJOR"):
        try:
            from app.modules.governance.models import GovernanceDecision
            decision = GovernanceDecision(
                org_id=org_id,
                unit_id=payload.get("unit_id", 0),
                boq_item_id=None,
                remark_id=remark_id,
                decision="HOLD",
                payment_pct=0.0,
                flag=f"Auto-Hold: {severity} defect detected via sync",
                matched_rule="AUTO_HOLD_ON_MAJOR_DEFECT",
                reason=f"QC remark severity={severity} triggered automatic payment hold via sync.",
                policy_version=1,
                explainability={
                    "rule": "AUTO_HOLD_ON_MAJOR_DEFECT",
                    "severity": severity,
                    "auto_hold": True,
                    "source": "sync_engine",
                },
                triggered_by=user_id,
                is_overridden=False,
            )
            db.add(decision)
            await db.flush()
        except Exception:
            pass  # governance table may not exist yet — non-fatal

    # Register UUID as PROCESSED
    await _register_sync_log(db, uuid, op, org_id, user_id, SyncStatus.PROCESSED, 0)
    return {"success": True, "conflicts": []}


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
