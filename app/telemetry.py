"""
Structured logging + LLM token/cost tracking.

Two components:

  1. `emit(event, **fields)` — writes a single JSON line to stderr and to
     `data/telemetry/<yyyy-mm-dd>.jsonl` with a stable schema:
       {ts, level, run_id, node, event, ...custom fields}

  2. `UsageCallback` — a LangChain callback handler that captures
     token counts + estimated USD cost for each LLM call, aggregated
     per `run_id`. Groq pricing is baked in (2026-09 rates); override
     with GROQ_PRICE_INPUT / GROQ_PRICE_OUTPUT env vars if needed.

Design notes:
  - No external observability deps (no LangSmith, no OpenTelemetry). Purely
    a stdlib JSON logger; a real deployment would ship these lines to Loki
    or a similar aggregator.
  - Cost tracking is *estimated*. Groq's API returns real token counts in
    the usage_metadata of AIMessages; we sum those. Prices are per 1M
    tokens and best-effort — they drift.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from langchain_core.callbacks import BaseCallbackHandler

from app.config import config


# --------------------------------------------------------------------------
# Groq pricing (per 1M tokens, USD, best-effort as of 2026-09)
# --------------------------------------------------------------------------
_DEFAULT_PRICES = {
    "groq/compound-mini":              {"input": 0.10, "output": 0.30},
    "groq/llama-3.3-70b-versatile":    {"input": 0.59, "output": 0.79},
    "groq/llama-3.1-8b-instant":       {"input": 0.05, "output": 0.08},
    "openai/gpt-oss-20b":              {"input": 0.15, "output": 0.60},
    "qwen/qwen3.6-27b":                {"input": 0.20, "output": 0.60},
    # Fallback if we see an unknown model
    "_default":                        {"input": 0.20, "output": 0.60},
}


def _price(model: str) -> Dict[str, float]:
    override_in = os.getenv("GROQ_PRICE_INPUT")
    override_out = os.getenv("GROQ_PRICE_OUTPUT")
    if override_in and override_out:
        return {"input": float(override_in), "output": float(override_out)}
    return _DEFAULT_PRICES.get(model) or _DEFAULT_PRICES["_default"]


# --------------------------------------------------------------------------
# Structured logger
# --------------------------------------------------------------------------
_current_run_id: ContextVar[Optional[str]] = ContextVar("current_run_id", default=None)
_current_node: ContextVar[Optional[str]] = ContextVar("current_node", default=None)

_log_lock = threading.Lock()


def _log_dir() -> Path:
    d = Path(config.DATA_DIR) / "telemetry"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _log_path() -> Path:
    return _log_dir() / f"{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.jsonl"


def emit(event: str, level: str = "info", **fields: Any) -> None:
    """Write a single structured log line. Safe to call from any node."""
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "event": event,
        "run_id": _current_run_id.get(),
        "node": _current_node.get(),
        **fields,
    }
    line = json.dumps(record, ensure_ascii=False, default=str)

    # stderr for local dev, file for retention
    with _log_lock:
        try:
            sys.stderr.write(line + "\n")
            sys.stderr.flush()
        except Exception:
            pass
        try:
            with _log_path().open("a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception:
            pass


def start_run(question: str, mode: str = "langgraph") -> str:
    """Register a new run. Returns the run_id, also sets the ContextVar so
    subsequent `emit()` and callback events attribute automatically."""
    run_id = uuid.uuid4().hex[:12]
    _current_run_id.set(run_id)
    _current_node.set(None)
    emit(
        "run.start",
        question=question[:200],
        mode=mode,
        max_rounds=config.MAX_ROUNDS,
        max_subquestions=config.MAX_SUBQUESTIONS,
    )
    return run_id


def set_node(node_name: Optional[str]) -> None:
    _current_node.set(node_name)


def end_run(status: str, **fields: Any) -> None:
    emit("run.end", status=status, **fields)
    _current_run_id.set(None)
    _current_node.set(None)


# --------------------------------------------------------------------------
# Per-run usage aggregator (thread-safe)
# --------------------------------------------------------------------------
class Usage:
    __slots__ = ("input_tokens", "output_tokens", "cost_usd", "calls")

    def __init__(self):
        self.input_tokens = 0
        self.output_tokens = 0
        self.cost_usd = 0.0
        self.calls = 0

    def add(self, input_t: int, output_t: int, cost: float) -> None:
        self.input_tokens += int(input_t or 0)
        self.output_tokens += int(output_t or 0)
        self.cost_usd += float(cost or 0)
        self.calls += 1

    def as_dict(self) -> Dict[str, Any]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.input_tokens + self.output_tokens,
            "cost_usd": round(self.cost_usd, 6),
            "llm_calls": self.calls,
        }


_run_usage: Dict[str, Usage] = {}
_usage_lock = threading.Lock()


def get_usage(run_id: Optional[str] = None) -> Usage:
    rid = run_id or _current_run_id.get() or "unattributed"
    with _usage_lock:
        u = _run_usage.get(rid)
        if u is None:
            u = Usage()
            _run_usage[rid] = u
        return u


def pop_usage(run_id: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve and clear a run's aggregate usage. Call after the run ends."""
    rid = run_id or _current_run_id.get() or "unattributed"
    with _usage_lock:
        u = _run_usage.pop(rid, Usage())
    return u.as_dict()


# --------------------------------------------------------------------------
# LangChain callback that pulls usage_metadata off every LLM response
# --------------------------------------------------------------------------
class UsageCallback(BaseCallbackHandler):
    """Attach to `ChatGroq(...).with_config({"callbacks": [UsageCallback()]})`
    or pass in the `.invoke(..., config={"callbacks": [...]})` call."""

    def on_llm_end(self, response, **kwargs) -> None:  # noqa: D401, ANN001
        try:
            model = ""
            input_t = 0
            output_t = 0

            # LangChain returns an LLMResult with generations[[{message: AIMessage}]]
            generations = getattr(response, "generations", []) or []
            for group in generations:
                for gen in group or []:
                    msg = getattr(gen, "message", None)
                    meta = getattr(msg, "usage_metadata", None) if msg else None
                    if meta:
                        input_t += int(meta.get("input_tokens") or 0)
                        output_t += int(meta.get("output_tokens") or 0)
                    md = getattr(msg, "response_metadata", None) if msg else None
                    if md and not model:
                        model = md.get("model_name") or md.get("model") or ""

            # Fall back to top-level llm_output.token_usage when usage_metadata is absent
            llm_output = getattr(response, "llm_output", None) or {}
            if input_t == 0 and output_t == 0:
                usage = llm_output.get("token_usage") or {}
                input_t = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
                output_t = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
            if not model:
                model = llm_output.get("model_name") or ""

            prices = _price(model)
            cost = (input_t * prices["input"] + output_t * prices["output"]) / 1_000_000
            get_usage().add(input_t, output_t, cost)

            emit(
                "llm.call",
                model=model,
                input_tokens=input_t,
                output_tokens=output_t,
                cost_usd=round(cost, 6),
            )
        except Exception as exc:  # noqa: BLE001
            emit("llm.usage_parse_failed", level="warning", error=str(exc))


# Singleton — cheap to reuse
_USAGE_CB = UsageCallback()


def callbacks() -> List[BaseCallbackHandler]:
    """Handy shorthand: `llm.invoke(prompt, config={"callbacks": telemetry.callbacks()})`."""
    return [_USAGE_CB]


# --------------------------------------------------------------------------
# Timer helper
# --------------------------------------------------------------------------
class timed:
    """`with timed("node.name"): ...` — logs duration on exit and sets node."""

    def __init__(self, node: str, **extra: Any):
        self.node = node
        self.extra = extra
        self._start = 0.0

    def __enter__(self):
        set_node(self.node)
        self._start = time.time()
        emit("node.start", **self.extra)
        return self

    def __exit__(self, exc_type, exc, tb):
        duration = round(time.time() - self._start, 3)
        if exc_type is None:
            emit("node.end", duration_seconds=duration, **self.extra)
        else:
            emit(
                "node.error",
                level="error",
                duration_seconds=duration,
                error=str(exc)[:200],
                error_type=exc_type.__name__ if exc_type else None,
                **self.extra,
            )
        set_node(None)
        return False  # don't swallow
