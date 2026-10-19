"""
Per-run telemetry scoping, planner retry, URL dedupe / domain exclusion,
research.start logging and the synthesis prompt rules.
"""
from __future__ import annotations

import contextvars
import json
import threading
import time

import pytest


# ---------------------------------------------------------------- planner
class TestPlannerRetry:
    def test_retries_once_when_first_plan_is_invalid(self, fake_llm, llm_calls):
        from app.agent import _initial_state, plan_node

        fake_llm.extend(["not json", json.dumps(["a", "b"])])
        out = plan_node(_initial_state("What is X?", "default"))
        assert out["subquestions"] == ["a", "b"]
        assert len(llm_calls) == 2

    def test_retries_when_plan_has_fewer_than_two_subquestions(self, fake_llm, llm_calls):
        from app.agent import _initial_state, plan_node

        fake_llm.extend([json.dumps(["only one"]), json.dumps(["a", "b"])])
        out = plan_node(_initial_state("What is X?", "default"))
        assert out["subquestions"] == ["a", "b"]
        assert len(llm_calls) == 2

    def test_falls_back_to_the_question_after_one_retry(self, fake_llm, llm_calls):
        from app.agent import _initial_state, plan_node

        fake_llm.extend(["garbage", json.dumps(["still one"])])
        out = plan_node(_initial_state("What is X?", "default"))
        assert out["subquestions"] == ["What is X?"]
        assert len(llm_calls) == 2  # exactly one retry, not more

    def test_valid_plan_is_not_retried(self, fake_llm, llm_calls):
        from app.agent import _initial_state, plan_node

        fake_llm.append(json.dumps(["a", "b"]))
        plan_node(_initial_state("What is X?", "default"))
        assert len(llm_calls) == 1


# ------------------------------------------------- url dedupe + exclusions
class _RecordingTavily:
    def __init__(self, results):
        self.results = results
        self.calls = []

    def search(self, query, **kwargs):
        self.calls.append(kwargs)
        return {"results": self.results}


class TestSearchSources:
    def test_normalize_url(self):
        from app.agent import _normalize_url

        keys = {
            _normalize_url("https://www.Example.com/a/?utm_source=x#frag"),
            _normalize_url("http://example.com/a"),
            _normalize_url("https://EXAMPLE.com/a/"),
        }
        assert keys == {"example.com/a"}
        assert _normalize_url("https://example.com/b") != "example.com/a"
        assert _normalize_url("") == ""

    def test_duplicates_are_removed_before_numbering(self, monkeypatch):
        from app import agent as agent_module
        from app.agent import _initial_state, search_node

        rec = _RecordingTavily([
            {"title": "A", "url": "https://www.example.com/a/?utm=1#x", "content": "1"},
            {"title": "A again", "url": "http://example.com/a", "content": "2"},
            {"title": "B", "url": "https://example.com/b", "content": "3"},
        ])
        monkeypatch.setattr(agent_module, "_tavily", lambda: rec)
        state = {**_initial_state("Q", "default"), "pending_queries": ["q1", "q2"]}
        out = search_node(state)
        assert [s["id"] for s in out["sources"]] == [1, 2]
        assert [s["title"] for s in out["sources"]] == ["A", "B"]

    def test_exclude_domains_passed_to_tavily(self, monkeypatch):
        from app import agent as agent_module
        from app.agent import _initial_state, search_node
        from app.config import config

        rec = _RecordingTavily([])
        monkeypatch.setattr(agent_module, "_tavily", lambda: rec)
        state = {**_initial_state("Q", "default"), "pending_queries": ["q"]}

        monkeypatch.setattr(config, "EXCLUDE_DOMAINS", "youtube.com, youtu.be")
        search_node(state)
        assert rec.calls[-1]["exclude_domains"] == ["youtube.com", "youtu.be"]

        monkeypatch.setattr(config, "EXCLUDE_DOMAINS", "")
        search_node(state)
        assert "exclude_domains" not in rec.calls[-1]


# ----------------------------------------------------------- prompt rules
class TestSynthesisPromptRules:
    def _prompt(self):
        from app.agent import _build_synthesis_prompt, _initial_state

        state = {
            **_initial_state("Q", "default"),
            "sources": [{"id": 1, "title": "T", "url": "https://x.test", "content": "c"}],
        }
        return _build_synthesis_prompt(state)

    def test_currency_note_is_limited_to_fast_changing_topics(self):
        p = self._prompt()
        assert "ONLY for fast-changing" in p
        assert "law and regulation, prices, markets, news, elections" in p
        assert "Do NOT add it for stable explainers or general pros/cons" in p

    def test_sources_and_date_conflict_rules(self):
        p = self._prompt()
        assert "'[n] Title - URL'" in p
        assert "exactly the title and URL from the source block" in p
        assert "Never name a publisher or company unless it appears in the title" in p
        assert "prefer the newest source" in p
        assert "never present both as current" in p


# --------------------------------------------- per-run usage + research.start
class _Result:
    generations: list = []
    llm_output = {"token_usage": {"prompt_tokens": 10, "completion_tokens": 5}, "model_name": "m"}


class _Msg:
    def __init__(self, content):
        self.content = content
        self.response_metadata = {}


class _UsageReportingLLM:
    """Fake LLM that reports usage through the real telemetry callback, as ChatGroq does."""

    def _report(self):
        from app import telemetry

        time.sleep(0.005)  # encourage interleaving between concurrent runs
        telemetry.UsageCallback().on_llm_end(_Result())

    def _answer(self, prompt: str) -> str:
        if "research planner" in prompt:
            return json.dumps(["sub one", "sub two"])
        if "was cut off mid-way" in prompt:
            return " and the rest [1]."
        if "Using ONLY the numbered sources" in prompt:
            return "## Overview\nBody [1]"
        if "Mermaid mindmap" in prompt:
            return "mindmap\n  root((t))\n    a"
        if "follow-up" in prompt:
            return json.dumps(["a?", "b?", "c?"])
        return "[]"

    def invoke(self, prompt, *_, **__):
        self._report()
        return _Msg(self._answer(prompt))

    def stream(self, prompt, *_, **__):
        self._report()
        if "BBB" in prompt:  # this run's stream dies midway -> one extra call
            yield _Msg("## Overview\nBody")
            raise ConnectionError("dropped")
        yield _Msg(self._answer(prompt))


@pytest.fixture
def usage_llm(monkeypatch):
    from app import agent as agent_module

    monkeypatch.setattr(agent_module, "_llm", lambda temperature=0.2: _UsageReportingLLM())


def _consume_like_a_threadpool(question, out):
    """Resume the generator in a fresh context each step, as the server does."""
    from app.agent import stream_research

    gen = stream_research(question, "default")
    base = contextvars.copy_context()
    metrics = {}
    while True:
        try:
            update = base.copy().run(next, gen)
        except StopIteration:
            break
        if update.get("metrics"):
            metrics = update["metrics"]
    out[question] = metrics


class TestPerRunScoping:
    def test_concurrent_runs_report_only_their_own_calls(
        self, usage_llm, fake_tavily, tavily_result_factory
    ):
        fake_tavily({"*": [tavily_result_factory()]})
        out: dict = {}
        threads = [
            threading.Thread(target=_consume_like_a_threadpool, args=(q, out))
            for q in ("AAA question", "BBB question")
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)

        # A: plan + synth + diagram + followups + tags = 5 calls.
        # B: the same plus one continuation call after its stream died = 6.
        assert out["AAA question"]["llm_calls"] == 5
        assert out["BBB question"]["llm_calls"] == 6
        assert out["AAA question"]["input_tokens"] == 50
        assert out["BBB question"]["input_tokens"] == 60

    def test_usage_without_a_run_is_not_shared(self):
        from app import telemetry

        telemetry.get_usage().add(100, 100, 1.0)
        assert telemetry.get_usage().calls == 0
        assert telemetry.pop_usage()["llm_calls"] == 0

    def test_research_start_event_is_emitted_once_per_stream(
        self, monkeypatch, usage_llm, fake_tavily, tavily_result_factory
    ):
        from app import telemetry
        from app.agent import stream_research

        fake_tavily({"*": [tavily_result_factory()]})
        seen: list = []
        real_emit = telemetry.emit

        def _emit(event, **kw):
            seen.append((event, kw))
            return real_emit(event, **kw)

        monkeypatch.setattr(telemetry, "emit", _emit)
        list(stream_research("What is RAG?", "executive"))
        starts = [kw for e, kw in seen if e == "research.start"]
        assert len(starts) == 1
        assert starts[0]["template"] == "executive"
        assert starts[0]["question_length"] == len("What is RAG?")
        assert starts[0]["run_id"]
