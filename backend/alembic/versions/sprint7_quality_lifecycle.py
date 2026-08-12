"""Sprint-7: Quality remark lifecycle ledger.

Revision ID: sprint7_quality_001
Revises: sprint6_epic1_001
"""
from alembic import op
import sqlalchemy as sa

revision = "sprint7_quality_001"
down_revision = "sprint6_epic1_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "remark_status_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("remark_id", sa.String(36), sa.ForeignKey("remarks.id"), nullable=False),
        sa.Column("from_status", sa.String(20), nullable=True),
        sa.Column("to_status", sa.String(20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    op.create_index("ix_remark_status_events_org_id", "remark_status_events", ["org_id"])
    op.create_index("ix_remark_status_events_remark_id", "remark_status_events", ["remark_id"])
    op.create_index("ix_remark_status_events_occurred_at", "remark_status_events", ["occurred_at"])

    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_remark_status_event_mutation()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'remark_status_events is append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_remark_status_events_worm
        BEFORE UPDATE OR DELETE ON remark_status_events
        FOR EACH ROW EXECUTE FUNCTION prevent_remark_status_event_mutation();
    """)

    op.execute("ALTER TABLE remark_status_events ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE remark_status_events FORCE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY org_isolation_policy ON remark_status_events
        FOR ALL
        USING (
            current_setting('app.current_org_id', true) IS NOT NULL
            AND current_setting('app.current_org_id', true) <> ''
            AND org_id = NULLIF(current_setting('app.current_org_id', true), '')::INTEGER
        )
        WITH CHECK (
            current_setting('app.current_org_id', true) IS NOT NULL
            AND current_setting('app.current_org_id', true) <> ''
            AND org_id = NULLIF(current_setting('app.current_org_id', true), '')::INTEGER
        );
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_remark_status_events_worm ON remark_status_events;")
    op.execute("DROP FUNCTION IF EXISTS prevent_remark_status_event_mutation();")
    op.execute("DROP POLICY IF EXISTS org_isolation_policy ON remark_status_events;")
    op.execute("ALTER TABLE remark_status_events DISABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE remark_status_events NO FORCE ROW LEVEL SECURITY;")
    op.drop_index("ix_remark_status_events_occurred_at", table_name="remark_status_events")
    op.drop_index("ix_remark_status_events_remark_id", table_name="remark_status_events")
    op.drop_index("ix_remark_status_events_org_id", table_name="remark_status_events")
    op.drop_table("remark_status_events")
