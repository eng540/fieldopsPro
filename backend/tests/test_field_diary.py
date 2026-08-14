from datetime import date

import pytest
from pydantic import ValidationError

from app.modules.field_diary.schemas import FieldDiaryCreate


def test_field_diary_create_accepts_valid_payload() -> None:
    payload = FieldDiaryCreate(
        project_id=1,
        diary_date=date(2026, 8, 14),
        workforce={"workers": 12},
        equipment=["mixer"],
        visits_total=5,
        visits_accepted=4,
        observations="Concrete works inspected.",
    )
    assert payload.project_id == 1
    assert payload.visits_accepted == 4


def test_field_diary_rejects_accepted_visits_above_total() -> None:
    with pytest.raises(ValidationError):
        FieldDiaryCreate(
            project_id=1,
            diary_date=date(2026, 8, 14),
            visits_total=2,
            visits_accepted=3,
        )
