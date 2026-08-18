from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.sync import atomic_service


class _Savepoint:
    def __init__(self, tracker):
        self.tracker = tracker

    async def __aenter__(self):
        self.tracker.append("enter")
        return self

    async def __aexit__(self, exc_type, exc, tb):
        self.tracker.append("rollback" if exc_type else "commit")
        return False


class _Result:
    def scalar_one_or_none(self):
        return None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_push_sync_atomic_isolates_failed_operation(monkeypatch):
    savepoints = []
    db = SimpleNamespace(
        execute=AsyncMock(return_value=_Result()),
        begin_nested=lambda: _Savepoint(savepoints),
    )

    async def first_handler(*args):
        return {"success": True, "conflicts": []}

    async def second_handler(*args):
        raise RuntimeError("synthetic failure")

    monkeypatch.setattr(atomic_service, "_process_work_order", first_handler)
    monkeypatch.setattr(atomic_service, "_process_unit_progress", second_handler)
    monkeypatch.setattr(atomic_service, "_register_sync_log", AsyncMock())

    op1 = SimpleNamespace(
        operation_uuid="00000000-0000-0000-0000-000000000001",
        device_timestamp=None,
        entity_type=SimpleNamespace(value="WORK_ORDER"),
        payload={},
    )
    op2 = SimpleNamespace(
        operation_uuid="00000000-0000-0000-0000-000000000002",
        device_timestamp=None,
        entity_type=SimpleNamespace(value="UNIT_PROGRESS"),
        payload={"completion_pct": 10},
    )

    result = await atomic_service.push_sync_atomic(
        db=db,
        user_context={"org_id": 1, "id": 7},
        operations=[op1, op2],
    )

    assert result.processed == [op1.operation_uuid]
    assert [c.operation_uuid for c in result.conflicts] == [op2.operation_uuid]
    assert savepoints == ["enter", "commit", "enter", "rollback"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_push_sync_atomic_duplicate_is_idempotent(monkeypatch):
    class _ExistingResult:
        def scalar_one_or_none(self):
            return object()

    db = SimpleNamespace(
        execute=AsyncMock(return_value=_ExistingResult()),
        begin_nested=lambda: pytest.fail("duplicate must not open a savepoint"),
    )

    handler = AsyncMock(return_value={"success": True, "conflicts": []})
    monkeypatch.setattr(atomic_service, "_process_work_order", handler)

    op = SimpleNamespace(
        operation_uuid="00000000-0000-0000-0000-000000000003",
        device_timestamp=None,
        entity_type=SimpleNamespace(value="WORK_ORDER"),
        payload={},
    )

    result = await atomic_service.push_sync_atomic(
        db=db,
        user_context={"org_id": 1, "id": 7},
        operations=[op],
    )

    assert result.processed == [op.operation_uuid]
    handler.assert_not_awaited()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_push_sync_atomic_routes_daily_log(monkeypatch):
    db = SimpleNamespace(
        execute=AsyncMock(return_value=_Result()),
        begin_nested=lambda: _Savepoint([]),
    )
    handler = AsyncMock(return_value={"success": True, "conflicts": []})
    monkeypatch.setattr(atomic_service, "_process_daily_log", handler)
    monkeypatch.setattr(atomic_service, "_register_sync_log", AsyncMock())

    op = SimpleNamespace(
        operation_uuid="00000000-0000-0000-0000-000000000004",
        device_timestamp=None,
        entity_type=SimpleNamespace(value="DAILY_LOG"),
        payload={"id": "00000000-0000-0000-0000-000000000005", "project_id": 1, "diary_date": "2026-08-18"},
    )

    result = await atomic_service.push_sync_atomic(
        db=db,
        user_context={"org_id": 1, "id": 7},
        operations=[op],
    )

    assert result.processed == [op.operation_uuid]
    assert result.conflicts == []
    handler.assert_awaited_once()
