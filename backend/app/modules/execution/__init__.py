"""FieldOps V4.0 — EXECUTION Module.

Epic 1 adds an append-only execution event pipeline while retaining the
legacy execution router for backward compatibility.
"""
from fastapi import APIRouter

from app.modules.execution.router import router
from app.modules.execution.event_router import router as event_router

# Mount Epic 1 endpoints into the existing execution namespace.
router.include_router(event_router)

__all__ = ["router"]
