"""PostgreSQL RLS tenant-context helper.

The authenticated request sets app.current_org_id on the same AsyncSession
used by application queries. SET LOCAL is transaction-scoped and therefore
safe with a pooled connection.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def set_rls_context(db: AsyncSession, org_id: int) -> None:
    """Install tenant context on the current transaction; never swallow errors."""
    if not isinstance(org_id, int) or org_id <= 0:
        raise ValueError("org_id must be a positive integer")
    await db.execute(
        text("SELECT set_config('app.current_org_id', :org_id, true)"),
        {"org_id": str(org_id)},
    )
