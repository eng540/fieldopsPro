"""Sprint-5: Row-Level Security (RLS) for Multi-Tenant Isolation

Constitutional (Directive Phase 2):
- PostgreSQL RLS enforces org_id isolation at the database level
- Application-level org_id filtering remains as defense-in-depth
- This Cloud-Native approach uses dynamic session variables without requiring
  custom PostgreSQL roles, making it compatible with managed DBs (Railway, AWS RDS).

Implementation Strategy:
1. Enable RLS on all org_id-scoped tables
2. Force RLS even for table owners
3. Create a dynamic policy: 
   - If 'app.current_org_id' is set (via FastAPI middleware), restrict rows to that org.
   - If 'app.current_org_id' is NULL (during login or migrations), allow access.

Revision ID: sprint5_rls_001
Revises: sprint4_boq_001
Create Date: 2026-08-02
"""
from alembic import op

revision = "sprint5_rls_001"
down_revision = "sprint4_boq_001"
branch_labels = None
depends_on = None

# All tables that have org_id and should be RLS-protected
_RLS_TABLES = [
    "users",
    "roles",
    "project_users",
    "audit_logs",
    "projects",
    "project_units",
    "boq_items",
    "work_orders",
    "work_order_assignments",
    "work_order_status_history",
    "work_order_sync_logs",
    "unit_boq_progress",
    "remarks",
    "remark_templates",
    "governance_decisions",
]


def upgrade() -> None:
    """Enable Cloud-Native RLS on all org_id-scoped tables."""

    for table in _RLS_TABLES:
        # Enable RLS
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")

        # Force RLS even for table owner
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")

        # Create dynamic isolation policy
        op.execute(f"""
            CREATE POLICY org_isolation_policy ON {table}
                FOR ALL
                USING (
                    current_setting('app.current_org_id', true) IS NULL 
                    OR current_setting('app.current_org_id', true) = ''
                    OR org_id = current_setting('app.current_org_id', true)::INTEGER
                )
                WITH CHECK (
                    current_setting('app.current_org_id', true) IS NULL 
                    OR current_setting('app.current_org_id', true) = ''
                    OR org_id = current_setting('app.current_org_id', true)::INTEGER
                );
        """)


def downgrade() -> None:
    """Remove RLS policies and disable RLS."""

    for table in _RLS_TABLES:
        # Drop policy
        op.execute(f"DROP POLICY IF EXISTS org_isolation_policy ON {table};")

        # Disable RLS
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")