from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.modules.execution.models import EntityType, EventClass, EventType, MetricType


class ExecutionEventIntent(BaseModel):
    """Client intent for one mutable execution event.

    The optimistic-lock version is mandatory at the API boundary.  This keeps
    stale/offline writes explicit and prevents the service layer from having to
    infer a concurrency policy from an omitted value.
    """

    sync_uuid: UUID
    entity_type: EntityType
    entity_id: str = Field(min_length=1, max_length=255)
    unit_id: int = Field(gt=0)
    boq_item_id: int = Field(gt=0)
    event_class: EventClass
    event_type: EventType
    metric_type: MetricType
    value: Any = None
    unit_of_measure: str | None = Field(default=None, max_length=50)
    occurred_at: datetime
    effective_date: datetime | None = None
    expected_version: int = Field(ge=1)
    transaction_group_id: UUID | None = None
    reason: str | None = None
    notes: str | None = None

    @field_validator("value")
    @classmethod
    def validate_value(cls, value: Any, info):
        metric = info.data.get("metric_type")
        event_type = info.data.get("event_type")
        if event_type == EventType.STATUS_CHANGE and not isinstance(value, str):
            raise ValueError("STATUS_CHANGE value must be a status string")
        if metric in {MetricType.QUANTITY, MetricType.PERCENTAGE, MetricType.FINANCIAL}:
            if not isinstance(value, (int, float)):
                raise ValueError("Numeric metric requires a numeric value")
        return value


class ExecutionEventsRequest(BaseModel):
    events: list[ExecutionEventIntent] = Field(min_length=1, max_length=1000)


class ExecutionEventResult(BaseModel):
    event_id: str
    sync_uuid: UUID
    transaction_group_id: UUID | None = None
    state_version: int
    current_state: dict[str, Any]


class ExecutionEventsResponse(BaseModel):
    results: list[ExecutionEventResult]
