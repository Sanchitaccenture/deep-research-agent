"""
Request/response logging middleware.

Every HTTP request emits a single JSONL line via `app.telemetry.emit` with
`{event: "http.request", method, path, status, duration_ms, client_ip}`.

Pairs with the LLM cost telemetry so a single `grep` over
`data/telemetry/YYYY-MM-DD.jsonl` reveals both API traffic and LLM usage
in the same timeline.
"""
from __future__ import annotations

import time

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app import telemetry


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.time()
        client_ip = _client_ip(request)
        method = request.method
        path = request.url.path

        try:
            response = await call_next(request)
        except Exception as exc:  # noqa: BLE001
            duration_ms = int((time.time() - start) * 1000)
            telemetry.emit(
                "http.error",
                level="error",
                method=method,
                path=path,
                status=500,
                duration_ms=duration_ms,
                client_ip=client_ip,
                error=str(exc)[:200],
            )
            raise

        duration_ms = int((time.time() - start) * 1000)
        # Streaming SSE endpoints do not report a stable body length —
        # log status only.
        telemetry.emit(
            "http.request",
            method=method,
            path=path,
            status=response.status_code,
            duration_ms=duration_ms,
            client_ip=client_ip,
        )
        response.headers["X-Response-Time-Ms"] = str(duration_ms)
        return response


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
