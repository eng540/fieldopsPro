"""FieldOps V4.0 — SYNC Module (Sprint-2 CP-4).

Offline-First Sync Engine implementing ADR-002:
- POST /sync/pull  → SyncBundle download (cursor-based, project-scoped)
- POST /sync/push  → Exactly-Once batch processing + Conflict Resolution

Constitutional:
- Exactly-Once Sync (operation_uuid dedup via WorkOrderSyncLog)
- Monotonic Progress enforcement on push
- WORM audit on status changes
- Multi-tenant isolation (org_id from JWT)
"""
from app.modules.sync.router import router

__all__ = ["router"]
