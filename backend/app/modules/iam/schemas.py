"""IAM Pydantic Schemas — FieldOps V4.0 (Sprint-1 CP-2)"""
from datetime import datetime
from typing import Any
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field

class LoginRequest(BaseModel):
    email: EmailStr = Field(description="User email (login identifier)", examples=["engineer@nrc.org"])
    password: str = Field(min_length=8, description="User password (min 8 characters)", examples=["SecurePass123!"])
    device_public_key: str | None = Field(default=None, description="Device public key (optional)")

class LogoutRequest(BaseModel):
    session_id: str = Field(description="Session UUID")
    revoke_all: bool = Field(default=False, description="Revoke all sessions")

class RefreshRequest(BaseModel):
    refresh_token: str | None = Field(default=None, description="Refresh token body fallback")

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=1, max_length=255)
    org_id: int = Field(gt=0)

class ProjectUserAssign(BaseModel):
    user_id: int = Field(gt=0)
    project_id: int = Field(gt=0)
    role_id: int = Field(gt=0)

class UserContext(BaseModel):
    id: int
    email: str
    role: str
    org_id: int
    projects: list[int] = Field(default_factory=list)
    name: str | None = None

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    session_id: str
    user: UserContext
    refresh_token: str | None = Field(default=None, description="Refresh token compatibility fallback")

class RefreshResponse(BaseModel):
    access_token: str
    expires_in: int
    refresh_token: str | None = Field(default=None, description="Rotated refresh token compatibility fallback")

class UserResponse(BaseModel):
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
    id: int
    name: str
    description: str | None = None
    org_id: int
    created_at: datetime
    model_config = {"from_attributes": True}

class ProjectUserResponse(BaseModel):
    id: int
    user_id: int
    project_id: int
    role_id: int
    org_id: int
    assigned_at: datetime
    model_config = {"from_attributes": True}

class AuditLogResponse(BaseModel):
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
    action: str | None = None
    user_id: int | None = Field(default=None, gt=0)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)

class AuditLogListResponse(BaseModel):
    items: list[AuditLogResponse] = Field(default_factory=list)
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=200)
