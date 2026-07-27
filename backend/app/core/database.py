"""Database Layer — FieldOps V4.0

Constitutional Principles:
- Multi-tenant isolation via org_id in every table.
- PostgreSQL RLS as ultimate enforcement layer.
- Async operations via asyncpg (production) or aiosqlite (testing).
"""
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings


class Base(DeclarativeBase):
    """Base class for all ORM models.

    Constitutional Rule: Every model MUST include org_id unless
    explicitly registered in System Table Registry.
    """
    pass


# ─────────────────────────────────────────
# ENGINE CONFIGURATION
# ─────────────────────────────────────────
# SQLite (testing): Use NullPool (no connection pooling)
# PostgreSQL (production): Use connection pool with pool_pre_ping
_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

if _is_sqlite:
    # Testing configuration — SQLite doesn't support connection pooling
    engine = create_async_engine(
        settings.DATABASE_URL,
        poolclass=NullPool,
        echo=settings.DEBUG,
    )
else:
    # Production configuration — PostgreSQL with connection pooling
    engine = create_async_engine(
        settings.DATABASE_URL,
        pool_size=settings.DATABASE_POOL_SIZE,
        max_overflow=settings.DATABASE_MAX_OVERFLOW,
        pool_pre_ping=True,
        echo=settings.DEBUG,
    )

# Session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency: Yield async database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
