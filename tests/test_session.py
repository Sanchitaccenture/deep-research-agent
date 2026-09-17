"""Session store CRUD + search + related + stats."""
from __future__ import annotations

import time

import pytest


@pytest.fixture
def store():
    from app import session as s
    return s


def _save(store, question: str = "What is X?", **kw):
    return store.save_session(
        question=question,
        report=kw.get("report", "## Overview\nBody [1].\n## Sources\n[1] Title — https://x.com"),
        sources=kw.get("sources", [{"id": 1, "title": "T", "url": "https://x.com", "content": "c"}]),
        steps=kw.get("steps", ["step-one"]),
        mode=kw.get("mode", "langgraph"),
        template=kw.get("template", "default"),
    )


class TestCrud:
    def test_save_creates_session_with_defaults(self, store):
        s = _save(store)
        assert s["id"]
        assert s["question"] == "What is X?"
        assert s["bookmarked"] is False
        assert s["tags"] == []
        assert s["notes"] == ""
        assert s["chat"] == []

    def test_list_returns_summary_shape(self, store):
        _save(store, question="q-a")
        _save(store, question="q-b")
        listed = store.list_sessions()
        assert len(listed) == 2
        assert set(listed[0].keys()) >= {
            "id", "question", "mode", "template", "created_at",
            "source_count", "chat_count", "bookmarked", "tags", "has_notes",
        }
        # report/sources are NOT in the summary — that would be wasteful
        assert "report" not in listed[0]
        assert "sources" not in listed[0]

    def test_get_missing_returns_none(self, store):
        assert store.get_session("does-not-exist") is None

    def test_delete_missing_returns_false(self, store):
        assert store.delete_session("does-not-exist") is False

    def test_delete_removes_the_file(self, store):
        s = _save(store)
        assert store.delete_session(s["id"]) is True
        assert store.get_session(s["id"]) is None


class TestMetaUpdates:
    def test_update_meta_persists_bookmark_tags_notes(self, store):
        s = _save(store)
        summary = store.update_meta(
            s["id"], bookmarked=True, tags=["ai", "rag"], notes="hello"
        )
        assert summary["bookmarked"] is True
        assert summary["tags"] == ["ai", "rag"]
        assert summary["has_notes"] is True

        # Re-read from disk to be sure it persisted.
        full = store.get_session(s["id"])
        assert full["bookmarked"] is True
        assert full["tags"] == ["ai", "rag"]
        assert full["notes"] == "hello"

    def test_update_meta_returns_none_for_missing(self, store):
        assert store.update_meta("nope", bookmarked=True) is None

    def test_update_meta_leaves_untouched_fields_alone(self, store):
        s = _save(store)
        store.update_meta(s["id"], tags=["one"])
        store.update_meta(s["id"], notes="hi")  # should NOT clear tags
        full = store.get_session(s["id"])
        assert full["tags"] == ["one"]
        assert full["notes"] == "hi"

    def test_tag_slots_are_capped(self, store):
        s = _save(store)
        many = [f"t{i}" for i in range(50)]
        summary = store.update_meta(s["id"], tags=many)
        assert len(summary["tags"]) == 20  # ceiling

    def test_empty_tag_strings_are_dropped(self, store):
        s = _save(store)
        summary = store.update_meta(s["id"], tags=["good", "", "  ", "also-good"])
        assert summary["tags"] == ["good", "also-good"]


class TestChatThread:
    def test_append_chat_extends(self, store):
        s = _save(store)
        assert store.append_chat(s["id"], [{"id": "1", "role": "user", "content": "hi"}]) is True
        full = store.get_session(s["id"])
        assert len(full["chat"]) == 1

    def test_append_chat_missing_returns_false(self, store):
        assert store.append_chat("nope", [{"id": "1"}]) is False

    def test_clear_chat_empties_thread(self, store):
        s = _save(store)
        store.append_chat(s["id"], [{"id": "1", "role": "user", "content": "hi"}])
        assert store.clear_chat(s["id"]) is True
        assert store.get_session(s["id"])["chat"] == []


class TestSearch:
    def test_returns_all_when_query_empty(self, store):
        _save(store, question="a")
        _save(store, question="b")
        _save(store, question="c")
        assert len(store.search_sessions("")) == 3

    def test_question_hits_rank_above_body_hits(self, store):
        a = _save(store, question="agentic AI systems", report="misc content")
        b = _save(store, question="unrelated", report="agentic is mentioned once")
        results = store.search_sessions("agentic")
        assert [r["id"] for r in results][0] == a["id"]
        assert b["id"] in [r["id"] for r in results]

    def test_tag_matches_get_extra_weight(self, store):
        _save(store, question="x")  # no tag
        with_tag = _save(store, question="y")
        store.update_meta(with_tag["id"], tags=["rag"])
        results = store.search_sessions("rag")
        assert results[0]["id"] == with_tag["id"]

    def test_all_tokens_must_match(self, store):
        _save(store, question="apple banana")
        _save(store, question="apple only")
        results = store.search_sessions("apple banana")
        assert len(results) == 1


class TestRelated:
    def test_related_finds_overlapping_keywords(self, store):
        target = _save(store, question="how does retrieval augmented generation work")
        related = _save(store, question="retrieval augmented generation best practices")
        _save(store, question="best pizza toppings in rome")
        out = store.find_related(target["id"])
        ids = [r["id"] for r in out]
        assert related["id"] in ids

    def test_related_excludes_self(self, store):
        target = _save(store, question="agentic AI research")
        out = store.find_related(target["id"])
        assert target["id"] not in [r["id"] for r in out]

    def test_related_missing_session_returns_empty(self, store):
        assert store.find_related("nope") == []


class TestStats:
    def test_stats_reflect_saved_data(self, store):
        a = _save(store, mode="langgraph", template="default")
        _save(store, mode="langgraph", template="executive")
        _save(store, mode="crew", template="default")
        store.update_meta(a["id"], bookmarked=True, tags=["ai", "rag"])

        stats = store.stats()
        assert stats["total_sessions"] == 3
        assert stats["bookmarked"] == 1
        assert stats["by_mode"] == {"langgraph": 2, "crew": 1}
        assert stats["by_template"]["default"] == 2
        assert {"tag": "ai", "count": 1} in stats["top_tags"]

    def test_stats_activity_windows_to_14_days(self, store):
        for _ in range(5):
            _save(store)
        stats = store.stats()
        assert len(stats["activity"]) <= 14
