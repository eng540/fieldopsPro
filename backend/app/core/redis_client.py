"""Redis Client — FieldOps V4.0 (Sprint-4 M3.1)

Provides a lazy async Redis connection via redis.asyncio.
Used for:
- Session cache (ADR-004): fast session validation without DB hit on every request
- Sync dedup window (ADR-002): operation_uuid registry for 72h retention

Constitutional:
- Sessions are ALWAYS written to PostgreSQL as source of truth
- Redis is a CACHE LAYER only — eviction/miss falls back to DB
- Redis errors are caught and logged — never block authentication
"""
from __future__ import annotations

import json
import logging
from datetime import timedelta

logger = logging.getLogger(__name__)

_redis_client = None


async def get_redis():
    """Return a shared async Redis client. Lazy-initialises on first call."""
    global _redis_client
    if _redis_client is not None:
        return _redis_client

    try:
        import redis.asyncio as aioredis
        from app.core.config import settings
        _redis_client = await aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        # Smoke test
        await _redis_client.ping()
        logger.info("Redis connection established: %s", settings.REDIS_URL)
    except Exception as exc:
        logger.warning("Redis unavailable (%s) — falling back to DB-only mode.", exc)
        _redis_client = None

    return _redis_client


# ─────────────────────────────────────────
# SESSION CACHE HELPERS
# ─────────────────────────────────────────

_SESSION_TTL_SECONDS = 7 * 24 * 3600   # 7 days (matches REFRESH_TOKEN_EXPIRE_DAYS)
_SESSION_KEY_PREFIX  = "session:"


def _session_key(session_id: str) -> str:
    return f"{_SESSION_KEY_PREFIX}{session_id}"


async def cache_session(session_id: str, session_data: dict, ttl: int = _SESSION_TTL_SECONDS) -> None:
    """Write session data to Redis cache.

    Falls back silently if Redis is unavailable.
    """
    r = await get_redis()
    if not r:
        return
    try:
        await r.setex(_session_key(session_id), ttl, json.dumps(session_data))
    except Exception as exc:
        logger.warning("Redis cache_session failed: %s", exc)


async def get_cached_session(session_id: str) -> dict | None:
    """Read session data from Redis cache.

    Returns None on miss or error (caller must fall back to DB).
    """
    r = await get_redis()
    if not r:
        return None
    try:
        raw = await r.get(_session_key(session_id))
        return json.loads(raw) if raw else None
    except Exception as exc:
        logger.warning("Redis get_cached_session failed: %s", exc)
        return None


async def invalidate_session_cache(session_id: str) -> None:
    """Remove session from Redis cache on logout/revoke."""
    r = await get_redis()
    if not r:
        return
    try:
        await r.delete(_session_key(session_id))
    except Exception as exc:
        logger.warning("Redis invalidate_session_cache failed: %s", exc)


async def invalidate_user_sessions(user_id: int) -> None:
    """Invalidate all cached sessions for a user (used by revoke_all_sessions).

    Scans keys matching session:* and removes those with matching user_id.
    In production: maintain a per-user set of session_ids for O(1) invalidation.
    """
    r = await get_redis()
    if not r:
        return
    try:
        # Scan for all session keys (acceptable for dev; use SET-of-keys pattern in prod)
        async for key in r.scan_iter(f"{_SESSION_KEY_PREFIX}*"):
            raw = await r.get(key)
            if raw:
                data = json.loads(raw)
                if data.get("user_id") == user_id:
                    await r.delete(key)
    except Exception as exc:
        logger.warning("Redis invalidate_user_sessions failed: %s", exc)


# ─────────────────────────────────────────
# SYNC DEDUP HELPERS (ADR-002)
# ─────────────────────────────────────────

_DEDUP_TTL  = 72 * 3600   # 72 hours per ADR-002
_DEDUP_PREFIX = "sync:uuid:"


async def mark_operation_processed(operation_uuid: str) -> None:
    """Register an operation_uuid as processed in Redis (Exactly-Once, 72h window)."""
    r = await get_redis()
    if not r:
        return
    try:
        await r.setex(f"{_DEDUP_PREFIX}{operation_uuid}", _DEDUP_TTL, "1")
    except Exception as exc:
        logger.warning("Redis mark_operation_processed failed: %s", exc)


async def is_operation_processed(operation_uuid: str) -> bool:
    """Check if operation_uuid is in the Redis dedup registry.

    Returns False on miss or error (caller falls back to DB check).
    """
    r = await get_redis()
    if not r:
        return False
    try:
        result = await r.exists(f"{_DEDUP_PREFIX}{operation_uuid}")
        return bool(result)
    except Exception as exc:
        logger.warning("Redis is_operation_processed failed: %s", exc)
        return False
