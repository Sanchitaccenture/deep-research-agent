"""
FastAPI transport layer for the Deep Research Agent.

Endpoints (v3):
  GET  /health                         — liveness check
  GET  /api/status                     — config + feature flags summary
  GET  /api/templates                  — list report templates

  POST /api/research                   — blocking LangGraph run (template opt.)
  GET  /api/research/stream            — SSE stream of a LangGraph research run
  POST /api/crew/research              — blocking CrewAI multi-agent run
  GET  /api/crew/stream                — SSE stream of a CrewAI multi-agent run

  POST /api/documents/upload           — upload + index a document
  GET  /api/documents                  — list indexed documents
  DELETE /api/documents/{doc_id}       — remove one document
  DELETE /api/documents                — clear the entire vector store

  GET  /api/sessions                   — list past research sessions
  GET  /api/sessions/{id}              — retrieve one session
  DELETE /api/sessions/{id}            — delete a session

  POST /api/sessions/{id}/chat         — blocking follow-up chat over a session
  GET  /api/sessions/{id}/chat/stream  — SSE stream a follow-up chat answer
  DELETE /api/sessions/{id}/chat       — clear a session's chat thread
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import re

from app.agent import DEFAULT_TEMPLATE, TEMPLATES, run_research, stream_research
from app.config import config
from app import cache as research_cache
from app import chat as chat_module
from app import rag, session as session_store
from app.middleware import RequestLoggingMiddleware
from app.rate_limit import RateLimitMiddleware, stats as rate_limit_stats


# --------------------------------------------------------------------------
# Error normalisation
# --------------------------------------------------------------------------
def _friendly_error(raw: str) -> Dict[str, Any]:
    """Turn a raw exception string into a client-friendly error payload."""
    text = str(raw)
    low = text.lower()

    if "rate_limit" in low or "rate limit" in low or "429" in low:
        wait = None
        # Groq: "Please try again in 19m41s"
        m = re.search(r"try again in\s+([0-9hms.]+)", text, re.IGNORECASE)
        if m:
            wait = m.group(1)
        return {
            "error": "Rate limit reached on the LLM provider.",
            "detail": (
                f"Please wait {wait} and try again."
                if wait
                else "Please wait a few minutes and try again."
            ),
            "kind": "rate_limit",
            "retry_after": wait,
        }

    if any(t in low for t in ("model_not_found", "does not exist", "decommissioned", "no longer supported", "deprecated")):
        return {
            "error": "The configured LLM model has been retired or renamed by the provider.",
            "detail": (
                "Set GROQ_MODEL in .env to a currently-supported model — e.g. "
                "`groq/compound-mini` or `llama-3.1-8b-instant`."
            ),
            "kind": "model_missing",
        }

    if "quota" in low or "insufficient_quota" in low:
        return {
            "error": "LLM quota exhausted.",
            "detail": "Upgrade your Groq plan or wait for the daily quota to reset.",
            "kind": "quota",
        }

    if "tavily" in low or "search" in low and "failed" in low:
        return {
            "error": "Web search failed.",
            "detail": text[:220],
            "kind": "search",
        }

    return {
        "error": "Something went wrong on the backend.",
        "detail": text[:220],
        "kind": "unknown",
    }


# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------
app = FastAPI(
    title="Deep Research Agent API",
    version="3.1.0",
    description=(
        "Autonomous research agent with LangGraph + streaming synthesis + RAG. "
        "Every research run streams incremental events over SSE: "
        "`step`, `sources`, `report_delta`, `report`, `diagram`, `followups`, "
        "`suggested_tags`, `metrics`, `done`, `error`."
    ),
    contact={"name": "Deep Research Agent"},
    license_info={"name": "MIT"},
)

# Middleware is applied in reverse order of registration, so the last one
# added runs first. Order: CORS -> RateLimit -> RequestLogging -> route.
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Response-Time-Ms"],
)


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------
class ResearchRequest(BaseModel):
    question: str
    template: str = DEFAULT_TEMPLATE
    save: bool = True


class ChatRequest(BaseModel):
    message: str


class SessionMetaUpdate(BaseModel):
    bookmarked: Optional[bool] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None


# --------------------------------------------------------------------------
# Health / status / templates
# --------------------------------------------------------------------------
@app.get("/health", tags=["ops"], summary="Deep liveness + readiness probe")
def health() -> dict:
    """Reports the status of every runtime dependency. `status`:
      * `ok`        — all checks pass
      * `degraded`  — API works but at least one dependency is missing
      * `error`     — a required dependency is unavailable
    """
    checks: dict[str, str] = {}

    checks["groq_key"] = (
        "ok" if config.GROQ_API_KEY and not config.GROQ_API_KEY.startswith("your_")
        else "missing"
    )
    checks["tavily_key"] = (
        "ok" if config.TAVILY_API_KEY and not config.TAVILY_API_KEY.startswith("your_")
        else "missing"
    )
    try:
        _ = session_store.list_sessions()
        checks["sessions_dir"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["sessions_dir"] = f"error: {exc.__class__.__name__}"
    if config.ENABLE_RAG:
        try:
            rag.document_count()
            checks["chroma"] = "ok"
        except Exception as exc:  # noqa: BLE001
            checks["chroma"] = f"error: {exc.__class__.__name__}"
    else:
        checks["chroma"] = "disabled"

    if any(v.startswith("error") or v == "missing" for v in checks.values() if v not in ("disabled",)):
        overall = "error" if "missing" in checks.values() else "degraded"
    else:
        overall = "ok"

    return {"status": overall, "checks": checks, "version": app.version}


@app.get(
    "/api/status",
    tags=["ops"],
    summary="Runtime configuration + feature flags",
)
def status() -> dict:
    """Snapshot of feature flags, models, budgets, templates, and counts.
    Used by the frontend to hide UI for disabled features."""
    try:
        doc_count = rag.document_count() if config.ENABLE_RAG else 0
    except Exception:
        doc_count = 0
    return {
        "features": {
            "rag": config.ENABLE_RAG,
            "crew": config.ENABLE_CREW,
        },
        "models": {
            "langgraph": config.GROQ_MODEL,
            "crew": config.CREW_MODEL,
            "embeddings": config.EMBEDDING_MODEL,
        },
        "budgets": {
            "max_subquestions": config.MAX_SUBQUESTIONS,
            "results_per_search": config.RESULTS_PER_SEARCH,
            "max_rounds": config.MAX_ROUNDS,
            "rag_top_k": config.RAG_TOP_K,
        },
        "templates": list(TEMPLATES.keys()),
        "documents": doc_count,
        "sessions": len(session_store.list_sessions()),
        "cache": research_cache.stats(),
        "rate_limit": rate_limit_stats(),
    }


@app.get("/api/templates")
def templates() -> dict:
    return {
        "templates": [
            {"key": k, "prompt": v} for k, v in TEMPLATES.items()
        ]
    }


# --------------------------------------------------------------------------
# LangGraph research
# --------------------------------------------------------------------------
def _resolve_template(t: Optional[str]) -> str:
    if not t or t not in TEMPLATES:
        return DEFAULT_TEMPLATE
    return t


@app.post(
    "/api/research",
    tags=["research"],
    summary="Run one research question and return the finished report",
)
def research(req: ResearchRequest) -> dict:
    """Blocking LangGraph run. Prefer the SSE stream endpoint for UIs — this
    is fine for scripting. Identical (question, template) pairs are served
    from an in-process cache with a 15-minute TTL."""
    tpl = _resolve_template(req.template)
    cached = research_cache.get(req.question, tpl, "langgraph")
    if cached:
        return {**cached, "cached": True}
    try:
        result = run_research(req.question, tpl)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload = {
        "question": req.question,
        "template": result.get("template", DEFAULT_TEMPLATE),
        "report": result.get("report", ""),
        "sources": result.get("sources", []),
        "steps": result.get("steps", []),
        "diagram": result.get("diagram", ""),
        "followups": result.get("followups", []),
        "metrics": result.get("metrics", {}),
        "mode": "langgraph",
    }
    if req.save:
        saved = session_store.save_session(
            question=req.question,
            report=payload["report"],
            sources=payload["sources"],
            steps=payload["steps"],
            mode="langgraph",
            template=payload["template"],
            diagram=payload["diagram"],
            followups=payload["followups"],
            metrics=payload["metrics"],
        )
        payload["session_id"] = saved["id"]
    research_cache.put(req.question, tpl, "langgraph", payload)
    return payload


@app.get("/api/research/stream")
def research_stream(
    question: str,
    template: str = DEFAULT_TEMPLATE,
    save: bool = True,
) -> StreamingResponse:
    tpl = _resolve_template(template)

    def event_generator():
        collected_sources: List[Dict[str, Any]] = []
        collected_steps: List[str] = []
        final_report = ""
        diagram = ""
        followups: List[str] = []
        suggested_tags: List[str] = []
        metrics: Dict[str, Any] = {}
        try:
            for update in stream_research(question, tpl):
                if update.get("error"):
                    yield f"data: {json.dumps({'error': update['error']})}\n\n"
                    continue
                for step in update.get("steps", []):
                    collected_steps.append(step)
                    yield f"data: {json.dumps({'step': step})}\n\n"
                if update.get("sources"):
                    collected_sources = update["sources"]
                    yield f"data: {json.dumps({'sources': collected_sources})}\n\n"
                if update.get("report_delta"):
                    yield f"data: {json.dumps({'report_delta': update['report_delta']})}\n\n"
                if update.get("report"):
                    final_report = update["report"]
                    yield f"data: {json.dumps({'report': final_report})}\n\n"
                if update.get("diagram"):
                    diagram = update["diagram"]
                    yield f"data: {json.dumps({'diagram': diagram})}\n\n"
                if update.get("followups"):
                    followups = update["followups"]
                    yield f"data: {json.dumps({'followups': followups})}\n\n"
                if update.get("suggested_tags"):
                    suggested_tags = update["suggested_tags"]
                    yield f"data: {json.dumps({'suggested_tags': suggested_tags})}\n\n"
                if update.get("metrics"):
                    metrics = update["metrics"]
                    yield f"data: {json.dumps({'metrics': metrics})}\n\n"

            session_id = None
            if save and final_report:
                saved = session_store.save_session(
                    question=question,
                    report=final_report,
                    sources=collected_sources,
                    steps=collected_steps,
                    mode="langgraph",
                    template=tpl,
                    diagram=diagram,
                    followups=followups,
                    metrics=metrics,
                )
                session_id = saved["id"]
                if suggested_tags:
                    session_store.update_meta(session_id, tags=suggested_tags)
            yield f"data: {json.dumps({'done': True, 'session_id': session_id, 'suggested_tags': suggested_tags})}\n\n"
        except RuntimeError as exc:
            yield f"data: {json.dumps(_friendly_error(str(exc)))}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps(_friendly_error(f'{exc.__class__.__name__}: {exc}'))}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# --------------------------------------------------------------------------
# CrewAI research
# --------------------------------------------------------------------------
@app.post("/api/crew/research")
def crew_research(req: ResearchRequest) -> dict:
    if not config.ENABLE_CREW:
        raise HTTPException(status_code=400, detail="Crew mode is disabled.")
    try:
        from app.crew import run_crew
        result = run_crew(req.question)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload = {
        "question": req.question,
        "template": DEFAULT_TEMPLATE,
        "report": result.get("report", ""),
        "sources": result.get("sources", []),
        "steps": result.get("steps", []),
        "diagram": "",
        "followups": [],
        "metrics": {"source_count": len(result.get("sources", []))},
        "mode": "crew",
    }
    if req.save:
        saved = session_store.save_session(
            question=req.question,
            report=payload["report"],
            sources=payload["sources"],
            steps=payload["steps"],
            mode="crew",
        )
        payload["session_id"] = saved["id"]
    return payload


@app.get("/api/crew/stream")
def crew_stream(question: str, save: bool = True) -> StreamingResponse:
    def event_generator():
        collected_sources: List[Dict[str, Any]] = []
        collected_steps: List[str] = []
        final_report = ""
        try:
            if not config.ENABLE_CREW:
                yield f"data: {json.dumps({'error': 'Crew mode is disabled.'})}\n\n"
                return
            from app.crew import stream_crew
            for update in stream_crew(question):
                for step in update.get("steps", []):
                    collected_steps.append(step)
                    yield f"data: {json.dumps({'step': step})}\n\n"
                if update.get("sources"):
                    collected_sources = update["sources"]
                    yield f"data: {json.dumps({'sources': collected_sources})}\n\n"
                if update.get("report_delta"):
                    yield f"data: {json.dumps({'report_delta': update['report_delta']})}\n\n"
                if update.get("report"):
                    final_report = update["report"]
                    yield f"data: {json.dumps({'report': final_report})}\n\n"

            session_id = None
            if save and final_report:
                saved = session_store.save_session(
                    question=question,
                    report=final_report,
                    sources=collected_sources,
                    steps=collected_steps,
                    mode="crew",
                )
                session_id = saved["id"]
            yield f"data: {json.dumps({'done': True, 'session_id': session_id})}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'error': f'{exc.__class__.__name__}: {exc}'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# --------------------------------------------------------------------------
# Documents (RAG)
# --------------------------------------------------------------------------
@app.post("/api/documents/upload")
async def upload_document(file: UploadFile = File(...)) -> dict:
    if not config.ENABLE_RAG:
        raise HTTPException(status_code=400, detail="RAG is disabled.")

    filename = file.filename or "upload.bin"
    safe_name = Path(filename).name
    dest = Path(config.UPLOADS_DIR) / safe_name
    dest.parent.mkdir(parents=True, exist_ok=True)

    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        doc = rag.ingest_file(dest, safe_name)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=422, detail=f"Ingestion failed: {exc}"
        ) from exc

    return {"ok": True, "document": doc}


@app.get("/api/documents")
def documents_list() -> dict:
    if not config.ENABLE_RAG:
        return {"documents": []}
    return {"documents": rag.list_documents()}


@app.delete("/api/documents/{doc_id}")
def documents_delete(doc_id: str) -> dict:
    if not config.ENABLE_RAG:
        raise HTTPException(status_code=400, detail="RAG is disabled.")
    if not rag.delete_document(doc_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True}


@app.delete("/api/documents")
def documents_clear() -> dict:
    if not config.ENABLE_RAG:
        raise HTTPException(status_code=400, detail="RAG is disabled.")
    rag.reset_collection()
    return {"ok": True}


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------
@app.get("/api/sessions")
def sessions_list() -> dict:
    return {"sessions": session_store.list_sessions()}


@app.get("/api/sessions/search")
def sessions_search(q: str = "", limit: int = 50) -> dict:
    return {"sessions": session_store.search_sessions(q, limit=limit)}


@app.get("/api/sessions/stats")
def sessions_stats() -> dict:
    return session_store.stats()


@app.get("/api/sessions/{session_id}")
def sessions_get(session_id: str) -> dict:
    data = session_store.get_session(session_id)
    if not data:
        raise HTTPException(status_code=404, detail="Session not found")
    return data


@app.get("/api/sessions/{session_id}/related")
def sessions_related(session_id: str, limit: int = 5) -> dict:
    return {"related": session_store.find_related(session_id, limit=limit)}


@app.patch("/api/sessions/{session_id}")
def sessions_patch(session_id: str, meta: SessionMetaUpdate) -> dict:
    updated = session_store.update_meta(
        session_id,
        bookmarked=meta.bookmarked,
        tags=meta.tags,
        notes=meta.notes,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Session not found")
    return updated


@app.delete("/api/sessions/{session_id}")
def sessions_delete(session_id: str) -> dict:
    if not session_store.delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


# --------------------------------------------------------------------------
# Chat over a session
# --------------------------------------------------------------------------
@app.post("/api/sessions/{session_id}/chat")
def chat_post(session_id: str, req: ChatRequest) -> dict:
    try:
        return chat_module.ask(session_id, req.message)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/sessions/{session_id}/chat/stream")
def chat_stream(session_id: str, message: str) -> StreamingResponse:
    def event_generator():
        try:
            for update in chat_module.stream_ask(session_id, message):
                yield f"data: {json.dumps(update)}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'error': f'{exc.__class__.__name__}: {exc}'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.delete("/api/sessions/{session_id}/chat")
def chat_clear(session_id: str) -> dict:
    if not session_store.clear_chat(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


# --------------------------------------------------------------------------
# Legacy compatibility (old streamlit_app.py hits these directly)
# --------------------------------------------------------------------------
@app.post("/research")
def research_legacy(req: ResearchRequest) -> dict:
    return research(req)


@app.get("/research/stream")
def research_stream_legacy(question: str) -> StreamingResponse:
    return research_stream(question, template=DEFAULT_TEMPLATE, save=False)
