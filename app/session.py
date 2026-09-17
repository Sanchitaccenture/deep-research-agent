"""JSON-based persistence for past research sessions and their chat threads."""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import config


_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "of", "for", "to", "in", "on", "at",
    "by", "with", "from", "is", "are", "was", "were", "be", "been", "being",
    "has", "have", "had", "do", "does", "did", "will", "would", "could",
    "should", "shall", "may", "might", "must", "can", "this", "that", "these",
    "those", "i", "you", "he", "she", "it", "we", "they", "what", "which",
    "who", "whom", "whose", "when", "where", "why", "how", "as", "if", "then",
    "than", "so", "not", "no", "yes", "all", "some", "any", "every", "each",
    "about", "into", "over", "under", "up", "down", "out", "off", "one", "two",
}


def _sessions_dir() -> Path:
    d = Path(config.SESSIONS_DIR)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path(session_id: str) -> Path:
    return _sessions_dir() / f"{session_id}.json"


def _tokenize(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]{3,}", (text or "").lower())
    return {w for w in words if w not in _STOPWORDS}


def _summary(data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": data["id"],
        "question": data["question"],
        "mode": data.get("mode", "langgraph"),
        "template": data.get("template", "default"),
        "created_at": data["created_at"],
        "source_count": len(data.get("sources", [])),
        "chat_count": len(data.get("chat", [])),
        "bookmarked": bool(data.get("bookmarked", False)),
        "tags": list(data.get("tags", [])),
        "has_notes": bool((data.get("notes") or "").strip()),
    }


def save_session(
    question: str,
    report: str,
    sources: List[Dict[str, Any]],
    steps: List[str],
    mode: str = "langgraph",
    template: str = "default",
    diagram: str = "",
    followups: Optional[List[str]] = None,
    metrics: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    session_id = uuid.uuid4().hex[:10]
    created_at = datetime.now(timezone.utc).isoformat()
    session = {
        "id": session_id,
        "question": question,
        "report": report,
        "sources": sources,
        "steps": steps,
        "mode": mode,
        "template": template,
        "diagram": diagram,
        "followups": followups or [],
        "metrics": metrics or {},
        "chat": [],
        "bookmarked": False,
        "tags": [],
        "notes": "",
        "created_at": created_at,
    }
    _path(session_id).write_text(
        json.dumps(session, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return session


def _load_all() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in sorted(_sessions_dir().glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except Exception:
            continue
    return out


def list_sessions() -> List[Dict[str, Any]]:
    return [_summary(d) for d in _load_all()]


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    p = _path(session_id)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def delete_session(session_id: str) -> bool:
    p = _path(session_id)
    if not p.exists():
        return False
    p.unlink()
    return True


def _save(data: Dict[str, Any]) -> None:
    _path(data["id"]).write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def update_meta(
    session_id: str,
    bookmarked: Optional[bool] = None,
    tags: Optional[List[str]] = None,
    notes: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    data = get_session(session_id)
    if not data:
        return None
    if bookmarked is not None:
        data["bookmarked"] = bool(bookmarked)
    if tags is not None:
        data["tags"] = [t.strip() for t in tags if t and t.strip()][:20]
    if notes is not None:
        data["notes"] = str(notes)
    _save(data)
    return _summary(data)


def append_chat(session_id: str, turns: List[Dict[str, Any]]) -> bool:
    data = get_session(session_id)
    if not data:
        return False
    data.setdefault("chat", []).extend(turns)
    _save(data)
    return True


def clear_chat(session_id: str) -> bool:
    data = get_session(session_id)
    if not data:
        return False
    data["chat"] = []
    _save(data)
    return True


# --------------------------------------------------------------------------
# Search + related
# --------------------------------------------------------------------------
def search_sessions(query: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Case-insensitive search over question + report + notes + tags."""
    q = (query or "").lower().strip()
    if not q:
        return list_sessions()[:limit]

    tokens = [t for t in re.split(r"\s+", q) if t]
    results: List[tuple[float, Dict[str, Any]]] = []
    for data in _load_all():
        hay = " ".join([
            data.get("question", "") or "",
            data.get("report", "") or "",
            data.get("notes", "") or "",
            " ".join(data.get("tags", []) or []),
        ]).lower()
        if not all(t in hay for t in tokens):
            continue
        # Rank: match in question weighs highest, then tags, then body.
        q_hits = sum(1 for t in tokens if t in (data.get("question", "") or "").lower())
        tag_hits = sum(1 for t in tokens if any(t in tag.lower() for tag in data.get("tags", [])))
        body_hits = sum(1 for t in tokens if t in (data.get("report", "") or "").lower())
        score = q_hits * 5 + tag_hits * 3 + body_hits
        results.append((score, data))

    results.sort(key=lambda r: r[0], reverse=True)
    return [_summary(d) for _, d in results[:limit]]


def find_related(session_id: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Rank other sessions by Jaccard overlap on question keywords + tag overlap."""
    src = get_session(session_id)
    if not src:
        return []
    src_words = _tokenize(src.get("question", ""))
    src_tags = set(t.lower() for t in src.get("tags", []))
    if not src_words and not src_tags:
        return []

    scored: List[tuple[float, Dict[str, Any]]] = []
    for data in _load_all():
        if data["id"] == session_id:
            continue
        w = _tokenize(data.get("question", ""))
        t = set(x.lower() for x in data.get("tags", []))
        if not w and not t:
            continue
        union_w = src_words | w
        overlap_w = len(src_words & w) / len(union_w) if union_w else 0.0
        overlap_t = len(src_tags & t) / max(1, len(src_tags | t)) if src_tags else 0.0
        score = overlap_w + 0.5 * overlap_t
        if score > 0.05:
            scored.append((score, data))

    scored.sort(key=lambda r: r[0], reverse=True)
    return [_summary(d) for _, d in scored[:limit]]


def stats() -> Dict[str, Any]:
    """Aggregate stats for the dashboard."""
    all_data = _load_all()
    total = len(all_data)
    bookmarked = sum(1 for d in all_data if d.get("bookmarked"))
    total_sources = sum(len(d.get("sources", [])) for d in all_data)
    total_chats = sum(len(d.get("chat", [])) for d in all_data)

    by_mode: Dict[str, int] = {}
    by_template: Dict[str, int] = {}
    tag_counts: Dict[str, int] = {}
    by_day: Dict[str, int] = {}

    for d in all_data:
        by_mode[d.get("mode", "langgraph")] = by_mode.get(d.get("mode", "langgraph"), 0) + 1
        by_template[d.get("template", "default")] = by_template.get(d.get("template", "default"), 0) + 1
        for t in d.get("tags", []) or []:
            tag_counts[t] = tag_counts.get(t, 0) + 1
        day = (d.get("created_at") or "")[:10]
        if day:
            by_day[day] = by_day.get(day, 0) + 1

    top_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    activity = sorted(by_day.items())[-14:]  # last 14 days

    return {
        "total_sessions": total,
        "bookmarked": bookmarked,
        "total_sources": total_sources,
        "total_chats": total_chats,
        "by_mode": by_mode,
        "by_template": by_template,
        "top_tags": [{"tag": t, "count": c} for t, c in top_tags],
        "activity": [{"day": d, "count": c} for d, c in activity],
    }
