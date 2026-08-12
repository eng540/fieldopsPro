from app.modules.quality.models import REMARK_STATUS_TRANSITIONS, RemarkStatus
from app.modules.quality.schemas import RemarkCreate, RemarkStatusUpdate
import pytest


def test_lifecycle_is_forward_only_and_closed_is_terminal():
    assert RemarkStatus.IN_REVIEW.value in REMARK_STATUS_TRANSITIONS[RemarkStatus.OPEN.value]
    assert RemarkStatus.REWORK_REQUIRED.value in REMARK_STATUS_TRANSITIONS[RemarkStatus.OPEN.value]
    assert RemarkStatus.RESUBMITTED.value in REMARK_STATUS_TRANSITIONS[RemarkStatus.REWORK_REQUIRED.value]
    assert RemarkStatus.CLOSED.value in REMARK_STATUS_TRANSITIONS[RemarkStatus.VERIFIED.value]
    assert REMARK_STATUS_TRANSITIONS[RemarkStatus.CLOSED.value] == set()


def test_rework_requires_reason_contract():
    update = RemarkStatusUpdate(status=RemarkStatus.REWORK_REQUIRED, reason="a")
    assert update.reason == "a"


def test_remark_requires_valid_uuid():
    with pytest.raises(ValueError):
        RemarkCreate(
            id="not-a-uuid",
            unit_id=1,
            custom_issue="Missing grout",
            severity="MAJOR",
        )


def test_remark_accepts_custom_issue_and_uuid():
    remark = RemarkCreate(
        id="550e8400-e29b-41d4-a716-446655440000",
        unit_id=1,
        custom_issue="Missing grout in block joint",
        severity="MAJOR",
    )
    assert remark.unit_id == 1
    assert remark.severity.value == "MAJOR"
