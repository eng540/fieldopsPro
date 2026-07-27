"""Security Unit Tests -- FieldOps V4.0

Tests JWT creation, validation, password hashing.
No database required.
"""
import pytest
from jose import jwt

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
    get_token_jti,
)
from app.core.config import settings


class TestPasswordHashing:
    def test_hash_and_verify(self):
        password = "SecurePass123!"
        hashed = get_password_hash(password)
        assert verify_password(password, hashed) is True
        assert verify_password("WrongPass", hashed) is False

    def test_hash_is_different_each_time(self):
        password = "SamePassword"
        hash1 = get_password_hash(password)
        hash2 = get_password_hash(password)
        assert hash1 != hash2  # bcrypt salt ensures uniqueness


class TestJWTMinimalism:
    def test_access_token_contains_identity_only(self):
        token, jti = create_access_token(
            subject=15,
            org_id=7,
            session_id="test-session",
        )
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])

        assert payload["sub"] == "15"
        assert payload["org_id"] == 7
        assert payload["type"] == "access"
        assert "jti" in payload
        assert payload["jti"] == jti
        assert "role" not in payload  # Constitutional: no roles in JWT
        assert "projects" not in payload  # Constitutional: no scopes in JWT

    def test_access_token_rejects_arbitrary_claims(self):
        with pytest.raises(ValueError, match="not in allowlist"):
            # This should fail because "role" is not in allowlist
            from app.core.security import _build_token_payload
            _build_token_payload(
                subject=1,
                token_type="access",
                expires_delta=__import__("datetime").timedelta(minutes=15),
                role="admin",  # Not in allowlist
            )

    def test_access_token_has_expiry(self):
        token, jti = create_access_token(
            subject=1,
            org_id=1,
            session_id="test",
        )
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])

        assert "exp" in payload
        assert "iat" in payload
        # Expiry should be ~15 minutes from now
        assert payload["exp"] - payload["iat"] == 15 * 60

    def test_refresh_token_contains_session(self):
        token, jti = create_refresh_token(subject=1, session_id="test-session-uuid")
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])

        assert payload["type"] == "refresh"
        assert payload["session_id"] == "test-session-uuid"
        assert payload["sub"] == "1"
        assert "jti" in payload

    def test_decode_invalid_token_returns_none(self):
        assert decode_token("invalid.token.here") is None

    def test_decode_expired_token_returns_none(self):
        from datetime import datetime, timezone

        # Create token that expired 1 second ago
        now = datetime.now(timezone.utc)
        expired_token = jwt.encode(
            {"sub": "1", "exp": now.timestamp() - 1, "iat": now.timestamp() - 2},
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM,
        )
        assert decode_token(expired_token) is None

    def test_get_token_jti_extracts_jti(self):
        token, expected_jti = create_access_token(
            subject=1,
            org_id=1,
            session_id="test",
        )
        extracted_jti = get_token_jti(token)
        assert extracted_jti == expected_jti
