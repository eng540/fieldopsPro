"""Schema Validation Tests — FieldOps V4.0 Sprint-1 CP-2

Tests Pydantic schema validation rules for IAM module:
- LoginRequest: email, password, device_public_key
- LoginResponse: access_token, token_type, expires_in, session_id, user
- UserContext: id, email, role, org_id, projects, name
- UserCreate: email, password, name, org_id
- LogoutRequest: session_id, revoke_all
- RefreshRequest: refresh_token (optional)
- RoleResponse: from_attributes=True
- AuditLogResponse: from_attributes=True
- AuditLogFilterParams: defaults
- Enum values match OpenAPI contract
"""
from datetime import datetime
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from app.modules.iam.schemas import (
    AuditLogFilterParams,
    AuditLogListResponse,
    AuditLogResponse,
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    ProjectUserAssign,
    ProjectUserResponse,
    RefreshRequest,
    RefreshResponse,
    RoleResponse,
    UserContext,
    UserCreate,
    UserResponse,
)


class TestLoginRequestSchema:
    """Validate LoginRequest schema rules."""

    def test_valid_login_request_minimal(self):
        """Valid login with email and password only (device_public_key optional)."""
        req = LoginRequest(
            email="engineer@nrc.org",
            password="SecurePass123!",
        )
        assert req.email == "engineer@nrc.org"
        assert req.password == "SecurePass123!"
        assert req.device_public_key is None

    def test_valid_login_with_device_key(self):
        """Valid login with device public key."""
        req = LoginRequest(
            email="engineer@nrc.org",
            password="SecurePass123!",
            device_public_key="-----BEGIN PUBLIC KEY-----...",
        )
        assert req.device_public_key == "-----BEGIN PUBLIC KEY-----..."

    def test_missing_email_rejected(self):
        """Email is required."""
        with pytest.raises(ValidationError) as exc_info:
            LoginRequest(password="SecurePass123!")
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("email",) for e in errors)

    def test_missing_password_rejected(self):
        """Password is required."""
        with pytest.raises(ValidationError) as exc_info:
            LoginRequest(email="engineer@nrc.org")
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("password",) for e in errors)

    def test_invalid_email_rejected(self):
        """Invalid email format is rejected."""
        with pytest.raises(ValidationError) as exc_info:
            LoginRequest(
                email="not-an-email",
                password="SecurePass123!",
            )
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("email",) for e in errors)

    def test_short_password_rejected(self):
        """Password must be at least 8 characters."""
        with pytest.raises(ValidationError) as exc_info:
            LoginRequest(
                email="engineer@nrc.org",
                password="short",
            )
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("password",) for e in errors)

    def test_password_exactly_8_chars_accepted(self):
        """Password at exactly 8 chars should be valid."""
        req = LoginRequest(
            email="engineer@nrc.org",
            password="12345678",
        )
        assert req.password == "12345678"


class TestLoginResponseSchema:
    """Validate LoginResponse schema structure."""

    def test_valid_login_response(self):
        """All required fields present."""
        user_ctx = UserContext(
            id=15,
            email="engineer@nrc.org",
            role="FIELD_ENGINEER",
            org_id=7,
            projects=[12, 15],
            name="Ahmed Al-Mansouri",
        )
        resp = LoginResponse(
            access_token="eyJhbGciOiJIUzI1NiIs...",
            token_type="bearer",
            expires_in=900,
            session_id="550e8400-e29b-41d4-a716-446655440000",
            user=user_ctx,
            refresh_token="refresh-token-value",
        )
        assert resp.access_token == "eyJhbGciOiJIUzI1NiIs..."
        assert resp.token_type == "bearer"
        assert resp.expires_in == 900
        assert resp.session_id == "550e8400-e29b-41d4-a716-446655440000"
        assert resp.user.email == "engineer@nrc.org"
        assert resp.refresh_token == "refresh-token-value"

    def test_missing_access_token_rejected(self):
        """access_token is required."""
        user_ctx = UserContext(
            id=15,
            email="engineer@nrc.org",
            role="FIELD_ENGINEER",
            org_id=7,
            projects=[],
        )
        with pytest.raises(ValidationError):
            LoginResponse(
                expires_in=900,
                session_id="uuid",
                user=user_ctx,
            )


class TestUserContextSchema:
    """Validate UserContext schema structure."""

    def test_valid_user_context(self):
        """All fields populated."""
        ctx = UserContext(
            id=15,
            email="engineer@nrc.org",
            role="FIELD_ENGINEER",
            org_id=7,
            projects=[12, 15],
            name="Ahmed Al-Mansouri",
        )
        assert ctx.id == 15
        assert ctx.role == "FIELD_ENGINEER"
        assert ctx.org_id == 7
        assert ctx.projects == [12, 15]
        assert ctx.name == "Ahmed Al-Mansouri"

    def test_user_context_empty_projects(self):
        """Projects defaults to empty list."""
        ctx = UserContext(
            id=1,
            email="user@test.org",
            role="ORG_ADMIN",
            org_id=1,
            projects=[],
        )
        assert ctx.projects == []

    def test_user_context_name_optional(self):
        """Name is optional."""
        ctx = UserContext(
            id=1,
            email="user@test.org",
            role="FIELD_ENGINEER",
            org_id=1,
            projects=[],
        )
        assert ctx.name is None

    def test_user_context_role_matches_openapi_enum(self):
        """Role values should match OpenAPI enum."""
        for role in ["SUPER_ADMIN", "ORG_ADMIN", "PROJECT_MANAGER", "FIELD_ENGINEER"]:
            ctx = UserContext(
                id=1,
                email="user@test.org",
                role=role,
                org_id=1,
                projects=[],
            )
            assert ctx.role == role


class TestUserCreateSchema:
    """Validate UserCreate schema rules."""

    def test_valid_user_create(self):
        """All required fields present."""
        uc = UserCreate(
            email="newuser@nrc.org",
            password="SecurePass123!",
            name="Ahmed Al-Mansouri",
            org_id=7,
        )
        assert uc.email == "newuser@nrc.org"
        assert uc.password == "SecurePass123!"
        assert uc.name == "Ahmed Al-Mansouri"
        assert uc.org_id == 7

    def test_missing_email_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(
                password="SecurePass123!",
                name="Test User",
                org_id=1,
            )

    def test_missing_password_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="user@test.org",
                name="Test User",
                org_id=1,
            )

    def test_missing_name_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="user@test.org",
                password="SecurePass123!",
                org_id=1,
            )

    def test_missing_org_id_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="user@test.org",
                password="SecurePass123!",
                name="Test User",
            )

    def test_short_password_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="user@test.org",
                password="short",
                name="Test User",
                org_id=1,
            )

    def test_invalid_email_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="not-an-email",
                password="SecurePass123!",
                name="Test User",
                org_id=1,
            )

    def test_org_id_must_be_positive(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="user@test.org",
                password="SecurePass123!",
                name="Test User",
                org_id=0,
            )

    def test_org_id_negative_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="user@test.org",
                password="SecurePass123!",
                name="Test User",
                org_id=-1,
            )


class TestLogoutRequestSchema:
    """Validate LogoutRequest schema rules."""

    def test_valid_logout(self):
        """session_id required, revoke_all defaults to False."""
        req = LogoutRequest(session_id="550e8400-e29b-41d4-a716-446655440000")
        assert req.session_id == "550e8400-e29b-41d4-a716-446655440000"
        assert req.revoke_all is False

    def test_logout_with_revoke_all(self):
        req = LogoutRequest(
            session_id="550e8400-e29b-41d4-a716-446655440000",
            revoke_all=True,
        )
        assert req.revoke_all is True

    def test_logout_missing_session_id_rejected(self):
        with pytest.raises(ValidationError):
            LogoutRequest(revoke_all=True)


class TestRefreshRequestSchema:
    """Validate RefreshRequest schema."""

    def test_valid_refresh_with_token(self):
        req = RefreshRequest(refresh_token="some-refresh-token")
        assert req.refresh_token == "some-refresh-token"

    def test_refresh_without_token_is_valid(self):
        """refresh_token is optional (cookie fallback)."""
        req = RefreshRequest()
        assert req.refresh_token is None


class TestRoleResponseSchema:
    """Validate RoleResponse with from_attributes."""

    def test_from_attributes_config(self):
        assert RoleResponse.model_config.get("from_attributes") is True

    def test_role_response_from_mock(self):
        mock_role = MagicMock()
        mock_role.id = 1
        mock_role.name = "ORG_ADMIN"
        mock_role.description = "Organization Administrator"
        mock_role.org_id = 7
        mock_role.created_at = datetime(2024, 1, 1, 12, 0, 0)

        resp = RoleResponse.model_validate(mock_role)
        assert resp.id == 1
        assert resp.name == "ORG_ADMIN"
        assert resp.org_id == 7


class TestAuditLogResponseSchema:
    """Validate AuditLogResponse with from_attributes."""

    def test_from_attributes_config(self):
        assert AuditLogResponse.model_config.get("from_attributes") is True

    def test_audit_log_response_from_mock(self):
        mock_log = MagicMock()
        mock_log.id = 1
        mock_log.org_id = 7
        mock_log.user_id = 15
        mock_log.action = "LOGIN"
        mock_log.resource_type = "session"
        mock_log.resource_id = "session-uuid"
        mock_log.details = {"ip": "1.2.3.4"}
        mock_log.ip_address = "1.2.3.4"
        mock_log.created_at = datetime(2024, 1, 1, 12, 0, 0)

        resp = AuditLogResponse.model_validate(mock_log)
        assert resp.action == "LOGIN"
        assert resp.user_id == 15
        assert resp.details["ip"] == "1.2.3.4"


class TestUserResponseSchema:
    """Validate UserResponse with from_attributes."""

    def test_from_attributes_config(self):
        assert UserResponse.model_config.get("from_attributes") is True

    def test_user_response_from_mock(self):
        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.email = "user@test.org"
        mock_user.name = "Test User"
        mock_user.org_id = 7
        mock_user.is_active = True
        mock_user.device_public_key = None
        mock_user.token_version = 1
        mock_user.created_at = datetime(2024, 1, 1, 12, 0, 0)

        resp = UserResponse.model_validate(mock_user)
        assert resp.id == 1
        assert resp.email == "user@test.org"
        assert resp.is_active is True


class TestProjectUserResponseSchema:
    """Validate ProjectUserResponse with from_attributes."""

    def test_from_attributes_config(self):
        assert ProjectUserResponse.model_config.get("from_attributes") is True


class TestAuditLogFilterParams:
    """Validate AuditLogFilterParams defaults."""

    def test_default_values(self):
        params = AuditLogFilterParams()
        assert params.action is None
        assert params.user_id is None
        assert params.page == 1
        assert params.page_size == 50

    def test_custom_values(self):
        params = AuditLogFilterParams(
            action="LOGIN",
            user_id=15,
            page=2,
            page_size=100,
        )
        assert params.action == "LOGIN"
        assert params.user_id == 15
        assert params.page == 2
        assert params.page_size == 100

    def test_page_zero_rejected(self):
        with pytest.raises(ValidationError):
            AuditLogFilterParams(page=0)

    def test_page_size_over_200_rejected(self):
        with pytest.raises(ValidationError):
            AuditLogFilterParams(page_size=201)


class TestProjectUserAssignSchema:
    """Validate ProjectUserAssign schema."""

    def test_valid_assignment(self):
        assign = ProjectUserAssign(
            user_id=15,
            project_id=12,
            role_id=3,
        )
        assert assign.user_id == 15
        assert assign.project_id == 12
        assert assign.role_id == 3

    def test_missing_user_id_rejected(self):
        with pytest.raises(ValidationError):
            ProjectUserAssign(project_id=12, role_id=3)

    def test_user_id_must_be_positive(self):
        with pytest.raises(ValidationError):
            ProjectUserAssign(user_id=0, project_id=12, role_id=3)

    def test_project_id_must_be_positive(self):
        with pytest.raises(ValidationError):
            ProjectUserAssign(user_id=15, project_id=0, role_id=3)

    def test_role_id_must_be_positive(self):
        with pytest.raises(ValidationError):
            ProjectUserAssign(user_id=15, project_id=12, role_id=0)


class TestRefreshResponseSchema:
    """Validate RefreshResponse schema."""

    def test_valid_response(self):
        resp = RefreshResponse(
            access_token="new-access-token",
            expires_in=900,
        )
        assert resp.access_token == "new-access-token"
        assert resp.expires_in == 900

    def test_missing_access_token_rejected(self):
        with pytest.raises(ValidationError):
            RefreshResponse(expires_in=900)


class TestEnumValuesMatchOpenAPI:
    """Verify enum values match the OpenAPI contract."""

    def test_user_context_role_values(self):
        """UserContext.role should accept OpenAPI enum values."""
        expected_roles = ["SUPER_ADMIN", "ORG_ADMIN", "PROJECT_MANAGER", "FIELD_ENGINEER"]
        for role in expected_roles:
            ctx = UserContext(
                id=1,
                email="user@test.org",
                role=role,
                org_id=1,
                projects=[],
            )
            assert ctx.role == role
