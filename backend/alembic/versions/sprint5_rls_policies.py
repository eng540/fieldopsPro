# --- START OF FILE backend/alembic/versions/sprint5_rls_policies.py ---

"""Sprint-5: Row-Level Security (RLS) for Multi-Tenant Isolation

Constitutional (Directive Phase 2):
- PostgreSQL RLS enforces org_id isolation at the database level
- Application-level org_id filtering remains as defense-in-depth
- RLS provides an additional layer: even if a query misses org_id filter,
  the database will still only return rows belonging to the current org
- This is the "belt and suspenders" approach required for production

Implementation Strategy:
1. Enable RLS on all org_id-scoped tables.
2. Create RLS policies that check `app.current_org_id`.
3. If `app.current_org_id` is set, restrict rows to that org_id.
4. If `app.current_org_id` is NOT set (e.g., during migrations or background tasks),
   allow all rows (fallback to application-level filtering).
5. The FastAPI app sets app.current_org_id per request via:
   SET LOCAL app.current_org_id = <org_id>

Tables with RLS (org_id-scoped):
- users, roles, project_users, audit_logs
- projects, project_units, boq_items
- work_orders, work_order_assignments, work_order_status_history, work_order_sync_logs
- unit_boq_progress
- remarks, remark_templates
- governance_decisions

Revision ID: sprint5_rls_001
Revises: sprint4_boq_001
Create Date: 2026-08-02
"""
from alembic import op

revision = "sprint5_rls_001"
down_revision = "sprint4_boq_001"
branch_labels = None
depends_on = None


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
    """Enable RLS on all org_id-scoped tables."""
    for table in _RLS_TABLES:
        # Enable RLS
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")

        # Force RLS even for table owner (production hardening)
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")

        # Policy: If app.current_org_id is set, restrict to it. Otherwise, allow all.
        # This provides defense-in-depth for API requests while allowing migrations/scripts to work.
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


def downgrade() -> None:
    """Remove RLS policies and disable RLS."""
    for table in _RLS_TABLES:
        op.execute(f"DROP POLICY IF EXISTS org_isolation_policy ON {table};")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")