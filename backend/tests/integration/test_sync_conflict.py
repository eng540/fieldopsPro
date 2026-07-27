"""Sprint-2 CP-4 — Sync Engine Integration Tests

Tests for POST /sync/pull and POST /sync/push.

Coverage:
  Pull:
    - Initial full sync (no cursor)
    - Incremental sync with last_sync_version cursor
    - Project scoping
    - Empty result (no new data)
    - Multi-tenant isolation

  Push — Exactly-Once (ADR-002 CR-02):
    - Duplicate operation_uuid → 200, not re-processed
    - Different UUID → processed normally

  Push — Monotonic Progress (ADR-002/ADR-003 CR-01):
    - Decrease without rework_flag → MONOTONIC_VIOLATION conflict
    - Increase → processed
    - Same value → processed

  Push — Status Transitions:
    - Valid transition → processed
    - Invalid transition → POLICY_BLOCK conflict

  Push — Clock Skew (ADR-002):
    - |device_ts - server_ts| > 5min → TIMESTAMP_SKEW conflict
    - Within threshold → processed

  Push — Org Isolation:
    - entity in different org → POLICY_BLOCK conflict

  Push — HTTP status codes:
    - All processed → 200
    - Partial (some conflicts) → 207
    - All blocked → 409

  Push — WORM audit:
    - Status change writes WorkOrderStatusHistory row
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta

import pytest
from sqlalchemy import insert


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _uuid() -> str:
    return str(uuid.uuid4())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_op(
    entity_id: int,
    *,
    op_uuid: str | None = None,
    op_type: str = "UPDATE",
    entity_type: str = "WORK_ORDER",
    payload: dict | None = None,
    device_ts: str | None = None,
) -> dict:
    return {
        "operation_uuid": op_uuid or _uuid(),
        "operation_type": op_type,
        "entity_type": entity_type,
        "entity_id": str(entity_id),
        "payload": payload or {"completion_pct": 50.0},
        "device_timestamp": device_ts or _now_iso(),
    }


def _seed_work_order(sync_db, auth_headers, *, completion_pct: float = 0.0, status: str = "DRAFT") -> int:
    """Seed a work order directly in DB and return its id."""
    from app.modules.execution.models import WorkOrder
    with sync_db.begin() as conn:
        result = conn.execute(
            insert(WorkOrder).values(
                org_id=auth_headers.org_id,
                project_id=1,
                title="Sync Test WO",
                created_by=auth_headers.user_id,
                status=status,
                completion_pct=completion_pct,
                rework_flag=False,
            )
        )
        return result.lastrowid


# ─────────────────────────────────────────────────────────────────────────────
# PULL TESTS
# ─────────────────────────────────────────────────────────────────────────────

class TestSyncPull:
    """POST /sync/pull"""

    def test_initial_full_sync_returns_bundle(self, client, auth_headers, sync_db):
        """No cursor → returns all work orders for the org."""
        _seed_work_order(sync_db, auth_headers)
        _seed_work_order(sync_db, auth_headers)

        response = client.post(
            "/sync/pull",
            json={},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert "sync_version" in data
        assert "bundle" in data
        assert "has_more" in data
        assert isinstance(data["bundle"]["work_orders"], list)
        assert len(data["bundle"]["work_orders"]) >= 2

    def test_pull_requires_auth(self, client, auth_headers):
        """No auth → 401."""
        response = client.post("/sync/pull", json={})
        assert response.status_code == 401

    def test_pull_returns_sync_version_cursor(self, client, auth_headers):
        """sync_version must be a parseable ISO-8601 datetime."""
        response = client.post("/sync/pull", json={}, headers=auth_headers)
        assert response.status_code == 200
        sv = response.json()["sync_version"]
        # Should parse without error
        parsed = datetime.fromisoformat(sv.replace("Z", "+00:00"))
        assert parsed is not None

    def test_pull_incremental_cursor_empty_when_no_new_data(self, client, auth_headers, sync_db):
        """Cursor set to future → no records returned, has_more=False."""
        # Use a future cursor so nothing is newer than it
        future_cursor = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        response = client.post(
            "/sync/pull",
            json={"last_sync_version": future_cursor},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["bundle"]["work_orders"] == []
        assert data["has_more"] is False

    def test_pull_multi_tenant_isolation(self, client, auth_headers, org2_auth_headers, sync_db):
        """Org1 pull must not return org2 work orders."""
        # Seed WO for org2
        _seed_work_order(sync_db, org2_auth_headers)

        response = client.post("/sync/pull", json={}, headers=auth_headers)
        assert response.status_code == 200
        wo_ids = [wo["org_id"] for wo in response.json()["bundle"]["work_orders"]]
        # All returned WOs must belong to auth_headers.org_id
        for oid in wo_ids:
            assert oid == auth_headers.org_id

    def test_pull_project_scoping_empty_intersection(self, client, auth_headers):
        """project_ids with no accessible projects → empty bundle, not error."""
        response = client.post(
            "/sync/pull",
            json={"project_ids": [99999]},  # non-existent project
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["bundle"]["work_orders"] == []

    def test_pull_bundle_fields(self, client, auth_headers, sync_db):
        """Returned work order summaries must contain required fields."""
        _seed_work_order(sync_db, auth_headers, completion_pct=45.0)
        response = client.post("/sync/pull", json={}, headers=auth_headers)
        assert response.status_code == 200
        wos = response.json()["bundle"]["work_orders"]
        assert len(wos) >= 1
        wo = wos[0]
        for field in ["id", "org_id", "project_id", "title", "status", "completion_pct", "server_timestamp"]:
            assert field in wo, f"Missing field: {field}"


# ─────────────────────────────────────────────────────────────────────────────
# PUSH — EXACTLY-ONCE
# ─────────────────────────────────────────────────────────────────────────────

class TestExactlyOnce:
    """ADR-002 CR-02: Duplicate operation_uuid → idempotent 200."""

    def test_duplicate_uuid_is_idempotent(self, client, auth_headers, sync_db):
        """Same operation_uuid twice → second call is accepted but not re-applied."""
        wo_id = _seed_work_order(sync_db, auth_headers, completion_pct=10.0)
        op_uuid = _uuid()

        # First push
        r1 = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, op_uuid=op_uuid, payload={"completion_pct": 20.0})]},
            headers=auth_headers,
        )
        assert r1.status_code == 200
        assert op_uuid in r1.json()["processed"]

        # Second push with same UUID
        r2 = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, op_uuid=op_uuid, payload={"completion_pct": 50.0})]},
            headers=auth_headers,
        )
        assert r2.status_code == 200
        assert op_uuid in r2.json()["processed"]

        # Value should still be 20 (first write), not 50 (duplicate ignored)
        wo_resp = client.get(f"/execution/work-orders/{wo_id}", headers=auth_headers)
        assert wo_resp.json()["completion_pct"] == 20.0

    def test_different_uuids_both_processed(self, client, auth_headers, sync_db):
        """Two different UUIDs → both processed."""
        wo_id = _seed_work_order(sync_db, auth_headers, completion_pct=0.0)
        uuid1, uuid2 = _uuid(), _uuid()

        response = client.post(
            "/sync/push",
            json={"operations": [
                _make_op(wo_id, op_uuid=uuid1, payload={"completion_pct": 30.0}),
                _make_op(wo_id, op_uuid=uuid2, payload={"completion_pct": 60.0}),
            ]},
            headers=auth_headers,
        )
        # May be 200 or 207 depending on whether first sets 30 and second sets 60
        # Both UUIDs should appear in processed
        data = response.json()
        assert uuid1 in data["processed"]
        assert uuid2 in data["processed"]


# ─────────────────────────────────────────────────────────────────────────────
# PUSH — MONOTONIC PROGRESS
# ─────────────────────────────────────────────────────────────────────────────

class TestPushMonotonicProgress:
    """ADR-002/ADR-003 CR-01: completion_pct cannot decrease without rework."""

    def test_increase_is_processed(self, client, auth_headers, sync_db):
        """Increase in completion_pct → processed, no conflict."""
        wo_id = _seed_work_order(sync_db, auth_headers, completion_pct=30.0)
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, payload={"completion_pct": 60.0})]},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["processed"]) == 1
        assert len(data["conflicts"]) == 0

    def test_same_value_is_processed(self, client, auth_headers, sync_db):
        """Equal completion_pct (no change) → idempotent, processed."""
        wo_id = _seed_work_order(sync_db, auth_headers, completion_pct=50.0)
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, payload={"completion_pct": 50.0})]},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert len(response.json()["conflicts"]) == 0

    def test_decrease_without_rework_returns_monotonic_conflict(self, client, auth_headers, sync_db):
        """Decrease without rework_flag → MONOTONIC_VIOLATION conflict."""
        wo_id = _seed_work_order(sync_db, auth_headers, completion_pct=70.0)
        op_uuid = _uuid()
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, op_uuid=op_uuid, payload={"completion_pct": 30.0})]},
            headers=auth_headers,
        )
        data = response.json()
        assert op_uuid not in data.get("processed", [])
        assert len(data["conflicts"]) == 1
        conflict = data["conflicts"][0]
        assert conflict["operation_uuid"] == op_uuid
        assert conflict["conflict_type"] == "MONOTONIC_VIOLATION"
        assert "70" in conflict["resolution_hint"] or "cannot decrease" in conflict["resolution_hint"]

    def test_decrease_with_rework_flag_is_processed(self, client, auth_headers, sync_db):
        """Decrease with rework_flag=True → processed (Monotonic rule satisfied)."""
        wo_id = _seed_work_order(sync_db, auth_headers, completion_pct=80.0)
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, payload={
                "completion_pct": 20.0,
                "rework_flag": True,
                "rework_reason": "Structural defect found — rework required per site inspection",
            })]},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert len(response.json()["conflicts"]) == 0

    def test_conflict_contains_server_and_client_values(self, client, auth_headers, sync_db):
        """Conflict must include server_value and client_value for display."""
        wo_id = _seed_work_order(sync_db, auth_headers, completion_pct=60.0)
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, payload={"completion_pct": 10.0})]},
            headers=auth_headers,
        )
        conflict = response.json()["conflicts"][0]
        assert "completion_pct" in str(conflict["server_value"]) or conflict["server_value"] != {}
        assert conflict["client_value"] is not None


# ─────────────────────────────────────────────────────────────────────────────
# PUSH — STATUS TRANSITIONS
# ─────────────────────────────────────────────────────────────────────────────

class TestPushStatusTransitions:
    """ADR-003: Status transitions enforced during push."""

    def test_valid_transition_processed(self, client, auth_headers, sync_db):
        """DRAFT → PENDING_APPROVAL via sync push → processed."""
        wo_id = _seed_work_order(sync_db, auth_headers, status="DRAFT")
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, payload={"status": "PENDING_APPROVAL"})]},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert len(response.json()["conflicts"]) == 0

        # Verify status applied
        wo = client.get(f"/execution/work-orders/{wo_id}", headers=auth_headers).json()
        assert wo["status"] == "PENDING_APPROVAL"

    def test_invalid_transition_returns_policy_block(self, client, auth_headers, sync_db):
        """DRAFT → COMPLETED is invalid → POLICY_BLOCK conflict."""
        wo_id = _seed_work_order(sync_db, auth_headers, status="DRAFT")
        op_uuid = _uuid()
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, op_uuid=op_uuid, payload={"status": "COMPLETED"})]},
            headers=auth_headers,
        )
        data = response.json()
        conflicts = data["conflicts"]
        assert len(conflicts) == 1
        assert conflicts[0]["conflict_type"] == "POLICY_BLOCK"
        assert op_uuid not in data.get("processed", [])

    def test_terminal_status_blocked(self, client, auth_headers, sync_db):
        """Transition out of COMPLETED (terminal) → POLICY_BLOCK."""
        wo_id = _seed_work_order(sync_db, auth_headers, status="COMPLETED")
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, payload={"status": "IN_PROGRESS"})]},
            headers=auth_headers,
        )
        data = response.json()
        assert len(data["conflicts"]) == 1
        assert data["conflicts"][0]["conflict_type"] == "POLICY_BLOCK"

    def test_status_change_writes_worm_history(self, client, auth_headers, sync_db):
        """Valid status transition via push must write WorkOrderStatusHistory."""
        from sqlalchemy import select
        from app.modules.execution.models import WorkOrderStatusHistory

        wo_id = _seed_work_order(sync_db, auth_headers, status="DRAFT")
        client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, payload={"status": "PENDING_APPROVAL"})]},
            headers=auth_headers,
        )

        with sync_db.connect() as conn:
            result = conn.execute(
                select(WorkOrderStatusHistory).where(
                    WorkOrderStatusHistory.work_order_id == wo_id
                )
            )
            rows = result.fetchall()

        assert len(rows) == 1
        assert rows[0].from_status == "DRAFT"
        assert rows[0].to_status == "PENDING_APPROVAL"


# ─────────────────────────────────────────────────────────────────────────────
# PUSH — CLOCK SKEW
# ─────────────────────────────────────────────────────────────────────────────

class TestClockSkew:
    """ADR-002: device_timestamp > 5 min from server → TIMESTAMP_SKEW conflict."""

    def test_device_ts_within_threshold_processed(self, client, auth_headers, sync_db):
        """device_timestamp 2 min in the past → processed normally."""
        wo_id = _seed_work_order(sync_db, auth_headers, completion_pct=10.0)
        recent_ts = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, payload={"completion_pct": 20.0}, device_ts=recent_ts)]},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert len(response.json()["conflicts"]) == 0

    def test_device_ts_far_past_returns_timestamp_skew(self, client, auth_headers, sync_db):
        """device_timestamp 2 hours in the past → TIMESTAMP_SKEW conflict."""
        wo_id = _seed_work_order(sync_db, auth_headers, completion_pct=10.0)
        old_ts = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        op_uuid = _uuid()
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, op_uuid=op_uuid, payload={"completion_pct": 20.0}, device_ts=old_ts)]},
            headers=auth_headers,
        )
        data = response.json()
        assert len(data["conflicts"]) == 1
        conflict = data["conflicts"][0]
        assert conflict["conflict_type"] == "TIMESTAMP_SKEW"
        assert conflict["operation_uuid"] == op_uuid

    def test_device_ts_far_future_returns_timestamp_skew(self, client, auth_headers, sync_db):
        """device_timestamp 2 hours in the future → TIMESTAMP_SKEW conflict."""
        wo_id = _seed_work_order(sync_db, auth_headers, completion_pct=10.0)
        future_ts = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, payload={"completion_pct": 20.0}, device_ts=future_ts)]},
            headers=auth_headers,
        )
        assert len(response.json()["conflicts"]) == 1
        assert response.json()["conflicts"][0]["conflict_type"] == "TIMESTAMP_SKEW"


# ─────────────────────────────────────────────────────────────────────────────
# PUSH — MULTI-TENANT ISOLATION
# ─────────────────────────────────────────────────────────────────────────────

class TestPushOrgIsolation:
    """Org isolation: cannot modify another org's work orders via push."""

    def test_cross_org_push_returns_policy_block(self, client, auth_headers, org2_auth_headers, sync_db):
        """Pushing to org2 WO from org1 token → POLICY_BLOCK."""
        wo_id_org2 = _seed_work_order(sync_db, org2_auth_headers, completion_pct=0.0)

        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id_org2, payload={"completion_pct": 50.0})]},
            headers=auth_headers,   # org1 token
        )
        data = response.json()
        assert len(data["conflicts"]) == 1
        assert data["conflicts"][0]["conflict_type"] == "POLICY_BLOCK"


# ─────────────────────────────────────────────────────────────────────────────
# PUSH — HTTP STATUS CODES
# ─────────────────────────────────────────────────────────────────────────────

class TestPushHTTPStatus:
    """HTTP 200 / 207 / 409 per OpenAPI spec."""

    def test_all_processed_returns_200(self, client, auth_headers, sync_db):
        """All operations succeed → 200."""
        wo_id = _seed_work_order(sync_db, auth_headers, completion_pct=0.0)
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, payload={"completion_pct": 50.0})]},
            headers=auth_headers,
        )
        assert response.status_code == 200

    def test_partial_conflict_returns_207(self, client, auth_headers, sync_db):
        """One processed + one conflict → 207 Multi-Status."""
        wo_id = _seed_work_order(sync_db, auth_headers, completion_pct=50.0)
        op_ok  = _make_op(wo_id, op_uuid=_uuid(), payload={"completion_pct": 60.0})  # valid increase
        op_bad = _make_op(wo_id, op_uuid=_uuid(), payload={"completion_pct": 10.0})  # decrease → conflict

        response = client.post(
            "/sync/push",
            json={"operations": [op_ok, op_bad]},
            headers=auth_headers,
        )
        assert response.status_code == 207
        data = response.json()
        assert len(data["processed"]) >= 1
        assert len(data["conflicts"]) >= 1

    def test_all_conflicts_returns_409(self, client, auth_headers, sync_db):
        """All operations blocked → 409."""
        wo_id = _seed_work_order(sync_db, auth_headers, completion_pct=80.0)
        response = client.post(
            "/sync/push",
            json={"operations": [
                _make_op(wo_id, op_uuid=_uuid(), payload={"completion_pct": 10.0}),  # decrease
                _make_op(wo_id, op_uuid=_uuid(), payload={"completion_pct": 5.0}),   # decrease
            ]},
            headers=auth_headers,
        )
        assert response.status_code == 409
        data = response.json()
        assert data["processed"] == []
        assert len(data["conflicts"]) == 2

    def test_push_requires_auth(self, client):
        """No auth → 401."""
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(1, payload={"completion_pct": 50.0})]},
        )
        assert response.status_code == 401

    def test_empty_operations_returns_422(self, client, auth_headers):
        """Empty operations list → 422 Unprocessable Entity."""
        response = client.post(
            "/sync/push",
            json={"operations": []},
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_invalid_uuid_format_returns_422(self, client, auth_headers, sync_db):
        """Malformed UUID → 422 schema validation error."""
        wo_id = _seed_work_order(sync_db, auth_headers)
        response = client.post(
            "/sync/push",
            json={"operations": [{
                "operation_uuid": "not-a-valid-uuid",
                "operation_type": "UPDATE",
                "entity_type": "WORK_ORDER",
                "entity_id": str(wo_id),
                "payload": {"completion_pct": 50.0},
                "device_timestamp": _now_iso(),
            }]},
            headers=auth_headers,
        )
        assert response.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# PUSH — MISC
# ─────────────────────────────────────────────────────────────────────────────

class TestPushMisc:
    """Entity not found, unsupported entity type."""

    def test_nonexistent_entity_returns_policy_block(self, client, auth_headers):
        """Work order ID that doesn't exist → POLICY_BLOCK conflict."""
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(99999, payload={"completion_pct": 50.0})]},
            headers=auth_headers,
        )
        data = response.json()
        assert len(data["conflicts"]) == 1
        assert data["conflicts"][0]["conflict_type"] == "POLICY_BLOCK"

    def test_unsupported_entity_type_returns_policy_block(self, client, auth_headers, sync_db):
        """UNIT_PROGRESS entity type not yet implemented → POLICY_BLOCK."""
        wo_id = _seed_work_order(sync_db, auth_headers)
        response = client.post(
            "/sync/push",
            json={"operations": [{
                "operation_uuid": _uuid(),
                "operation_type": "UPDATE",
                "entity_type": "UNIT_PROGRESS",
                "entity_id": str(wo_id),
                "payload": {"completion_pct": 50.0},
                "device_timestamp": _now_iso(),
            }]},
            headers=auth_headers,
        )
        data = response.json()
        assert len(data["conflicts"]) == 1
        assert data["conflicts"][0]["conflict_type"] == "POLICY_BLOCK"

    def test_next_sync_version_in_response(self, client, auth_headers, sync_db):
        """Every push response must include next_sync_version."""
        wo_id = _seed_work_order(sync_db, auth_headers)
        response = client.post(
            "/sync/push",
            json={"operations": [_make_op(wo_id, payload={"completion_pct": 50.0})]},
            headers=auth_headers,
        )
        data = response.json()
        assert "next_sync_version" in data
        # Must be parseable ISO datetime
        parsed = datetime.fromisoformat(data["next_sync_version"].replace("Z", "+00:00"))
        assert parsed is not None
