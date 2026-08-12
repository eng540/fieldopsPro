from datetime import datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.modules.execution.event_schemas import ExecutionEventIntent, ExecutionEventsRequest
from app.modules.execution.models import EntityType, EventClass, EventType, MetricType


def _event(**overrides):
    data = {
        "sync_uuid": uuid4(),
        "entity_type": EntityType.BOQ_ITEM,
        "entity_id": "1042",
        "unit_id": 1,
        "boq_item_id": 1042,
        "event_class": EventClass.PROGRESS,
        "event_type": EventType.DELTA_ADD,
        "metric_type": MetricType.QUANTITY,
        "value": 15.5,
        "unit_of_measure": "m3",
        "occurred_at": datetime.now(timezone.utc),
        "expected_version": 3,
    }
    data.update(overrides)
    return data


def test_event_request_accepts_valid_event():
    request = ExecutionEventsRequest(events=[_event()])
    assert len(request.events) == 1
    assert request.events[0].expected_version == 3


def test_batch_is_limited_to_1000_events():
    with pytest.raises(ValidationError):
        ExecutionEventsRequest(events=[_event(sync_uuid=uuid4()) for _ in range(1001)])


def test_status_change_requires_string_value():
    with pytest.raises(ValidationError):
        ExecutionEventIntent(**_event(
            event_type=EventType.STATUS_CHANGE,
            event_class=EventClass.STATUS,
            metric_type=MetricType.NONE,
            value=50,
        ))


def test_numeric_metric_requires_numeric_value():
    with pytest.raises(ValidationError):
        ExecutionEventIntent(**_event(value="fifteen", metric_type=MetricType.QUANTITY))
