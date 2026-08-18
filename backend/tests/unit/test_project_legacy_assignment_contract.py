from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.modules.projects.router import legacy_create_or_assign_boq
from app.modules.projects.schemas import BOQItemCreate


class _Result:
    def __init__(self, scalar=None, first=None):
        self._scalar = scalar
        self._first = first

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return self

    def first(self):
        return self._first


@pytest.mark.asyncio
async def test_legacy_unit_boq_route_never_creates_missing_master_boq():
    db = SimpleNamespace(
        execute=AsyncMock(side_effect=[
            _Result(scalar=SimpleNamespace(id=7)),
            _Result(first=None),
        ]),
        add=Mock(),
        flush=AsyncMock(),
    )
    data = BOQItemCreate(
        code="BOQ-001",
        trade="Civil",
        description="Concrete",
        quantity=10,
        rate=420,
        unit_of_measure="m3",
    )

    with pytest.raises(HTTPException) as exc_info:
        await legacy_create_or_assign_boq(1, 7, data, db, {"org_id": 1, "id": 10})

    assert exc_info.value.status_code == 409
    assert "Master BOQ item not found" in str(exc_info.value.detail)
    db.add.assert_not_called()
    db.flush.assert_not_awaited()
