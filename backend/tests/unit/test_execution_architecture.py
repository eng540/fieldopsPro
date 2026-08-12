"""Contract tests for the canonical execution architecture."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.modules.execution.router import router
from app.modules.execution.schemas import EntityType, EventIntent, EventType, MetricType


def test_execution_exposes_one_canonical_events_mutation_route() -> None:
    events_routes = [
        route for route in router.routes
        if getattr(route, "path", None) == "/events"
        and "POST" in getattr(route, "methods", set())
    ]
    assert len(events_routes) == 1
    assert events_routes[0].endpoint.__module__ == "app.modules.execution.router"


def test_boq_event_requires_unit_context() -> None:
    with pytest.raises(ValidationError, match="unit_id is required"):
        EventIntent(
            sync_uuid=str(uuid4()),
            entity_type=EntityType.BOQ_ITEM,
            entity_id="10",
            event_class="PROGRESS",
            event_type=EventType.DELTA_ADD,
            metric_type=MetricType.PERCENTAGE,
            value={"pct": 5},
            occurred_at=datetime.now(timezone.utc),
            expected_version=1,
        )


def test_event_intent_accepts_explicit_version_and_unit() -> None:
    intent = EventIntent(
        sync_uuid=str(uuid4()),
        entity_type=EntityType.BOQ_ITEM,
        entity_id="10",
        unit_id=7,
        event_class="PROGRESS",
        event_type=EventType.DELTA_ADD,
        metric_type=MetricType.PERCENTAGE,
        value={"pct": 5},
        occurred_at=datetime.now(timezone.utc),
        expected_version=1,
    )
    assert intent.unit_id == 7
    assert intent.expected_version == 1
