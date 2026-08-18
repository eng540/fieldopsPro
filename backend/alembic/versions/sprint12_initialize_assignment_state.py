"""Initialize materialized execution state for active BOQ assignments.

Assignments are the applicability contract.  Every active assignment must have
one zeroed UnitBoQProgress row and one INITIAL_STATE event before the UI can
read or mutate execution state.  This migration creates only missing rows and
never overwrites existing progress or events.
"""
from alembic import op

revision = "s12_init_boq_state_001"
down_revision = "s11_boq_assign_reconcile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$
        DECLARE
            r RECORD;
            v_event_id VARCHAR(36);
            v_sync_uuid VARCHAR(36);
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM unit_boq_assignments a
                WHERE a.is_active = TRUE
                  AND NOT EXISTS (
                      SELECT 1 FROM users u
                      WHERE u.org_id = a.org_id AND u.is_active = TRUE
                  )
            ) THEN
                RAISE EXCEPTION 'Cannot initialize BOQ state: an active assignment has no active audit user';
            END IF;

            FOR r IN
                SELECT a.org_id, a.unit_id, a.boq_item_id,
                       u.project_id, usr.user_id,
                       COALESCE(a.created_at, now()) AS baseline_at
                FROM unit_boq_assignments a
                JOIN project_units u
                  ON u.id = a.unit_id
                 AND u.org_id = a.org_id
                 AND u.is_active = TRUE
                JOIN boq_items b
                  ON b.id = a.boq_item_id
                 AND b.project_id = u.project_id
                 AND b.org_id = a.org_id
                 AND b.is_active = TRUE
                CROSS JOIN LATERAL (
                    SELECT MIN(id) AS user_id
                    FROM users
                    WHERE org_id = a.org_id AND is_active = TRUE
                ) usr
                LEFT JOIN unit_boq_progress p
                  ON p.unit_id = a.unit_id AND p.boq_item_id = a.boq_item_id
                WHERE a.is_active = TRUE
                  AND p.id IS NULL
                ORDER BY a.unit_id, a.boq_item_id
            LOOP
                v_event_id := gen_random_uuid()::varchar;
                v_sync_uuid := gen_random_uuid()::varchar;

                INSERT INTO event_sync_logs
                    (org_id, operation_uuid, status, response_payload, created_at)
                VALUES
                    (r.org_id, v_sync_uuid, 'PROCESSED',
                     jsonb_build_object(
                         'event_id', v_event_id,
                         'event_type', 'INITIAL_STATE',
                         'source', 'assignment_state_reconciliation'
                     ), r.baseline_at)
                ON CONFLICT (operation_uuid) DO NOTHING;

                INSERT INTO unit_boq_progress
                    (org_id, unit_id, boq_item_id, completion_pct, status,
                     measured_quantity, rework_flag, updated_by,
                     server_timestamp, created_at, updated_at,
                     state_version, actual_quantity, financial_value, last_event_id)
                VALUES
                    (r.org_id, r.unit_id, r.boq_item_id, 0.0, 'NOT_STARTED',
                     0.0, FALSE, r.user_id,
                     r.baseline_at, r.baseline_at, r.baseline_at,
                     1, 0.0, 0.0, NULL)
                ON CONFLICT (unit_id, boq_item_id) DO NOTHING;

                INSERT INTO execution_events
                    (id, org_id, project_id, unit_id, entity_type, entity_id,
                     event_class, event_type, metric_type, previous_value,
                     new_value, occurred_at, recorded_at, user_id, notes, sync_uuid)
                SELECT v_event_id, r.org_id, r.project_id, r.unit_id,
                       'BOQ_ITEM', r.boq_item_id::varchar,
                       'PROGRESS', 'INITIAL_STATE', 'PERCENTAGE', NULL,
                       jsonb_build_object(
                           'completion_pct', 0.0,
                           'status', 'NOT_STARTED',
                           'actual_quantity', 0.0,
                           'source', 'assignment_state_reconciliation'
                       ), r.baseline_at, r.baseline_at, r.user_id,
                       'Initialized from active UnitBoQAssignment', v_sync_uuid
                WHERE EXISTS (
                    SELECT 1 FROM unit_boq_progress p
                    WHERE p.unit_id = r.unit_id AND p.boq_item_id = r.boq_item_id
                )
                ON CONFLICT (id) DO NOTHING;

                UPDATE unit_boq_progress
                SET last_event_id = v_event_id,
                    state_version = 1,
                    updated_at = r.baseline_at
                WHERE unit_id = r.unit_id
                  AND boq_item_id = r.boq_item_id
                  AND last_event_id IS NULL;
            END LOOP;
        END $$;
    """)


def downgrade() -> None:
    # Deliberately non-destructive: initialized states may already have events.
    pass
