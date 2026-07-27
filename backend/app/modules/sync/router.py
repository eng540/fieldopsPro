"""Sync Engine Router — FieldOps V4.0 (Sprint-2 CP-4)

Endpoints (2):
1. POST /sync/pull  — Download server state for offline work
2. POST /sync/push  — Upload offline operations batch to server

Constitutional (ADR-002):
- All endpoints require valid JWT (get_current_user)
- org_id always injected from JWT — never trusted from client
- Pull: cursor-based incremental sync, project-scoped, batch-limited
- Push: Exactly-Once (operation_uuid dedup) + Monotonic Progress + WORM audit
- Multi-Status 207: some operations failed, others succeeded
- 409: all operations blocked by governance rule
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.iam.dependencies import get_current_user
from app.modules.sync.schemas import SyncPullRequest, SyncPullResponse, SyncPushRequest, SyncPushResponse
from app.modules.sync.service import pull_sync, push_sync

router = APIRouter()


# ═══════════════════════════════════════
# ENDPOINT 1: PULL
# ═══════════════════════════════════════
@router.post(
    "/pull",
    response_model=SyncPullResponse,
    summary="Pull server state for offline work",
    description=(
        "Downloads all data needed for offline field work. "
        "Respects user's project_scope and role_scope. "
        "Use last_sync_version cursor for incremental pulls (ADR-002)."
    ),
    responses={
        200: {"description": "Sync bundle returned"},
        403: {"description": "Access denied to requested projects"},
    },
)
async def sync_pull(
    request: SyncPullRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> SyncPullResponse:
    return await pull_sync(db=db, user_context=current_user, request=request)


# ═══════════════════════════════════════
# ENDPOINT 2: PUSH
# ═══════════════════════════════════════
@router.post(
    "/push",
    response_model=SyncPushResponse,
    summary="Push offline operations to server",
    description=(
        "Uploads queued operations from device to server. "
        "Implements Exactly-Once processing via operation_uuid (ADR-002 CR-02). "
        "Returns 200 if all processed, 207 if partial, 409 if all blocked."
    ),
    responses={
        200: {"description": "All operations processed successfully"},
        207: {"description": "Multi-Status — some operations failed"},
        409: {"description": "Governance conflict — all operations blocked"},
        422: {"description": "Validation error (malformed request)"},
    },
)
async def sync_push(
    request: SyncPushRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> SyncPushResponse:
    if not request.operations:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="operations list cannot be empty",
        )

    result = await push_sync(
        db=db,
        user_context=current_user,
        operations=request.operations,
    )

    # Determine HTTP status per OpenAPI spec:
    # 200: all processed
    # 207: partial (some conflicts)
    # 409: all blocked (zero processed)
    total = len(request.operations)
    n_processed = len(result.processed)
    n_conflicts = len(result.conflicts)

    if n_conflicts == 0:
        # 200: all good
        return result
    elif n_processed == 0:
        # 409: all blocked
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=result.model_dump(),
        )
    else:
        # 207: partial
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=207,
            content=result.model_dump(),
        )
