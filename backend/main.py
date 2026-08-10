# --- START OF FILE backend/app/main.py ---

"""FieldOps SaaS V4.0 -- Application Entry Point

Constitutional: This file is ONLY for assembly. No business logic here.
All business logic lives in modules/.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, APIRouter
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine
from app.modules.iam import router as iam_router
from app.modules.projects import router as projects_router
from app.modules.execution import router as execution_router
from app.modules.sync import router as sync_router
from app.modules.quality import router as quality_router
from app.modules.governance import router as governance_router
from app.modules.reporting import router as reporting_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    # Import all models so they register with Base metadata
    from app.modules.iam import models as iam_models          # noqa: F401
    from app.modules.execution import models as exec_models   # noqa: F401
    from app.modules.projects import models as proj_models    # noqa: F401
    from app.modules.quality import models as qual_models     # noqa: F401
    from app.modules.governance import models as gov_models   # noqa: F401
    yield
    # Shutdown
    await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="""
    FieldOps SaaS V4.0 -- Multi-Tenant Offline-First Field Operations Platform.

    ## Constitutional Principles
    - Multi-Tenant Isolation: org_id + project_scope + role_scope
    - Server-Reconciled State: Sync != Truth
    - Monotonic Progress: Financial safety via Rework Flag + Audit
    - Explainable Governance: Every decision carries matched_rule + reason + policy_version
    - Exactly-Once Sync: operation_uuid + processed_operations

    ## Architecture
    Modular Monolith | FastAPI + SQLAlchemy 2.0 + PostgreSQL 16 (RLS) | Offline-First
    """,
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
)

# CORS -- Explicit whitelist + regex for production deployments
cors_origins = settings.CORS_ORIGINS
if settings.DEBUG and not cors_origins:
    cors_origins = ["http://localhost:3000", "http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"https://.*",  # Allow any HTTPS origin (e.g., Railway domains)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
    max_age=600,
)

# ─────────────────────────────────────────
# MODULE REGISTRATION
# No cross-module DB access. Only via service layer.
# ─────────────────────────────────────────
# FIX: Added /api/v1 prefix to match frontend expectations
api_router = APIRouter(prefix="/api/v1")

api_router.include_router(iam_router, prefix="/auth", tags=["Authentication & IAM"])
api_router.include_router(projects_router, prefix="/projects", tags=["Projects & Units"])
api_router.include_router(execution_router, prefix="/execution", tags=["Field Execution"])
api_router.include_router(sync_router, prefix="/sync", tags=["Sync Engine"])
api_router.include_router(quality_router, prefix="/quality", tags=["Quality Control"])
api_router.include_router(governance_router, prefix="/governance", tags=["Governance Engine"])
api_router.include_router(reporting_router, prefix="/reporting", tags=["Reporting & Analytics"])

app.include_router(api_router)


# ── Static file serving (uploaded photos) ───────────────────────────────────
import os as _os
_upload_dir = _os.environ.get("UPLOAD_DIR", "/tmp/fieldops_uploads")
_os.makedirs(_upload_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_upload_dir), name="uploads")


@app.get("/health", tags=["System"])
async def health_check() -> dict:
    """Health check endpoint for load balancers and monitoring."""
    return {
        "status": "healthy",
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
    }


@app.get("/", tags=["System"])
async def root() -> dict:
    """Root endpoint."""
    return {
        "name": settings.APP_NAME,
        "version": settings.VERSION,
        "status": "operational",
        "constitution": "v2.0-baseline-approved",
    }