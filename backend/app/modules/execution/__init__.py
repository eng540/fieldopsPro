"""FieldOps V4.0 — EXECUTION Module.

Epic 1 adds an append-only execution event pipeline while preserving the
legacy endpoint paths through event-backed compatibility handlers.
"""
from app.modules.execution.router import router
from app.modules.execution.event_router import router as event_router

# Put Epic 1 routes first so /progress and /bulk-progress cannot bypass the
# event pipeline through the legacy handlers still present in router.py.
for _route in reversed(event_router.routes):
    router.routes.insert(0, _route)

__all__ = ["router"]
