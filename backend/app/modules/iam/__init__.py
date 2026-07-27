"""FieldOps V4.0 — IAM Module.

Identity & Access Management module.
Self-contained: no direct DB access to other modules.

Constitutional (ADR-004):
- JWT Minimalism: identity only in tokens
- Server-side authorization: roles/permissions from DB
- Session registry: instant revocation
- WORM audit trail

Submodules:
- models.py: SQLAlchemy ORM models
- schemas.py: Pydantic request/response schemas
- service.py: Authentication business logic
- dependencies.py: FastAPI JWT dependencies
- router.py: HTTP endpoints
"""
from app.modules.iam.router import router

__all__ = ["router"]
