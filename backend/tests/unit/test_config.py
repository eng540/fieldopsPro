"""Configuration Tests -- FieldOps V4.0

Verifies settings load correctly and constitutional defaults.
"""
from app.core.config import settings


class TestConstitutionalDefaults:
    def test_multi_tenant_rls_enabled(self):
        assert settings.ENABLE_RLS is True

    def test_system_tables_defined(self):
        assert "tenants" in settings.SYSTEM_TABLES
        assert "subscriptions" in settings.SYSTEM_TABLES
        assert "alembic_version" in settings.SYSTEM_TABLES

    def test_sync_batch_size_reasonable(self):
        assert settings.SYNC_BATCH_SIZE <= 1000
        assert settings.SYNC_BATCH_SIZE > 0

    def test_governance_default_is_hold(self):
        assert settings.GOVERNANCE_DEFAULT_DECISION == "HOLD"
        assert settings.GOVERNANCE_DEFAULT_PAYMENT_PCT == 0

    def test_audit_retention_is_7_years(self):
        assert settings.AUDIT_RETENTION_DAYS == 2555

    def test_jwt_expiry_short_lived(self):
        assert settings.ACCESS_TOKEN_EXPIRE_MINUTES <= 15

    def test_refresh_token_rotation_enabled(self):
        assert settings.REFRESH_TOKEN_ROTATION is True
