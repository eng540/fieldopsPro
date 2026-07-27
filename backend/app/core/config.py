"""Application Configuration -- FieldOps V4.0

Constitutional Principle: Configuration is explicit, typed, and environment-aware.
No secrets in code. All secrets via environment variables.
"""
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment.

    Validation: All required secrets must be provided.
    Production: extra='forbid' prevents typos from being ignored.
    """

    model_config = SettingsConfigDict(
        # Sprint-2: No .env file auto-discovery (prevents parent .env conflicts)
        # Use explicit environment variables or pass via pytest --env
        # env_file=".env",
        # env_file_encoding="utf-8",
        # Sprint-0: Use 'ignore' for development flexibility
        # Sprint-1: Switch to 'forbid' for production builds
        extra="ignore",
    )

    # ─────────────────────────────────────────
    # Application
    # ─────────────────────────────────────────
    APP_NAME: str = "FieldOps SaaS V4.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    VERSION: str = "4.0.0-sprint2"

    # ─────────────────────────────────────────
    # REQUIRED SECRETS (no defaults)
    # ─────────────────────────────────────────
    SECRET_KEY: str = Field(
        default="dev-only-secret-key-do-not-use-in-production-32ch",
        min_length=32,
        description="JWT signing key. MUST be changed in production.",
    )

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError(
                "SECRET_KEY must be at least 32 characters. "
                "Generate with: openssl rand -hex 32"
            )
        return v

    # ─────────────────────────────────────────
    # Database
    # ─────────────────────────────────────────
    DATABASE_URL: str = Field(
        default="sqlite+aiosqlite:///fieldops_dev.db",
        description="Database connection string. Production: postgresql+asyncpg://",
    )

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        """Validate DATABASE_URL format.

        Sprint-2: Allow SQLite for testing, enforce PostgreSQL for production.
        """
        if v and not v.startswith(("postgresql+asyncpg://", "sqlite+aiosqlite://")):
            raise ValueError(
                "DATABASE_URL must use asyncpg (production) or aiosqlite (testing) driver. "
                "Production format: postgresql+asyncpg://user:pass@host:port/db"
            )
        return v

    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 10

    # ─────────────────────────────────────────
    # Redis
    # ─────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ─────────────────────────────────────────
    # JWT
    # ─────────────────────────────────────────
    ALGORITHM: str = "HS256"  # Sprint-1: Migrate to RS256
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    REFRESH_TOKEN_ROTATION: bool = True

    # ─────────────────────────────────────────
    # Multi-Tenant
    # ─────────────────────────────────────────
    ENABLE_RLS: bool = True
    SYSTEM_TABLES: list[str] = [
        "tenants",
        "subscriptions",
        "plans",
        "feature_flags",
        "global_audit",
        "alembic_version",
    ]

    # ─────────────────────────────────────────
    # Sync
    # ─────────────────────────────────────────
    SYNC_BATCH_SIZE: int = 1000
    SYNC_MAX_RETRIES: int = 3
    SYNC_RETENTION_HOURS: int = 72

    # ─────────────────────────────────────────
    # Governance
    # ─────────────────────────────────────────
    GOVERNANCE_DEFAULT_DECISION: str = "HOLD"
    GOVERNANCE_DEFAULT_PAYMENT_PCT: int = 0
    GOVERNANCE_REQUIRE_JUSTIFICATION: bool = True

    # ─────────────────────────────────────────
    # Audit & Logging
    # ─────────────────────────────────────────
    AUDIT_RETENTION_DAYS: int = 2555  # 7 years
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"  # json or console

    # ─────────────────────────────────────────
    # CORS (Production)
    # ─────────────────────────────────────────
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()


settings = get_settings()
