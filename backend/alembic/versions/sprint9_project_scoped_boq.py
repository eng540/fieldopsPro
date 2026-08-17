"""Sprint-9: project-scoped BOQ with unit applicability.

The old schema stored BOQ definitions per unit. V4 normalizes this into:
Project -> BOQ definition -> Unit applicability -> Execution state.

Legacy rows are consolidated by project + trade + description + UOM. Quantities
remain per-unit in unit_boq_assignments, while execution state is remapped to
the canonical BOQ id.
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
            category = b.trade
        FROM project_units u
        WHERE b.unit_id = u.id
    """)
    op.alter_column("boq_items", "project_id", nullable=False)
    op.alter_column("boq_items", "code", nullable=False)
    op.create_foreign_key("fk_boq_items_project", "boq_items", "projects", ["project_id"], ["id"])

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

    # Build a deterministic canonical id for semantically identical legacy rows.
    op.execute("""
        CREATE TEMP TABLE _boq_canonical_map ON COMMIT DROP AS
        SELECT id AS old_id,
               MIN(id) OVER (PARTITION BY project_id, trade, description, unit_of_measure) AS canonical_id
        FROM boq_items
    """)

    # Preserve unit-level planned quantities against the canonical BOQ item.
    op.execute("""
        INSERT INTO unit_boq_assignments (org_id, unit_id, boq_item_id, planned_quantity)
        SELECT b.org_id, b.unit_id, m.canonical_id, SUM(b.quantity)
        FROM boq_items b
        JOIN _boq_canonical_map m ON m.old_id = b.id
        WHERE b.unit_id IS NOT NULL
        GROUP BY b.org_id, b.unit_id, m.canonical_id
        ON CONFLICT (unit_id, boq_item_id)
        DO UPDATE SET planned_quantity = EXCLUDED.planned_quantity, updated_at = now()
    """)

    # Remap the materialized execution state to the canonical BOQ id.
    op.execute("""
        DELETE FROM unit_boq_progress p
        USING _boq_canonical_map m
        WHERE p.boq_item_id = m.old_id
          AND m.old_id <> m.canonical_id
          AND EXISTS (
              SELECT 1 FROM unit_boq_progress keep
              WHERE keep.unit_id = p.unit_id
                AND keep.boq_item_id = m.canonical_id
          )
    """)
    op.execute("""
        UPDATE unit_boq_progress p
        SET boq_item_id = m.canonical_id
        FROM _boq_canonical_map m
        WHERE p.boq_item_id = m.old_id AND m.old_id <> m.canonical_id
    """)

    # Remap the immutable event ledger's BOQ entity references.
    op.execute("""
        UPDATE execution_events e
        SET entity_id = m.canonical_id::text
        FROM _boq_canonical_map m
        WHERE e.entity_type = 'BOQ_ITEM'
          AND e.entity_id = m.old_id::text
          AND m.old_id <> m.canonical_id
    """)

    # Delete duplicate BOQ definitions only after references have been remapped.
    op.execute("""
        DELETE FROM boq_items b
        USING _boq_canonical_map m
        WHERE b.id = m.old_id AND m.old_id <> m.canonical_id
    """)

    # Canonical project-level quantity is the sum of its unit assignments.
    op.execute("""
        UPDATE boq_items b
        SET quantity = COALESCE((
                SELECT SUM(a.planned_quantity)
                FROM unit_boq_assignments a
                WHERE a.boq_item_id = b.id AND a.is_active
            ), b.quantity),
            amount = b.quantity * b.rate
    """)

    # Generate stable project-local BOQ codes after consolidation.
    op.execute("""
        WITH numbered AS (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY sequence, id) AS rn
            FROM boq_items
        )
        UPDATE boq_items b
        SET code = 'BOQ-' || LPAD(n.rn::text, 4, '0')
        FROM numbered n
        WHERE b.id = n.id
    """)
    op.create_unique_constraint("uq_boq_items_project_code", "boq_items", ["project_id", "code"])
    op.create_index("ix_boq_items_project_id", "boq_items", ["project_id"])

    # Legacy ownership column is retained only for compatibility and is no longer authoritative.
    op.execute("UPDATE boq_items SET unit_id = NULL")
    op.alter_column("boq_items", "unit_id", nullable=True)

    op.execute("ALTER TABLE unit_boq_assignments ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE unit_boq_assignments FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY unit_boq_assignment_org_isolation ON unit_boq_assignments
        FOR ALL USING (
            current_setting('app.current_org_id', true) IS NULL
            OR current_setting('app.current_org_id', true) = ''
            OR org_id = NULLIF(current_setting('app.current_org_id', true), '')::INTEGER
        ) WITH CHECK (
            current_setting('app.current_org_id', true) IS NULL
            OR current_setting('app.current_org_id', true) = ''
            OR org_id = NULLIF(current_setting('app.current_org_id', true), '')::INTEGER
        )
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS unit_boq_assignment_org_isolation ON unit_boq_assignments")
    op.execute("ALTER TABLE unit_boq_assignments NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE unit_boq_assignments DISABLE ROW LEVEL SECURITY")
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
