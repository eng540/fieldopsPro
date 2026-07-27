"""Test Infrastructure Models — FieldOps V4.0

Minimal stub models for foreign key targets used during testing.
These models are NOT part of the production schema.
They exist solely to satisfy SQLAlchemy FK resolution during test table creation.

In production, these are defined in their respective modules:
- organizations, users -> app.modules.iam.models (Sprint-1)
- projects, project_units -> app.modules.projects.models (future sprint)

Constitutional: These stubs are TEST-ONLY. Never import in production code.

NOTE: When IAM models are imported in conftest (which they are as of Sprint-1),
the real Organization/User models supersede these stubs automatically via
SQLAlchemy's declarative_base metadata. These stubs are kept for tables
that IAM doesn't define (projects, project_units).
"""
from sqlalchemy import Column, Integer, String
from sqlalchemy.sql import func

from app.core.database import Base

# Sprint-1 Note: Organization and User are now defined in app.modules.iam.models
# and imported via conftest. These Project stubs remain for FK resolution.

class _Project(Base):
    """Stub for projects FK target."""
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=False)
    name = Column(String(255), nullable=False)
    status = Column(String(20), nullable=False, default="ACTIVE")


class _ProjectUnit(Base):
    """Stub for project_units FK target."""
    __tablename__ = "project_units"
    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, nullable=False)
