"""
Truncated-report recovery and the synthesis context budget. The LLM is a
scripted fake: each call (invoke or stream) consumes the next script item.
"""
from __future__ import annotations

import json
from datetime import date

import pytest

PARTIAL = "## Overview\nRAG combines retrieval and generation, and"
CONTINUATION = " it grounds answers [1].\n\n## Sources\n[1] Src - https://x"
CUT_OFF_NOTE = "_The report was cut off. Re-run, or ask in Chat._"


class _Msg:
    def __init__(self, content: str, meta: dict | None = None):
        self.content = content
        self.response_metadata = meta or {}


class Cut:
    """Stream item: yield `text`, then die with `exc` (as a dropped connection would)."""

    def __init__(self, text: str, exc: Exception):
        self.text = text
        self.exc = exc


class Length:
    """Stream/invoke item: text that ends with finish_reason == 'length'."""

    def __init__(self, text: str):
        self.text = text


class Scripted:
    def __init__(self, script, prompts):
        self._script = script
        self.prompts = prompts

    def _next(self, prompt):
        self.prompts.append(prompt)
        return self._script.pop(0) if self._script else "[]"

    def invoke(self, prompt, *_, **__):
        item = self._next(prompt)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, Length):
            return _Msg(item.text, {"finish_reason": "length", "model_name": "m"})
        return _Msg(item)

    def stream(self, prompt, *_, **__):
        item = self._next(prompt)
        if isinstance(item, Cut):
            yield _Msg(item.text)
            raise item.exc
        if isinstance(item, Exception):
            raise item
        if isinstance(item, Length):
            yield _Msg(item.text, {"finish_reason": "length", "model_name": "m"})
            return
        yield _Msg(item)


class _Script(list):
    prompts: list


@pytest.fixture
def script(monkeypatch):
    from app import agent as agent_module

    items = _Script()
    prompts: list = []
    monkeypatch.setattr(
        agent_module, "_llm", lambda temperature=0.2: Scripted(items, prompts)
    )
    items.prompts = prompts
    return items


@pytest.fixture
def events(monkeypatch):
    from app import agent as agent_module

    recorded: list = []
    real_emit = agent_module.telemetry.emit

    def _emit(event, **kw):
        recorded.append((event, kw))
        return real_emit(event, **kw)

    monkeypatch.setattr(agent_module.telemetry, "emit", _emit)
    return recorded


def _run(script, fake_tavily, tavily_result_factory, synth_items):
    fake_tavily({"*": [tavily_result_factory(content=f"Updated {date.today().year} guidance")]})
    script.extend(
        [json.dumps(["x", "y"]), *synth_items, "mindmap\n  root((t))", json.dumps(["c?"]), json.dumps(["t"])]
    )
    from app.agent import stream_research

    updates = list(stream_research("What is RAG?"))
    deltas = "".join(u["report_delta"] for u in updates if "report_delta" in u)
    final = [u["report"] for u in updates if "report" in u][-1]
    steps = [s for u in updates for s in u.get("steps", [])]
    return deltas, final, steps


class TestMidflightRecovery:
    def test_stream_dies_midway_and_is_continued(
        self, script, events, fake_tavily, tavily_result_factory
    ):
        deltas, final, steps = _run(
            script, fake_tavily, tavily_result_factory,
            [Cut(PARTIAL, ConnectionError("stream closed")), CONTINUATION],
        )
        assert final == (PARTIAL + CONTINUATION).strip()
        assert deltas == PARTIAL + CONTINUATION
        assert CUT_OFF_NOTE not in final
        assert any("continued" in s for s in steps)
        # The continuation prompt carries the question, sources and partial text.
        cont_prompt = script.prompts[2]
        assert "What is RAG?" in cont_prompt and PARTIAL in cont_prompt
        assert "[1]" in cont_prompt

    def test_failed_continuation_appends_visible_note(
        self, script, events, fake_tavily, tavily_result_factory
    ):
        deltas, final, _ = _run(
            script, fake_tavily, tavily_result_factory,
            [Cut(PARTIAL, ConnectionError("stream closed")), RuntimeError("still down")],
        )
        assert final.startswith(PARTIAL)
        assert final.endswith(CUT_OFF_NOTE)
        assert CUT_OFF_NOTE in deltas
        assert any(e == "llm.continuation_failed" for e, _ in events)

    def test_finish_reason_length_is_continued(
        self, script, events, fake_tavily, tavily_result_factory
    ):
        _, final, _ = _run(
            script, fake_tavily, tavily_result_factory,
            [Length(PARTIAL), CONTINUATION],
        )
        assert final == (PARTIAL + CONTINUATION).strip()
        ev = [kw for e, kw in events if e == "llm.stream_midflight_error"]
        assert ev and ev[0]["error"] == "finish_reason=length"

    def test_blocking_synthesis_continues_on_length(self, script, events):
        from app.agent import _initial_state, synthesize_node

        state = {
            **_initial_state("Q", "default"),
            "sources": [{"id": 1, "title": "S", "url": "https://x", "content": f"body {date.today().year}"}],
            "round": 1,
        }
        script.extend([Length(PARTIAL), CONTINUATION])
        out = synthesize_node(state)
        assert out["report"] == PARTIAL + CONTINUATION

    def test_stream_fallback_does_not_restart_after_first_chunk(
        self, monkeypatch, events
    ):
        from app import agent as agent_module

        made: list = []

        class Dying:
            def stream(self, prompt):
                yield _Msg("partial ")
                raise ConnectionError("dropped")

        def _make(model, temperature):
            made.append(model)
            return Dying()

        monkeypatch.setattr(agent_module, "_make_client", _make)
        got = []
        with pytest.raises(ConnectionError):
            for chunk in agent_module._stream_with_fallback("p"):
                got.append(chunk.content)
        assert got == ["partial "]
        assert len(made) == 1  # no restart on the next model (would duplicate text)
        ev = [kw for e, kw in events if e == "llm.stream_midflight_error"]
        assert ev and ev[0]["model"] == made[0] and "dropped" in ev[0]["error"]


class TestSourcesBudget:
    def _sources(self, n, size=1200):
        return [
            {"id": i, "title": f"T{i}", "url": f"https://s{i}.test", "content": "x" * size}
            for i in range(1, n + 1)
        ]

    def test_block_respects_budget_and_keeps_numbering(self):
        from app.agent import _format_sources_block

        block = _format_sources_block(self._sources(10), 4000)
        assert len(block) <= 4000
        for i in range(1, 11):
            assert f"[{i}] (web) T{i}" in block

    def test_content_split_evenly(self):
        from app.agent import _format_sources_block

        block = _format_sources_block(self._sources(4), 3000)
        counts = [part.count("x") for part in block.split("\n\n")]
        assert len(set(counts)) == 1

    def test_small_set_keeps_the_1200_char_cap(self):
        from app.agent import _format_sources_block

        block = _format_sources_block(self._sources(2, size=5000), 12000)
        assert block.count("x") == 2 * 1200

    def test_synthesis_prompt_uses_configured_budget(self, monkeypatch):
        from app.agent import _build_synthesis_prompt, _initial_state
        from app.config import config

        state = {**_initial_state("Q", "default"), "sources": self._sources(12)}
        monkeypatch.setattr(config, "SYNTH_CONTEXT_CHARS", 3000)
        small = _build_synthesis_prompt(state)
        monkeypatch.setattr(config, "SYNTH_CONTEXT_CHARS", 12000)
        large = _build_synthesis_prompt(state)
        assert small.count("x") < large.count("x") <= 12000
        assert "[12] (web) T12" in small
