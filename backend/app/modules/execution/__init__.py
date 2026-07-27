"""FieldOps V4.0 — EXECUTION Module.

This module is self-contained. No direct DB access to other modules.
Handles work order CRUD, assignment, and status management.

Constitutional:
- Multi-tenant isolation via org_id
- Monotonic Progress (ADR-003)
- WORM audit trail for status changes
- Exactly-Once Sync (ADR-002)
"""
from fastapi import APIRouter

from app.modules.execution.router import router

# Re-export router for main.py assembly
__all__ = ["router"]
