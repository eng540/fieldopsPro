"""Sprint-2 CP-1: Create execution tables — work_orders, work_order_assignments,
work_order_status_history, work_order_sync_logs.

Constitutional:
- All tables include org_id for multi-tenant isolation
- work_orders.completion_pct supports Monotonic Progress (ADR-003)
- work_order_status_history is WORM (append-only audit)
- work_order_sync_logs.operation_uuid guarantees Exactly-Once Sync (ADR-002)
- PostgreSQL-compatible: Uses VARCHAR for enums (not native ENUM types)
  to avoid the DEF-2 PostgreSQL-only ENUM issue from Sprint-1.

Revision ID: sprint2_cp1
Revises: None
Create Date: 2025-01-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "sprint2_cp1"
down_revision: Union[str, None] = "sprint3_projects_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create execution tables with multi-tenant isolation."""

    # ─────────────────────────────────────────
    # work_orders — Core work order entity
    # ─────────────────────────────────────────
    op.create_table(
        "work_orders",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "org_id", sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
            comment="Organization ID for multi-tenant isolation",
        ),
        sa.Column(
            "project_id", sa.Integer(),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column(
            "unit_id", sa.Integer(),
            sa.ForeignKey("project_units.id"),
            nullable=True,
        ),
        sa.Column(
            "title", sa.String(255),
            nullable=False,
            comment="Brief descriptive title of the work order",
        ),
        sa.Column(
            "description", sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "wo_type", sa.String(20),
            nullable=False,
            server_default="CORRECTIVE",
        ),
        sa.Column(
            "priority", sa.String(10),
            nullable=False,
            server_default="MEDIUM",
        ),
        sa.Column(
            "status", sa.String(20),
            nullable=False,
            server_default="DRAFT",
        ),
        sa.Column(
            "completion_pct", sa.Float(),
            nullable=False,
            server_default="0.0",
            comment="Monotonic — cannot decrease without rework (ADR-003)",
        ),
        sa.Column(
            "rework_flag", sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        sa.Column(
            "rework_reason", sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "rework_authorized_by", sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "created_by", sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "device_timestamp", sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "server_timestamp", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "location_data", sa.JSON(),
            nullable=True,
        ),
        sa.Column(
            "extra_data", sa.JSON(),
            nullable=True,
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
        sa.UniqueConstraint("org_id", "id", name="uq_work_orders_org_id"),
    )

    # Indexes for work_orders
    op.create_index("ix_work_orders_org_id", "work_orders", ["org_id"])
    op.create_index("ix_work_orders_project_id", "work_orders", ["project_id"])
    op.create_index("ix_work_orders_unit_id", "work_orders", ["unit_id"])
    op.create_index("ix_work_orders_status", "work_orders", ["status"])
    op.create_index("ix_work_orders_created_by", "work_orders", ["created_by"])

    # ─────────────────────────────────────────
    # work_order_assignments — Personnel assignment
    # ─────────────────────────────────────────
    op.create_table(
        "work_order_assignments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "org_id", sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "work_order_id", sa.Integer(),
            sa.ForeignKey("work_orders.id"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "assigned_by", sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "status", sa.String(15),
            nullable=False,
            server_default="ACTIVE",
        ),
        sa.Column(
            "notes", sa.Text(),
            nullable=True,
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
    )

    # Indexes for work_order_assignments
    op.create_index("ix_wo_assignments_org_id", "work_order_assignments", ["org_id"])
    op.create_index("ix_wo_assignments_wo_id", "work_order_assignments", ["work_order_id"])
    op.create_index("ix_wo_assignments_user_id", "work_order_assignments", ["user_id"])

    # ─────────────────────────────────────────
    # work_order_status_history — WORM audit trail
    # ─────────────────────────────────────────
    op.create_table(
        "work_order_status_history",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "org_id", sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "work_order_id", sa.Integer(),
            sa.ForeignKey("work_orders.id"),
            nullable=False,
        ),
        sa.Column(
            "changed_by", sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "from_status", sa.String(20),
            nullable=False,
        ),
        sa.Column(
            "to_status", sa.String(20),
            nullable=False,
        ),
        sa.Column(
            "reason", sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "rework_flag", sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        sa.Column(
            "rework_reason", sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "rework_authorized_by", sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        comment="WORM audit trail — records MUST NOT be modified or deleted",
    )

    # Indexes for work_order_status_history
    op.create_index("ix_wo_status_hist_org_id", "work_order_status_history", ["org_id"])
    op.create_index("ix_wo_status_hist_wo_id", "work_order_status_history", ["work_order_id"])
    op.create_index("ix_wo_status_hist_changed_by", "work_order_status_history", ["changed_by"])

    # ─────────────────────────────────────────
    # work_order_sync_logs — Exactly-Once sync
    # ─────────────────────────────────────────
    op.create_table(
        "work_order_sync_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "org_id", sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "work_order_id", sa.Integer(),
            sa.ForeignKey("work_orders.id"),
            nullable=False,
        ),
        sa.Column(
            "operation_uuid", sa.String(36),
            nullable=False,
            comment="UUID for idempotency. Prevents duplicate processing.",
        ),
        sa.Column(
            "operation_type", sa.String(15),
            nullable=False,
        ),
        sa.Column(
            "synced_by", sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "sync_status", sa.String(15),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column(
            "conflict_details", sa.JSON(),
            nullable=True,
        ),
        sa.Column(
            "device_timestamp", sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "server_timestamp", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("operation_uuid", name="uq_work_order_sync_operation_uuid"),
        comment="Exactly-Once sync deduplication log",
    )

    # Indexes for work_order_sync_logs
    op.create_index("ix_wo_sync_logs_org_id", "work_order_sync_logs", ["org_id"])
    op.create_index("ix_wo_sync_logs_wo_id", "work_order_sync_logs", ["work_order_id"])
    op.create_index("ix_wo_sync_logs_op_uuid", "work_order_sync_logs", ["operation_uuid"], unique=True)
    op.create_index("ix_wo_sync_logs_sync_status", "work_order_sync_logs", ["sync_status"])


def downgrade() -> None:
    """Drop execution tables in reverse dependency order."""
    op.drop_table("work_order_sync_logs")
    op.drop_table("work_order_status_history")
    op.drop_table("work_order_assignments")
    op.drop_table("work_orders")
