"""Sprint-6 Epic 1: Dynamic Progress and Event Log.

Revision ID: sprint6_epic1_001
Revises: sprint5_rls_001
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "sprint6_epic1_001"
down_revision = "sprint5_rls_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "event_sync_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("operation_uuid", sa.String(36), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("response_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("operation_uuid", name="uq_event_sync_logs_uuid"),
    )
    op.create_index("ix_event_sync_logs_org_id", "event_sync_logs", ["org_id"])

    op.create_table(
        "execution_events",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("unit_id", sa.Integer(), sa.ForeignKey("project_units.id"), nullable=True),
        sa.Column("entity_type", sa.String(50), nullable=False),
        sa.Column("entity_id", sa.String(255), nullable=False),
        sa.Column("event_class", sa.String(50), nullable=False),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("metric_type", sa.String(50), nullable=False),
        sa.Column("previous_value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("new_value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("delta_value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("unit_of_measure", sa.String(50), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("sync_uuid", sa.String(36), sa.ForeignKey("event_sync_logs.operation_uuid"), nullable=False),
        sa.Column("transaction_group_id", sa.String(36), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sync_uuid", name="uq_execution_events_sync_uuid"),
    )
    op.create_index("ix_execution_events_org_id", "execution_events", ["org_id"])
    op.create_index("ix_execution_events_entity", "execution_events", ["entity_type", "entity_id"])
    op.create_index("ix_execution_events_timeline", "execution_events", ["org_id", "unit_id", "occurred_at"])

    op.add_column("unit_boq_progress", sa.Column("state_version", sa.Integer(), server_default="1", nullable=False))
    op.add_column("unit_boq_progress", sa.Column("actual_quantity", sa.Float(), nullable=True))
    op.add_column("unit_boq_progress", sa.Column("financial_value", sa.Float(), nullable=True))
    op.add_column("unit_boq_progress", sa.Column("last_event_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_unit_boq_progress_last_event_id",
        "unit_boq_progress",
        "execution_events",
        ["last_event_id"],
        ["id"],
    )

    op.execute(
        """
        DO $$
        DECLARE
            r RECORD;
            v_event_id VARCHAR(36);
            v_sync_uuid VARCHAR(36);
        BEGIN
            FOR r IN
                SELECT id, org_id, unit_id, boq_item_id, completion_pct, status,
                       measured_quantity, rework_flag, rework_reason,
                       rework_authorized_by, updated_by, updated_at
                FROM unit_boq_progress
                ORDER BY id
            LOOP
                v_event_id := gen_random_uuid()::varchar;
                v_sync_uuid := gen_random_uuid()::varchar;

                INSERT INTO event_sync_logs (
                    org_id, operation_uuid, status, response_payload, created_at
                ) VALUES (
                    r.org_id, v_sync_uuid, 'PROCESSED',
                    jsonb_build_object(
                        'event_id', v_event_id,
                        'event_type', 'INITIAL_STATE',
                        'source', 'legacy_unit_boq_progress'
                    ), r.updated_at
                );

                INSERT INTO execution_events (
                    id, org_id, unit_id, entity_type, entity_id, event_class,
                    event_type, metric_type, previous_value, new_value, delta_value,
                    unit_of_measure, occurred_at, recorded_at, user_id, reason, notes,
                    sync_uuid
                ) VALUES (
                    v_event_id, r.org_id, r.unit_id, 'BOQ_ITEM', r.boq_item_id::varchar,
                    'PROGRESS', 'INITIAL_STATE',
                    CASE WHEN r.measured_quantity IS NOT NULL THEN 'QUANTITY' ELSE 'PERCENTAGE' END,
                    NULL,
                    jsonb_build_object(
                        'completion_pct', r.completion_pct,
                        'status', r.status,
                        'measured_quantity', r.measured_quantity,
                        'rework_flag', r.rework_flag,
                        'rework_reason', r.rework_reason,
                        'rework_authorized_by', r.rework_authorized_by
                    ),
                    NULL, NULL, r.updated_at, r.updated_at, r.updated_by, NULL,
                    'تم ترحيل الحالة الحالية من unit_boq_progress إلى Event Log كـ INITIAL_STATE.',
                    v_sync_uuid
                );

                UPDATE unit_boq_progress
                SET state_version = 1,
                    actual_quantity = r.measured_quantity,
                    last_event_id = v_event_id
                WHERE id = r.id;
            END LOOP;
        END $$;
        """
    )

    for table in ["event_sync_logs", "execution_events"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
        op.execute(f"DROP POLICY IF EXISTS org_isolation_policy ON {table};")
        op.execute(
            f"""
            CREATE POLICY org_isolation_policy ON {table}
                FOR ALL
                USING (
                    current_setting('app.current_org_id', true) IS NOT NULL
                    AND current_setting('app.current_org_id', true) <> ''
                    AND org_id = current_setting('app.current_org_id', true)::INTEGER
                )
                WITH CHECK (
                    current_setting('app.current_org_id', true) IS NOT NULL
                    AND current_setting('app.current_org_id', true) <> ''
                    AND org_id = current_setting('app.current_org_id', true)::INTEGER
                );
            """
        )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_update_delete_execution_events()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION
                'WORM Violation: execution_events is append-only; UPDATE/DELETE are prohibited.';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute("DROP TRIGGER IF EXISTS enforce_worm_execution_events ON execution_events;")
    op.execute(
        """
        CREATE TRIGGER enforce_worm_execution_events
        BEFORE UPDATE OR DELETE ON execution_events
        FOR EACH ROW
        EXECUTE FUNCTION prevent_update_delete_execution_events();
        """
    )

    op.execute("GRANT SELECT, INSERT ON TABLE execution_events TO fieldops_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE ON TABLE event_sync_logs TO fieldops_app;")


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS enforce_worm_execution_events ON execution_events;")
    op.execute("DROP FUNCTION IF EXISTS prevent_update_delete_execution_events();")

    for table in ["execution_events", "event_sync_logs"]:
        op.execute(f"DROP POLICY IF EXISTS org_isolation_policy ON {table};")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        op.execute(f"REVOKE ALL ON TABLE {table} FROM fieldops_app;")

    op.drop_constraint("fk_unit_boq_progress_last_event_id", "unit_boq_progress", type_="foreignkey")
    op.drop_column("unit_boq_progress", "last_event_id")
    op.drop_column("unit_boq_progress", "financial_value")
    op.drop_column("unit_boq_progress", "actual_quantity")
    op.drop_column("unit_boq_progress", "state_version")

    op.drop_index("ix_execution_events_timeline", table_name="execution_events")
    op.drop_index("ix_execution_events_entity", table_name="execution_events")
    op.drop_index("ix_execution_events_org_id", table_name="execution_events")
    op.drop_table("execution_events")

    op.drop_index("ix_event_sync_logs_org_id", table_name="event_sync_logs")
    op.drop_table("event_sync_logs")
