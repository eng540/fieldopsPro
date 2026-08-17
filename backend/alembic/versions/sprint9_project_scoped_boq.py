"""Sprint-9: project-scoped BOQ with unit applicability.

The old schema stored boq_items under project_units. V4 now treats a BOQ item as
one project definition and stores unit applicability/planned quantity separately.
Existing rows are preserved and converted into assignments before the legacy
unit_id column is cleared.
"""
from alembic import op
import sqlalchemy as sa

revision = "sprint9_project_scoped_boq_001"
down_revision = "sprint8_field_diary_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("boq_items", sa.Column("project_id", sa.Integer(), nullable=True))
    op.add_column("boq_items", sa.Column("code", sa.String(80), nullable=True))
    op.add_column("boq_items", sa.Column("category", sa.String(120), nullable=True))
    op.add_column("boq_items", sa.Column("rate", sa.Float(), nullable=False, server_default="0"))
    op.add_column("boq_items", sa.Column("amount", sa.Float(), nullable=False, server_default="0"))
    op.add_column("boq_items", sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("boq_items", sa.Column("extra_data", sa.JSON(), nullable=True))

    op.execute("""
        UPDATE boq_items b
        SET project_id = u.project_id,
            code = 'LEGACY-' || b.id::text,
            category = b.trade,
            amount = b.quantity * 0
        FROM project_units u
        WHERE b.unit_id = u.id
    """)
    op.execute("UPDATE boq_items SET project_id = (SELECT id FROM projects WHERE projects.org_id = boq_items.org_id ORDER BY id LIMIT 1) WHERE project_id IS NULL")
    op.alter_column("boq_items", "project_id", nullable=False)
    op.alter_column("boq_items", "code", nullable=False)

    op.create_foreign_key("fk_boq_items_project", "boq_items", "projects", ["project_id"], ["id"])
    op.create_unique_constraint("uq_boq_items_project_code", "boq_items", ["project_id", "code"])
    op.create_index("ix_boq_items_project_id", "boq_items", ["project_id"])

    op.create_table(
        "unit_boq_assignments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("unit_id", sa.Integer(), sa.ForeignKey("project_units.id", ondelete="CASCADE"), nullable=False),
        sa.Column("boq_item_id", sa.Integer(), sa.ForeignKey("boq_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("planned_quantity", sa.Float(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("extra_data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("unit_id", "boq_item_id", name="uq_unit_boq_assignment"),
    )
    op.create_index("ix_unit_boq_assignment_org", "unit_boq_assignments", ["org_id"])
    op.create_index("ix_unit_boq_assignment_unit", "unit_boq_assignments", ["unit_id"])
    op.create_index("ix_unit_boq_assignment_boq", "unit_boq_assignments", ["boq_item_id"])

    op.execute("""
        INSERT INTO unit_boq_assignments (org_id, unit_id, boq_item_id, planned_quantity)
        SELECT org_id, unit_id, id, quantity
        FROM boq_items
        WHERE unit_id IS NOT NULL
        ON CONFLICT (unit_id, boq_item_id) DO NOTHING
    """)

    # unit_id is retained temporarily as a nullable compatibility column for old
    # integrations, but it is no longer used as the ownership relationship.
    op.alter_column("boq_items", "unit_id", nullable=True)
    op.execute("UPDATE boq_items SET unit_id = NULL")


def downgrade() -> None:
    op.drop_index("ix_unit_boq_assignment_boq", table_name="unit_boq_assignments")
    op.drop_index("ix_unit_boq_assignment_unit", table_name="unit_boq_assignments")
    op.drop_index("ix_unit_boq_assignment_org", table_name="unit_boq_assignments")
    op.drop_table("unit_boq_assignments")
    op.drop_index("ix_boq_items_project_id", table_name="boq_items")
    op.drop_constraint("uq_boq_items_project_code", "boq_items", type_="unique")
    op.drop_constraint("fk_boq_items_project", "boq_items", type_="foreignkey")
    op.drop_column("boq_items", "extra_data")
    op.drop_column("boq_items", "sequence")
    op.drop_column("boq_items", "amount")
    op.drop_column("boq_items", "rate")
    op.drop_column("boq_items", "category")
    op.drop_column("boq_items", "code")
    op.drop_column("boq_items", "project_id")
