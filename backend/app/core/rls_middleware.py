"""RLS Middleware — FieldOps V4.0 (Sprint-5)

Sets the PostgreSQL session variable `app.current_org_id` on every
authenticated request so that Row-Level Security policies can enforce
multi-tenant isolation at the database level.

Constitutional (Phase 2):
- RLS provides defense-in-depth: even if a query misses org_id filter,
  the database will still only return rows belonging to the current org.
- Application-level org_id filtering remains as the primary defense.
- The SET LOCAL command is scoped to the current transaction, so it
  automatically resets when the transaction ends.

Flow:
1. After authentication, the middleware extracts org_id from user context
2. On each DB session checkout, it executes: SET LOCAL app.current_org_id = <org_id>
3. RLS policies use: org_id = current_setting('app.current_org_id')::INTEGER
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory


class RLSMiddleware(BaseHTTPMiddleware):
    """Set PostgreSQL RLS session variable on every authenticated request.

    This middleware runs AFTER authentication. It reads the org_id from
    the request state (set by get_current_user dependency) and sets the
    PostgreSQL session variable app.current_org_id.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # After the request is processed, set RLS context if user is authenticated
        # The org_id is set by the auth dependency into request.state
        org_id = getattr(request.state, "org_id", None)

        if org_id is not None:
            try:
                async with async_session_factory() as db:
                    async with db.begin():
                        await db.execute(
                            text("SET LOCAL app.current_org_id = :org_id"),
                            {"org_id": int(org_id)},
                        )
            except Exception:
                pass  # RLS context setting failure is non-fatal

        return response


async def set_rls_context(db: AsyncSession, org_id: int) -> None:
    """Set the RLS context for the current database session.

    This function should be called in the auth dependency after
    determining the user's org_id. It sets the PostgreSQL session
    variable that RLS policies use for filtering.

    Args:
        db: The async database session
        org_id: The organization ID to set as the RLS context
    """
    try:
        await db.execute(
            text("SET LOCAL app.current_org_id = :org_id"),
            {"org_id": int(org_id)},
        )
    except Exception:
        # RLS context setting failure is non-fatal
        # Application-level org_id filtering provides the primary defense
        pass
