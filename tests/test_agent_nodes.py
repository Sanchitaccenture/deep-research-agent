"""
Node-level tests for the LangGraph pipeline. Every LLM and every Tavily call
is stubbed, so these are fast and deterministic.
"""
from __future__ import annotations

import json

import pytest


@pytest.fixture
def base_state():
    from app.agent import _initial_state, DEFAULT_TEMPLATE
    return _initial_state("What is retrieval augmented generation?", DEFAULT_TEMPLATE)


class TestPlanNode:
    def test_plan_produces_up_to_max_subquestions(self, fake_llm, base_state):
        from app.agent import plan_node
        fake_llm.append(json.dumps(["what is RAG", "why does RAG matter", "when to use RAG"]))
        result = plan_node(base_state)
        # config caps at MAX_SUBQUESTIONS=2 (see conftest)
        assert len(result["subquestions"]) == 2
        assert result["pending_queries"] == result["subquestions"]
        assert result["round"] == 0

    def test_plan_recovers_when_llm_returns_garbage(self, fake_llm, base_state):
        from app.agent import plan_node
        fake_llm.append("not json at all — the model went off the rails")
        result = plan_node(base_state)
        # Fallback: use the original question if we can't parse anything
        assert len(result["subquestions"]) >= 1

    def test_plan_writes_step_breadcrumbs(self, fake_llm, base_state):
        from app.agent import plan_node
        fake_llm.append(json.dumps(["q1", "q2"]))
        result = plan_node(base_state)
        assert any("Planned" in s for s in result["steps"])


class TestSearchNode:
    def test_search_merges_tavily_results_and_dedupes_urls(
        self, fake_tavily, base_state, tavily_result_factory
    ):
        from app.agent import search_node
        state = {**base_state, "pending_queries": ["q1", "q2"]}
        fake_tavily({
            "q1": [tavily_result_factory(url="https://a.com"), tavily_result_factory(url="https://b.com")],
            "q2": [tavily_result_factory(url="https://a.com"), tavily_result_factory(url="https://c.com")],
        })
        result = search_node(state)
        urls = [s["url"] for s in result["sources"]]
        # a.com must appear only once (dedup by URL)
        assert urls.count("https://a.com") == 1
        assert set(urls) == {"https://a.com", "https://b.com", "https://c.com"}

    def test_search_increments_round_and_clears_pending(
        self, fake_tavily, base_state, tavily_result_factory
    ):
        from app.agent import search_node
        state = {**base_state, "pending_queries": ["q1"]}
        fake_tavily({"q1": [tavily_result_factory()]})
        result = search_node(state)
        assert result["round"] == 1
        assert result["pending_queries"] == []

    def test_search_survives_tavily_exception(self, monkeypatch, base_state):
        from app.agent import search_node
        from app import agent as agent_module

        class Boom:
            def search(self, *_, **__):
                raise RuntimeError("tavily is down")

        monkeypatch.setattr(agent_module, "_tavily", lambda: Boom())
        state = {**base_state, "pending_queries": ["q1"]}
        result = search_node(state)
        # The whole run should NOT crash — search failure is graceful
        assert result["sources"] == []
        assert any("failed" in s for s in result["steps"])


class TestAssessNode:
    def _state(self, base_state, **kw):
        return {
            **base_state,
            "sources": [{"id": 1, "title": "T", "url": "https://x.com", "content": "c", "query": "q"}],
            **kw,
        }

    def test_assess_routes_to_synth_when_sufficient(self, fake_llm, base_state):
        from app.agent import assess_node, route_after_assess_full
        state = self._state(base_state, round=1)
        fake_llm.append(json.dumps({"sufficient": True, "gaps": "", "followups": []}))
        result = assess_node(state)
        assert result["pending_queries"] == []
        assert route_after_assess_full({**state, **result}) == "synthesize"

    def test_assess_queues_followups_when_gaps_exist(self, fake_llm, base_state):
        from app.agent import assess_node, route_after_assess_full
        state = self._state(base_state, round=0)
        fake_llm.append(json.dumps({
            "sufficient": False,
            "gaps": "missing market share numbers",
            "followups": ["market share 2026", "vendor comparison"],
        }))
        result = assess_node(state)
        assert result["pending_queries"] == ["market share 2026", "vendor comparison"]
        assert route_after_assess_full({**state, **result}) == "search"

    def test_assess_forces_synthesis_when_round_budget_hit(self, base_state):
        # MAX_ROUNDS=1 in conftest; round already 1 -> stop immediately.
        from app.agent import assess_node
        state = self._state(base_state, round=1)
        # No LLM call needed — budget-check short-circuits.
        result = assess_node(state)
        assert result["pending_queries"] == []


class TestSynthesizeNode:
    def test_synthesize_returns_no_sources_message_when_empty(self, base_state):
        from app.agent import synthesize_node
        state = {**base_state, "sources": []}
        result = synthesize_node(state)
        assert "No sources found" in result["report"]

    def test_synthesize_uses_llm_to_build_report(self, fake_llm, base_state):
        from app.agent import synthesize_node
        state = {
            **base_state,
            "sources": [{
                "id": 1, "title": "Src", "url": "https://x", "content": "body", "query": "q",
            }],
            "round": 1,
        }
        fake_llm.append("## Overview\nFacts [1].\n## Sources\n[1] Src — https://x")
        result = synthesize_node(state)
        assert "Overview" in result["report"]
        assert "[1]" in result["report"]


class TestEnrichNode:
    def test_enrich_produces_metrics_diagram_followups_tags(self, fake_llm, base_state):
        from app.agent import enrich_node
        state = {
            **base_state,
            "sources": [{"id": 1, "title": "S", "url": "https://x", "content": "c", "query": "q"}],
            "report": "## Overview\n\nFacts [1].",
            "round": 1,
        }
        fake_llm.append("mindmap\n  root((AI))\n    Node1\n    Node2")
        fake_llm.append(json.dumps(["follow-up 1?", "follow-up 2?", "follow-up 3?"]))
        fake_llm.append(json.dumps(["ai", "rag", "research"]))

        result = enrich_node(state)
        assert result["diagram"].startswith("mindmap")
        assert len(result["followups"]) >= 1
        assert result["suggested_tags"] == ["ai", "rag", "research"]
        m = result["metrics"]
        assert m["source_count"] == 1
        assert m["report_chars"] > 0
        assert m["reading_time_seconds"] >= 0
        assert m["token_estimate"] > 0

    def test_enrich_skipped_without_report(self, base_state):
        from app.agent import enrich_node
        state = {**base_state, "sources": [], "report": ""}
        result = enrich_node(state)
        assert result["diagram"] == ""
        assert result["followups"] == []
        assert result["metrics"]["source_count"] == 0

    def test_tag_cleaning_normalises_whitespace_and_hashes(self, fake_llm, base_state):
        from app.agent import _generate_tags
        fake_llm.append(json.dumps(["  #Some Tag ", "Great-Topic", "ok"]))
        tags = _generate_tags("q", "report body")
        assert "some-tag" in tags
        assert "great-topic" in tags


class TestParseHelpers:
    def test_parse_json_list_strips_markdown_fences(self):
        from app.agent import _parse_json_list
        raw = "```json\n[\"a\", \"b\"]\n```"
        assert _parse_json_list(raw) == ["a", "b"]

    def test_parse_json_obj_falls_back_to_safe_default(self):
        from app.agent import _parse_json_obj
        d = _parse_json_obj("this is definitely not json")
        # The fallback pretends coverage is sufficient so the graph can terminate.
        assert d["sufficient"] is True
