"""Sprint-1: Create IAM tables — organizations, users, roles, project_users,
sessions, audit_logs.

Constitutional:
- All tables include org_id for multi-tenant isolation (except users FK target)
- Session table supports JWT revocation (ADR-004)
- AuditLog is WORM (append-only)
- PostgreSQL-compatible: Uses VARCHAR for enums (not native ENUM types)
  to avoid DEF-2 PostgreSQL-only ENUM issue from Sprint-1.

Revision ID: sprint1_iam
Revises: None
Create Date: 2026-06-02
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "sprint1_iam"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create IAM tables with multi-tenant isolation."""

    # ─────────────────────────────────────────
    # organizations — Multi-tenant root entity
    # ─────────────────────────────────────────
    op.create_table(
        "organizations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "name", sa.String(255),
            nullable=False,
            comment="Organization display name",
        ),
        sa.Column(
            "code", sa.String(50),
            nullable=False,
            comment="Unique organization code",
        ),
        sa.Column(
            "is_active", sa.Boolean(),
            nullable=False,
            server_default="true",
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_organizations_code"),
    )
    op.create_index("ix_organizations_code", "organizations", ["code"])

    # ─────────────────────────────────────────
    # users — Core user entity
    # ─────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "org_id", sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
            comment="Organization ID for multi-tenant isolation",
        ),
        sa.Column(
            "email", sa.String(255),
            nullable=False,
            comment="User email (login identifier)",
        ),
        sa.Column(
            "name", sa.String(255),
            nullable=False,
            comment="Full display name",
        ),
        sa.Column(
            "hashed_password", sa.String(255),
            nullable=False,
            comment="Bcrypt hash of user password",
        ),
        sa.Column(
            "is_active", sa.Boolean(),
            nullable=False,
            server_default="true",
        ),
        sa.Column(
            "device_public_key", sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "token_version", sa.Integer(),
            nullable=False,
            server_default="1",
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "email", name="uq_users_org_email"),
    )
    op.create_index("ix_users_org_id", "users", ["org_id"])
    op.create_index("ix_users_email", "users", ["email"])

    # ─────────────────────────────────────────
    # roles — RBAC role definitions
    # ─────────────────────────────────────────
    op.create_table(
        "roles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "org_id", sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "name", sa.String(50),
            nullable=False,
            comment="Role name matching UserRole enum values",
        ),
        sa.Column(
            "description", sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "permissions_json", sa.JSON(),
            nullable=True,
            comment="JSON blob of granular permissions",
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "name", name="uq_roles_org_name"),
    )

    # ─────────────────────────────────────────
    # project_users — User-project role assignment
    # ─────────────────────────────────────────
    op.create_table(
        "project_users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "org_id", sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "project_id", sa.Integer(),
            nullable=False,
            comment="FK to projects table (Projects module)",
        ),
        sa.Column(
            "role_id", sa.Integer(),
            sa.ForeignKey("roles.id"),
            nullable=False,
        ),
        sa.Column(
            "assigned_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "project_id", name="uq_project_users_user_project"),
    )
    op.create_index("ix_project_users_org_id", "project_users", ["org_id"])
    op.create_index("ix_project_users_user_id", "project_users", ["user_id"])
    op.create_index("ix_project_users_project_id", "project_users", ["project_id"])
    op.create_index("ix_project_users_role_id", "project_users", ["role_id"])

    # ─────────────────────────────────────────
    # sessions — JWT session registry
    # ─────────────────────────────────────────
    op.create_table(
        "sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "user_id", sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "session_id", sa.String(36),
            nullable=False,
            comment="UUID session identifier",
        ),
        sa.Column(
            "refresh_token_hash", sa.String(255),
            nullable=False,
            comment="Hashed refresh token",
        ),
        sa.Column(
            "device_info_json", sa.JSON(),
            nullable=True,
            comment="Device fingerprint info",
        ),
        sa.Column(
            "ip_address", sa.String(45),
            nullable=True,
        ),
        sa.Column(
            "status", sa.String(20),
            nullable=False,
            server_default="ACTIVE",
        ),
        sa.Column(
            "expires_at", sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", name="uq_sessions_session_id"),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_index("ix_sessions_session_id", "sessions", ["session_id"])
    op.create_index("ix_sessions_status", "sessions", ["status"])

    # ─────────────────────────────────────────
    # audit_logs — WORM audit trail
    # ─────────────────────────────────────────
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "org_id", sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "action", sa.String(50),
            nullable=False,
        ),
        sa.Column(
            "resource_type", sa.String(50),
            nullable=True,
        ),
        sa.Column(
            "resource_id", sa.String(255),
            nullable=True,
        ),
        sa.Column(
            "details_json", sa.JSON(),
            nullable=True,
        ),
        sa.Column(
            "ip_address", sa.String(45),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_logs_org_id", "audit_logs", ["org_id"])
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])


def downgrade() -> None:
    """Drop IAM tables in reverse dependency order."""
    op.drop_table("audit_logs")
    op.drop_table("sessions")
    op.drop_table("project_users")
    op.drop_table("roles")
    op.drop_table("users")
    op.drop_table("organizations")
