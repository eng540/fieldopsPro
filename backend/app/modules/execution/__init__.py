"""FieldOps V4.0 — EXECUTION Module.

Event-backed execution is the single mutation path for BOQ progress.
Read-only event history, current state, and server-derived aggregation are
mounted here without duplicating mutation routes.
"""
from app.modules.execution.aggregation import router as aggregation_router
from app.modules.execution.event_query import router as event_query_router
from app.modules.execution.event_router import router
from app.modules.execution.router import router as legacy_router
from app.modules.execution.state_query import router as state_query_router

for _route in legacy_router.routes:
    if _route.path not in {"/progress", "/bulk-progress", "/events"}:
        router.routes.append(_route)

for _route in event_query_router.routes:
    router.routes.append(_route)

for _route in state_query_router.routes:
    router.routes.append(_route)

for _route in aggregation_router.routes:
    router.routes.append(_route)

__all__ = ["router"]
