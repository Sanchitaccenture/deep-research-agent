"""
Tiny in-memory per-IP rate limiter.

Default: 30 requests per 60-second window per client IP. Configurable via
`RATE_LIMIT_PER_MINUTE` env var (set to 0 to disable — useful in tests).

Design:
  - Sliding window with a deque of timestamps per IP
  - Thread-safe
  - Only applies to /api/* routes; /health is always allowed

Not distributed. If you scale horizontally, switch to Redis.
"""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


_WINDOW_SECONDS = 60
_LIMIT = int(os.getenv("RATE_LIMIT_PER_MINUTE", "30"))
_ENABLED = _LIMIT > 0

_buckets: Dict[str, Deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def _client_key(request: Request) -> str:
    # Honour X-Forwarded-For when behind a proxy (Railway / Fly / Nginx),
    # otherwise fall back to the immediate client.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _allowed(key: str) -> tuple[bool, int]:
    now = time.time()
    cutoff = now - _WINDOW_SECONDS
    with _lock:
        q = _buckets[key]
        while q and q[0] < cutoff:
            q.popleft()
        if len(q) >= _LIMIT:
            retry_after = max(1, int(_WINDOW_SECONDS - (now - q[0])))
            return False, retry_after
        q.append(now)
        return True, 0


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not _ENABLED:
            return await call_next(request)
        path = request.url.path
        # Never limit health / status probes.
        if path.startswith("/health") or path == "/api/status":
            return await call_next(request)
        # Only apply to /api/* — static/docs/OpenAPI can be free.
        if not path.startswith("/api/"):
            return await call_next(request)

        allowed, retry_after = _allowed(_client_key(request))
        if not allowed:
            return JSONResponse(
                {
                    "error": "Too many requests.",
                    "detail": f"Please slow down; try again in {retry_after}s.",
                    "kind": "rate_limit",
                    "retry_after": retry_after,
                },
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )
        return await call_next(request)


def stats() -> dict:
    with _lock:
        return {
            "enabled": _ENABLED,
            "limit_per_minute": _LIMIT,
            "active_clients": len(_buckets),
        }
