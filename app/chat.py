"""
Follow-up chat over a completed research session.

Given a session_id, we ground the LLM in the session's collected sources
(a lightweight RAG-over-context pattern) and stream a grounded answer with
inline [n] citations that match the session's source ids.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any, Dict, Generator, List, Optional

from langchain_groq import ChatGroq

from app.config import config
from app import session as session_store


def _llm(temperature: float = 0.2) -> ChatGroq:
    return ChatGroq(
        api_key=config.GROQ_API_KEY,
        model=config.GROQ_MODEL or "groq/compound-mini",
        temperature=temperature,
    )


def _content(msg) -> str:
    raw = getattr(msg, "content", msg)
    if isinstance(raw, list):
        return "".join(str(x) for x in raw)
    return str(raw or "")


# --------------------------------------------------------------------------
# Prompt construction
# --------------------------------------------------------------------------
def _build_prompt(
    original_question: str,
    report: str,
    sources: List[Dict[str, Any]],
    history: List[Dict[str, str]],
    user_message: str,
) -> str:
    source_block = "\n\n".join(
        f"[{s.get('id','?')}] ({s.get('source_type','web')}) "
        f"{s.get('title','Untitled')} ({s.get('url','')})\n"
        f"{(s.get('content','') or '')[:900]}"
        for s in sources
    ) or "(no sources)"

    history_block = ""
    if history:
        parts = []
        for h in history[-6:]:
            role = h.get("role", "user").upper()
            content = h.get("content", "").strip()
            if content:
                parts.append(f"{role}: {content}")
        if parts:
            history_block = "\n\nConversation so far:\n" + "\n".join(parts)

    return (
        "You are a research assistant continuing a conversation about a prior "
        "research report. Answer the user's new question using ONLY the numbered "
        "sources and the prior report below.\n\n"
        "Rules:\n"
        "- Cite every factual claim inline as [n], matching the numbered sources.\n"
        "- If the sources don't cover something, say so plainly — do not invent.\n"
        "- Keep answers focused, well-structured markdown.\n"
        "- If the user asks about the report itself (summary, tone, etc.), answer "
        "  from the report text, no citations needed.\n\n"
        f"Original question: {original_question}\n\n"
        f"Prior report:\n{report[:4000]}\n\n"
        f"Sources:\n{source_block}"
        f"{history_block}\n\n"
        f"New user question: {user_message}\n\n"
        "Answer:"
    )


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------
def ask(session_id: str, user_message: str) -> Dict[str, Any]:
    """Blocking Q&A over a session's sources. Persists both turns."""
    config.validate()
    session = session_store.get_session(session_id)
    if not session:
        raise ValueError(f"Session not found: {session_id}")

    history = session.get("chat", []) or []
    prompt = _build_prompt(
        original_question=session.get("question", ""),
        report=session.get("report", ""),
        sources=session.get("sources", []),
        history=history,
        user_message=user_message,
    )

    answer = _content(_llm(temperature=0.2).invoke(prompt)).strip()

    user_turn = _turn("user", user_message)
    ai_turn = _turn("assistant", answer)
    session_store.append_chat(session_id, [user_turn, ai_turn])

    return {"answer": answer, "user_turn": user_turn, "assistant_turn": ai_turn}


def stream_ask(session_id: str, user_message: str) -> Generator[Dict[str, Any], None, None]:
    """Streaming chat: yields {'delta': str} chunks then {'done': True}."""
    config.validate()
    session = session_store.get_session(session_id)
    if not session:
        yield {"error": f"Session not found: {session_id}"}
        return

    history = session.get("chat", []) or []
    prompt = _build_prompt(
        original_question=session.get("question", ""),
        report=session.get("report", ""),
        sources=session.get("sources", []),
        history=history,
        user_message=user_message,
    )

    user_turn = _turn("user", user_message)
    yield {"user_turn": user_turn}

    parts: List[str] = []
    try:
        for chunk in _llm(temperature=0.2).stream(prompt):
            delta = _content(chunk)
            if delta:
                parts.append(delta)
                yield {"delta": delta}
    except Exception as exc:  # noqa: BLE001
        yield {"error": f"{exc.__class__.__name__}: {exc}"}
        return

    full = "".join(parts).strip()
    ai_turn = _turn("assistant", full)
    session_store.append_chat(session_id, [user_turn, ai_turn])
    yield {"done": True, "assistant_turn": ai_turn}


def _turn(role: str, content: str) -> Dict[str, str]:
    return {
        "id": uuid.uuid4().hex[:10],
        "role": role,
        "content": content,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
