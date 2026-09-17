"""
Tiny in-process TTL cache for identical research questions.

If two requests ask the exact same question with the same template, the
second one gets the first one's result — saving 100% of Groq / Tavily
cost and returning near-instantly.

Design:
  - Key = (mode, template, normalised_question)
  - Value = the full session dict returned by run_research
  - TTL configurable via env (default 15 minutes)
  - Simple dict with lazy eviction; no LRU because volume is tiny
  - Thread-safe via a single lock

This is intentionally minimal. A production version would go through
Redis so multiple workers share the cache.
"""
from __future__ import annotations

import os
import re
import threading
import time
from typing import Any, Dict, Optional

from app import telemetry


_TTL_SECONDS = int(os.getenv("RESEARCH_CACHE_TTL_SECONDS", "900"))  # 15 min
_MAX_ENTRIES = int(os.getenv("RESEARCH_CACHE_MAX_ENTRIES", "128"))

_store: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()


def _key(question: str, template: str, mode: str) -> str:
    q = re.sub(r"\s+", " ", (question or "").strip().lower())
    return f"{mode}::{template}::{q}"


def get(question: str, template: str, mode: str) -> Optional[Dict[str, Any]]:
    k = _key(question, template, mode)
    with _lock:
        entry = _store.get(k)
        if not entry:
            return None
        if time.time() - entry["stored_at"] > _TTL_SECONDS:
            _store.pop(k, None)
            return None
        entry["hits"] += 1
    telemetry.emit("cache.hit", key=k[:80], hits=entry["hits"])
    return entry["value"]


def put(question: str, template: str, mode: str, value: Dict[str, Any]) -> None:
    if not value or not value.get("report"):
        return
    k = _key(question, template, mode)
    with _lock:
        _store[k] = {"value": value, "stored_at": time.time(), "hits": 0}
        # Cheap eviction: drop the oldest entries when we exceed the ceiling.
        if len(_store) > _MAX_ENTRIES:
            oldest = sorted(_store.items(), key=lambda kv: kv[1]["stored_at"])
            for old_k, _ in oldest[: len(_store) - _MAX_ENTRIES]:
                _store.pop(old_k, None)
    telemetry.emit("cache.put", key=k[:80], size=len(_store))


def stats() -> Dict[str, Any]:
    with _lock:
        return {
            "size": len(_store),
            "ttl_seconds": _TTL_SECONDS,
            "max_entries": _MAX_ENTRIES,
            "total_hits": sum(v["hits"] for v in _store.values()),
        }


def clear() -> None:
    with _lock:
        _store.clear()
