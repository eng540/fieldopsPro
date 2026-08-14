"""Sprint-8: daily field diary.
Revision ID: sprint8_field_diary_001
Revises: sprint7_quality_001
"""
from alembic import op
import sqlalchemy as sa
revision="sprint8_field_diary_001"; down_revision="sprint7_quality_001"; branch_labels=None; depends_on=None

def upgrade():
    op.create_table("field_diary_entries",sa.Column("id",sa.String(36),primary_key=True),sa.Column("org_id",sa.Integer(),sa.ForeignKey("organizations.id"),nullable=False),sa.Column("project_id",sa.Integer(),sa.ForeignKey("projects.id"),nullable=False),sa.Column("diary_date",sa.Date(),nullable=False),sa.Column("weather",sa.String(120)),sa.Column("workforce",sa.JSON(),nullable=False,server_default=sa.text("'{}'::json")),sa.Column("equipment",sa.JSON(),nullable=False,server_default=sa.text("'[]'::json")),sa.Column("visits_total",sa.Integer(),nullable=False,server_default="0"),sa.Column("visits_accepted",sa.Integer(),nullable=False,server_default="0"),sa.Column("observations",sa.Text()),sa.Column("gps_tag",sa.JSON()),sa.Column("attachments",sa.JSON(),nullable=False,server_default=sa.text("'[]'::json")),sa.Column("created_by",sa.Integer(),sa.ForeignKey("users.id"),nullable=False),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False))
    op.create_index("ix_field_diary_org_date","field_diary_entries",["org_id","diary_date"]); op.create_index("ix_field_diary_project_date","field_diary_entries",["project_id","diary_date"])
    op.execute("ALTER TABLE field_diary_entries ENABLE ROW LEVEL SECURITY"); op.execute("ALTER TABLE field_diary_entries FORCE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY field_diary_org_isolation ON field_diary_entries FOR ALL USING (NULLIF(current_setting('app.current_org_id', true), '')::INTEGER = org_id) WITH CHECK (NULLIF(current_setting('app.current_org_id', true), '')::INTEGER = org_id)")

def downgrade():
    op.execute("DROP POLICY IF EXISTS field_diary_org_isolation ON field_diary_entries"); op.execute("ALTER TABLE field_diary_entries NO FORCE ROW LEVEL SECURITY"); op.execute("ALTER TABLE field_diary_entries DISABLE ROW LEVEL SECURITY"); op.drop_index("ix_field_diary_project_date",table_name="field_diary_entries"); op.drop_index("ix_field_diary_org_date",table_name="field_diary_entries"); op.drop_table("field_diary_entries")
