"""FieldOps V4.0 — EXECUTION Module.

Epic 1 uses the event-backed execution router as the single mutation entrypoint
for BOQ progress. Legacy work-order CRUD remains in router.py, while
/progress, /bulk-progress and /events mutations are owned by event_router.py.
Read-only event history is exposed by event_query.py.
"""
from app.modules.execution.event_query import router as event_query_router
from app.modules.execution.event_router import router
from app.modules.execution.router import router as legacy_router

# Work-order CRUD is still exposed from the legacy router. Event mutation endpoints
# are deliberately not copied from it, preventing duplicate route ownership.
for _route in legacy_router.routes:
    if _route.path not in {"/progress", "/bulk-progress", "/events"}:
        router.routes.append(_route)

for _route in event_query_router.routes:
    router.routes.append(_route)

__all__ = ["router"]
