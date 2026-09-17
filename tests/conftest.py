"""
Shared fixtures. The whole suite runs offline — every LLM and every web-search
call is monkeypatched. Tests can override the fake responses per-case.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List

import pytest


# --------------------------------------------------------------------------
# Env: point every persistence dir at a per-test tmp so nothing leaks to disk
# --------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _isolated_data_dirs(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    monkeypatch.setenv("TAVILY_API_KEY", "test-tavily-key")
    monkeypatch.setenv("ENABLE_RAG", "false")
    # Tests explicitly opt in to crew mode when they want it via monkeypatch.
    monkeypatch.setenv("ENABLE_CREW", "false")
    # Also patch the crew module's _llm() to the fake so tests don't hit Groq.
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SESSIONS_DIR", str(tmp_path / "data" / "sessions"))
    monkeypatch.setenv("UPLOADS_DIR", str(tmp_path / "data" / "uploads"))
    monkeypatch.setenv("CHROMA_PERSIST_DIR", str(tmp_path / "data" / "chroma"))
    monkeypatch.setenv("MAX_ROUNDS", "1")  # deterministic short loops
    monkeypatch.setenv("MAX_SUBQUESTIONS", "2")
    monkeypatch.setenv("RESULTS_PER_SEARCH", "2")

    # Overwrite the config singleton's attributes with the freshly-set env
    # values. Because `Config`'s fields are class-level defaults evaluated
    # once at import, we set each attribute explicitly on the singleton.
    import os as _os
    from pathlib import Path as _Path
    from app.config import config as _config_singleton

    _config_singleton.GROQ_API_KEY = _os.getenv("GROQ_API_KEY", "")
    _config_singleton.TAVILY_API_KEY = _os.getenv("TAVILY_API_KEY", "")
    _config_singleton.ENABLE_RAG = _os.getenv("ENABLE_RAG", "true").lower() in ("1", "true", "yes", "on")
    _config_singleton.ENABLE_CREW = _os.getenv("ENABLE_CREW", "true").lower() in ("1", "true", "yes", "on")
    _config_singleton.DATA_DIR = _Path(_os.getenv("DATA_DIR", "./data"))
    _config_singleton.SESSIONS_DIR = _Path(_os.getenv("SESSIONS_DIR", "./data/sessions"))
    _config_singleton.UPLOADS_DIR = _Path(_os.getenv("UPLOADS_DIR", "./data/uploads"))
    _config_singleton.CHROMA_PERSIST_DIR = _Path(_os.getenv("CHROMA_PERSIST_DIR", "./data/chroma"))
    _config_singleton.MAX_ROUNDS = int(_os.getenv("MAX_ROUNDS", "3"))
    _config_singleton.MAX_SUBQUESTIONS = int(_os.getenv("MAX_SUBQUESTIONS", "4"))
    _config_singleton.RESULTS_PER_SEARCH = int(_os.getenv("RESULTS_PER_SEARCH", "4"))
    _config_singleton.ensure_dirs()

    # Clear the per-process research cache so results don't leak between tests.
    try:
        from app import cache as _research_cache
        _research_cache.clear()
    except Exception:
        pass
    yield


# --------------------------------------------------------------------------
# Fake ChatGroq: returns whatever the queue tells it to, records prompts
# --------------------------------------------------------------------------
class _FakeAIMessage:
    def __init__(self, content: str):
        self.content = content


class FakeChatGroq:
    """Test double. Consumes responses from `queue` (LIFO); optionally
    supports streaming by yielding character chunks of the queued response."""

    def __init__(self, queue: List[str], calls: List[Dict[str, Any]]):
        self._queue = queue
        self.calls = calls

    def _next(self) -> str:
        if not self._queue:
            return "[]"
        return self._queue.pop(0)

    def invoke(self, prompt: str, *args, **kwargs):
        response = self._next()
        self.calls.append({"kind": "invoke", "prompt": prompt, "response": response})
        return _FakeAIMessage(response)

    def stream(self, prompt: str, *args, **kwargs) -> Iterable[_FakeAIMessage]:
        response = self._next()
        self.calls.append({"kind": "stream", "prompt": prompt, "response": response})
        # Chunk into ~40-char pieces so downstream deltas look realistic.
        step = 40
        for i in range(0, len(response), step):
            yield _FakeAIMessage(response[i : i + step])


@pytest.fixture
def llm_queue() -> List[str]:
    """Queue of LLM responses. Push before the code under test invokes."""
    return []


@pytest.fixture
def llm_calls() -> List[Dict[str, Any]]:
    return []


@pytest.fixture
def fake_llm(monkeypatch, llm_queue, llm_calls):
    """Patch agent._llm to return a FakeChatGroq that pops from llm_queue."""
    from app import agent as agent_module

    def _factory(temperature: float = 0.2):  # noqa: ARG001
        return FakeChatGroq(llm_queue, llm_calls)

    monkeypatch.setattr(agent_module, "_llm", _factory)
    # Other modules have their own _llm() helpers — patch each one that exists.
    for name in ("chat", "crew"):
        try:
            mod = __import__(f"app.{name}", fromlist=[name])
            monkeypatch.setattr(mod, "_llm", _factory)
        except ImportError:
            pass
    return llm_queue


# --------------------------------------------------------------------------
# Fake Tavily
# --------------------------------------------------------------------------
class FakeTavily:
    def __init__(self, results_by_query: Dict[str, List[Dict[str, Any]]]):
        self._by_query = results_by_query
        self.searches: List[str] = []

    def search(self, query: str, **kwargs) -> Dict[str, Any]:
        self.searches.append(query)
        return {"results": self._by_query.get(query, self._by_query.get("*", []))}


@pytest.fixture
def fake_tavily(monkeypatch):
    """Patch every Tavily entry point so no test hits the real API."""
    from app import agent as agent_module

    holder: Dict[str, Any] = {"client": FakeTavily({"*": []})}

    def install(results_by_query: Dict[str, List[Dict[str, Any]]]):
        holder["client"] = FakeTavily(results_by_query)

    monkeypatch.setattr(agent_module, "_tavily", lambda: holder["client"])

    # Crew mode calls Tavily directly via `_tavily_search`. Reroute it.
    try:
        from app import crew as crew_module

        def _fake_search(query: str):
            resp = holder["client"].search(query=query)
            return [
                {
                    "title": r.get("title", "Untitled"),
                    "url": r.get("url", ""),
                    "content": (r.get("content", "") or "")[:1200],
                    "query": query,
                    "source_type": "web",
                }
                for r in resp.get("results", [])
            ]

        monkeypatch.setattr(crew_module, "_tavily_search", _fake_search)
    except ImportError:
        pass
    return install


# --------------------------------------------------------------------------
# Handy factories
# --------------------------------------------------------------------------
def make_tavily_result(
    title: str = "A source", url: str = "https://example.com/a", content: str = "snippet",
) -> Dict[str, Any]:
    return {"title": title, "url": url, "content": content}


@pytest.fixture
def tavily_result_factory():
    return make_tavily_result
