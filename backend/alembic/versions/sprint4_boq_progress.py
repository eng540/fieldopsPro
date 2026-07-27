"""Sprint-4: unit_boq_progress table

Revision ID: sprint4_boq_001
Revises: sprint3_qg_001
Create Date: 2026-07-27
"""
from alembic import op
import sqlalchemy as sa

revision     = "sprint4_boq_001"
down_revision = "sprint3_qg_001"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        "unit_boq_progress",
        sa.Column("id",           sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("org_id",       sa.Integer, sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("unit_id",      sa.Integer, sa.ForeignKey("project_units.id"), nullable=False),
        sa.Column("boq_item_id",  sa.Integer, sa.ForeignKey("boq_items.id"),     nullable=False),
        sa.Column("completion_pct", sa.Float, nullable=False, server_default="0.0"),
        sa.Column("status",       sa.String(30), nullable=False, server_default="NOT_STARTED"),
        sa.Column("measured_quantity", sa.Float, nullable=True),
        sa.Column("rework_flag",  sa.Boolean, nullable=False, server_default="0"),
        sa.Column("rework_reason", sa.Text, nullable=True),
        sa.Column("rework_authorized_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_by",   sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("server_timestamp", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("created_at",   sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at",   sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("unit_id", "boq_item_id", name="uq_unit_boq_progress"),
    )
    op.create_index("ix_unit_boq_progress_org_id",  "unit_boq_progress", ["org_id"])
    op.create_index("ix_unit_boq_progress_unit_id", "unit_boq_progress", ["unit_id"])


def downgrade() -> None:
    op.drop_table("unit_boq_progress")
