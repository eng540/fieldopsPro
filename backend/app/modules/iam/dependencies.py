"""IAM Dependencies — FieldOps V4.0 (Sprint-1 CP-2)

FastAPI JWT dependency injection (replacing mock auth).

Constitutional (ADR-004):
- JWT Minimalism: tokens carry identity + references only
- Server-side authorization: roles/permissions from DB on every request
- Session registry: instant revocation support
- token_version check: invalidate all tokens on password change / revoke_all

Dependencies:
- get_current_user: Extract and validate JWT, return full user context
- require_role: Dependency factory for role-based access control
"""
from typing import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.modules.iam.models import Session, SessionStatus, User
from app.modules.iam.service import get_user_context

# Bearer token extraction
_bearer_scheme = HTTPBearer()


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Extract JWT from Authorization header, validate, and return user context.

    Flow (per ADR-004):
    1. Extract Bearer token from Authorization header
    2. Decode JWT → extract sub (user_id), org_id, session_id, token_version
    3. Check session_registry → is session revoked?
    4. Query User + ProjectUser tables → determine effective role and project scope
    5. Return full user context dict

    Raises:
        HTTPException 401: If token missing, invalid, session revoked, or user not found.
    """
    # Extract Authorization header
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = auth_header.split("Bearer ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Decode token
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Validate token type
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    session_id = payload.get("session_id")
    token_version = payload.get("token_version")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject claim",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check session is not revoked (Redis cache-first, DB fallback — ADR-004)
    if session_id:
        session_revoked = False

        try:
            from app.core.redis_client import get_cached_session
            cached = await get_cached_session(session_id)
            if cached is not None:
                # Cache hit — check status without DB round-trip
                session_revoked = cached.get("status") == "REVOKED"
            else:
                # Cache miss — fall through to DB
                session_query = select(Session).where(Session.session_id == session_id)
                result = await db.execute(session_query)
                session = result.scalar_one_or_none()
                if session:
                    session_revoked = session.status == SessionStatus.REVOKED.value
                    # Back-fill cache for future requests
                    from app.core.redis_client import cache_session
                    await cache_session(session_id, {
                        "session_id": session_id,
                        "user_id":    session.user_id,
                        "status":     session.status,
                    })
        except Exception:
            # Redis error — fall back to DB check
            session_query = select(Session).where(Session.session_id == session_id)
            result = await db.execute(session_query)
            session = result.scalar_one_or_none()
            session_revoked = session is not None and session.status == SessionStatus.REVOKED.value

        if session_revoked:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session has been revoked",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # Check token_version matches current user version
    user_query = select(User).where(User.id == int(user_id))
    user_result = await db.execute(user_query)
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is deactivated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check token_version (invalidate tokens on password change / revoke_all)
    if token_version is not None and token_version != user.token_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been invalidated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Build full user context from DB (server-side authorization)
    user_context = await get_user_context(db, user.id)

    if not user_context:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not build user context",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user_context


def require_role(allowed_roles: list[str]) -> Callable:
    """Dependency factory for role-based access control.

    Usage:
        @router.get("/admin-only")
        async def admin_endpoint(
            user: dict = Depends(require_role(["ORG_ADMIN", "SUPER_ADMIN"]))
        ):
            ...

    Checks user role (from server-side DB lookup) against allowed list.
    """
    async def role_checker(
        user: dict = Depends(get_current_user),
    ) -> dict:
        user_role = user.get("role", "")
        if user_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user_role}' not authorized. Required: {allowed_roles}",
            )
        return user

    return role_checker
