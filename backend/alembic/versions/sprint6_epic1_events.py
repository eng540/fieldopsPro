# --- START OF FILE backend/alembic/versions/sprint6_epic1_events.py ---

"""Sprint-6 Epic 1: Dynamic Progress and Event Log

Revision ID: sprint6_epic1_001
Revises: sprint5_rls_001
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "sprint6_epic1_001"
down_revision = "sprint5_rls_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create event_sync_logs table (Idempotency Registry)
    op.create_table(
        "event_sync_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("operation_uuid", sa.String(36), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("response_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("operation_uuid", name="uq_event_sync_logs_uuid")
    )
    op.create_index("ix_event_sync_logs_org_id", "event_sync_logs", ["org_id"])

    # 2. Create execution_events table (WORM Event Log)
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
        sa.UniqueConstraint("sync_uuid", name="uq_execution_events_sync_uuid")
    )
    op.create_index("ix_execution_events_org_id", "execution_events", ["org_id"])
    op.create_index("ix_execution_events_entity", "execution_events", ["entity_type", "entity_id"])
    op.create_index("ix_execution_events_timeline", "execution_events", ["org_id", "unit_id", "occurred_at"])

    # 3. Add new state columns to unit_boq_progress
    op.add_column("unit_boq_progress", sa.Column("state_version", sa.Integer(), server_default="1", nullable=False))
    op.add_column("unit_boq_progress", sa.Column("actual_quantity", sa.Float(), nullable=True))
    op.add_column("unit_boq_progress", sa.Column("financial_value", sa.Float(), nullable=True))
    op.add_column("unit_boq_progress", sa.Column("last_event_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_unit_boq_progress_last_event_id",
        "unit_boq_progress", "execution_events",
        ["last_event_id"], ["id"]
    )

    # 4. Safe Data Migration using CTE
    op.execute("""
        WITH generated_events AS (
            SELECT
                id as boq_prog_id,
                org_id,
                unit_id,
                boq_item_id,
                completion_pct,
                updated_at,
                updated_by,
                gen_random_uuid()::varchar as new_sync_uuid,
                gen_random_uuid()::varchar as new_event_id
            FROM unit_boq_progress
        ),
        insert_sync AS (
            INSERT INTO event_sync_logs (org_id, operation_uuid, status, created_at)
            SELECT org_id, new_sync_uuid, 'PROCESSED', updated_at FROM generated_events
        ),
        insert_events AS (
            INSERT INTO execution_events (
                id, org_id, unit_id, entity_type, entity_id, event_class, event_type, metric_type,
                new_value, occurred_at, recorded_at, user_id, notes, sync_uuid
            )
            SELECT
                new_event_id, org_id, unit_id, 'BOQ_ITEM', boq_item_id::varchar, 'PROGRESS',
                'INITIAL_STATE', 'PERCENTAGE', jsonb_build_object('pct', completion_pct),
                updated_at, updated_at, updated_by, 'تم ترحيل الحالة من النظام القديم (V4.0 Legacy)', new_sync_uuid
            FROM generated_events
            RETURNING id, unit_id, entity_id
        )
        UPDATE unit_boq_progress u
        SET last_event_id = e.id
        FROM insert_events e
        WHERE u.unit_id = e.unit_id AND u.boq_item_id::varchar = e.entity_id;
    """)

    # 5. Apply Strict RLS (Dynamic, without hardcoded roles)
    for table in ["event_sync_logs", "execution_events"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY org_isolation_policy ON {table}
                FOR ALL
                USING (
                    current_setting('app.current_org_id', true) IS NULL 
                    OR current_setting('app.current_org_id', true) = ''
                    OR org_id = NULLIF(current_setting('app.current_org_id', true), '')::INTEGER
                )
                WITH CHECK (
                    current_setting('app.current_org_id', true) IS NULL 
                    OR current_setting('app.current_org_id', true) = ''
                    OR org_id = NULLIF(current_setting('app.current_org_id', true), '')::INTEGER
                );
        """)

    # 6. Enforce WORM via PostgreSQL Trigger (Bulletproof)
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_update_delete()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'WORM Violation: Updates and Deletes are strictly prohibited on this table.';
        END;
        $$ LANGUAGE plpgsql;
    """)
    
    op.execute("""
        CREATE TRIGGER enforce_worm_execution_events
        BEFORE UPDATE OR DELETE ON execution_events
        FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
    """)


def downgrade() -> None:
    # Drop WORM Trigger and Function
    op.execute("DROP TRIGGER IF EXISTS enforce_worm_execution_events ON execution_events;")
    op.execute("DROP FUNCTION IF EXISTS prevent_update_delete();")

    # Remove RLS
    for table in ["execution_events", "event_sync_logs"]:
        op.execute(f"DROP POLICY IF EXISTS org_isolation_policy ON {table};")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")

    # Remove columns from unit_boq_progress using the named constraint
    op.drop_constraint("fk_unit_boq_progress_last_event_id", "unit_boq_progress", type_="foreignkey")
    op.drop_column("unit_boq_progress", "last_event_id")
    op.drop_column("unit_boq_progress", "financial_value")
    op.drop_column("unit_boq_progress", "actual_quantity")
    op.drop_column("unit_boq_progress", "state_version")

    # Drop tables
    op.drop_table("execution_events")
    op.drop_table("event_sync_logs")