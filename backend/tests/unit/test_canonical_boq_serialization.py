from datetime import datetime, timezone
from types import SimpleNamespace

from app.modules.projects.canonical_router import _serialize_boq, _serialize_unit


def test_canonical_boq_serializes_orm_values_to_json_ready_dict():
    now = datetime.now(timezone.utc)
    item = SimpleNamespace(
        id=250,
        org_id=1,
        project_id=10,
        code="QA-DOOR-007",
        category="Finishes",
        trade="Doors",
        description="Test door",
        quantity=6.0,
        rate=10.0,
        amount=60.0,
        unit_of_measure="unit",
        sequence=1,
        completion_pct=25.0,
        is_active=True,
        extra_data=None,
        created_at=now,
        updated_at=now,
    )

    result = _serialize_boq(item)

    assert result["id"] == 250
    assert result["project_id"] == 10
    assert result["completion_pct"] == 25.0
    assert result["created_at"] == now.isoformat()
    assert result["updated_at"] == now.isoformat()
    assert "_sa_instance_state" not in result


def test_canonical_unit_serializes_orm_values_to_json_ready_dict():
    now = datetime.now(timezone.utc)
    unit = SimpleNamespace(
        id=229,
        org_id=1,
        project_id=10,
        name="QA Demo Unit A-101",
        code="QA-A101",
        unit_type="Shelter",
        floor=1,
        area_sqm=42.0,
        status="IN_PROGRESS",
        completion_pct=48.12,
        is_active=True,
        created_at=now,
        updated_at=now,
    )

    result = _serialize_unit(unit)

    assert result["id"] == 229
    assert result["project_id"] == 10
    assert result["completion_pct"] == 48.12
    assert result["created_at"] == now.isoformat()
    assert result["updated_at"] == now.isoformat()
    assert "_sa_instance_state" not in result
