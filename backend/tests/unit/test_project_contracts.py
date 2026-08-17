import pytest
from pydantic import ValidationError

from app.modules.projects.schemas import BOQItemCreate, ProjectCreate, ProjectUpdate, UnitCreate


def test_unit_contract_requires_canonical_area_field():
    unit = UnitCreate(name="QA Unit", code="qa-001", unit_type="Shelter", area_sqm=42)
    assert unit.code == "QA-001"
    assert unit.area_sqm == 42


def test_unit_contract_rejects_unknown_area_alias():
    with pytest.raises(ValidationError):
        UnitCreate(name="QA Unit", code="QA-001", unit_type="Shelter", area=42)


def test_boq_contract_requires_canonical_financial_fields():
    item = BOQItemCreate(
        code="qa-conc-001",
        trade="Civil",
        description="Concrete",
        quantity=10,
        rate=420,
        unit_of_measure="m3",
    )
    assert item.code == "qa-conc-001"
    assert item.rate == 420
    assert item.unit_of_measure == "m3"


def test_boq_contract_rejects_legacy_financial_aliases():
    with pytest.raises(ValidationError):
        BOQItemCreate(
            code="QA-001",
            trade="Civil",
            description="Concrete",
            quantity_total=10,
            unit_price=420,
            unit="m3",
        )


def test_project_update_keeps_ui_deactivation_supported():
    update = ProjectUpdate(is_active=False)
    assert update.is_active is False


def test_project_contract_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        ProjectCreate(name="QA", code="QA-001", unexpected_field="value")
