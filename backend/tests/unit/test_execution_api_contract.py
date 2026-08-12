from main import app


def test_execution_routes_are_registered_once():
    paths = [route.path for route in app.routes if route.path.startswith("/api/v1/execution")]
    assert paths.count("/api/v1/execution/events") == 1
    assert paths.count("/api/v1/execution/progress") == 1
    assert paths.count("/api/v1/execution/bulk-progress") == 1
    assert paths.count("/api/v1/execution/events/history") == 1
    assert paths.count("/api/v1/execution/state") == 1
    assert paths.count("/api/v1/execution/state/{unit_id}/{boq_item_id}") == 1


def test_event_history_is_read_only_at_route_contract_level():
    event_history = next(
        route for route in app.routes
        if route.path == "/api/v1/execution/events/history"
    )
    assert event_history.methods == {"GET"}
