from main import app


def test_execution_routes_are_registered_once():
    # FastAPI keeps included routers nested in app.routes; OpenAPI exposes the
    # flattened contract that clients actually receive.
    paths = app.openapi()["paths"]
    assert "/api/v1/execution/events" in paths
    assert "/api/v1/execution/progress" in paths
    assert "/api/v1/execution/bulk-progress" in paths
    assert "/api/v1/execution/events/history" in paths
    assert "/api/v1/execution/state" in paths
    assert "/api/v1/execution/state/{unit_id}/{boq_item_id}" in paths


def test_event_history_is_read_only_at_route_contract_level():
    methods = app.openapi()["paths"]["/api/v1/execution/events/history"]
    assert set(methods) == {"get"}
