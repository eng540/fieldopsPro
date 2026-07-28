"""Sprint-3: Projects, ProjectUnits, BOQItems tables

Revision ID: sprint3_projects_001
Revises: sprint2_cp1_execution_tables
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

revision = "sprint3_projects_001"
down_revision = "sprint1_iam"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer, sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="PLANNING"),
        sa.Column("location", sa.String(500), nullable=True),
        sa.Column("start_date", sa.String(20), nullable=True),
        sa.Column("end_date", sa.String(20), nullable=True),
        sa.Column("total_units", sa.Integer, nullable=False, server_default="0"),
        sa.Column("completion_pct", sa.Float, nullable=False, server_default="0.0"),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("extra_data", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("org_id", "code", name="uq_projects_org_code"),
    )
    op.create_index("ix_projects_org_id", "projects", ["org_id"])
    op.create_index("ix_projects_status", "projects", ["status"])

    op.create_table(
        "project_units",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer, sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("project_id", sa.Integer, sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("unit_type", sa.String(100), nullable=True),
        sa.Column("floor", sa.Integer, nullable=True),
        sa.Column("area_sqm", sa.Float, nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="PENDING"),
        sa.Column("completion_pct", sa.Float, nullable=False, server_default="0.0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "code", name="uq_units_project_code"),
    )
    op.create_index("ix_project_units_org_id", "project_units", ["org_id"])
    op.create_index("ix_project_units_project_id", "project_units", ["project_id"])

    op.create_table(
        "boq_items",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer, sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("unit_id", sa.Integer, sa.ForeignKey("project_units.id"), nullable=False),
        sa.Column("trade", sa.String(100), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("quantity", sa.Float, nullable=False, server_default="0.0"),
        sa.Column("unit_of_measure", sa.String(50), nullable=False, server_default="item"),
        sa.Column("completion_pct", sa.Float, nullable=False, server_default="0.0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_boq_items_org_id", "boq_items", ["org_id"])
    op.create_index("ix_boq_items_unit_id", "boq_items", ["unit_id"])


def downgrade() -> None:
    op.drop_table("boq_items")
    op.drop_table("project_units")
    op.drop_table("projects")
