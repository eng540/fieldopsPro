"""IAM Models — FieldOps V4.0 (Sprint-1)

Identity & Access Management models implementing:
- ADR-001: Modular Monolith (self-contained IAM module)
- ADR-004: JWT Minimalism + Server-Side Authorization
- Constitutional: Multi-tenant isolation via org_id
- Constitutional: WORM Audit trail for all auth events

Models:
- Organization: Tenant entity for multi-tenant isolation
- User: Core user entity with credentials and device trust
- Role: RBAC role definitions (global, not per-user)
- ProjectUser: User-to-project assignment with scoped role
- Session: JWT session registry for revocation support
- AuditLog: WORM audit trail for all IAM events
"""
import enum
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


# ─────────────────────────────────────────
# ENUMS
# ─────────────────────────────────────────
class UserRole(str, enum.Enum):
    """System-wide role definitions.

    Constitutional (ADR-004): Roles are NOT stored in JWT.
    Server reads from DB on every authorized request.
    """
    SUPER_ADMIN = "SUPER_ADMIN"
    ORG_ADMIN = "ORG_ADMIN"
    PROJECT_MANAGER = "PROJECT_MANAGER"
    FIELD_ENGINEER = "FIELD_ENGINEER"


class SessionStatus(str, enum.Enum):
    """Session lifecycle states."""
    ACTIVE = "ACTIVE"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"


class AuditAction(str, enum.Enum):
    """Audit log action types (WORM)."""
    LOGIN = "LOGIN"
    LOGOUT = "LOGOUT"
    LOGIN_FAILED = "LOGIN_FAILED"
    SESSION_REVOKED = "SESSION_REVOKED"
    ALL_SESSIONS_REVOKED = "ALL_SESSIONS_REVOKED"
    TOKEN_REFRESHED = "TOKEN_REFRESHED"
    PASSWORD_CHANGED = "PASSWORD_CHANGED"
    USER_CREATED = "USER_CREATED"
    USER_UPDATED = "USER_UPDATED"
    USER_DEACTIVATED = "USER_DEACTIVATED"
    ROLE_ASSIGNED = "ROLE_ASSIGNED"
    ROLE_REMOVED = "ROLE_REMOVED"
    DEVICE_REGISTERED = "DEVICE_REGISTERED"


# ─────────────────────────────────────────
# ORGANIZATION
# ─────────────────────────────────────────
class Organization(Base):
    """Multi-tenant organization entity.

    Constitutional: Every non-system table MUST reference org_id.
    Organization is the root of the tenant hierarchy.
    """

    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Organization display name",
    )
    code: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        unique=True,
        comment="Unique organization code (e.g., NRC, UNICEF)",
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="Whether this organization can accept logins",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    users: Mapped[list["User"]] = relationship(
        "User",
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    roles: Mapped[list["Role"]] = relationship(
        "Role",
        back_populates="organization",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        {"comment": "Multi-tenant root entity"},
    )


# ─────────────────────────────────────────
# USER
# ─────────────────────────────────────────
class User(Base):
    """Core user entity with credentials and device trust.

    Constitutional (ADR-004):
    - Password stored as bcrypt hash (never plaintext)
    - Device public key for future sync request signing
    - is_active controls login access (soft-disable)
    - org_id links to tenant
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("organizations.id"),
        nullable=False,
        index=True,
        comment="Organization ID for multi-tenant isolation",
    )
    email: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="User email (login identifier)",
    )
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Full display name",
    )
    hashed_password: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Bcrypt hash of user password",
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="Whether user can log in",
    )
    device_public_key: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Ed25519 or RSA public key for device trust",
    )
    token_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        comment="Incremented to invalidate all issued tokens",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        back_populates="users",
    )
    project_assignments: Mapped[list["ProjectUser"]] = relationship(
        "ProjectUser",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    sessions: Mapped[list["Session"]] = relationship(
        "Session",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    audit_logs: Mapped[list["AuditLog"]] = relationship(
        "AuditLog",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint(
            "org_id", "email",
            name="uq_users_org_email",
            comment="Email must be unique within an organization",
        ),
        {"comment": "Core user entity with credentials"},
    )


# ─────────────────────────────────────────
# ROLE
# ─────────────────────────────────────────
class Role(Base):
    """RBAC role definition.

    Roles are organization-scoped. Each org can define its own
    role hierarchy within the system enum constraints.

    Constitutional (ADR-004): Role determination is server-side.
    JWT does NOT contain role claims.
    """

    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("organizations.id"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="Role name matching UserRole enum values",
    )
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Human-readable role description",
    )
    permissions: Mapped[dict[str, Any] | None] = mapped_column(
        "permissions_json",
        JSON,
        nullable=True,
        comment="JSON blob of granular permissions for this role",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        back_populates="roles",
    )
    user_assignments: Mapped[list["ProjectUser"]] = relationship(
        "ProjectUser",
        back_populates="role",
    )

    __table_args__ = (
        UniqueConstraint(
            "org_id", "name",
            name="uq_roles_org_name",
            comment="Role name must be unique within organization",
        ),
        {"comment": "RBAC role definitions"},
    )


# ─────────────────────────────────────────
# PROJECT USER (User-Project Assignment)
# ─────────────────────────────────────────
class ProjectUser(Base):
    """User-to-project assignment with scoped role.

    Constitutional:
    - A user's effective role is determined per-project
    - org_id ensures multi-tenant isolation
    - project_id scopes the assignment
    - role_id defines what the user can do in this project
    """

    __tablename__ = "project_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("organizations.id"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        index=True,
        comment="FK to projects table (implemented in Projects module)",
    )
    role_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("roles.id"),
        nullable=False,
        index=True,
    )

    # Timestamps
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="project_assignments",
    )
    role: Mapped["Role"] = relationship(
        "Role",
        back_populates="user_assignments",
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "project_id",
            name="uq_project_users_user_project",
            comment="User can only have one role per project",
        ),
        {"comment": "User-to-project role assignment"},
    )


# ─────────────────────────────────────────
# SESSION (JWT Session Registry)
# ─────────────────────────────────────────
class Session(Base):
    """JWT session registry for revocation support.

    Constitutional (ADR-004):
    - Access Token: 15 min, stored in RAM only
    - Refresh Token: 7 days, HttpOnly cookie (rotated on use)
    - Session table enables instant revocation
    - Redis-backed in production; DB-backed for Sprint-1

    NOTE: refresh_token_hash stores hashed value (like password),
    never the plaintext refresh token.
    """

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[str] = mapped_column(
        String(36),
        nullable=False,
        unique=True,
        index=True,
        comment="UUID session identifier (carried in JWT as session_id)",
    )
    refresh_token_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Hashed refresh token (never store plaintext)",
    )
    device_info: Mapped[dict[str, Any] | None] = mapped_column(
        "device_info_json",
        JSON,
        nullable=True,
        comment="Device fingerprint info for audit",
    )
    ip_address: Mapped[str | None] = mapped_column(
        String(45),
        nullable=True,
        comment="Client IP address at login",
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=SessionStatus.ACTIVE.value,
        index=True,
        comment="Session lifecycle status",
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="When this session expires",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="sessions",
    )

    __table_args__ = (
        {"comment": "JWT session registry for revocation support"},
    )

    def is_revoked(self) -> bool:
        """Check if this session has been revoked."""
        return self.status == SessionStatus.REVOKED.value

    def is_expired(self) -> bool:
        """Check if this session has expired."""
        return datetime.utcnow() > self.expires_at.replace(tzinfo=None) if self.expires_at.tzinfo else datetime.utcnow() > self.expires_at


# ─────────────────────────────────────────
# AUDIT LOG (WORM)
# ─────────────────────────────────────────
class AuditLog(Base):
    """WORM (Write-Once-Read-Many) audit trail for all IAM events.

    Constitutional:
    - Once written, rows MUST NEVER be modified or deleted
    - Provides full audit trail for governance compliance
    - Supports EXPLAINABILITY requirement
    """

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("organizations.id"),
        nullable=False,
        index=True,
        comment="Organization context for multi-tenant isolation",
    )
    user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
        index=True,
        comment="User who triggered the action (null for system events)",
    )
    action: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        comment="Action type (enum: LOGIN, LOGOUT, etc.)",
    )
    resource_type: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        comment="Type of resource affected (user, session, role, etc.)",
    )
    resource_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="ID of the affected resource",
    )
    details: Mapped[dict[str, Any] | None] = mapped_column(
        "details_json",
        JSON,
        nullable=True,
        comment="Additional context (IP, device, reason, etc.)",
    )
    ip_address: Mapped[str | None] = mapped_column(
        String(45),
        nullable=True,
    )

    # Timestamp (WORM: set once, never modified)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="WORM: set once, never modified",
    )

    # Relationships
    user: Mapped["User | None"] = relationship(
        "User",
        back_populates="audit_logs",
    )

    __table_args__ = (
        {"comment": "WORM audit trail — records MUST NOT be modified or deleted"},
    )
