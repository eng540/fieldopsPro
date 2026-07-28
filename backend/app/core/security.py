"""Security Layer -- FieldOps V4.0

Constitutional Principles:
- JWT Minimalism: Identity only, NOT full authorization state.
- Server-side authorization prevents stale permissions.
- Device trust via cryptographic key pairs.
- Every token has unique ID (jti) for granular revocation.
"""
import hashlib
import bcrypt
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from jose import JWTError, jwt

from app.core.config import settings

def _prepare_secret(secret: str) -> bytes:
    """Prepare secret for bcrypt. If > 72 bytes, pre-hash with SHA-256."""
    b_secret = secret.encode("utf-8")
    if len(b_secret) > 72:
        # Bcrypt has a 72-byte limit. Pre-hashing prevents ValueError for long tokens.
        return hashlib.sha256(b_secret).hexdigest().encode("utf-8")
    return b_secret

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plain password against hash."""
    return bcrypt.checkpw(
        _prepare_secret(plain_password),
        hashed_password.encode("utf-8")
    )

def get_password_hash(password: str) -> str:
    """Hash a password."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(_prepare_secret(password), salt).decode("utf-8")

def _build_token_payload(
    subject: str | int,
    token_type: str,
    expires_delta: timedelta,
    **claims: Any,
) -> dict[str, Any]:
    """Build standard JWT payload with jti and timestamps."""
    now = datetime.now(timezone.utc)
    expire = now + expires_delta

    payload = {
        "sub": str(subject),
        "jti": str(uuid4()),  # Unique token ID for revocation
        "iat": now,
        "exp": expire,
        "type": token_type,
    }

    # Only allowlisted claims permitted
    allowed_claims = {"org_id", "session_id", "token_version", "device_id"}
    for key, value in claims.items():
        if key in allowed_claims:
            payload[key] = value
        else:
            raise ValueError(f"Claim '{key}' is not in allowlist. "
                           f"Allowed: {allowed_claims}")

    return payload

def create_access_token(
    subject: str | int,
    org_id: int,
    session_id: str,
    token_version: int = 1,
) -> tuple[str, str]:
    """Create short-lived JWT access token."""
    payload = _build_token_payload(
        subject=subject,
        token_type="access",
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        org_id=org_id,
        session_id=session_id,
        token_version=token_version,
    )

    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return token, payload["jti"]

def create_refresh_token(subject: str | int, session_id: str) -> tuple[str, str]:
    """Create long-lived refresh token."""
    payload = _build_token_payload(
        subject=subject,
        token_type="refresh",
        expires_delta=timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        session_id=session_id,
    )

    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return token, payload["jti"]

def decode_token(token: str) -> dict[str, Any] | None:
    """Decode and validate JWT. Returns None if invalid."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        return None

def get_token_jti(token: str) -> str | None:
    """Extract jti from token without full validation."""
    try:
        payload = jwt.get_unverified_claims(token)
        return payload.get("jti")
    except Exception:
        return None

def get_token_expiry(token: str) -> datetime | None:
    """Extract expiry timestamp from token."""
    try:
        payload = jwt.get_unverified_claims(token)
        exp = payload.get("exp")
        if exp:
            return datetime.fromtimestamp(exp, tz=timezone.utc)
        return None
    except Exception:
        return None