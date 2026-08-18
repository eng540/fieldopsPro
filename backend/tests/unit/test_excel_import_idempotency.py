from types import SimpleNamespace

from app.modules.projects.excel_import_router import _prepare_boq, _prepare_units


def test_matching_boq_row_is_skipped_not_duplicated():
    existing = {
        "QA-FOUNDATION-001": SimpleNamespace(
            code="QA-FOUNDATION-001",
            trade="Civil",
            description="Foundation concrete",
            unit_of_measure="m3",
            quantity=10,
            rate=25,
        )
    }
    rows = [
        ("code", "trade", "description", "quantity", "rate", "unit_of_measure"),
        ("QA-FOUNDATION-001", "Civil", "Foundation concrete", 10, 25, "m3"),
    ]
    mapping = {"code": 0, "trade": 1, "description": 2, "quantity": 3, "rate": 4, "unit_of_measure": 5}
    prepared, errors, skipped = _prepare_boq(rows, mapping, existing, 1, 10, 1)
    assert prepared == []
    assert errors == []
    assert skipped == ["QA-FOUNDATION-001"]


def test_changed_boq_row_is_rejected_instead_of_overwriting():
    existing = {
        "QA-FOUNDATION-001": SimpleNamespace(
            code="QA-FOUNDATION-001",
            trade="Civil",
            description="Foundation concrete",
            unit_of_measure="m3",
            quantity=10,
            rate=25,
        )
    }
    rows = [
        ("code", "trade", "description", "quantity", "rate", "unit_of_measure"),
        ("QA-FOUNDATION-001", "Civil", "Foundation concrete revised", 10, 25, "m3"),
    ]
    mapping = {"code": 0, "trade": 1, "description": 2, "quantity": 3, "rate": 4, "unit_of_measure": 5}
    prepared, errors, skipped = _prepare_boq(rows, mapping, existing, 1, 10, 1)
    assert prepared == []
    assert skipped == []
    assert len(errors) == 1
    assert "موجود بمحتوى مختلف" in errors[0]


def test_matching_unit_row_is_skipped_not_duplicated():
    existing = {
        "QA-A101": SimpleNamespace(code="QA-A101", name="Unit A101", unit_type="Shelter", floor=1, area_sqm=40)
    }
    rows = [
        ("name", "code", "unit_type", "floor", "area_sqm"),
        ("Unit A101", "QA-A101", "Shelter", 1, 40),
    ]
    mapping = {"name": 0, "code": 1, "unit_type": 2, "floor": 3, "area_sqm": 4}
    prepared, errors, skipped = _prepare_units(rows, mapping, existing, 1, 10)
    assert prepared == []
    assert errors == []
    assert skipped == ["QA-A101"]
