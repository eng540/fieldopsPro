"""Pytest Configuration -- FieldOps V4.0

Provides shared fixtures for database testing.
Uses SQLite for test isolation (no PostgreSQL dependency).

Sprint-1 Update: Added IAM model imports for table creation.
"""
import os
from typing import Generator

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

# ─────────────────────────────────────────
# Set DATABASE_URL before any app imports
# ─────────────────────────────────────────
_TEST_DB_PATH = "/tmp/fieldops_sprint2_test.db"
_TEST_DB_URL = f"sqlite+aiosqlite:///{_TEST_DB_PATH}"
_TEST_SYNC_URL = f"sqlite:///{_TEST_DB_PATH}"

os.environ["DATABASE_URL"] = _TEST_DB_URL

# Now safe to import
from app.core.database import Base, get_db

# Import test infrastructure models to register FK targets
import tests.test_infra_models  # noqa: F401

# Import production models — order matters: IAM first (defines org/users FK targets)
from app.modules.iam import models as iam_models  # noqa: F401
from app.modules.execution import models as execution_models  # noqa: F401

# ─────────────────────────────────────────
# SYNC ENGINE (for table creation)
# ─────────────────────────────────────────
sync_test_engine = create_engine(
    _TEST_SYNC_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)


@pytest.fixture(scope="session")
def setup_database():
    """Create all tables before tests, drop after."""
    if os.path.exists(_TEST_DB_PATH):
        os.unlink(_TEST_DB_PATH)

    @event.listens_for(sync_test_engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(sync_test_engine)
    yield
    Base.metadata.drop_all(sync_test_engine)
    sync_test_engine.dispose()
    if os.path.exists(_TEST_DB_PATH):
        os.unlink(_TEST_DB_PATH)


# ─────────────────────────────────────────
# ASYNC ENGINE (for per-test sessions)
# ─────────────────────────────────────────
test_async_engine = create_async_engine(
    _TEST_DB_URL,
    poolclass=NullPool,
    echo=False,
)


@pytest.fixture(autouse=True)
def clean_db_data():
    """Clean all data between tests to ensure isolation."""
    with sync_test_engine.begin() as conn:
        # Delete in FK-safe order (children before parents)
        for table in [
            "work_order_sync_logs", "work_order_status_history",
            "work_order_assignments", "work_orders",
            "audit_logs", "sessions", "project_users",
            "roles", "users", "organizations",
            "projects", "project_units",
        ]:
            try:
                conn.execute(text(f"DELETE FROM {table}"))
            except Exception:
                pass


@pytest.fixture
def client(setup_database) -> Generator:
    """Provide a FastAPI TestClient with overridden DB dependency."""
    from fastapi.testclient import TestClient
    from app.main import app

    TestAsyncSessionFactory = async_sessionmaker(
        test_async_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )

    async def override_get_db():
        async with TestAsyncSessionFactory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


@pytest.fixture
def mock_user():
    """Return a mock user context for testing."""
    return {
        "id": 1,
        "email": "test@fieldops.dev",
        "name": "Test Engineer",
        "role": "FIELD_ENGINEER",
        "org_id": 1,
        "projects": [1, 2],
    }


# ─────────────────────────────────────────
# IAM Test Fixtures
# ─────────────────────────────────────────
@pytest.fixture
async def db_session(setup_database):
    """Provide an async DB session for direct model operations."""
    TestAsyncSessionFactory = async_sessionmaker(
        test_async_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )
    async with TestAsyncSessionFactory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@pytest.fixture
def sync_db(setup_database):
    """Provide a sync DB engine for direct SQL operations in tests."""
    return sync_test_engine


@pytest.fixture
def test_organization(sync_db):
    """Create a test organization and return it."""
    from sqlalchemy import insert
    with sync_db.begin() as conn:
        result = conn.execute(
            insert(__import__("app.modules.iam.models", fromlist=["Organization"]).Organization).values(
                name="Test Organization",
                code="TEST-ORG",
                is_active=True,
            )
        )
        conn.commit()
        org_id = result.lastrowid
    return org_id


@pytest.fixture
def test_user_with_password(sync_db, test_organization):
    """Create a test user with known password and return (user_id, email, password)."""
    from sqlalchemy import insert
    from app.core.security import get_password_hash
    from app.modules.iam.models import User

    email = "engineer@test.org"
    password = "SecurePass123!"
    hashed = get_password_hash(password)

    with sync_db.begin() as conn:
        result = conn.execute(
            insert(User).values(
                org_id=test_organization,
                email=email,
                name="Test Engineer",
                hashed_password=hashed,
                is_active=True,
                token_version=1,
            )
        )
        conn.commit()
        user_id = result.lastrowid
    return user_id, email, password
