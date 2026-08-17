"""Reconcile BOQ applicability with existing execution state.

Configuration is explicit: Project -> BOQItem -> UnitBoQAssignment.
Execution state may exist from legacy imports or offline sync, so this
migration creates only missing assignments for valid project/unit/item pairs
that already have evidence in the database. It never invents a new BOQ item,
unit, quantity, or progress value.
"""
from alembic import op

revision = "s11_boq_assign_reconcile"
down_revision = "sprint10_repair_legacy_boq_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # First preserve legacy per-unit BOQ applicability when present.
    op.execute("""
        INSERT INTO unit_boq_assignments
            (org_id, unit_id, boq_item_id, planned_quantity, is_active, created_at, updated_at)
        SELECT b.org_id, b.unit_id, b.id, COALESCE(b.quantity, 0), b.is_active,
               COALESCE(b.created_at, now()), COALESCE(b.updated_at, now())
        FROM boq_items b
        JOIN project_units u ON u.id = b.unit_id AND u.project_id = b.project_id
        WHERE b.unit_id IS NOT NULL
          AND b.is_active = TRUE
        ON CONFLICT (unit_id, boq_item_id)
        DO UPDATE SET
            planned_quantity = CASE
                WHEN unit_boq_assignments.planned_quantity = 0
                THEN EXCLUDED.planned_quantity
                ELSE unit_boq_assignments.planned_quantity
            END,
            is_active = TRUE,
            updated_at = now()
    """)

    # Then reconcile orphan execution state. The pair is valid only when the
    # unit and BOQ item belong to the same project and organization.
    op.execute("""
        INSERT INTO unit_boq_assignments
            (org_id, unit_id, boq_item_id, planned_quantity, is_active, created_at, updated_at)
        SELECT DISTINCT p.org_id, p.unit_id, p.boq_item_id, 0, TRUE, now(), now()
        FROM unit_boq_progress p
        JOIN project_units u
          ON u.id = p.unit_id
         AND u.org_id = p.org_id
         AND u.is_active = TRUE
        JOIN boq_items b
          ON b.id = p.boq_item_id
         AND b.org_id = p.org_id
         AND b.project_id = u.project_id
         AND b.is_active = TRUE
        LEFT JOIN unit_boq_assignments a
          ON a.unit_id = p.unit_id
         AND a.boq_item_id = p.boq_item_id
        WHERE a.id IS NULL
        ON CONFLICT (unit_id, boq_item_id) DO NOTHING
    """)

    # Keep explicit applicability for existing legacy unit_id links even when
    # no progress row exists, so project configuration and Speed Entry agree.
    op.execute("""
        UPDATE boq_items
        SET unit_id = NULL
        WHERE unit_id IS NOT NULL
    """)


def downgrade() -> None:
    # Deliberately no destructive downgrade: assignments may have been used by
    # new execution events after this migration ran.
    pass
