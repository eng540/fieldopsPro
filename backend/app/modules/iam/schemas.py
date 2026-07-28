"""IAM Pydantic Schemas — FieldOps V4.0 (Sprint-1 CP-2)

All schemas enforce multi-tenant context where applicable.
Matches the OpenAPI contract in docs/openapi/openapi.yaml.

Constitutional (ADR-004):
- JWT Minimalism: identity only in tokens
- Server-side authorization: roles/permissions from DB
- WORM audit trail for all auth events
"""
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


# ─────────────────────────────────────────
# AUTH REQUEST SCHEMAS
# ─────────────────────────────────────────
class LoginRequest(BaseModel):
    """Schema for user login (POST /auth/login).

    Per OpenAPI: email, password, device_public_key are required.
    device_public_key made optional for Sprint-1 (will be required later).
    """
    email: EmailStr = Field(
        description="User email (login identifier)",
        examples=["engineer@nrc.org"],
    )
    password: str = Field(
        min_length=6,
        description="User password (min 6 characters)",
        examples=["SecurePass123!"],
    )
    device_public_key: str | None = Field(
        default=None,
        description="Ed25519 or RSA public key for device trust (optional for Sprint-1)",
    )


class LogoutRequest(BaseModel):
    """Schema for user logout (POST /auth/logout).

    Per OpenAPI: session_id required, revoke_all defaults to false.
    """
    session_id: str = Field(
        description="Session UUID to revoke",
        examples=["550e8400-e29b-41d4-a716-446655440000"],
    )
    revoke_all: bool = Field(
        default=False,
        description="Revoke all sessions for this user",
    )


class RefreshRequest(BaseModel):
    """Schema for refresh token (POST /auth/refresh).

    Accepts refresh_token in body as fallback for testing.
    In production, this comes from HttpOnly cookie.
    """
    refresh_token: str | None = Field(
        default=None,
        description="Refresh token (fallback for testing; normally from cookie)",
    )


class UserCreate(BaseModel):
    """Schema for creating a new user (POST /auth/register).

    Requires auth (ORG_ADMIN role).
    """
    email: EmailStr = Field(
        description="User email (must be unique within org)",
        examples=["newuser@nrc.org"],
    )
    password: str = Field(
        min_length=6,
        description="User password (min 6 characters)",
        examples=["SecurePass123!"],
    )
    name: str = Field(
        min_length=1,
        max_length=255,
        description="Full display name",
        examples=["Ahmed Al-Mansouri"],
    )
    org_id: int = Field(
        gt=0,
        description="Organization ID for the new user",
        examples=[7],
    )


class ProjectUserAssign(BaseModel):
    """Schema for assigning a user to a project with a role."""
    user_id: int = Field(
        gt=0,
        description="User to assign",
    )
    project_id: int = Field(
        gt=0,
        description="Project to assign user to",
    )
    role_id: int = Field(
        gt=0,
        description="Role ID for the assignment",
    )


# ─────────────────────────────────────────
# AUTH RESPONSE SCHEMAS
# ─────────────────────────────────────────
class UserContext(BaseModel):
    """User context returned in login and /auth/me responses.

    Per OpenAPI: id, email, role, org_id, projects required.
    name included per OpenAPI.
    """
    id: int = Field(
        description="User ID",
        examples=[15],
    )
    email: str = Field(
        description="User email",
        examples=["engineer@nrc.org"],
    )
    role: str = Field(
        description="User role (server-side, NOT from JWT)",
        examples=["FIELD_ENGINEER"],
    )
    org_id: int = Field(
        description="Organization ID",
        examples=[7],
    )
    projects: list[int] = Field(
        default_factory=list,
        description="Project IDs this user is assigned to",
        examples=[[12, 15]],
    )
    name: str | None = Field(
        default=None,
        description="Full display name",
        examples=["Ahmed Al-Mansouri"],
    )


class LoginResponse(BaseModel):
    """Schema for successful login response (POST /auth/login).

    Per OpenAPI: access_token, token_type, expires_in, session_id required.
    """
    access_token: str = Field(
        description="JWT access token (15 min)",
    )
    token_type: str = Field(
        default="bearer",
        description="Token type",
    )
    expires_in: int = Field(
        description="Seconds until expiration",
        examples=[900],
    )
    session_id: str = Field(
        description="Session UUID",
        examples=["550e8400-e29b-41d4-a716-446655440000"],
    )
    user: UserContext = Field(
        description="User context",
    )
    refresh_token: str | None = Field(
        default=None,
        description="Refresh token (returned in body for test compatibility)",
    )


class RefreshResponse(BaseModel):
    """Schema for token refresh response (POST /auth/refresh).

    Per OpenAPI: access_token, expires_in.
    """
    access_token: str = Field(
        description="New JWT access token (15 min)",
    )
    expires_in: int = Field(
        description="Seconds until expiration",
        examples=[900],
    )


# ─────────────────────────────────────────
# USER / ROLE RESPONSE SCHEMAS
# ─────────────────────────────────────────
class UserResponse(BaseModel):
    """Schema for user read response (GET /auth/users)."""
    id: int
    email: str
    name: str
    org_id: int
    is_active: bool
    device_public_key: str | None = None
    token_version: int
    created_at: datetime

    model_config = {"from_attributes": True}


class RoleResponse(BaseModel):
    """Schema for role read response (GET /auth/roles)."""
    id: int
    name: str
    description: str | None = None
    org_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ProjectUserResponse(BaseModel):
    """Schema for project user assignment response."""
    id: int
    user_id: int
    project_id: int
    role_id: int
    org_id: int
    assigned_at: datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────
# AUDIT LOG SCHEMAS
# ─────────────────────────────────────────
class AuditLogResponse(BaseModel):
    """Schema for audit log read response (GET /auth/audit)."""
    id: int
    org_id: int
    user_id: int | None = None
    action: str
    resource_type: str | None = None
    resource_id: str | None = None
    details: dict[str, Any] | None = None
    ip_address: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditLogFilterParams(BaseModel):
    """Query parameters for filtering audit logs."""
    action: str | None = None
    user_id: int | None = Field(default=None, gt=0)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)


# ─────────────────────────────────────────
# PAGINATED RESPONSE HELPERS
# ─────────────────────────────────────────
class AuditLogListResponse(BaseModel):
    """Paginated response for audit logs."""
    items: list[AuditLogResponse] = Field(default_factory=list)
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=200)
