import pytest

from app.modules.execution.models import UnitBoQProgressStatus
from app.modules.execution.service import BusinessRuleError, _number, _validate_status_transition


def test_boq_status_transition_does_not_use_work_order_states() -> None:
    assert _validate_status_transition(
        UnitBoQProgressStatus.NOT_STARTED.value,
        UnitBoQProgressStatus.IN_PROGRESS.value,
    ) == UnitBoQProgressStatus.IN_PROGRESS.value
    assert _validate_status_transition(
        UnitBoQProgressStatus.REWORK_REQUIRED.value,
        UnitBoQProgressStatus.IN_PROGRESS.value,
    ) == UnitBoQProgressStatus.IN_PROGRESS.value


def test_completed_boq_can_only_return_to_rework() -> None:
    with pytest.raises(BusinessRuleError):
        _validate_status_transition(
            UnitBoQProgressStatus.COMPLETED.value,
            UnitBoQProgressStatus.IN_PROGRESS.value,
        )
    assert _validate_status_transition(
        UnitBoQProgressStatus.COMPLETED.value,
        UnitBoQProgressStatus.REWORK_REQUIRED.value,
    ) == UnitBoQProgressStatus.REWORK_REQUIRED.value


def test_numeric_payload_rejects_nan_and_infinity() -> None:
    with pytest.raises(BusinessRuleError):
        _number({"pct": float("nan")}, "pct")
    with pytest.raises(BusinessRuleError):
        _number({"pct": float("inf")}, "pct")
