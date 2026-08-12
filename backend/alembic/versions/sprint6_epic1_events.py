"""Sprint-6 Epic 1: Event-Logged State Architecture.

Creates the append-only event ledger and idempotency registry, migrates every
legacy BOQ state into an INITIAL_STATE event, tightens Sprint-5 RLS to fail
closed, and applies database-level WORM enforcement.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "sprint6_epic1_001"
down_revision = "sprint5_rls_001"
branch_labels = None
depends_on = None

_RLS_TABLES = [
    "users", "roles", "project_users", "audit_logs", "projects", "project_units",
    "boq_items", "work_orders", "work_order_assignments", "work_order_status_history",
    "work_order_sync_logs", "unit_boq_progress", "remarks", "remark_templates",
    "governance_decisions", "event_sync_logs", "execution_events",
]


def _strict_rls(table: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS org_isolation_policy ON {table};")
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
    op.execute(f"""
        CREATE POLICY org_isolation_policy ON {table}
        FOR ALL
        USING (
            NULLIF(current_setting('app.current_org_id', true), '') IS NOT NULL
            AND org_id = NULLIF(current_setting('app.current_org_id', true), '')::INTEGER
        )
        WITH CHECK (
            NULLIF(current_setting('app.current_org_id', true), '') IS NOT NULL
            AND org_id = NULLIF(current_setting('app.current_org_id', true), '')::INTEGER
        );
    """)


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
    op.create_index("ix_execution_events_transaction_group", "execution_events", ["transaction_group_id"])

    op.add_column("unit_boq_progress", sa.Column("state_version", sa.Integer(), server_default="1", nullable=False))
    op.add_column("unit_boq_progress", sa.Column("actual_quantity", sa.Float(), nullable=True))
    op.add_column("unit_boq_progress", sa.Column("financial_value", sa.Float(), nullable=True))
    op.add_column("unit_boq_progress", sa.Column("last_event_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_unit_boq_progress_last_event_id", "unit_boq_progress", "execution_events",
        ["last_event_id"], ["id"],
    )

    # One deterministic mapping per legacy row. No >0 filter: zero-progress
    # rows also establish the INITIAL_STATE baseline.
    op.execute("""
        DO $$
        DECLARE r RECORD; v_event_id VARCHAR(36); v_sync_uuid VARCHAR(36);
        BEGIN
            FOR r IN SELECT id, org_id, unit_id, boq_item_id, completion_pct, status,
                            measured_quantity, rework_flag, rework_reason,
                            rework_authorized_by, updated_by, updated_at
                     FROM unit_boq_progress ORDER BY id
            LOOP
                v_event_id := gen_random_uuid()::varchar;
                v_sync_uuid := gen_random_uuid()::varchar;
                INSERT INTO event_sync_logs(org_id, operation_uuid, status, response_payload, created_at)
                VALUES(r.org_id, v_sync_uuid, 'PROCESSED',
                       jsonb_build_object('event_id', v_event_id, 'event_type', 'INITIAL_STATE',
                                          'source', 'legacy_unit_boq_progress'), r.updated_at);
                INSERT INTO execution_events(
                    id, org_id, unit_id, entity_type, entity_id, event_class, event_type,
                    metric_type, previous_value, new_value, occurred_at, recorded_at, user_id,
                    notes, sync_uuid
                ) VALUES(
                    v_event_id, r.org_id, r.unit_id, 'BOQ_ITEM', r.boq_item_id::varchar,
                    'PROGRESS', 'INITIAL_STATE', 'PERCENTAGE', NULL,
                    jsonb_build_object('completion_pct', r.completion_pct, 'status', r.status,
                                       'measured_quantity', r.measured_quantity,
                                       'rework_flag', r.rework_flag, 'rework_reason', r.rework_reason,
                                       'rework_authorized_by', r.rework_authorized_by),
                    r.updated_at, r.updated_at, r.updated_by,
                    'Migrated from legacy unit_boq_progress', v_sync_uuid);
                UPDATE unit_boq_progress SET state_version = 1, actual_quantity = r.measured_quantity,
                    last_event_id = v_event_id WHERE id = r.id;
            END LOOP;
        END $$;
    """)

    # Tighten the previously permissive Sprint-5 policies for every tenant table.
    # Alembic runs under the migration role; PostgreSQL superusers bypass RLS.
    for table in _RLS_TABLES:
        _strict_rls(table)

    # App role has no UPDATE/DELETE on either event table.
    op.execute("GRANT SELECT, INSERT ON TABLE event_sync_logs TO fieldops_app;")
    op.execute("GRANT SELECT, INSERT ON TABLE execution_events TO fieldops_app;")
    op.execute("GRANT USAGE, SELECT ON SEQUENCE event_sync_logs_id_seq TO fieldops_app;")

    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_execution_event_mutation()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'WORM Violation: execution_events is append-only; % is forbidden', TG_OP
                USING ERRCODE = '42501';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("DROP TRIGGER IF EXISTS enforce_worm_execution_events ON execution_events;")
    op.execute("""
        CREATE TRIGGER enforce_worm_execution_events
        BEFORE UPDATE OR DELETE ON execution_events
        FOR EACH ROW EXECUTE FUNCTION prevent_execution_event_mutation();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS enforce_worm_execution_events ON execution_events;")
    op.execute("DROP FUNCTION IF EXISTS prevent_execution_event_mutation();")
    op.execute("REVOKE ALL ON TABLE execution_events FROM fieldops_app;")
    op.execute("REVOKE ALL ON TABLE event_sync_logs FROM fieldops_app;")
    op.execute("REVOKE ALL ON SEQUENCE event_sync_logs_id_seq FROM fieldops_app;")

    for table in _RLS_TABLES:
        op.execute(f"DROP POLICY IF EXISTS org_isolation_policy ON {table};")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")

    op.drop_constraint("fk_unit_boq_progress_last_event_id", "unit_boq_progress", type_="foreignkey")
    op.drop_column("unit_boq_progress", "last_event_id")
    op.drop_column("unit_boq_progress", "financial_value")
    op.drop_column("unit_boq_progress", "actual_quantity")
    op.drop_column("unit_boq_progress", "state_version")

    op.drop_index("ix_execution_events_transaction_group", table_name="execution_events")
    op.drop_index("ix_execution_events_timeline", table_name="execution_events")
    op.drop_index("ix_execution_events_entity", table_name="execution_events")
    op.drop_index("ix_execution_events_org_id", table_name="execution_events")
    op.drop_table("execution_events")
    op.drop_index("ix_event_sync_logs_org_id", table_name="event_sync_logs")
    op.drop_table("event_sync_logs")
