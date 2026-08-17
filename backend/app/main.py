"""FieldOps SaaS V4.0 -- Application Entry Point"""
from contextlib import asynccontextmanager
import os

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.database import engine
from app.modules.execution import router as execution_router
from app.modules.field_diary import router as field_diary_router
from app.modules.governance import router as governance_router
from app.modules.iam import router as iam_router
from app.modules.projects import router as projects_router
from app.modules.projects.canonical_router import router as canonical_projects_router
from app.modules.quality import router as quality_router
from app.modules.reporting import router as reporting_router
from app.modules.sync import router as sync_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    from app.modules.iam import models as iam_models  # noqa: F401
    from app.modules.execution import models as exec_models  # noqa: F401
    from app.modules.projects import models as proj_models  # noqa: F401
    from app.modules.quality import models as qual_models  # noqa: F401
    from app.modules.governance import models as gov_models  # noqa: F401
    from app.modules.field_diary import models as diary_models  # noqa: F401
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
)

cors_origins = settings.CORS_ORIGINS
if settings.DEBUG and not cors_origins:
    cors_origins = ["http://localhost:3000", "http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"https://.*\.up\.railway\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
    max_age=600,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(iam_router, prefix="/auth", tags=["Authentication & IAM"])
api_router.include_router(projects_router, prefix="/projects", tags=["Projects & Units"])
# Canonical V4 project configuration. Legacy per-unit BOQ routes remain for compatibility,
# but the V4 UI uses these canonical endpoints exclusively.
api_router.include_router(canonical_projects_router, prefix="/projects", tags=["Canonical Project BOQ"])
api_router.include_router(execution_router, prefix="/execution", tags=["Field Execution"])
api_router.include_router(field_diary_router, prefix="/field-diary", tags=["Daily Site Diary"])
api_router.include_router(sync_router, prefix="/sync", tags=["Sync Engine"])
api_router.include_router(quality_router, prefix="/quality", tags=["Quality Control"])
api_router.include_router(governance_router, prefix="/governance", tags=["Governance Engine"])
api_router.include_router(reporting_router, prefix="/reporting", tags=["Reporting & Analytics"])
app.include_router(api_router)

_upload_dir = os.environ.get("UPLOAD_DIR", "/tmp/fieldops_uploads")
os.makedirs(_upload_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_upload_dir), name="uploads")


@app.get("/health", tags=["System"])
async def health_check() -> dict:
    return {"status": "healthy", "version": settings.VERSION}


@app.get("/", tags=["System"])
async def root() -> dict:
    return {"status": "operational", "api_base": "/api/v1"}
