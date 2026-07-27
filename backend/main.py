"""FieldOps V4.0 — Main Application Entry Point"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine, Base

from app.modules.iam import router as iam_router
from app.modules.execution import router as execution_router
from app.modules.sync import router as sync_router
from app.modules.projects import router as projects_router
from app.modules.quality import router as quality_router
from app.modules.governance import router as governance_router
from app.modules.reporting import router as reporting_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Import all models so they register with Base metadata
    from app.modules.iam import models as iam_models          # noqa: F401
    from app.modules.execution import models as exec_models   # noqa: F401
    from app.modules.projects import models as proj_models    # noqa: F401
    from app.modules.quality import models as qual_models     # noqa: F401
    from app.modules.governance import models as gov_models   # noqa: F401
    yield


app = FastAPI(
    title="FieldOps V4 API",
    version="4.0.0",
    description="Offline-First Field Operations Management Platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Router Registration ──────────────────────────────────────────────────────
app.include_router(iam_router,        prefix="/auth",       tags=["Authentication & IAM"])
app.include_router(projects_router,   prefix="/projects",   tags=["Projects & Units"])
app.include_router(execution_router,  prefix="/execution",  tags=["Field Execution"])
app.include_router(sync_router,       prefix="/sync",       tags=["Sync Engine"])
app.include_router(quality_router,    prefix="/quality",    tags=["Quality Control"])
app.include_router(governance_router, prefix="/governance", tags=["Governance Engine"])
app.include_router(reporting_router,  prefix="/reporting",  tags=["Reporting & Analytics"])


@app.get("/health", tags=["System"])
async def health_check() -> dict:
    return {"status": "ok", "version": "4.0.0", "service": "fieldops-api"}


@app.get("/", tags=["System"])
async def root() -> dict:
    return {
        "service": "FieldOps V4 API",
        "docs": "/docs",
        "health": "/health",
    }
