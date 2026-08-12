"""IAM authentication and authorization dependencies.

RLS is fail-closed. The tenant context is installed immediately from the
validated JWT org_id before querying any org-scoped table.
"""
from typing import Callable

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.modules.iam.models import Session, SessionStatus, User
from app.modules.iam.service import get_user_context


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header", headers={"WWW-Authenticate": "Bearer"})
    token = auth_header.split("Bearer ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty bearer token", headers={"WWW-Authenticate": "Bearer"})

    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid or expired access token", headers={"WWW-Authenticate": "Bearer"})

    user_id = payload.get("sub")
    session_id = payload.get("session_id")
    token_version = payload.get("token_version")
    token_org_id = payload.get("org_id")
    if not user_id or token_org_id is None:
        raise HTTPException(status_code=401, detail="Token missing required identity/organization claims", headers={"WWW-Authenticate": "Bearer"})
    try:
        org_id = int(token_org_id)
        if org_id <= 0:
            raise ValueError
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Invalid organization claim", headers={"WWW-Authenticate": "Bearer"}) from exc

    # RLS context MUST be established before querying users/session/project scope.
    from app.core.rls_middleware import set_rls_context
    try:
        await set_rls_context(db, org_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Tenant security context could not be established") from exc

    if session_id:
        result = await db.execute(select(Session).where(
            Session.session_id == session_id,
            Session.user_id == int(user_id),
        ))
        session = result.scalar_one_or_none()
        if session is None or session.status == SessionStatus.REVOKED.value:
            raise HTTPException(status_code=401, detail="Session has been revoked or does not exist", headers={"WWW-Authenticate": "Bearer"})

    result = await db.execute(select(User).where(User.id == int(user_id), User.org_id == org_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive", headers={"WWW-Authenticate": "Bearer"})
    if token_version is not None and token_version != user.token_version:
        raise HTTPException(status_code=401, detail="Token has been invalidated", headers={"WWW-Authenticate": "Bearer"})

    user_context = await get_user_context(db, user.id)
    if not user_context or int(user_context.get("org_id", 0)) != org_id:
        raise HTTPException(status_code=403, detail="Organization context mismatch")

    request.state.org_id = org_id
    return user_context


def require_role(allowed_roles: list[str]) -> Callable:
    async def role_checker(user: dict = Depends(get_current_user)) -> dict:
        role = user.get("role", "")
        if role not in allowed_roles:
            raise HTTPException(status_code=403, detail=f"Role '{role}' not authorized. Required: {allowed_roles}")
        return user
    return role_checker
