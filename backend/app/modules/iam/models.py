"""IAM Router — FieldOps V4.0 (Sprint-1)

Authentication endpoints implementing:
- Login: Verify credentials, issue tokens, create session
- Refresh: Rotate refresh token, issue new access token
- Logout: Revoke specific session
- Logout All: Revoke all user sessions
- Me: Return current user context (ADR-004)
"""
from fastapi import APIRouter, Depends, HTTPException, status, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, get_current_user
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.modules.iam.models import AuditAction, SessionStatus, User
from app.modules.iam.schemas import (
    LoginRequest,
    LoginResponse,
    RefreshRequest,
    MessageResponse,
    UserContextResponse,
)
from app.modules.iam.service import (
    authenticate_user,
    create_audit_log,
    create_session,
    find_session_by_hashed_token,
    refresh_session,
    revoke_all_sessions,
    revoke_session,
    get_user_context,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(
    data: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate user and issue tokens.

    Sets refresh token in HttpOnly, Secure, SameSite=Strict cookie.
    Returns access token in response body.
    """
    # Authenticate user
    user = await authenticate_user(db, email=data.email, password=data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Create tokens
    session_id = None
    access_token, _ = create_access_token(
        subject=user.id,
        org_id=user.org_id,
        session_id="",  # Will be set after session creation
        token_version=user.token_version,
    )

    refresh_token, r_jti = create_refresh_token(
        subject=user.id,
        session_id="",  # Placeholder
    )

    # Decode refresh token to get session_id from jti (or generate new)
    payload = decode_token(refresh_token)
    if payload:
        session_id = payload.get("jti")  # Using jti as session_id for uniqueness

    # Create session in DB
    session = await create_session(
        db,
        user=user,
        refresh_token=refresh_token,
        device_info=data.device_info,
        ip_address=data.ip_address,
    )

    # Re-create access token with correct session_id
    access_token, _ = create_access_token(
        subject=user.id,
        org_id=user.org_id,
        session_id=session.session_id,
        token_version=user.token_version,
    )

    # Set refresh token in HttpOnly cookie
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=7 * 24 * 60 * 60,  # 7 days
        path="/api/v1/auth",
    )

    # Audit log: successful login
    await create_audit_log(
        db,
        org_id=user.org_id,
        user_id=user.id,
        action=AuditAction.LOGIN.value,
        ip_address=data.ip_address,
        details={"device_info": data.device_info},
    )

    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        user_id=user.id,
        session_id=session.session_id,
    )


@router.post("/refresh", response_model=LoginResponse)
async def refresh(
    request: RefreshRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Refresh access token using refresh token.

    Rotates refresh token for security. Previous refresh token becomes invalid.
    """
    refresh_token = request.refresh_token
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token required",
        )

    # Find session by hashed token
    session = await find_session_by_hashed_token(db, refresh_token)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    # Get user
    user = session.user
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is not active",
        )

    # Generate new refresh token and rotate
    new_refresh_token, _ = create_refresh_token(
        subject=user.id,
        session_id=session.session_id,
    )

    updated_session = await refresh_session(
        db,
        session_id=session.session_id,
        new_refresh_token=new_refresh_token,
    )
    if not updated_session:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update session",
        )

    # Issue new access token
    access_token, _ = create_access_token(
        subject=user.id,
        org_id=user.org_id,
        session_id=session.session_id,
        token_version=user.token_version,
    )

    # Update refresh token cookie
    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=7 * 24 * 60 * 60,
        path="/api/v1/auth",
    )

    # Audit log: token refreshed
    await create_audit_log(
        db,
        org_id=user.org_id,
        user_id=user.id,
        action=AuditAction.TOKEN_REFRESHED.value,
        resource_type="session",
        resource_id=session.session_id,
    )

    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        user_id=user.id,
        session_id=session.session_id,
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke the specified session."""
    success = await revoke_session(db, current_user.id, session_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )

    await create_audit_log(
        db,
        org_id=current_user.org_id,
        user_id=current_user.id,
        action=AuditAction.LOGOUT.value,
        resource_type="session",
        resource_id=session_id,
    )

    return MessageResponse(message="Session revoked successfully")


@router.post("/logout-all", response_model=MessageResponse)
async def logout_all(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke all active sessions for the current user."""
    count = await revoke_all_sessions(db, current_user.id)

    await create_audit_log(
        db,
        org_id=current_user.org_id,
        user_id=current_user.id,
        action=AuditAction.ALL_SESSIONS_REVOKED.value,
        details={"count": count},
    )

    return MessageResponse(message=f"All {count} sessions revoked")


@router.get("/me", response_model=UserContextResponse)
async def get_me(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return current user context (roles, projects) from DB (ADR-004)."""
    context = await get_user_context(db, current_user.id)
    return UserContextResponse(**context)