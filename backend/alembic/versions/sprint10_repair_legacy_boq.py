"""Sprint-10: repair legacy BOQ duplication after project-scoped migration.

Canonical invariant:
Project -> BOQ definition (one row per semantic project item)
ProjectUnit -> UnitBoQAssignment -> BOQItem
UnitBoQProgress -> execution state

Only legacy-coded BOQ rows are automatically consolidated. Intentionally
separately-coded project BOQ lines are left untouched.
"""
from alembic import op

revision = "sprint10_repair_legacy_boq_001"
down_revision = "sprint9_project_scoped_boq_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO unit_boq_assignments
            (org_id, unit_id, boq_item_id, planned_quantity, is_active, created_at, updated_at)
        SELECT b.org_id, b.unit_id, b.id, COALESCE(b.quantity, 0), b.is_active,
               COALESCE(b.created_at, now()), COALESCE(b.updated_at, now())
        FROM boq_items b
        WHERE b.unit_id IS NOT NULL
        ON CONFLICT (unit_id, boq_item_id)
        DO UPDATE SET
            planned_quantity = EXCLUDED.planned_quantity,
            is_active = EXCLUDED.is_active,
            updated_at = now()
    """)

    op.execute("""
        CREATE TEMP TABLE _legacy_boq_map ON COMMIT DROP AS
        WITH candidates AS (
            SELECT id, project_id,
                   LOWER(BTRIM(trade)) AS trade_key,
                   LOWER(BTRIM(description)) AS description_key,
                   LOWER(BTRIM(unit_of_measure)) AS uom_key
            FROM boq_items
            WHERE code LIKE 'LEGACY-%'
        ),
        groups AS (
            SELECT project_id, trade_key, description_key, uom_key, MIN(id) AS canonical_id
            FROM candidates
            GROUP BY project_id, trade_key, description_key, uom_key
        )
        SELECT c.id AS old_id, g.canonical_id
        FROM candidates c
        JOIN groups g
          ON g.project_id = c.project_id
         AND g.trade_key = c.trade_key
         AND g.description_key = c.description_key
         AND g.uom_key = c.uom_key
        WHERE c.id <> g.canonical_id
    """)

    op.execute("""
        INSERT INTO unit_boq_assignments
            (org_id, unit_id, boq_item_id, planned_quantity, is_active, created_at, updated_at)
        SELECT a.org_id, a.unit_id, m.canonical_id,
               SUM(a.planned_quantity), BOOL_OR(a.is_active), MIN(a.created_at), MAX(a.updated_at)
        FROM unit_boq_assignments a
        JOIN _legacy_boq_map m ON m.old_id = a.boq_item_id
        GROUP BY a.org_id, a.unit_id, m.canonical_id
        ON CONFLICT (unit_id, boq_item_id)
        DO UPDATE SET
            planned_quantity = unit_boq_assignments.planned_quantity + EXCLUDED.planned_quantity,
            is_active = unit_boq_assignments.is_active OR EXCLUDED.is_active,
            updated_at = now()
    """)

    op.execute("""
        UPDATE execution_events e
        SET entity_id = m.canonical_id::text
        FROM _legacy_boq_map m
        WHERE e.entity_type = 'BOQ_ITEM' AND e.entity_id = m.old_id::text
    """)

    op.execute("""
        CREATE TEMP TABLE _progress_merge ON COMMIT DROP AS
        SELECT p.unit_id, m.canonical_id AS boq_item_id,
               MAX(p.completion_pct) AS completion_pct,
               MAX(p.actual_quantity) AS actual_quantity,
               MAX(p.measured_quantity) AS measured_quantity,
               BOOL_OR(p.rework_flag) AS rework_flag
        FROM unit_boq_progress p
        JOIN _legacy_boq_map m ON m.old_id = p.boq_item_id
        GROUP BY p.unit_id, m.canonical_id
    """)

    op.execute("""
        UPDATE unit_boq_progress p
        SET completion_pct = GREATEST(p.completion_pct, x.completion_pct),
            actual_quantity = CASE WHEN p.actual_quantity IS NULL THEN x.actual_quantity
                                    WHEN x.actual_quantity IS NULL THEN p.actual_quantity
                                    ELSE GREATEST(p.actual_quantity, x.actual_quantity) END,
            measured_quantity = CASE WHEN p.measured_quantity IS NULL THEN x.measured_quantity
                                     WHEN x.measured_quantity IS NULL THEN p.measured_quantity
                                     ELSE GREATEST(p.measured_quantity, x.measured_quantity) END,
            rework_flag = p.rework_flag OR x.rework_flag,
            status = CASE WHEN GREATEST(p.completion_pct, x.completion_pct) >= 100 THEN 'COMPLETED'
                          WHEN GREATEST(p.completion_pct, x.completion_pct) > 0 THEN 'IN_PROGRESS'
                          ELSE p.status END,
            updated_at = now(), server_timestamp = now()
        FROM _progress_merge x
        WHERE p.unit_id = x.unit_id AND p.boq_item_id = x.boq_item_id
    """)

    op.execute("""
        DELETE FROM unit_boq_progress p
        USING _legacy_boq_map m
        WHERE p.boq_item_id = m.old_id
          AND EXISTS (SELECT 1 FROM unit_boq_progress c
                      WHERE c.unit_id = p.unit_id AND c.boq_item_id = m.canonical_id)
    """)

    op.execute("""
        DELETE FROM unit_boq_progress p
        USING _legacy_boq_map m
        WHERE p.boq_item_id = m.old_id
          AND p.id NOT IN (
              SELECT DISTINCT ON (p2.unit_id, m2.canonical_id) p2.id
              FROM unit_boq_progress p2
              JOIN _legacy_boq_map m2 ON m2.old_id = p2.boq_item_id
              WHERE NOT EXISTS (
                  SELECT 1 FROM unit_boq_progress c2
                  WHERE c2.unit_id = p2.unit_id AND c2.boq_item_id = m2.canonical_id
              )
              ORDER BY p2.unit_id, m2.canonical_id, p2.completion_pct DESC, p2.updated_at DESC, p2.id DESC
          )
    """)

    op.execute("""
        UPDATE unit_boq_progress p
        SET boq_item_id = m.canonical_id
        FROM _legacy_boq_map m
        WHERE p.boq_item_id = m.old_id
    """)

    op.execute("""
        DELETE FROM unit_boq_assignments a
        USING _legacy_boq_map m
        WHERE a.boq_item_id = m.old_id
    """)
    op.execute("""
        DELETE FROM boq_items b
        USING _legacy_boq_map m
        WHERE b.id = m.old_id
    """)

    op.execute("""
        UPDATE boq_items b
        SET quantity = COALESCE((SELECT SUM(a.planned_quantity)
                                FROM unit_boq_assignments a
                                WHERE a.boq_item_id = b.id AND a.is_active), b.quantity),
            amount = COALESCE((SELECT SUM(a.planned_quantity)
                               FROM unit_boq_assignments a
                               WHERE a.boq_item_id = b.id AND a.is_active), b.quantity) * b.rate
        WHERE EXISTS (SELECT 1 FROM _legacy_boq_map m WHERE m.canonical_id = b.id)
    """)

    op.execute("UPDATE boq_items SET unit_id = NULL WHERE unit_id IS NOT NULL")


def downgrade() -> None:
    pass
