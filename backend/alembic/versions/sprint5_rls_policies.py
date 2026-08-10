"""Sprint-5: Row-Level Security (RLS) for Multi-Tenant Isolation

Constitutional (Directive Phase 2):
- PostgreSQL RLS enforces org_id isolation at the database level
- Application-level org_id filtering remains as defense-in-depth
- RLS provides an additional layer: even if a query misses org_id filter,
  the database will still only return rows belonging to the current org
- This is the "belt and suspenders" approach required for production

Implementation Strategy:
1. Create a fieldops_app role (used by the FastAPI connection pool)
2. Enable RLS on all org_id-scoped tables
3. Create RLS policies: app role can only see rows where org_id matches
   the current session's app.current_org_id setting
4. The FastAPI app sets app.current_org_id per request via:
   SET LOCAL app.current_org_id = <org_id>
5. Tables without org_id (system tables) are excluded from RLS

Tables with RLS (org_id-scoped):
- users, roles, project_users, audit_logs
- projects, project_units, boq_items
- work_orders, work_order_assignments, work_order_status_history, work_order_sync_logs
- unit_boq_progress
- remarks, remark_templates
- governance_decisions

Tables WITHOUT RLS (system/root-level):
- organizations (root entity — needed for login)
- sessions (user-scoped, not org-scoped)

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
# FIX: Removed "report_templates" as it does not exist in the schema
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

    # ── Step 1: Create the fieldops_app role if it doesn't exist ──
    # This role is used by the FastAPI connection pool
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fieldops_app') THEN
                CREATE ROLE fieldops_app;
            END IF;
        END
        $$;
    """)

    # ── Step 2: Grant table permissions to fieldops_app role ──
    for table in _RLS_TABLES:
        op.execute(f"""
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO fieldops_app;
        """)

    # Grant organizations and sessions to fieldops_app (no RLS, but needs access)
    op.execute("""
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organizations TO fieldops_app;
    """)
    op.execute("""
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sessions TO fieldops_app;
    """)

    # ── Step 3: Enable RLS and create policies for each table ──
    for table in _RLS_TABLES:
        # Enable RLS
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")

        # Force RLS even for table owner (production hardening)
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")

        # Policy: fieldops_app can only see rows where org_id matches session setting
        op.execute(f"""
            CREATE POLICY org_isolation_policy ON {table}
                FOR ALL
                TO fieldops_app
                USING (org_id = current_setting('app.current_org_id')::INTEGER)
                WITH CHECK (org_id = current_setting('app.current_org_id')::INTEGER);
        """)

        # Policy: allow superuser (table owner) to bypass RLS for admin operations
        op.execute(f"""
            CREATE POLICY superuser_bypass_policy ON {table}
                FOR ALL
                TO fieldops
                USING (true)
                WITH CHECK (true);
        """)

    # ── Step 4: Grant sequence permissions for auto-increment columns ──
    # Required for INSERT operations on tables with serial PKs
    for table in _RLS_TABLES:
        op.execute(f"""
            GRANT USAGE, SELECT ON SEQUENCE IF EXISTS {table}_id_seq TO fieldops_app;
        """)

    # Grant sequences for system tables
    op.execute("GRANT USAGE, SELECT ON SEQUENCE IF EXISTS organizations_id_seq TO fieldops_app;")
    op.execute("GRANT USAGE, SELECT ON SEQUENCE IF EXISTS sessions_id_seq TO fieldops_app;")


def downgrade() -> None:
    """Remove RLS policies and disable RLS."""

    for table in _RLS_TABLES:
        # Drop policies
        op.execute(f"DROP POLICY IF EXISTS org_isolation_policy ON {table};")
        op.execute(f"DROP POLICY IF EXISTS superuser_bypass_policy ON {table};")

        # Disable RLS
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")

    # Revoke permissions
    for table in _RLS_TABLES:
        op.execute(f"REVOKE ALL ON TABLE {table} FROM fieldops_app;")

    op.execute("REVOKE ALL ON TABLE organizations FROM fieldops_app;")
    op.execute("REVOKE ALL ON TABLE sessions FROM fieldops_app;")

    # Drop the role
    op.execute("DROP ROLE IF EXISTS fieldops_app;")