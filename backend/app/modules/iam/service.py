# --- START OF FILE backend/app/modules/iam/service.py ---

"""IAM Service Layer — FieldOps V4.0 (Sprint-1 CP-2)

Authentication business logic implementing:
- ADR-004: JWT Minimalism + Server-Side Authorization
- Constitutional: Multi-tenant isolation via org_id
- Constitutional: WORM Audit trail for all auth events
"""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
    hash_token,          # <-- تم إضافة هذا
    verify_token_hash,   # <-- تم إضافة هذا
)
from app.modules.iam.models import (
    AuditLog,
    AuditAction,
    Organization,
    ProjectUser,
    Role,
    Session,
    SessionStatus,
    User,
)


async def authenticate_user(
    db: AsyncSession,
    email: str,
    password: str,
    org_id: int | None = None,
) -> User | None:
    query = select(User).where(User.email == email)
    if org_id:
        query = query.where(User.org_id == org_id)

    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        return None

    if not verify_password(password, user.hashed_password):
        return None

    if not user.is_active:
        return None

    org_query = select(Organization).where(Organization.id == user.org_id)
    org_result = await db.execute(org_query)
    org = org_result.scalar_one_or_none()
    if not org or not org.is_active:
        return None

    return user


async def create_session(
    db: AsyncSession,
    user: User,
    refresh_token: str,
    device_info: dict | None = None,
    ip_address: str | None = None,
) -> Session:
    session_id = str(uuid4())
    refresh_token_hash = hash_token(refresh_token)
    expires_at = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS,
    )

    session = Session(
        user_id=user.id,
        session_id=session_id,
        refresh_token_hash=refresh_token_hash,
        device_info=device_info,
        ip_address=ip_address,
        status=SessionStatus.ACTIVE.value,
        expires_at=expires_at,
    )
    db.add(session)
    await db.flush()
    await db.refresh(session)

    try:
        from app.core.redis_client import cache_session
        ttl = settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
        await cache_session(session_id, {
            "session_id": session_id,
            "user_id":    user.id,
            "status":     SessionStatus.ACTIVE.value,
        }, ttl=ttl)
    except Exception:
        pass

    return session


async def refresh_session(
    db: AsyncSession,
    session_id: str,
    new_refresh_token: str,
) -> Session | None:
    query = select(Session).where(Session.session_id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session or session.status != SessionStatus.ACTIVE.value:
        return None

    now = datetime.now(timezone.utc)
    expires = session.expires_at
    if expires.tzinfo:
        expires_utc = expires
    else:
        expires_utc = expires.replace(tzinfo=timezone.utc)
    if now > expires_utc:
        return None

    session.refresh_token_hash = hash_token(new_refresh_token)
    await db.flush()
    await db.refresh(session)
    return session


async def find_session_by_hashed_token(
    db: AsyncSession,
    refresh_token: str,
) -> Session | None:
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        return None

    session_id = payload.get("session_id")
    if not session_id:
        return None

    query = select(Session).where(Session.session_id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        return None

    if not verify_token_hash(refresh_token, session.refresh_token_hash):
        return None

    return session


async def revoke_session(
    db: AsyncSession,
    user_id: int,
    session_id: str,
) -> bool:
    query = select(Session).where(
        Session.session_id == session_id,
        Session.user_id == user_id,
    )
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        return False

    session.status = SessionStatus.REVOKED.value
    await db.flush()

    try:
        from app.core.redis_client import invalidate_session_cache
        await invalidate_session_cache(session_id)
    except Exception:
        pass

    return True


async def revoke_all_sessions(
    db: AsyncSession,
    user_id: int,
) -> int:
    query = select(Session).where(
        Session.user_id == user_id,
        Session.status == SessionStatus.ACTIVE.value,
    )
    result = await db.execute(query)
    sessions = result.scalars().all()

    count = 0
    for session in sessions:
        session.status = SessionStatus.REVOKED.value
        count += 1

    user_query = select(User).where(User.id == user_id)
    user_result = await db.execute(user_query)
    user = user_result.scalar_one_or_none()
    if user:
        user.token_version += 1

    await db.flush()

    try:
        from app.core.redis_client import invalidate_user_sessions
        await invalidate_user_sessions(user_id)
    except Exception:
        pass

    return count


async def get_user_context(
    db: AsyncSession,
    user_id: int,
) -> dict:
    user_query = select(User).where(User.id == user_id)
    result = await db.execute(user_query)
    user = result.scalar_one_or_none()

    if not user:
        return {}

    assignment_query = (
        select(ProjectUser, Role)
        .join(Role, ProjectUser.role_id == Role.id)
        .where(ProjectUser.user_id == user_id)
    )
    assign_result = await db.execute(assignment_query)
    assignments = assign_result.all()

    projects = []
    role_priority = {
        "SUPER_ADMIN": 4,
        "ORG_ADMIN": 3,
        "PROJECT_MANAGER": 2,
        "FIELD_ENGINEER": 1,
    }
    highest_role = "FIELD_ENGINEER"

    for assignment, role in assignments:
        projects.append(assignment.project_id)
        rp = role_priority.get(role.name, 0)
        if rp > role_priority.get(highest_role, 0):
            highest_role = role.name

    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "org_id": user.org_id,
        "role": highest_role,
        "projects": projects,
        "token_version": user.token_version,
    }


async def create_audit_log(
    db: AsyncSession,
    org_id: int,
    action: str,
    user_id: int | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    details: dict | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    audit_entry = AuditLog(
        org_id=org_id,
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details,
        ip_address=ip_address,
    )
    db.add(audit_entry)
    await db.flush()
    await db.refresh(audit_entry)
    return audit_entry


async def register_user(
    db: AsyncSession,
    email: str,
    password: str,
    name: str,
    org_id: int,
) -> User:
    org_query = select(Organization).where(
        Organization.id == org_id,
        Organization.is_active == True,
    )
    org_result = await db.execute(org_query)
    org = org_result.scalar_one_or_none()
    if not org:
        raise ValueError(f"Organization {org_id} not found or inactive")

    user = User(
        org_id=org_id,
        email=email,
        name=name,
        hashed_password=get_password_hash(password),
        is_active=True,
        token_version=1,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user