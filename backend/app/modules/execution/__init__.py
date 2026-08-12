"""FieldOps V4.0 — EXECUTION module.

Canonical mutation architecture:
- ``router.py`` owns the public execution mutation API.
- ``service.py`` owns the atomic event/state transaction pipeline.
- ``event_query.py``, ``state_query.py`` and ``aggregation.py`` are read-only.

The older ``event_router.py`` / ``event_service.py`` implementation is kept in
place for source compatibility, but is deliberately not mounted. This prevents
multiple mutation engines from serving the same API contract.
"""

from app.modules.execution.aggregation import router as aggregation_router
from app.modules.execution.event_query import router as event_query_router
from app.modules.execution.router import router
from app.modules.execution.state_query import router as state_query_router

# Read-only capabilities are composed onto the canonical mutation router.
for _route in event_query_router.routes:
    router.routes.append(_route)

for _route in state_query_router.routes:
    router.routes.append(_route)

for _route in aggregation_router.routes:
    router.routes.append(_route)

__all__ = ["router"]
