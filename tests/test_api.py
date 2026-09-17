"""
API tests using FastAPI's TestClient. LLM + Tavily are stubbed via conftest,
so these run entirely offline.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from app.api import app
    return TestClient(app)


class TestHealthAndStatus:
    def test_health(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert "status" in body
        assert "checks" in body
        # In tests we set fake keys so those two should pass; RAG is disabled.
        assert body["checks"]["groq_key"] == "ok"
        assert body["checks"]["tavily_key"] == "ok"

    def test_status_reports_feature_flags(self, client):
        r = client.get("/api/status")
        data = r.json()
        assert r.status_code == 200
        assert "features" in data
        # Set in conftest via env
        assert data["features"]["rag"] is False
        assert data["features"]["crew"] is False
        assert "templates" in data
        assert "default" in data["templates"]


class TestTemplates:
    def test_templates_exposes_the_five_shipped_templates(self, client):
        r = client.get("/api/templates")
        keys = {t["key"] for t in r.json()["templates"]}
        assert keys == {"default", "executive", "deep_dive", "pros_cons", "timeline"}


class TestResearchBlocking:
    def test_research_persists_and_returns_report(
        self, client, fake_llm, fake_tavily, tavily_result_factory
    ):
        # MAX_ROUNDS=1 in conftest causes assess to short-circuit without
        # an LLM call, so the queue only needs plan → synth → diagram →
        # followups → tags.
        fake_llm.extend([
            json.dumps(["what is X", "why X matters"]),
            "## Overview\nFacts [1].\n## Sources\n[1] Src — https://x",
            "mindmap\n  root((topic))\n    A\n    B",
            json.dumps(["Q1?", "Q2?", "Q3?"]),
            json.dumps(["ai", "research"]),
        ])
        fake_tavily({"*": [tavily_result_factory()]})

        r = client.post("/api/research", json={"question": "What is X?"})
        assert r.status_code == 200
        body = r.json()
        assert "Overview" in body["report"]
        assert body["sources"]
        assert body["session_id"]
        assert body["template"] == "default"
        # Metrics travelled through the pipeline
        assert body["metrics"]["source_count"] >= 1

    def test_research_rejects_invalid_template_by_falling_back(
        self, client, fake_llm, fake_tavily, tavily_result_factory
    ):
        fake_llm.extend([
            json.dumps(["q"]),
            "## Overview\nBody [1]",
            "mindmap\n  root((x))\n    a",
            json.dumps(["x?"]),
            json.dumps(["x"]),
        ])
        fake_tavily({"*": [tavily_result_factory()]})
        r = client.post(
            "/api/research", json={"question": "hi", "template": "not-a-real-template"}
        )
        assert r.status_code == 200
        assert r.json()["template"] == "default"


class TestSessionsCrud:
    def _seed(self, client, fake_llm, fake_tavily, tavily_result_factory, question="Q"):
        fake_llm.extend([
            json.dumps(["a"]),
            "## Overview\nB [1]",
            "mindmap\n  root((t))\n    a",
            json.dumps(["c?"]),
            json.dumps(["t"]),
        ])
        fake_tavily({"*": [tavily_result_factory()]})
        return client.post("/api/research", json={"question": question}).json()

    def test_list_after_create(self, client, fake_llm, fake_tavily, tavily_result_factory):
        self._seed(client, fake_llm, fake_tavily, tavily_result_factory)
        r = client.get("/api/sessions")
        assert r.status_code == 200
        assert len(r.json()["sessions"]) == 1

    def test_get_full_session(self, client, fake_llm, fake_tavily, tavily_result_factory):
        s = self._seed(client, fake_llm, fake_tavily, tavily_result_factory)
        r = client.get(f"/api/sessions/{s['session_id']}")
        assert r.status_code == 200
        body = r.json()
        assert body["question"] == "Q"
        assert body["report"]

    def test_get_missing_returns_404(self, client):
        assert client.get("/api/sessions/nope").status_code == 404

    def test_patch_updates_meta(self, client, fake_llm, fake_tavily, tavily_result_factory):
        s = self._seed(client, fake_llm, fake_tavily, tavily_result_factory)
        r = client.patch(
            f"/api/sessions/{s['session_id']}",
            json={"bookmarked": True, "notes": "hello"},
        )
        assert r.status_code == 200
        assert r.json()["bookmarked"] is True
        full = client.get(f"/api/sessions/{s['session_id']}").json()
        assert full["bookmarked"] is True
        assert full["notes"] == "hello"

    def test_delete_removes_the_session(self, client, fake_llm, fake_tavily, tavily_result_factory):
        s = self._seed(client, fake_llm, fake_tavily, tavily_result_factory)
        assert client.delete(f"/api/sessions/{s['session_id']}").status_code == 200
        assert client.get(f"/api/sessions/{s['session_id']}").status_code == 404


class TestSearchAndStats:
    def _seed_two(self, client, fake_llm, fake_tavily, tavily_result_factory):
        for q in ["agentic AI", "pizza toppings"]:
            fake_llm.extend([
                json.dumps(["x"]),
                "## Overview\nB [1]",
                "mindmap\n  root((t))\n    a",
                json.dumps(["c?"]),
                json.dumps(["t"]),
            ])
            fake_tavily({"*": [tavily_result_factory()]})
            client.post("/api/research", json={"question": q})

    def test_search_finds_agentic(
        self, client, fake_llm, fake_tavily, tavily_result_factory
    ):
        self._seed_two(client, fake_llm, fake_tavily, tavily_result_factory)
        r = client.get("/api/sessions/search", params={"q": "agentic"})
        found = [s["question"] for s in r.json()["sessions"]]
        assert "agentic AI" in found
        assert "pizza toppings" not in found

    def test_stats_aggregate(self, client, fake_llm, fake_tavily, tavily_result_factory):
        self._seed_two(client, fake_llm, fake_tavily, tavily_result_factory)
        stats = client.get("/api/sessions/stats").json()
        assert stats["total_sessions"] == 2
        assert stats["by_mode"] == {"langgraph": 2}


class TestChat:
    def _seed(self, client, fake_llm, fake_tavily, tavily_result_factory):
        fake_llm.extend([
            json.dumps(["x"]),
            "## Overview\nB [1]",
            "mindmap\n  root((t))\n    a",
            json.dumps(["c?"]),
            json.dumps(["t"]),
        ])
        fake_tavily({"*": [tavily_result_factory()]})
        return client.post("/api/research", json={"question": "Q"}).json()["session_id"]

    def test_chat_persists_turns(
        self, client, fake_llm, fake_tavily, tavily_result_factory
    ):
        sid = self._seed(client, fake_llm, fake_tavily, tavily_result_factory)
        fake_llm.append("The answer is 42 [1].")
        r = client.post(f"/api/sessions/{sid}/chat", json={"message": "what?"})
        assert r.status_code == 200
        body = r.json()
        assert "42" in body["answer"]
        # Both turns saved
        full = client.get(f"/api/sessions/{sid}").json()
        assert len(full["chat"]) == 2

    def test_chat_missing_session_is_404(self, client):
        r = client.post("/api/sessions/nope/chat", json={"message": "hi"})
        assert r.status_code == 404


class TestCrewGating:
    def test_crew_endpoint_disabled_returns_400(self, client):
        # Default in conftest is ENABLE_CREW=false
        r = client.post("/api/crew/research", json={"question": "x"})
        assert r.status_code == 400


class TestCrewMode:
    """Crew mode enabled via monkeypatch. Uses the native LangChain-based
    crew (no external `crewai` package)."""

    def _enable_crew(self, monkeypatch):
        from app.config import config
        monkeypatch.setattr(config, "ENABLE_CREW", True)

    def test_crew_research_runs_and_persists(
        self,
        client,
        monkeypatch,
        fake_llm,
        fake_tavily,
        tavily_result_factory,
    ):
        self._enable_crew(monkeypatch)
        # 5 agent calls: planner, web_researcher (comment), critic, writer
        # Doc analyst is skipped because ENABLE_RAG=false.
        fake_llm.extend([
            json.dumps(["sub 1", "sub 2"]),               # planner
            "Web researcher's short note.",               # web_researcher
            "- Coverage is decent.\n- Gap: nothing.",     # critic
            "## Overview\nBody [1].\n## Sources\n[1] Src — https://x",  # writer
        ])
        fake_tavily({"*": [tavily_result_factory(url="https://x")]})

        r = client.post("/api/crew/research", json={"question": "test crew"})
        assert r.status_code == 200
        body = r.json()
        assert body["mode"] == "crew"
        assert "Overview" in body["report"]
        assert len(body["sources"]) >= 1
        assert body["session_id"]

    def test_crew_gracefully_handles_agent_failure(
        self, client, monkeypatch, fake_llm, fake_tavily, tavily_result_factory
    ):
        """If an agent step raises, the endpoint returns a report explaining
        the failure rather than 500-ing."""
        self._enable_crew(monkeypatch)
        # Empty queue -> FakeChatGroq returns "[]" for planner, then nothing.
        # No exception is raised, but the pipeline still produces a report.
        fake_tavily({"*": [tavily_result_factory()]})
        r = client.post("/api/crew/research", json={"question": "test"})
        assert r.status_code == 200
        # Even with degraded LLM output, the crew produces *some* structured body
        assert isinstance(r.json()["report"], str)
