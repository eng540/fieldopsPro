"""Integration Tests — FieldOps V4.0 Sprint-2 CP-4

Tests the 5 CRUD endpoints for work orders:
1. POST   /execution/work-orders              — Create
2. GET    /execution/work-orders              — List (filtered, paginated)
3. GET    /execution/work-orders/{id}         — Get detail
4. PATCH  /execution/work-orders/{id}        — Update
5. POST   /execution/work-orders/{id}/assign   — Assign

Constitutional Tests:
- Multi-tenant isolation (org_id scoping via JWT)
- Default values (status=DRAFT, completion_pct=0)
- Pagination bounds
- 404 for non-existent resources
- 403 for org_id mismatch

Authentication:
- All tests use real JWT tokens obtained via POST /auth/login
- IAM data (org, user, role, project_user) is seeded per-test via fixtures
"""
from __future__ import annotations

import pytest
from sqlalchemy import insert


# ─────────────────────────────────────────
# Auth Headers Wrapper
# ─────────────────────────────────────────
class AuthHeaders(dict):
    """Dict subclass for HTTP headers with extra metadata attributes.

    Inherits from dict so httpx/starlette TestClient treats it as headers.
    Only string-valued keys are stored in the dict; metadata is on attributes.
    """

    def __init__(self, token: str, *, org_id: int, user_id: int):
        super().__init__({"Authorization": f"Bearer {token}"})
        self.org_id = org_id
        self.user_id = user_id


# ─────────────────────────────────────────
# IAM Seed & Auth Helper
# ─────────────────────────────────────────
def _seed_and_auth(client, sync_db, *, org_name, org_code, email, password,
                   role_name="SUPER_ADMIN", project_ids=None):
    """Seed an org + role + user + project_user, then login.

    Returns an AuthHeaders instance (dict + .org_id / .user_id attrs).
    """
    from app.core.security import get_password_hash
    from app.modules.iam.models import Organization, User, Role, ProjectUser

    if project_ids is None:
        project_ids = [1]

    # ── Seed organization ──
    with sync_db.begin() as conn:
        result = conn.execute(
            insert(Organization).values(
                name=org_name,
                code=org_code,
                is_active=True,
            )
        )
        org_id = result.lastrowid

    # ── Seed role ──
    with sync_db.begin() as conn:
        result = conn.execute(
            insert(Role).values(
                org_id=org_id,
                name=role_name,
                description=f"{role_name} role for {org_name}",
            )
        )
        role_id = result.lastrowid

    # ── Seed user ──
    with sync_db.begin() as conn:
        result = conn.execute(
            insert(User).values(
                org_id=org_id,
                email=email,
                name=f"{org_name} User",
                hashed_password=get_password_hash(password),
                is_active=True,
                token_version=1,
            )
        )
        user_id = result.lastrowid

    # ── Seed project_user assignments (gives user a role) ──
    for pid in project_ids:
        with sync_db.begin() as conn:
            conn.execute(
                insert(ProjectUser).values(
                    org_id=org_id,
                    user_id=user_id,
                    project_id=pid,
                    role_id=role_id,
                )
            )

    # ── Login via API to get real JWT token ──
    response = client.post(
        "/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200, f"Login failed: {response.text}"
    data = response.json()

    return AuthHeaders(
        data["access_token"],
        org_id=org_id,
        user_id=user_id,
    )


# ─────────────────────────────────────────
# Shared Fixtures
# ─────────────────────────────────────────
@pytest.fixture
def auth_headers(client, sync_db):
    """Real JWT auth headers for org 1 user (SUPER_ADMIN)."""
    return _seed_and_auth(
        client, sync_db,
        org_name="Test Organization",
        org_code="TEST-ORG",
        email="testuser@fieldops.dev",
        password="TestPass123!",
    )


@pytest.fixture
def org2_auth_headers(client, sync_db):
    """Real JWT auth headers for org 2 user (SUPER_ADMIN)."""
    return _seed_and_auth(
        client, sync_db,
        org_name="Second Organization",
        org_code="ORG2",
        email="org2user@fieldops.dev",
        password="TestPass123!",
    )


# ─────────────────────────────────────────
# Test Classes
# ─────────────────────────────────────────
@pytest.mark.integration
class TestCreateWorkOrder:
    """Endpoint 1: POST /execution/work-orders"""

    def test_create_work_order_minimal(self, client, auth_headers):
        """Create work order with only required fields."""
        response = client.post(
            "/execution/work-orders",
            json={
                "title": "Fix cracked foundation slab",
                "project_id": 1,
            },
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["title"] == "Fix cracked foundation slab"
        assert data["project_id"] == 1
        assert data["status"] == "DRAFT"
        assert data["completion_pct"] == 0.0
        assert data["wo_type"] == "CORRECTIVE"
        assert data["priority"] == "MEDIUM"
        assert data["created_by"] == auth_headers.user_id
        assert data["org_id"] == auth_headers.org_id
        assert "id" in data
        assert data["id"] > 0

    def test_create_work_order_full(self, client, auth_headers):
        """Create work order with all optional fields."""
        response = client.post(
            "/execution/work-orders",
            json={
                "title": "Replace corroded plumbing pipes",
                "description": "Section 3B pipes show advanced corrosion per inspection report",
                "project_id": 1,
                "unit_id": 5,
                "wo_type": "CORRECTIVE",
                "priority": "HIGH",
                "location_data": {"lat": 14.8021, "lng": 42.9513},
                "extra_data": {"estimated_hours": 8},
            },
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["title"] == "Replace corroded plumbing pipes"
        assert data["description"] == "Section 3B pipes show advanced corrosion per inspection report"
        assert data["unit_id"] == 5
        assert data["wo_type"] == "CORRECTIVE"
        assert data["priority"] == "HIGH"
        assert data["location_data"]["lat"] == 14.8021
        assert data["extra_data"]["estimated_hours"] == 8

    def test_create_with_different_priorities(self, client, auth_headers):
        """Test all priority values are accepted."""
        for priority in ["LOW", "MEDIUM", "HIGH", "CRITICAL"]:
            response = client.post(
                "/execution/work-orders",
                json={"title": f"WO priority {priority}", "project_id": 1, "priority": priority},
                headers=auth_headers,
            )
            assert response.status_code == 201
            assert response.json()["priority"] == priority

    def test_create_with_different_types(self, client, auth_headers):
        """Test all work order types are accepted."""
        for wo_type in ["CORRECTIVE", "PREVENTIVE", "INSTALLATION", "INSPECTION", "MAINTENANCE"]:
            response = client.post(
                "/execution/work-orders",
                json={"title": f"WO type {wo_type}", "project_id": 1, "wo_type": wo_type},
                headers=auth_headers,
            )
            assert response.status_code == 201
            assert response.json()["wo_type"] == wo_type

    def test_create_rejects_short_title(self, client, auth_headers):
        """Title must be at least 3 characters."""
        response = client.post(
            "/execution/work-orders",
            json={"title": "AB", "project_id": 1},
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_create_rejects_missing_title(self, client, auth_headers):
        response = client.post(
            "/execution/work-orders",
            json={"project_id": 1},
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_create_rejects_missing_project_id(self, client, auth_headers):
        response = client.post(
            "/execution/work-orders",
            json={"title": "Valid title"},
            headers=auth_headers,
        )
        assert response.status_code == 422


@pytest.mark.integration
class TestListWorkOrders:
    """Endpoint 2: GET /execution/work-orders"""

    @pytest.fixture(autouse=True)
    def _seed_work_orders(self, client, auth_headers, org2_auth_headers):
        """Seed work orders in org 1 and org 2 for list tests."""
        # Create 5 WOs in org 1
        for i in range(5):
            client.post(
                "/execution/work-orders",
                json={"title": f"Work Order {i}", "project_id": 1, "priority": "HIGH" if i % 2 == 0 else "LOW"},
                headers=auth_headers,
            )
        # Create 2 WOs in org 2
        client.post(
            "/execution/work-orders",
            json={"title": "Other Org WO 1", "project_id": 2},
            headers=org2_auth_headers,
        )
        client.post(
            "/execution/work-orders",
            json={"title": "Other Org WO 2", "project_id": 2},
            headers=org2_auth_headers,
        )
        # Store headers for tests
        self._org1_headers = auth_headers
        self._org2_headers = org2_auth_headers

    def test_list_returns_paginated_results(self, client):
        response = client.get(
            "/execution/work-orders",
            headers=self._org1_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "page" in data
        assert "page_size" in data
        assert data["total"] == 5  # Only org 1 WOs
        assert len(data["items"]) == 5

    def test_list_scoped_by_org_id(self, client):
        """List only returns WOs for the requesting org."""
        response = client.get(
            "/execution/work-orders",
            headers=self._org2_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2

    def test_list_filter_by_status(self, client):
        """Filter by status parameter."""
        response = client.get(
            "/execution/work-orders?status=DRAFT",
            headers=self._org1_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 5  # All seeded WOs are DRAFT

    def test_list_filter_by_priority(self, client):
        """Filter by priority parameter."""
        response = client.get(
            "/execution/work-orders?priority=HIGH",
            headers=self._org1_headers,
        )
        assert response.status_code == 200
        data = response.json()
        # 3 of 5 seeded WOs have HIGH priority (i=0,2,4)
        assert data["total"] == 3

    def test_list_pagination(self, client):
        """Pagination parameters work correctly."""
        response = client.get(
            "/execution/work-orders?page=1&page_size=2",
            headers=self._org1_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["page"] == 1
        assert data["page_size"] == 2
        assert len(data["items"]) == 2
        assert data["total"] == 5

    def test_list_second_page(self, client):
        """Second page returns correct items."""
        response = client.get(
            "/execution/work-orders?page=2&page_size=2",
            headers=self._org1_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["page"] == 2
        assert len(data["items"]) == 2

    def test_list_empty_for_no_match(self, client):
        """Returns empty list when no WOs match filters."""
        response = client.get(
            "/execution/work-orders?project_id=999",
            headers=self._org1_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["items"] == []


@pytest.mark.integration
class TestGetWorkOrderDetail:
    """Endpoint 3: GET /execution/work-orders/{id}"""

    @pytest.fixture
    def work_order_id(self, client, auth_headers):
        """Create a work order and return its ID."""
        response = client.post(
            "/execution/work-orders",
            json={"title": "Detail Test WO", "project_id": 1, "description": "Full detail test"},
            headers=auth_headers,
        )
        return response.json()["id"], auth_headers

    def test_get_existing_work_order(self, client, work_order_id):
        """Get detail of existing work order."""
        wo_id, headers = work_order_id
        response = client.get(
            f"/execution/work-orders/{wo_id}",
            headers=headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == wo_id
        assert data["title"] == "Detail Test WO"
        assert data["description"] == "Full detail test"
        assert data["org_id"] == headers.org_id

    def test_get_nonexistent_work_order(self, client, auth_headers):
        """Returns 404 for non-existent work order."""
        response = client.get(
            "/execution/work-orders/99999",
            headers=auth_headers,
        )
        assert response.status_code == 404

    def test_get_work_order_different_org(self, client, work_order_id, org2_auth_headers):
        """Cannot access work order from different organization."""
        wo_id, _ = work_order_id
        response = client.get(
            f"/execution/work-orders/{wo_id}",
            headers=org2_auth_headers,
        )
        assert response.status_code == 404  # Returns 404, not 403 (prevents info leakage)

    def test_get_includes_all_fields(self, client, work_order_id):
        """Response includes all model fields."""
        wo_id, headers = work_order_id
        response = client.get(
            f"/execution/work-orders/{wo_id}",
            headers=headers,
        )
        data = response.json()
        expected_fields = [
            "id", "org_id", "project_id", "unit_id", "title", "description",
            "wo_type", "priority", "status", "completion_pct", "rework_flag",
            "rework_reason", "rework_authorized_by", "created_by",
            "device_timestamp", "server_timestamp", "location_data",
            "extra_data", "created_at", "updated_at",
        ]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"


@pytest.mark.integration
class TestUpdateWorkOrder:
    """Endpoint 4: PATCH /execution/work-orders/{id}"""

    @pytest.fixture
    def work_order_id(self, client, auth_headers):
        """Create a work order for update tests."""
        response = client.post(
            "/execution/work-orders",
            json={"title": "Original Title", "project_id": 1, "priority": "LOW"},
            headers=auth_headers,
        )
        return response.json()["id"], auth_headers

    def test_update_title(self, client, work_order_id):
        """Update just the title field."""
        wo_id, headers = work_order_id
        response = client.patch(
            f"/execution/work-orders/{wo_id}",
            json={"title": "Updated Title"},
            headers=headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Updated Title"
        # Unchanged fields should remain
        assert data["priority"] == "LOW"

    def test_update_priority(self, client, work_order_id):
        """Update priority field."""
        wo_id, headers = work_order_id
        response = client.patch(
            f"/execution/work-orders/{wo_id}",
            json={"priority": "CRITICAL"},
            headers=headers,
        )
        assert response.status_code == 200
        assert response.json()["priority"] == "CRITICAL"

    def test_update_completion_pct(self, client, work_order_id):
        """Update completion_pct (increase is allowed)."""
        wo_id, headers = work_order_id
        response = client.patch(
            f"/execution/work-orders/{wo_id}",
            json={"completion_pct": 50.0},
            headers=headers,
        )
        assert response.status_code == 200
        assert response.json()["completion_pct"] == 50.0

    def test_update_with_rework_fields(self, client, work_order_id):
        """Update with valid rework fields (ADR-003 compliance)."""
        wo_id, headers = work_order_id
        response = client.patch(
            f"/execution/work-orders/{wo_id}",
            json={
                "completion_pct": 30.0,
                "rework_flag": True,
                "rework_reason": "Quality inspection revealed insufficient reinforcement in section 3B of the foundation slab",
                "rework_authorized_by": 5,
            },
            headers=headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["rework_flag"] is True
        assert data["rework_reason"] is not None
        assert data["rework_authorized_by"] == 5

    def test_update_rework_without_reason_rejected(self, client, work_order_id):
        """ADR-003: rework_flag=True without rework_reason is rejected."""
        wo_id, headers = work_order_id
        response = client.patch(
            f"/execution/work-orders/{wo_id}",
            json={
                "rework_flag": True,
                "rework_authorized_by": 5,
            },
            headers=headers,
        )
        assert response.status_code == 422

    def test_update_nonexistent_work_order(self, client, auth_headers):
        """Returns 404 for non-existent work order."""
        response = client.patch(
            "/execution/work-orders/99999",
            json={"title": "Should fail"},
            headers=auth_headers,
        )
        assert response.status_code == 404

    def test_update_different_org_rejected(self, client, work_order_id, org2_auth_headers):
        """Cannot update work order from different organization."""
        wo_id, _ = work_order_id
        response = client.patch(
            f"/execution/work-orders/{wo_id}",
            json={"title": "Cross-org update"},
            headers=org2_auth_headers,
        )
        assert response.status_code == 404

    def test_update_empty_patch_succeeds(self, client, work_order_id):
        """PATCH with empty body returns current state."""
        wo_id, headers = work_order_id
        response = client.patch(
            f"/execution/work-orders/{wo_id}",
            json={},
            headers=headers,
        )
        assert response.status_code == 200


@pytest.mark.integration
class TestAssignWorkOrder:
    """Endpoint 5: POST /execution/work-orders/{id}/assign"""

    @pytest.fixture
    def work_order_id(self, client, auth_headers):
        """Create a work order for assignment tests."""
        response = client.post(
            "/execution/work-orders",
            json={"title": "Assignment Test WO", "project_id": 1},
            headers=auth_headers,
        )
        return response.json()["id"], auth_headers

    def test_assign_user_to_work_order(self, client, work_order_id):
        """Assign a user to a work order."""
        wo_id, headers = work_order_id
        response = client.post(
            f"/execution/work-orders/{wo_id}/assign",
            json={"user_id": 20, "notes": "Handle section 3B repair"},
            headers=headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["work_order_id"] == wo_id
        assert data["user_id"] == 20
        assert data["assigned_by"] == headers.user_id
        assert data["status"] == "ACTIVE"
        assert data["notes"] == "Handle section 3B repair"

    def test_assign_without_notes(self, client, work_order_id):
        """Assignment without notes is valid."""
        wo_id, headers = work_order_id
        response = client.post(
            f"/execution/work-orders/{wo_id}/assign",
            json={"user_id": 25},
            headers=headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["user_id"] == 25
        assert data["notes"] is None

    def test_assign_releases_previous_assignment(self, client, work_order_id):
        """New assignment releases previous active assignment."""
        wo_id, headers = work_order_id
        # First assignment
        response1 = client.post(
            f"/execution/work-orders/{wo_id}/assign",
            json={"user_id": 20},
            headers=headers,
        )
        assert response1.status_code == 201

        # Second assignment (replaces first)
        response2 = client.post(
            f"/execution/work-orders/{wo_id}/assign",
            json={"user_id": 30},
            headers=headers,
        )
        assert response2.status_code == 201
        assert response2.json()["user_id"] == 30

    def test_assign_nonexistent_work_order(self, client, auth_headers):
        """Returns 404 for non-existent work order."""
        response = client.post(
            "/execution/work-orders/99999/assign",
            json={"user_id": 20},
            headers=auth_headers,
        )
        assert response.status_code == 404

    def test_assign_missing_user_id_rejected(self, client, work_order_id):
        """user_id is required."""
        wo_id, headers = work_order_id
        response = client.post(
            f"/execution/work-orders/{wo_id}/assign",
            json={},
            headers=headers,
        )
        assert response.status_code == 422

    def test_assign_invalid_user_id_rejected(self, client, work_order_id):
        """user_id must be positive."""
        wo_id, headers = work_order_id
        response = client.post(
            f"/execution/work-orders/{wo_id}/assign",
            json={"user_id": 0},
            headers=headers,
        )
        assert response.status_code == 422


# ═══════════════════════════════════════════════════════════════════════════
# CP-3: MONOTONIC PROGRESS TESTS (ADR-003)
# ═══════════════════════════════════════════════════════════════════════════

class TestMonotonicProgress:
    """ADR-003: completion_pct cannot decrease without rework authorization."""

    @pytest.fixture
    def wo_at_50(self, client, auth_headers):
        r = client.post("/execution/work-orders",
                        json={"project_id": 1, "title": "Monotonic WO"},
                        headers=auth_headers)
        assert r.status_code == 201
        wo_id = r.json()["id"]
        r2 = client.patch(f"/execution/work-orders/{wo_id}",
                          json={"completion_pct": 50.0}, headers=auth_headers)
        assert r2.status_code == 200
        return wo_id, auth_headers

    def test_increase_allowed(self, client, wo_at_50):
        wo_id, headers = wo_at_50
        r = client.patch(f"/execution/work-orders/{wo_id}",
                         json={"completion_pct": 75.0}, headers=headers)
        assert r.status_code == 200
        assert r.json()["completion_pct"] == 75.0

    def test_same_value_allowed(self, client, wo_at_50):
        wo_id, headers = wo_at_50
        r = client.patch(f"/execution/work-orders/{wo_id}",
                         json={"completion_pct": 50.0}, headers=headers)
        assert r.status_code == 200

    def test_decrease_without_rework_flag_409(self, client, wo_at_50):
        wo_id, headers = wo_at_50
        r = client.patch(f"/execution/work-orders/{wo_id}",
                         json={"completion_pct": 30.0}, headers=headers)
        assert r.status_code == 409
        assert "Monotonic Progress Violation" in r.json()["detail"]

    def test_decrease_with_valid_rework(self, client, wo_at_50):
        wo_id, headers = wo_at_50
        r = client.patch(f"/execution/work-orders/{wo_id}", json={
            "completion_pct": 20.0,
            "rework_flag": True,
            "rework_reason": "Quality inspection revealed insufficient reinforcement in section 3B",
        }, headers=headers)
        assert r.status_code == 200
        assert r.json()["completion_pct"] == 20.0

    def test_rework_short_reason_422(self, client, wo_at_50):
        wo_id, headers = wo_at_50
        r = client.patch(f"/execution/work-orders/{wo_id}", json={
            "completion_pct": 10.0, "rework_flag": True, "rework_reason": "Short",
        }, headers=headers)
        assert r.status_code == 422

    def test_above_100_rejected(self, client, wo_at_50):
        wo_id, headers = wo_at_50
        r = client.patch(f"/execution/work-orders/{wo_id}",
                         json={"completion_pct": 150.0}, headers=headers)
        assert r.status_code == 422

    def test_negative_rejected(self, client, wo_at_50):
        wo_id, headers = wo_at_50
        r = client.patch(f"/execution/work-orders/{wo_id}",
                         json={"completion_pct": -1.0}, headers=headers)
        assert r.status_code == 422


class TestStatusTransitions:
    """ADR-003: Only allowed status transitions."""

    @pytest.fixture
    def fresh_wo(self, client, auth_headers):
        r = client.post("/execution/work-orders",
                        json={"project_id": 1, "title": "Transition WO"},
                        headers=auth_headers)
        return r.json()["id"], auth_headers

    def test_draft_to_pending_allowed(self, client, fresh_wo):
        wo_id, h = fresh_wo
        r = client.patch(f"/execution/work-orders/{wo_id}",
                         json={"status": "PENDING_APPROVAL"}, headers=h)
        assert r.status_code == 200

    def test_draft_to_approved_rejected(self, client, fresh_wo):
        wo_id, h = fresh_wo
        r = client.patch(f"/execution/work-orders/{wo_id}",
                         json={"status": "APPROVED"}, headers=h)
        assert r.status_code == 409

    def test_draft_to_completed_rejected(self, client, fresh_wo):
        wo_id, h = fresh_wo
        r = client.patch(f"/execution/work-orders/{wo_id}",
                         json={"status": "COMPLETED"}, headers=h)
        assert r.status_code == 409

    def test_full_happy_path(self, client, fresh_wo):
        wo_id, h = fresh_wo
        for s in ["PENDING_APPROVAL", "APPROVED", "IN_PROGRESS", "COMPLETED"]:
            r = client.patch(f"/execution/work-orders/{wo_id}",
                             json={"status": s}, headers=h)
            assert r.status_code == 200, f"Failed on {s}: {r.json()}"

    def test_cancelled_is_terminal(self, client, fresh_wo):
        wo_id, h = fresh_wo
        client.patch(f"/execution/work-orders/{wo_id}",
                     json={"status": "CANCELLED"}, headers=h)
        r = client.patch(f"/execution/work-orders/{wo_id}",
                         json={"status": "DRAFT"}, headers=h)
        assert r.status_code == 409

    def test_same_status_allowed(self, client, fresh_wo):
        wo_id, h = fresh_wo
        r = client.patch(f"/execution/work-orders/{wo_id}",
                         json={"status": "DRAFT"}, headers=h)
        assert r.status_code == 200


class TestWORMStatusHistory:
    """ADR-002: Status changes write immutable history rows."""

    @pytest.fixture
    def fresh_wo(self, client, auth_headers):
        r = client.post("/execution/work-orders",
                        json={"project_id": 1, "title": "WORM WO"},
                        headers=auth_headers)
        return r.json()["id"], auth_headers

    def test_status_change_writes_history(self, client, fresh_wo, sync_db):
        from sqlalchemy import select
        from app.modules.execution.models import WorkOrderStatusHistory
        wo_id, h = fresh_wo
        client.patch(f"/execution/work-orders/{wo_id}",
                     json={"status": "PENDING_APPROVAL"}, headers=h)
        with sync_db.connect() as conn:
            rows = conn.execute(
                select(WorkOrderStatusHistory).where(
                    WorkOrderStatusHistory.work_order_id == wo_id)
            ).fetchall()
        assert len(rows) == 1
        assert rows[0].from_status == "DRAFT"
        assert rows[0].to_status == "PENDING_APPROVAL"

    def test_no_status_change_no_history(self, client, fresh_wo, sync_db):
        from sqlalchemy import select
        from app.modules.execution.models import WorkOrderStatusHistory
        wo_id, h = fresh_wo
        client.patch(f"/execution/work-orders/{wo_id}",
                     json={"completion_pct": 30.0}, headers=h)
        with sync_db.connect() as conn:
            rows = conn.execute(
                select(WorkOrderStatusHistory).where(
                    WorkOrderStatusHistory.work_order_id == wo_id)
            ).fetchall()
        assert len(rows) == 0

    def test_multiple_transitions_cumulative(self, client, fresh_wo, sync_db):
        from sqlalchemy import select
        from app.modules.execution.models import WorkOrderStatusHistory
        wo_id, h = fresh_wo
        for s in ["PENDING_APPROVAL", "APPROVED", "IN_PROGRESS"]:
            client.patch(f"/execution/work-orders/{wo_id}",
                         json={"status": s}, headers=h)
        with sync_db.connect() as conn:
            rows = conn.execute(
                select(WorkOrderStatusHistory).where(
                    WorkOrderStatusHistory.work_order_id == wo_id)
            ).fetchall()
        assert len(rows) == 3
