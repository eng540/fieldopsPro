"""Internal Event Bus -- FieldOps V4.0

Constitutional Principle: Modules communicate via events, NOT direct DB access.
This is an in-process dispatcher (NOT microservices bus).

NOTE: Use get_event_bus() to get instance. Do NOT use EventBus class directly
in production code to ensure test isolation.
"""
from dataclasses import dataclass, field
from typing import Callable, TypeVar

T = TypeVar("T", bound="DomainEvent")


@dataclass(frozen=True)
class DomainEvent:
    """Base class for all domain events."""
    event_id: str
    timestamp: str
    org_id: int
    user_id: int
    metadata: dict = field(default_factory=dict)


@dataclass(frozen=True)
class ProgressUpdated(DomainEvent):
    """Emitted when BoQ progress is updated."""
    project_id: int = 0
    unit_id: int = 0
    boq_item_id: int = 0
    old_pct: float = 0.0
    new_pct: float = 0.0


@dataclass(frozen=True)
class RemarkCreated(DomainEvent):
    """Emitted when a QC remark is created."""
    project_id: int = 0
    unit_id: int = 0
    remark_id: str = ""
    severity: str = ""


@dataclass(frozen=True)
class DecisionIssued(DomainEvent):
    """Emitted when governance decision is issued."""
    project_id: int = 0
    unit_id: int = 0
    decision: str = ""
    policy_version: int = 0


class EventBus:
    """In-process event dispatcher.

    Use get_event_bus() in production code.
    Use EventBus() directly in tests for isolation.
    """

    def __init__(self):
        self._handlers: dict[type, list[Callable]] = {}

    def subscribe(self, event_type: type[T], handler: Callable[[T], None]) -> None:
        """Subscribe handler to event type."""
        if event_type not in self._handlers:
            self._handlers[event_type] = []
        self._handlers[event_type].append(handler)

    def publish(self, event: DomainEvent) -> None:
        """Publish event to all subscribers."""
        event_type = type(event)
        handlers = self._handlers.get(event_type, [])
        for handler in handlers:
            handler(event)

    def clear_handlers(self) -> None:
        """Clear all handlers. Use in test teardown."""
        self._handlers.clear()


# Singleton instance for production use
_event_bus_instance: EventBus | None = None


def get_event_bus() -> EventBus:
    """Get the singleton event bus instance."""
    global _event_bus_instance
    if _event_bus_instance is None:
        _event_bus_instance = EventBus()
    return _event_bus_instance


def emit(event: DomainEvent) -> None:
    """Convenience function to emit an event to the singleton bus."""
    get_event_bus().publish(event)
