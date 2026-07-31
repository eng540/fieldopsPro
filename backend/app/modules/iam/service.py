"""IAM Service Layer — FieldOps V4.0 (Sprint-1 CP-2)

Authentication business logic implementing:
- ADR-004: JWT Minimalism + Server-Side Authorization
- Constitutional: Multi-tenant isolation via org_id
- Constitutional: WORM Audit trail for all auth events

Functions:
- authenticate_user: Verify credentials against DB
- create_session: Create session record with hashed refresh token
- refresh_session: Rotate refresh token
- revoke_session / revoke_all_sessions: Session management
- get_user_context: Build full user context from DB
- create_audit_log: WORM audit entry
- register_user: Create new user with hashed password
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
    """Verify user credentials.

    1. Find user by email (optionally scoped to org_id)
    2. Verify password against bcrypt hash
    3. Check user is_active
    4. Check organization is_active

    Returns User if all checks pass, None otherwise.
    """
    # Build query — find user by email
    query = select(User).where(User.email == email)
    if org_id:
        query = query.where(User.org_id == org_id)

    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        return None

    # Verify password
    if not verify_password(password, user.hashed_password):
        return None

    # Check user is active
    if not user.is_active:
        return None

    # Check organization is active
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
    """Create a new session record.

    Stores hashed refresh token (never plaintext).
    Sets session expiry based on REFRESH_TOKEN_EXPIRE_DAYS.
    """
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

    # Cache in Redis (ADR-004 cache-aside — DB is source of truth)
    try:
        from app.core.redis_client import cache_session
        ttl = settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
        await cache_session(session_id, {
            "session_id": session_id,
            "user_id":    user.id,
            "status":     SessionStatus.ACTIVE.value,
        }, ttl=ttl)
    except Exception:
        pass  # Redis failure is non-fatal

    return session


async def refresh_session(
    db: AsyncSession,
    session_id: str,
    new_refresh_token: str,
) -> Session | None:
    """Rotate refresh token for an active session.

    1. Find session by session_id
    2. Validate session is ACTIVE
    3. Check not expired
    4. Update with new hashed refresh token

    Returns Session if successful, None if session invalid.
    """
    query = select(Session).where(Session.session_id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        return None

    if session.status != SessionStatus.ACTIVE.value:
        return None

    # Check expiry
    now = datetime.now(timezone.utc)
    expires = session.expires_at
    if expires.tzinfo:
        expires_utc = expires
    else:
        expires_utc = expires.replace(tzinfo=timezone.utc)
    if now > expires_utc:
        return None

    # Rotate token
    session.refresh_token_hash = hash_token(new_refresh_token)
    await db.flush()
    await db.refresh(session)
    return session


async def find_session_by_hashed_token(
    db: AsyncSession,
    refresh_token: str,
) -> Session | None:
    """Find session by hashing the provided refresh token and matching.

    This is the lookup used during refresh to find the session
    associated with the plaintext refresh token from the cookie/body.
    """
    # Decode refresh token JWT to extract session_id (ADR-004: session_id in token)
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

    # Verify the token hash matches
    if not verify_token_hash(refresh_token, session.refresh_token_hash):
        return None

    return session


async def revoke_session(
    db: AsyncSession,
    user_id: int,
    session_id: str,
) -> bool:
    """Revoke a single session.

    Returns True if session was found and revoked, False otherwise.
    """
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

    # Invalidate Redis cache immediately (ADR-004)
    try:
        from app.core.redis_client import invalidate_session_cache
        await invalidate_session_cache(session_id)
    except Exception:
        pass  # Non-fatal

    return True


async def revoke_all_sessions(
    db: AsyncSession,
    user_id: int,
) -> int:
    """Revoke all active sessions for a user.

    Also increments token_version to invalidate all issued access tokens.

    Returns count of revoked sessions.
    """
    # Revoke all active sessions
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

    # Increment token_version on user
    user_query = select(User).where(User.id == user_id)
    user_result = await db.execute(user_query)
    user = user_result.scalar_one_or_none()
    if user:
        user.token_version += 1

    await db.flush()

    # Invalidate all Redis session caches for this user (ADR-004)
    try:
        from app.core.redis_client import invalidate_user_sessions
        await invalidate_user_sessions(user_id)
    except Exception:
        pass  # Non-fatal

    return count


async def get_user_context(
    db: AsyncSession,
    user_id: int,
) -> dict:
    """Build full user context from DB.

    Constitutional (ADR-004): Roles are NOT in JWT.
    Server reads from DB on every authorized request.

    Returns dict with:
    - id, email, name, org_id, token_version
    - role: highest role from ProjectUser -> Role table
    - projects: list of project IDs from ProjectUser
    """
    # Query user
    user_query = select(User).where(User.id == user_id)
    result = await db.execute(user_query)
    user = result.scalar_one_or_none()

    if not user:
        return {}

    # Query project assignments with role info
    assignment_query = (
        select(ProjectUser, Role)
        .join(Role, ProjectUser.role_id == Role.id)
        .where(ProjectUser.user_id == user_id)
    )
    assign_result = await db.execute(assignment_query)
    assignments = assign_result.all()

    # Build project list and determine highest role
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

    # Also check if user has an ORG_ADMIN or SUPER_ADMIN role directly
    direct_role_query = (
        select(Role)
        .join(Organization, Role.org_id == Organization.id)
        .where(
            Role.org_id == user.org_id,
            Role.name.in_(["SUPER_ADMIN", "ORG_ADMIN"]),
        )
    )
    # This is a simplification — we assume the user might be an admin
    # In full implementation, there would be a user_roles junction table
    # For Sprint-1, we determine role from project assignments

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
    """Create a WORM audit log entry.

    Constitutional: Once written, audit logs MUST NEVER be modified or deleted.
    """
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
    """Create a new user with hashed password.

    Verifies org exists and is active before creating.
    """
    # Verify org exists and is active
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
