from pathlib import Path

from app.modules.execution.schemas import EventBatchResponse, ExecutionStateInitializationResponse


def test_event_batch_response_exposes_structured_partial_failures():
    response = EventBatchResponse(
        succeeded=[],
        conflicts=[],
        failed=[{"sync_uuid": "x", "error": "state not initialized"}],
    )
    assert response.failed[0]["error"] == "state not initialized"


def test_assignment_state_migration_has_short_revision_and_correct_parent():
    migration = Path(__file__).parents[2] / "alembic" / "versions" / "sprint12_initialize_assignment_state.py"
    text = migration.read_text()
    revision = next(line.split('"')[1] for line in text.splitlines() if line.startswith("revision ="))
    down_revision = next(line.split('"')[1] for line in text.splitlines() if line.startswith("down_revision ="))
    assert len(revision) <= 32
    assert down_revision == "s11_boq_assign_reconcile"
    assert "unit_boq_progress" in text
    assert "INITIAL_STATE" in text


def test_execution_state_initialization_response_is_explicit_and_counted():
    response = ExecutionStateInitializationResponse(
        project_id=10,
        assignment_count=48,
        initialized_count=48,
        existing_count=0,
    )
    assert response.assignment_count == response.initialized_count + response.existing_count
    assert response.project_id == 10


def test_initialize_project_route_is_present_in_execution_router():
    router_text = Path(__file__).parents[2].joinpath("app", "modules", "execution", "router.py").read_text()
    assert '"/state/initialize-project"' in router_text
    assert "VIEWER cannot initialize execution state" in router_text


def test_initialization_response_all_existing_states_is_not_a_failure():
    response = ExecutionStateInitializationResponse(
        project_id=10,
        assignment_count=2128,
        initialized_count=0,
        existing_count=2128,
    )
    assert response.initialized_count == 0
    assert response.existing_count == response.assignment_count


def test_frontend_state_hydration_follows_all_execution_state_pages():
    client = Path(__file__).parents[2].parent / "src" / "lib" / "api-client.ts"
    text = client.read_text()
    assert "listAllExecutionStates" in text
    assert "page=${page}&page_size=500" in text
    assert "items.length < total" in text


def test_frontend_execution_client_does_not_stop_at_first_state_page():
    client = Path(__file__).parents[2].parent / "src" / "lib" / "execution-client.ts"
    text = client.read_text()
    assert "while (hasMore)" in text
    assert "page=${page}&page_size=${safePageSize}" in text
    assert "Execution state pagination exceeded safety limit" in text
