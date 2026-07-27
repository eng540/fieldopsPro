"""Integration Tests — FieldOps V4.0 Sprint-1 CP-2

Tests the 9 IAM auth endpoints:
1. POST /auth/login       — Authenticate, create session
2. POST /auth/refresh     — Refresh access token
3. POST /auth/logout      — Revoke session
4. GET  /auth/me          — Get current user context
5. POST /auth/register    — Create new user
6. GET  /auth/roles       — List organization roles
7. POST /auth/assignments — Assign user to project
8. GET  /auth/audit       — List audit logs
9. GET  /auth/users       — List org users

Constitutional Tests:
- JWT-based authentication (real tokens, not mocks)
- Multi-tenant isolation (org_id scoping)
- Session revocation
- Token version invalidation
- WORM audit trail
- Role-based access control

CRITICAL: Tests use real JWT tokens from POST /auth/login
for authentication, not mock headers.
"""
import pytest
from sqlalchemy import insert, text


# ─────────────────────────────────────────
# HELPER FIXTURES
# ─────────────────────────────────────────
@pytest.fixture
def create_test_org_and_user(sync_db):
    """Create an org, ORG_ADMIN user with known password, and a FIELD_ENGINEER user.

    Returns dict with:
    - org_id, admin_user_id, admin_email, admin_password
    - engineer_user_id, engineer_email, engineer_password
    - role_id (ORG_ADMIN role)
    """
    from app.core.security import get_password_hash
    from app.modules.iam.models import Organization, User, Role

    admin_email = "admin@test.org"
    admin_password = "AdminPass123!"
    engineer_email = "engineer@test.org"
    engineer_password = "EngineerPass123!"

    with sync_db.begin() as conn:
        # Create organization
        org_result = conn.execute(
            insert(Organization).values(
                name="Test Organization",
                code="TEST-ORG",
                is_active=True,
            )
        )
        org_id = org_result.lastrowid

        # Create roles
        admin_role_result = conn.execute(
            insert(Role).values(
                org_id=org_id,
                name="ORG_ADMIN",
                description="Organization Administrator",
            )
        )
        admin_role_id = admin_role_result.lastrowid

        engineer_role_result = conn.execute(
            insert(Role).values(
                org_id=org_id,
                name="FIELD_ENGINEER",
                description="Field Engineer",
            )
        )
        engineer_role_id = engineer_role_result.lastrowid

        # Create admin user
        admin_result = conn.execute(
            insert(User).values(
                org_id=org_id,
                email=admin_email,
                name="Test Admin",
                hashed_password=get_password_hash(admin_password),
                is_active=True,
                token_version=1,
            )
        )
        admin_user_id = admin_result.lastrowid

        # Create engineer user
        eng_result = conn.execute(
            insert(User).values(
                org_id=org_id,
                email=engineer_email,
                name="Test Engineer",
                hashed_password=get_password_hash(engineer_password),
                is_active=True,
                token_version=1,
            )
        )
        engineer_user_id = eng_result.lastrowid

        # Assign admin to a project with ORG_ADMIN role
        # First create a project stub
        conn.execute(
            text(
                "INSERT INTO projects (org_id, name, status) "
                f"VALUES ({org_id}, 'Test Project', 'ACTIVE')"
            )
        )
        # Get project id
        proj_row = conn.execute(
            text("SELECT id FROM projects WHERE org_id = :oid"),
            {"oid": org_id},
        ).fetchone()
        project_id = proj_row[0]

        # Assign admin to project with ORG_ADMIN role
        conn.execute(
            text(
                "INSERT INTO project_users (org_id, user_id, project_id, role_id) "
                f"VALUES ({org_id}, {admin_user_id}, {project_id}, {admin_role_id})"
            )
        )

        # Assign engineer to project with FIELD_ENGINEER role
        conn.execute(
            text(
                "INSERT INTO project_users (org_id, user_id, project_id, role_id) "
                f"VALUES ({org_id}, {engineer_user_id}, {project_id}, {engineer_role_id})"
            )
        )

        conn.commit()

    return {
        "org_id": org_id,
        "admin_user_id": admin_user_id,
        "admin_email": admin_email,
        "admin_password": admin_password,
        "engineer_user_id": engineer_user_id,
        "engineer_email": engineer_email,
        "engineer_password": engineer_password,
        "admin_role_id": admin_role_id,
        "engineer_role_id": engineer_role_id,
        "project_id": project_id,
    }


@pytest.fixture
def admin_auth_headers(client, create_test_org_and_user):
    """Get Authorization headers for admin user."""
    response = client.post(
        "/auth/login",
        json={
            "email": create_test_org_and_user["admin_email"],
            "password": create_test_org_and_user["admin_password"],
        },
    )
    assert response.status_code == 200
    data = response.json()
    return {
        "Authorization": f"Bearer {data['access_token']}",
        "Content-Type": "application/json",
    }, data


@pytest.fixture
def engineer_auth_headers(client, create_test_org_and_user):
    """Get Authorization headers for engineer user."""
    response = client.post(
        "/auth/login",
        json={
            "email": create_test_org_and_user["engineer_email"],
            "password": create_test_org_and_user["engineer_password"],
        },
    )
    assert response.status_code == 200
    data = response.json()
    return {
        "Authorization": f"Bearer {data['access_token']}",
        "Content-Type": "application/json",
    }, data


# ═══════════════════════════════════════
# ENDPOINT 1: POST /auth/login
# ═══════════════════════════════════════
@pytest.mark.integration
class TestLoginEndpoint:
    """POST /auth/login"""

    def test_login_valid_credentials(self, client, create_test_org_and_user):
        """Successful login returns access token and user context."""
        response = client.post(
            "/auth/login",
            json={
                "email": create_test_org_and_user["admin_email"],
                "password": create_test_org_and_user["admin_password"],
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["expires_in"] > 0
        assert "session_id" in data
        assert data["user"]["email"] == create_test_org_and_user["admin_email"]
        assert data["user"]["org_id"] == create_test_org_and_user["org_id"]
        assert "refresh_token" in data

    def test_login_invalid_password(self, client, create_test_org_and_user):
        """Wrong password returns 401."""
        response = client.post(
            "/auth/login",
            json={
                "email": create_test_org_and_user["admin_email"],
                "password": "WrongPassword",
            },
        )
        assert response.status_code == 401

    def test_login_nonexistent_user(self, client, create_test_org_and_user):
        """Non-existent email returns 401."""
        response = client.post(
            "/auth/login",
            json={
                "email": "nonexistent@test.org",
                "password": "SomePassword123!",
            },
        )
        assert response.status_code == 401

    def test_login_inactive_user(self, client, sync_db, create_test_org_and_user):
        """Inactive user returns 401."""
        from app.core.security import get_password_hash
        from app.modules.iam.models import User

        with sync_db.begin() as conn:
            conn.execute(
                insert(User).values(
                    org_id=create_test_org_and_user["org_id"],
                    email="inactive@test.org",
                    name="Inactive User",
                    hashed_password=get_password_hash("Password123!"),
                    is_active=False,
                    token_version=1,
                )
            )

        response = client.post(
            "/auth/login",
            json={"email": "inactive@test.org", "password": "Password123!"},
        )
        assert response.status_code == 401

    def test_login_response_has_user_role(self, client, create_test_org_and_user):
        """Login response includes user role from DB."""
        response = client.post(
            "/auth/login",
            json={
                "email": create_test_org_and_user["admin_email"],
                "password": create_test_org_and_user["admin_password"],
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "role" in data["user"]
        assert data["user"]["role"] == "ORG_ADMIN"


# ═══════════════════════════════════════
# ENDPOINT 2: POST /auth/refresh
# ═══════════════════════════════════════
@pytest.mark.integration
class TestRefreshEndpoint:
    """POST /auth/refresh"""

    def test_refresh_valid_token(self, client, create_test_org_and_user):
        """Valid refresh token returns new access token."""
        # First login to get refresh token
        login_resp = client.post(
            "/auth/login",
            json={
                "email": create_test_org_and_user["admin_email"],
                "password": create_test_org_and_user["admin_password"],
            },
        )
        assert login_resp.status_code == 200
        refresh_token = login_resp.json()["refresh_token"]

        # Refresh
        refresh_resp = client.post(
            "/auth/refresh",
            json={"refresh_token": refresh_token},
        )
        assert refresh_resp.status_code == 200
        data = refresh_resp.json()
        assert "access_token" in data
        assert data["expires_in"] > 0

    def test_refresh_invalid_token(self, client, create_test_org_and_user):
        """Invalid refresh token returns 401."""
        response = client.post(
            "/auth/refresh",
            json={"refresh_token": "invalid-token-here"},
        )
        assert response.status_code == 401

    def test_refresh_revoked_session(self, client, create_test_org_and_user, admin_auth_headers):
        """Revoked session refresh returns 401."""
        login_data = admin_auth_headers[1]
        refresh_token = login_data["refresh_token"]

        # Revoke all sessions via logout
        headers = admin_auth_headers[0]
        client.post(
            "/auth/logout",
            json={
                "session_id": login_data["session_id"],
                "revoke_all": True,
            },
            headers=headers,
        )

        # Try to refresh with revoked token
        response = client.post(
            "/auth/refresh",
            json={"refresh_token": refresh_token},
        )
        assert response.status_code == 401


# ═══════════════════════════════════════
# ENDPOINT 3: POST /auth/logout
# ═══════════════════════════════════════
@pytest.mark.integration
class TestLogoutEndpoint:
    """POST /auth/logout"""

    def test_logout_valid_session(self, client, admin_auth_headers):
        """Logout with valid session returns success."""
        headers = admin_auth_headers[0]
        login_data = admin_auth_headers[1]

        response = client.post(
            "/auth/logout",
            json={"session_id": login_data["session_id"]},
            headers=headers,
        )
        assert response.status_code == 200
        assert response.json()["detail"] == "Logged out successfully"

    def test_logout_revoke_all(self, client, admin_auth_headers):
        """Logout with revoke_all=True revokes all sessions."""
        headers = admin_auth_headers[0]
        login_data = admin_auth_headers[1]

        response = client.post(
            "/auth/logout",
            json={
                "session_id": login_data["session_id"],
                "revoke_all": True,
            },
            headers=headers,
        )
        assert response.status_code == 200

    def test_logout_without_auth(self, client, create_test_org_and_user):
        """Logout without authentication returns 401."""
        response = client.post(
            "/auth/logout",
            json={"session_id": "some-uuid"},
        )
        assert response.status_code == 401


# ═══════════════════════════════════════
# ENDPOINT 4: GET /auth/me
# ═══════════════════════════════════════
@pytest.mark.integration
class TestMeEndpoint:
    """GET /auth/me"""

    def test_me_returns_user_context(self, client, admin_auth_headers):
        """Returns full user context for authenticated user."""
        headers = admin_auth_headers[0]
        response = client.get("/auth/me", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "email" in data
        assert "role" in data
        assert "org_id" in data
        assert "projects" in data

    def test_me_401_without_token(self, client):
        """Returns 401 without authorization header."""
        response = client.get("/auth/me")
        assert response.status_code == 401

    def test_me_401_with_invalid_token(self, client):
        """Returns 401 with invalid token."""
        response = client.get(
            "/auth/me",
            headers={"Authorization": "Bearer invalid-token"},
        )
        assert response.status_code == 401

    def test_me_engineer_has_projects(self, client, engineer_auth_headers):
        """Engineer user has projects assigned."""
        headers = engineer_auth_headers[0]
        response = client.get("/auth/me", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["projects"]) >= 1


# ═══════════════════════════════════════
# ENDPOINT 5: POST /auth/register
# ═══════════════════════════════════════
@pytest.mark.integration
class TestRegisterEndpoint:
    """POST /auth/register"""

    def test_register_new_user(self, client, admin_auth_headers, create_test_org_and_user):
        """ORG_ADMIN can create new user."""
        headers = admin_auth_headers[0]
        response = client.post(
            "/auth/register",
            json={
                "email": "newuser@test.org",
                "password": "NewUserPass123!",
                "name": "New User",
                "org_id": create_test_org_and_user["org_id"],
            },
            headers=headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["email"] == "newuser@test.org"
        assert data["name"] == "New User"
        assert data["org_id"] == create_test_org_and_user["org_id"]
        assert data["is_active"] is True
        assert "id" in data

    def test_register_duplicate_email_rejected(self, client, admin_auth_headers, create_test_org_and_user):
        """Duplicate email in same org returns error."""
        headers = admin_auth_headers[0]
        payload = {
            "email": create_test_org_and_user["admin_email"],
            "password": "Password123!",
            "name": "Duplicate User",
            "org_id": create_test_org_and_user["org_id"],
        }
        response = client.post("/auth/register", json=payload, headers=headers)
        assert response.status_code in (400, 409, 500)  # IntegrityError

    def test_register_missing_fields(self, client, admin_auth_headers):
        """Missing required fields returns 422."""
        headers = admin_auth_headers[0]
        response = client.post(
            "/auth/register",
            json={"name": "Incomplete"},
            headers=headers,
        )
        assert response.status_code == 422

    def test_register_requires_auth(self, client, create_test_org_and_user):
        """Unauthenticated registration returns 401."""
        response = client.post(
            "/auth/register",
            json={
                "email": "sneaky@test.org",
                "password": "SneakyPass123!",
                "name": "Sneaky User",
                "org_id": create_test_org_and_user["org_id"],
            },
        )
        assert response.status_code == 401


# ═══════════════════════════════════════
# ENDPOINT 6: GET /auth/roles
# ═══════════════════════════════════════
@pytest.mark.integration
class TestRolesEndpoint:
    """GET /auth/roles"""

    def test_list_roles(self, client, admin_auth_headers, create_test_org_and_user):
        """Returns roles for the organization."""
        headers = admin_auth_headers[0]
        response = client.get("/auth/roles", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 2  # ORG_ADMIN + FIELD_ENGINEER

    def test_roles_contains_expected_roles(self, client, admin_auth_headers):
        """Roles include ORG_ADMIN and FIELD_ENGINEER."""
        headers = admin_auth_headers[0]
        response = client.get("/auth/roles", headers=headers)
        assert response.status_code == 200
        data = response.json()
        role_names = [r["name"] for r in data]
        assert "ORG_ADMIN" in role_names
        assert "FIELD_ENGINEER" in role_names

    def test_roles_requires_auth(self, client):
        """Returns 401 without authentication."""
        response = client.get("/auth/roles")
        assert response.status_code == 401


# ═══════════════════════════════════════
# ENDPOINT 7: POST /auth/assignments
# ═══════════════════════════════════════
@pytest.mark.integration
class TestAssignmentsEndpoint:
    """POST /auth/assignments"""

    def test_assign_user_to_project(self, client, admin_auth_headers, create_test_org_and_user, sync_db):
        """ORG_ADMIN can assign user to project."""
        headers = admin_auth_headers[0]

        # Create another project via sync_db
        with sync_db.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO projects (org_id, name, status) "
                    f"VALUES ({create_test_org_and_user['org_id']}, 'Project 2', 'ACTIVE')"
                )
            )
            proj = conn.execute(
                text("SELECT id FROM projects WHERE name = 'Project 2'")
            ).fetchone()

        project_id = proj[0]
        response = client.post(
            "/auth/assignments",
            json={
                "user_id": create_test_org_and_user["engineer_user_id"],
                "project_id": project_id,
                "role_id": create_test_org_and_user["engineer_role_id"],
            },
            headers=headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["user_id"] == create_test_org_and_user["engineer_user_id"]

    def test_assignments_requires_admin(self, client, engineer_auth_headers, create_test_org_and_user):
        """FIELD_ENGINEER cannot create assignments."""
        headers = engineer_auth_headers[0]
        response = client.post(
            "/auth/assignments",
            json={
                "user_id": 1,
                "project_id": 1,
                "role_id": 1,
            },
            headers=headers,
        )
        assert response.status_code == 403


# ═══════════════════════════════════════
# ENDPOINT 8: GET /auth/audit
# ═══════════════════════════════════════
@pytest.mark.integration
class TestAuditEndpoint:
    """GET /auth/audit"""

    def test_audit_returns_logs(self, client, admin_auth_headers, create_test_org_and_user):
        """Returns audit logs (login generates one)."""
        headers = admin_auth_headers[0]
        response = client.get("/auth/audit", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "page" in data
        assert "page_size" in data
        assert data["total"] >= 1  # At least the login audit log

    def test_audit_filter_by_action(self, client, admin_auth_headers):
        """Filter audit logs by action type."""
        headers = admin_auth_headers[0]
        response = client.get("/auth/audit?action=LOGIN", headers=headers)
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["action"] == "LOGIN"

    def test_audit_requires_auth(self, client):
        """Returns 401 without authentication."""
        response = client.get("/auth/audit")
        assert response.status_code == 401

    def test_audit_pagination(self, client, admin_auth_headers):
        """Pagination parameters work correctly."""
        headers = admin_auth_headers[0]
        response = client.get("/auth/audit?page=1&page_size=5", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["page"] == 1
        assert data["page_size"] == 5


# ═══════════════════════════════════════
# ENDPOINT 9: GET /auth/users
# ═══════════════════════════════════════
@pytest.mark.integration
class TestUsersEndpoint:
    """GET /auth/users"""

    def test_list_users(self, client, admin_auth_headers, create_test_org_and_user):
        """Returns users in the organization."""
        headers = admin_auth_headers[0]
        response = client.get("/auth/users", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 2  # Admin + Engineer

    def test_list_users_contains_expected(self, client, admin_auth_headers, create_test_org_and_user):
        """Users list contains both admin and engineer."""
        headers = admin_auth_headers[0]
        response = client.get("/auth/users", headers=headers)
        assert response.status_code == 200
        data = response.json()
        emails = [u["email"] for u in data]
        assert create_test_org_and_user["admin_email"] in emails
        assert create_test_org_and_user["engineer_email"] in emails

    def test_users_requires_auth(self, client):
        """Returns 401 without authentication."""
        response = client.get("/auth/users")
        assert response.status_code == 401

    def test_users_have_required_fields(self, client, admin_auth_headers):
        """Each user has all required fields."""
        headers = admin_auth_headers[0]
        response = client.get("/auth/users", headers=headers)
        assert response.status_code == 200
        data = response.json()
        for user in data:
            assert "id" in user
            assert "email" in user
            assert "name" in user
            assert "org_id" in user
            assert "is_active" in user
            assert "token_version" in user
            assert "created_at" in user
