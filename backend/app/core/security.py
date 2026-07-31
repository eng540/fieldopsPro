"""Security Layer -- FieldOps V4.0

Constitutional Principles:
- JWT Minimalism: Identity only, NOT full authorization state.
- Server-side authorization prevents stale permissions.
- Device trust via cryptographic key pairs.
- Every token has unique ID (jti) for granular revocation.
"""
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import hashlib

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Bcrypt silently truncates inputs >72 bytes.
# Pre-hash with SHA-256 (hex = 64 chars, always < 72) before passing to bcrypt.
_BCRYPT_MAX_BYTES = 72


def _prehash(secret: str) -> str:
    """SHA-256 pre-hash — ensures input to bcrypt is always ≤72 bytes.

    Constitutional: Applied to ANY secret (passwords, refresh tokens, device keys).
    hex digest = 64 ASCII chars = 64 bytes — safely under the 72-byte bcrypt limit.
    """
    if len(secret.encode("utf-8")) <= _BCRYPT_MAX_BYTES:
        return secret
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plain password against hash (with bcrypt pre-hash guard)."""
    return pwd_context.verify(_prehash(plain_password), hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password (with bcrypt pre-hash guard)."""
    return pwd_context.hash(_prehash(password))


def hash_token(token: str) -> str:
    """Hash a refresh token for secure storage.
    
    Always uses pre-hash — refresh tokens are JWTs and always exceed 72 bytes.
    """
    return pwd_context.hash(_prehash(token))


def verify_token_hash(token: str, hashed: str) -> bool:
    """Verify a refresh token against its stored hash."""
    return pwd_context.verify(_prehash(token), hashed)


def _build_token_payload(
    subject: str | int,
    token_type: str,
    expires_delta: timedelta,
    **claims: Any,
) -> dict[str, Any]:
    """Build standard JWT payload with jti and timestamps.

    Constitutional: No role/permission claims allowed.
    Only identity, org reference, and session metadata.
    """
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
    """Create short-lived JWT access token.

    Returns:
        tuple: (token_string, jti)

    Constitutional: JWT carries identity + scope_reference only.
    Full authorization is server-side.
    """
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
    """Create long-lived refresh token.

    Returns:
        tuple: (token_string, jti)
    """
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
