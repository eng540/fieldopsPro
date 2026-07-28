"""Sprint-3: Quality (remark_templates, remarks) + Governance tables

Revision ID: sprint3_qg_001
Revises: sprint3_projects_001
Create Date: 2026-07-26
"""
from alembic import op
import sqlalchemy as sa

revision = "sprint3_qg_001"
down_revision = "sprint2_cp1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Quality ──────────────────────────────────────────────────────────────
    op.create_table(
        "remark_templates",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer, sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("issue", sa.String(500), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("recommended_action", sa.Text, nullable=True),
        sa.Column("auto_hold", sa.Boolean, nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_remark_templates_org_id", "remark_templates", ["org_id"])
    op.create_index("ix_remark_templates_category", "remark_templates", ["category"])

    op.create_table(
        "remarks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("org_id", sa.Integer, sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("unit_id", sa.Integer, sa.ForeignKey("project_units.id"), nullable=False),
        sa.Column("work_order_id", sa.Integer, sa.ForeignKey("work_orders.id"), nullable=True),
        sa.Column("template_id", sa.Integer, sa.ForeignKey("remark_templates.id"), nullable=True),
        sa.Column("custom_issue", sa.String(1000), nullable=True),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="OPEN"),
        sa.Column("photos", sa.JSON, nullable=True),
        sa.Column("gps_tag", sa.JSON, nullable=True),
        sa.Column("resolution_notes", sa.Text, nullable=True),
        sa.Column("resolution_photos", sa.JSON, nullable=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_remarks_org_id", "remarks", ["org_id"])
    op.create_index("ix_remarks_unit_id", "remarks", ["unit_id"])
    op.create_index("ix_remarks_severity", "remarks", ["severity"])
    op.create_index("ix_remarks_status", "remarks", ["status"])

    # ── Governance ───────────────────────────────────────────────────────────
    op.create_table(
        "governance_policies",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer, sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_governance_policies_org_id", "governance_policies", ["org_id"])

    op.create_table(
        "governance_policy_rules",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("policy_id", sa.Integer, sa.ForeignKey("governance_policies.id"), nullable=False),
        sa.Column("org_id", sa.Integer, sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("rule_code", sa.String(50), nullable=False),
        sa.Column("priority", sa.Integer, nullable=False, server_default="100"),
        sa.Column("decision", sa.String(30), nullable=False),
        sa.Column("payment_pct", sa.Float, nullable=False, server_default="0.0"),
        sa.Column("condition_json", sa.JSON, nullable=False),
        sa.Column("flag_message", sa.String(500), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_governance_rules_policy_id", "governance_policy_rules", ["policy_id"])
    op.create_index("ix_governance_rules_org_id", "governance_policy_rules", ["org_id"])

    op.create_table(
        "governance_decisions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer, sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("unit_id", sa.Integer, sa.ForeignKey("project_units.id"), nullable=False),
        sa.Column("boq_item_id", sa.Integer, sa.ForeignKey("boq_items.id"), nullable=True),
        sa.Column("remark_id", sa.String(36), nullable=True),
        sa.Column("decision", sa.String(30), nullable=False),
        sa.Column("payment_pct", sa.Float, nullable=False, server_default="0.0"),
        sa.Column("flag", sa.String(500), nullable=True),
        sa.Column("matched_rule", sa.String(50), nullable=True),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("policy_version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("explainability", sa.JSON, nullable=False),
        sa.Column("triggered_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("is_overridden", sa.Boolean, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_governance_decisions_org_id", "governance_decisions", ["org_id"])
    op.create_index("ix_governance_decisions_unit_id", "governance_decisions", ["unit_id"])
    op.create_index("ix_governance_decisions_decision", "governance_decisions", ["decision"])

    op.create_table(
        "governance_overrides",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer, sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("decision_id", sa.Integer, sa.ForeignKey("governance_decisions.id"), nullable=False),
        sa.Column("overridden_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("justification", sa.Text, nullable=False),
        sa.Column("new_payment_pct", sa.Float, nullable=True),
        sa.Column("new_decision", sa.String(30), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_governance_overrides_org_id", "governance_overrides", ["org_id"])
    op.create_index("ix_governance_overrides_decision_id", "governance_overrides", ["decision_id"])


def downgrade() -> None:
    for tbl in [
        "governance_overrides", "governance_decisions",
        "governance_policy_rules", "governance_policies",
        "remarks", "remark_templates",
    ]:
        op.drop_table(tbl)


# NOTE: unit_boq_progress migration is in sprint4_boq_progress.py
