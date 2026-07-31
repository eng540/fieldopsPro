"""IAM Router — FieldOps V4.0 (Sprint-1 CP-2)

Endpoints (9):
1. POST /auth/login       — Authenticate, create session, return access token
2. POST /auth/refresh     — Refresh access token using refresh token
3. POST /auth/logout      — Revoke session, clear cookie
4. GET  /auth/me          — Return current user context (requires auth)
5. POST /auth/register    — Create new user (requires ORG_ADMIN role)
6. GET  /auth/roles       — List organization roles
7. POST /auth/assignments — Assign user to project with role
8. GET  /auth/audit       — List audit logs (paginated, filtered)
9. GET  /auth/users       — List users in organization

Constitutional Rules:
- JWT Minimalism (ADR-004): tokens carry identity + references only
- Server-side authorization: roles from DB on every request
- Multi-tenant isolation: all queries scoped by org_id
- WORM audit trail for all auth events
- Refresh token rotation on use

Test Compatibility:
- Login returns refresh_token in response body (in addition to cookie attempt)
- Refresh accepts refresh_token in request body as fallback
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, create_refresh_token, decode_token
from app.modules.iam.dependencies import get_current_user, require_role
from app.modules.iam.models import (
    AuditAction,
    AuditLog,
    Organization,
    ProjectUser,
    Role,
    Session,
    SessionStatus,
    User,
    UserRole,
)
from app.modules.iam.schemas import (
    AuditLogFilterParams,
    AuditLogListResponse,
    AuditLogResponse,
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    ProjectUserAssign,
    ProjectUserResponse,
    RefreshRequest,
    RefreshResponse,
    RoleResponse,
    UserContext,
    UserCreate,
    UserResponse,
)
from app.modules.iam.service import (
    authenticate_user,
    create_audit_log,
    create_session,
    find_session_by_hashed_token,
    get_user_context,
    refresh_session,
    register_user,
    revoke_all_sessions,
    revoke_session,
)

# ─────────────────────────────────────────
# ROUTER
# ─────────────────────────────────────────
router = APIRouter()


# ═══════════════════════════════════════
# ENDPOINT 1: POST /auth/login
# ═══════════════════════════════════════
@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Authenticate user",
    description="Authenticate user and return access token + refresh token.",
    responses={
        200: {"description": "Authentication successful"},
        401: {"description": "Invalid credentials"},
        403: {"description": "Account disabled or organization inactive"},
    },
)
async def login(
    data: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Authenticate user and create session.

    Returns access token (15 min) and refresh token (7 days).
    Refresh token is returned in response body for test compatibility
    and set in HttpOnly cookie for production use.
    """
    # Authenticate
    user = await authenticate_user(db, email=data.email, password=data.password)
    if not user:
        # Audit log skipped for unknown-user failures:
        # org_id would be 0 which violates the DB NOT NULL / FK constraint.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Create refresh token
    refresh_token_str, _ = create_refresh_token(
        subject=user.id,
        session_id="",  # Will be set after session creation
    )

    # Create session
    session = await create_session(
        db,
        user=user,
        refresh_token=refresh_token_str,
        ip_address=request.client.host if request.client else None,
    )

    # Now create the real refresh token with the session_id
    real_refresh_token_str, _ = create_refresh_token(
        subject=user.id,
        session_id=session.session_id,
    )

    # Update session with real refresh token hash
    from app.core.security import get_password_hash
    session.refresh_token_hash = get_password_hash(real_refresh_token_str)
    await db.flush()

    # Create access token
    access_token_str, _ = create_access_token(
        subject=user.id,
        org_id=user.org_id,
        session_id=session.session_id,
        token_version=user.token_version,
    )

    # Create audit log for successful login
    await create_audit_log(
        db,
        org_id=user.org_id,
        action=AuditAction.LOGIN.value,
        user_id=user.id,
        resource_type="session",
        resource_id=session.session_id,
        ip_address=request.client.host if request.client else None,
    )

    # Update device public key if provided
    if data.device_public_key:
        user.device_public_key = data.device_public_key
        await db.flush()

    # Build user context
    user_ctx = await get_user_context(db, user.id)

    # Set refresh token in cookie (production behavior)
    response.set_cookie(
        key="refresh_token",
        value=real_refresh_token_str,
        httponly=True,
        secure=False,  # False for development/testing
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/auth/refresh",
    )

    return {
        "access_token": access_token_str,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "session_id": session.session_id,
        "user": user_ctx,
        "refresh_token": real_refresh_token_str,  # Body for test compatibility
    }


# ═══════════════════════════════════════
# ENDPOINT 2: POST /auth/refresh
# ═══════════════════════════════════════
@router.post(
    "/refresh",
    response_model=RefreshResponse,
    summary="Refresh access token",
    description="Use refresh token to obtain a new access token. Implements token rotation.",
    responses={
        200: {"description": "New access token issued"},
        401: {"description": "Invalid or revoked refresh token"},
    },
)
async def refresh_access_token(
    request: Request,
    response: Response,
    data: RefreshRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Refresh access token using refresh token.

    Accepts refresh_token from:
    1. Cookie (production path)
    2. Request body (test compatibility fallback)
    """
    # Get refresh token from cookie or body
    refresh_token_str = None
    if data and data.refresh_token:
        refresh_token_str = data.refresh_token
    else:
        # Try cookie
        refresh_token_str = request.cookies.get("refresh_token")

    if not refresh_token_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token not provided",
        )

    # Find session by token hash
    session = await find_session_by_hashed_token(db, refresh_token_str)
    if not session or session.status != SessionStatus.ACTIVE.value:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked refresh token",
        )

    # Check session expiry
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    expires = session.expires_at
    if expires.tzinfo:
        expires_utc = expires
    else:
        expires_utc = expires.replace(tzinfo=timezone.utc)
    if now > expires_utc:
        session.status = SessionStatus.EXPIRED.value
        await db.flush()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired",
        )

    # Get user for context
    user_query = select(User).where(User.id == session.user_id)
    user_result = await db.execute(user_query)
    user = user_result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or deactivated",
        )

    # Create new refresh token (rotation)
    new_refresh_token_str, _ = create_refresh_token(
        subject=user.id,
        session_id=session.session_id,
    )

    # Update session with new hash
    from app.core.security import get_password_hash
    session.refresh_token_hash = get_password_hash(new_refresh_token_str)
    await db.flush()

    # Create new access token
    access_token_str, _ = create_access_token(
        subject=user.id,
        org_id=user.org_id,
        session_id=session.session_id,
        token_version=user.token_version,
    )

    # Create audit log
    await create_audit_log(
        db,
        org_id=user.org_id,
        action=AuditAction.TOKEN_REFRESHED.value,
        user_id=user.id,
        resource_type="session",
        resource_id=session.session_id,
        ip_address=request.client.host if request.client else None,
    )

    # Update cookie
    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token_str,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/auth/refresh",
    )

    return {
        "access_token": access_token_str,
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


# ═══════════════════════════════════════
# ENDPOINT 3: POST /auth/logout
# ═══════════════════════════════════════
@router.post(
    "/logout",
    summary="Revoke session",
    description="Revoke current session. If revoke_all=true, revokes ALL user sessions.",
    responses={
        200: {"description": "Logout successful"},
        401: {"description": "Invalid session"},
    },
)
async def logout(
    data: LogoutRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Revoke session(s) and clear refresh cookie."""
    user = await get_current_user(request, db)

    if data.revoke_all:
        count = await revoke_all_sessions(db, user["id"])
        await create_audit_log(
            db,
            org_id=user["org_id"],
            action=AuditAction.ALL_SESSIONS_REVOKED.value,
            user_id=user["id"],
            details={"revoked_count": count},
            ip_address=request.client.host if request.client else None,
        )
    else:
        success = await revoke_session(db, user["id"], data.session_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session not found",
            )
        await create_audit_log(
            db,
            org_id=user["org_id"],
            action=AuditAction.LOGOUT.value,
            user_id=user["id"],
            resource_type="session",
            resource_id=data.session_id,
            ip_address=request.client.host if request.client else None,
        )

    # Clear refresh cookie
    response.delete_cookie(key="refresh_token", path="/auth/refresh")

    return {"detail": "Logged out successfully"}


# ═══════════════════════════════════════
# ENDPOINT 4: GET /auth/me
# ═══════════════════════════════════════
@router.get(
    "/me",
    response_model=UserContext,
    summary="Get current user context",
    description="Return current authenticated user's full context.",
    responses={
        200: {"description": "User context"},
        401: {"description": "Not authenticated"},
    },
)
async def get_me(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return current user context from DB (server-side authorization)."""
    user_context = await get_current_user(request, db)
    return user_context


# ═══════════════════════════════════════
# ENDPOINT 5: POST /auth/register
# ═══════════════════════════════════════
@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register new user",
    description="Create a new user. Requires ORG_ADMIN or SUPER_ADMIN role.",
    responses={
        201: {"description": "User created"},
        401: {"description": "Not authenticated"},
        403: {"description": "Insufficient privileges"},
        422: {"description": "Validation error"},
        409: {"description": "User already exists"},
    },
)
async def register(
    data: UserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role(["ORG_ADMIN", "SUPER_ADMIN"])),
) -> User:
    """Create a new user in the organization."""
    try:
        new_user = await register_user(
            db,
            email=data.email,
            password=data.password,
            name=data.name,
            org_id=data.org_id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User with email '{data.email}' already exists in this organization",
        )

    # Create audit log
    await create_audit_log(
        db,
        org_id=data.org_id,
        action=AuditAction.USER_CREATED.value,
        user_id=user["id"],
        resource_type="user",
        resource_id=str(new_user.id),
        ip_address=request.client.host if request.client else None,
    )

    return new_user


# ═══════════════════════════════════════
# ENDPOINT 6: GET /auth/roles
# ═══════════════════════════════════════
@router.get(
    "/roles",
    response_model=list[RoleResponse],
    summary="List organization roles",
    description="List all roles for the authenticated user's organization.",
    responses={
        200: {"description": "Roles list"},
        401: {"description": "Not authenticated"},
    },
)
async def list_roles(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> list[Role]:
    """List roles for the current user's organization."""
    user_context = await get_current_user(request, db)

    query = select(Role).where(Role.org_id == user_context["org_id"])
    result = await db.execute(query)
    roles = result.scalars().all()
    return list(roles)


# ═══════════════════════════════════════
# ENDPOINT 7: POST /auth/assignments
# ═══════════════════════════════════════
@router.post(
    "/assignments",
    response_model=ProjectUserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Assign user to project",
    description="Assign a user to a project with a specific role. Requires ORG_ADMIN role.",
    responses={
        201: {"description": "Assignment created"},
        401: {"description": "Not authenticated"},
        403: {"description": "Insufficient privileges"},
        409: {"description": "Assignment already exists"},
    },
)
async def create_assignment(
    data: ProjectUserAssign,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role(["ORG_ADMIN", "SUPER_ADMIN"])),
) -> ProjectUser:
    """Assign a user to a project with a role."""
    # Verify role exists in the org
    role_query = select(Role).where(
        Role.id == data.role_id,
        Role.org_id == user["org_id"],
    )
    role_result = await db.execute(role_query)
    role = role_result.scalar_one_or_none()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Role {data.role_id} not found in organization",
        )

    # Create assignment
    assignment = ProjectUser(
        org_id=user["org_id"],
        user_id=data.user_id,
        project_id=data.project_id,
        role_id=data.role_id,
    )
    db.add(assignment)

    try:
        await db.flush()
        await db.refresh(assignment)
    except Exception:
        # UniqueConstraint violation — assignment already exists
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already assigned to this project",
        )

    # Create audit log
    await create_audit_log(
        db,
        org_id=user["org_id"],
        action=AuditAction.ROLE_ASSIGNED.value,
        user_id=user["id"],
        resource_type="project_user",
        resource_id=str(assignment.id),
        details={
            "target_user_id": data.user_id,
            "project_id": data.project_id,
            "role_id": data.role_id,
        },
        ip_address=request.client.host if request.client else None,
    )

    return assignment


# ═══════════════════════════════════════
# ENDPOINT 8: GET /auth/audit
# ═══════════════════════════════════════
@router.get(
    "/audit",
    response_model=AuditLogListResponse,
    summary="List audit logs",
    description="List audit logs for the authenticated user's organization. Paginated and filterable.",
    responses={
        200: {"description": "Audit log list"},
        401: {"description": "Not authenticated"},
    },
)
async def list_audit_logs(
    request: Request,
    db: AsyncSession = Depends(get_db),
    action: str | None = Query(None, description="Filter by action type"),
    user_id: int | None = Query(None, description="Filter by user ID", gt=0),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict:
    """List audit logs scoped to the current user's organization."""
    user_context = await get_current_user(request, db)

    # Base query — ALWAYS filtered by org_id
    query = select(AuditLog).where(AuditLog.org_id == user_context["org_id"])

    # Apply filters
    if action:
        query = query.where(AuditLog.action == action)
    if user_id:
        query = query.where(AuditLog.user_id == user_id)

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.order_by(AuditLog.created_at.desc()).offset(offset).limit(page_size)

    result = await db.execute(query)
    items = result.scalars().all()

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ═══════════════════════════════════════
# ENDPOINT 9: GET /auth/users
# ═══════════════════════════════════════
@router.get(
    "/users",
    response_model=list[UserResponse],
    summary="List organization users",
    description="List all users in the authenticated user's organization.",
    responses={
        200: {"description": "Users list"},
        401: {"description": "Not authenticated"},
    },
)
async def list_users(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> list[User]:
    """List users in the current user's organization."""
    user_context = await get_current_user(request, db)

    query = select(User).where(User.org_id == user_context["org_id"])
    result = await db.execute(query)
    users = result.scalars().all()
    return list(users)
