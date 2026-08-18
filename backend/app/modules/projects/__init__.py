from app.modules.projects.router import router
from app.modules.projects.canonical_router import router as canonical_router
from app.modules.projects.excel_import_router import router as excel_import_router

# The project package is mounted once by main.py under /api/v1/projects.
# Extend the route list directly so FastAPI exposes canonical BOQ and Excel
# preview/import routes alongside the project routes without opaque nesting.
router.routes.extend(canonical_router.routes)
router.routes.extend(excel_import_router.routes)

__all__ = ["router"]
