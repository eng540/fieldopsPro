from app.modules.projects.router import router
from app.modules.projects.canonical_router import router as canonical_router

# The project package is mounted once by main.py under /api/v1/projects.
# Extend the route list directly so FastAPI exposes the canonical V4 routes
# alongside the legacy project routes without leaving an opaque IncludedRouter.
router.routes.extend(canonical_router.routes)

__all__ = ["router"]
