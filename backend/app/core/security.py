"""Security Layer -- FieldOps V4.0

Constitutional Principles:
- JWT Minimalism: Identity only, NOT full authorization state.
- Server-side authorization prevents stale permissions.
- Device trust via cryptographic key pairs.
- Every token has unique ID (jti) for granular revocation.

Implementation Note (bcrypt):
- Uses bcrypt directly (not passlib) for Python 3.12 + bcrypt 4.x compatibility.
- passlib 1.7 is unmaintained and incompatible with bcrypt 4.x (detect_wrap_bug crash).
- _prehash() ensures all inputs are ≤72 bytes (SHA-256 hex = 64 bytes always safe).
"""
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

# ─────────────────────────────────────────
# BCRYPT CONSTANTS
# ─────────────────────────────────────────
_BCRYPT_MAX_BYTES = 72
_BCRYPT_ROUNDS    = 12   # OWASP recommended minimum


# ─────────────────────────────────────────
# PRE-HASH (72-byte guard)
# ─────────────────────────────────────────
def _prehash(secret: str) -> bytes:
    """SHA-256 pre-hash → always ≤72 bytes before bcrypt.

    Returns bytes ready for bcrypt.hashpw() / bcrypt.checkpw().
    hex digest = 64 ASCII chars = 64 bytes — safely under the limit.
    """
    encoded = secret.encode("utf-8")
    if len(encoded) <= _BCRYPT_MAX_BYTES:
        return encoded
    return hashlib.sha256(encoded).hexdigest().encode("ascii")


# ─────────────────────────────────────────
# PASSWORD HASHING
# ─────────────────────────────────────────
def get_password_hash(password: str) -> str:
    """Hash a password with bcrypt. Returns a str for DB storage."""
    salt   = bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)
    hashed = bcrypt.hashpw(_prehash(password), salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plain password against bcrypt hash."""
    try:
        return bcrypt.checkpw(
            _prehash(plain_password),
            hashed_password.encode("utf-8"),
        )
    except Exception:
        return False


# ─────────────────────────────────────────
# TOKEN HASHING (Refresh tokens)
# ─────────────────────────────────────────
def hash_token(token: str) -> str:
    """Hash a refresh token for secure DB storage.

    Refresh tokens are JWTs (~300+ chars) → always pre-hashed.
    """
    salt   = bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)
    hashed = bcrypt.hashpw(_prehash(token), salt)
    return hashed.decode("utf-8")


def verify_token_hash(token: str, hashed: str) -> bool:
    """Verify a refresh token against its stored bcrypt hash."""
    try:
        return bcrypt.checkpw(
            _prehash(token),
            hashed.encode("utf-8"),
        )
    except Exception:
        return False


# ─────────────────────────────────────────
# JWT TOKEN CREATION
# ─────────────────────────────────────────
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
    now    = datetime.now(timezone.utc)
    expire = now + expires_delta

    payload: dict[str, Any] = {
        "sub":  str(subject),
        "jti":  str(uuid4()),   # Unique token ID for revocation
        "iat":  now,
        "exp":  expire,
        "type": token_type,
    }

    allowed_claims = {"org_id", "session_id", "token_version", "device_id"}
    for key, value in claims.items():
        if key in allowed_claims:
            payload[key] = value
        else:
            raise ValueError(
                f"Claim '{key}' is not in allowlist. Allowed: {allowed_claims}"
            )

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


def create_refresh_token(
    subject: str | int,
    session_id: str,
) -> tuple[str, str]:
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


# ─────────────────────────────────────────
# JWT TOKEN DECODING
# ─────────────────────────────────────────
def decode_token(token: str) -> dict[str, Any] | None:
    """Decode and validate JWT. Returns None if invalid."""
    try:
        return jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
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
