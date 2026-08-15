"""Sprint-6: Dynamic project/org dictionaries.

Revision ID: sprint6_dict_001
Revises: sprint6_epic1_001
"""
from alembic import op
import sqlalchemy as sa

revision = "sprint6_dict_001"
down_revision = "sprint6_epic1_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_dictionaries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("kind", sa.String(length=80), nullable=False),
        sa.Column("key", sa.String(length=120), nullable=False),
        sa.Column("value", sa.String(length=255), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("extra_data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("org_id", "project_id", "kind", "key", name="uq_project_dict_scope_key"),
    )
    op.create_index("ix_project_dict_org_kind", "project_dictionaries", ["org_id", "kind"])
    op.create_index("ix_project_dict_project_kind", "project_dictionaries", ["project_id", "kind"])
    op.execute("ALTER TABLE project_dictionaries ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE project_dictionaries FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY org_isolation_policy ON project_dictionaries
        FOR ALL USING (
            current_setting('app.current_org_id', true) IS NULL OR
            current_setting('app.current_org_id', true) = '' OR
            org_id = NULLIF(current_setting('app.current_org_id', true), '')::INTEGER
        ) WITH CHECK (
            current_setting('app.current_org_id', true) IS NULL OR
            current_setting('app.current_org_id', true) = '' OR
            org_id = NULLIF(current_setting('app.current_org_id', true), '')::INTEGER
        )
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS org_isolation_policy ON project_dictionaries")
    op.execute("ALTER TABLE project_dictionaries DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE project_dictionaries NO FORCE ROW LEVEL SECURITY")
    op.drop_index("ix_project_dict_project_kind", table_name="project_dictionaries")
    op.drop_index("ix_project_dict_org_kind", table_name="project_dictionaries")
    op.drop_table("project_dictionaries")
