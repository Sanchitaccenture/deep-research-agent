"""
Deep Research Agent — LangGraph pipeline with token-by-token streaming synthesis
plus post-synthesis enrichment (mermaid diagram + follow-ups + suggested tags + metrics).

Two graphs:

  build_research_agent :  plan -> search -> assess -> (loop) -> END
                          (research phases only; ends when coverage is sufficient)

  build_full_agent     :  plan -> search -> assess -> (loop) -> synthesize -> enrich -> END
                          (used by the blocking run_research entrypoint)

`stream_research` composes:
  1. runs build_research_agent (streaming node updates as SSE events)
  2. streams synthesize token-by-token via LLM.stream() → emits `report_delta`
  3. runs enrich_node on the completed report → emits diagram/followups/tags/metrics
"""
from __future__ import annotations

import json
import time
from typing import Any, Dict, Generator, List, Optional, TypedDict, cast

from langgraph.graph import END, StateGraph
from langchain_groq import ChatGroq
from tavily import TavilyClient

from app import telemetry
from app.config import config


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------
TEMPLATES: Dict[str, str] = {
    "default": (
        "Use markdown: ## Overview, then a ### section per theme, then "
        "## Key Findings. Cite every factual claim inline as [n]. End with "
        "## Sources listing each [n] with title and URL."
    ),
    "executive": (
        "Write a crisp one-page executive summary. Sections in order:\n"
        "## TL;DR — exactly 3 bullets\n"
        "## Context — 2-4 short sentences\n"
        "## Key Findings — 4-6 bullets, each ending with citations [n]\n"
        "## Risks & Opportunities — a two-column markdown table\n"
        "## Recommendation — 2-3 sentences\n"
        "## Sources — numbered list of title + URL\n"
        "Keep the whole report under ~450 words."
    ),
    "deep_dive": (
        "Write a comprehensive deep-dive report:\n"
        "## Executive Summary — 3-4 sentences\n"
        "## Background — set the stage\n"
        "### Sub-topic sections — one per theme, with sub-headings\n"
        "## Comparative Table — a markdown table when quantitative facts exist\n"
        "## Key Findings — bulleted, each cited [n]\n"
        "## Open Questions — honest list of what the sources don't answer\n"
        "## Sources — numbered list. Cite inline as [n]."
    ),
    "pros_cons": (
        "Write a balanced pros/cons analysis:\n"
        "## Overview — the question and stakes\n"
        "## Pros — bulleted with citations [n]\n"
        "## Cons — bulleted with citations [n]\n"
        "## Nuances — where the answer depends on context\n"
        "## Verdict — one-paragraph judgement grounded in the evidence\n"
        "## Sources — numbered list of title + URL."
    ),
    "timeline": (
        "Write a chronological analysis:\n"
        "## Overview — 2-3 sentences\n"
        "## Timeline — a markdown table with columns Date | Event | "
        "Significance | Sources ([n])\n"
        "## Key Turning Points — 3-5 bullets with citations\n"
        "## Outlook — brief forward look, only if sources support it\n"
        "## Sources — numbered list of title + URL."
    ),
}

DEFAULT_TEMPLATE = "default"


# --------------------------------------------------------------------------
# State
# --------------------------------------------------------------------------
class ResearchState(TypedDict):
    question: str
    template: str
    subquestions: List[str]
    pending_queries: List[str]
    sources: List[Dict[str, Any]]
    seen_urls: List[str]
    round: int
    gaps: str
    report: str
    diagram: str
    followups: List[str]
    suggested_tags: List[str]
    metrics: Dict[str, Any]
    steps: List[str]
    started_at: float


# --------------------------------------------------------------------------
# Clients
# --------------------------------------------------------------------------
def _model_chain() -> List[str]:
    """Ordered fallback chain of Groq-hosted models.

    Priority: user's configured GROQ_MODEL first, then progressively different
    models each on a separate daily quota bucket so a single-model rate-limit
    doesn't kill a run. Duplicates dropped in order.
    """
    chain = [
        (config.GROQ_MODEL or "").strip(),
        "llama-3.1-8b-instant",       # small + huge daily quota — best rescue
        "llama-3.3-70b-versatile",    # big + versatile
        "openai/gpt-oss-20b",         # newer, separate quota bucket
        "openai/gpt-oss-120b",        # newer big model
    ]
    seen: set = set()
    out: List[str] = []
    for m in chain:
        m = m.strip() if m else ""
        # Strip the "groq/" prefix if present — langchain-groq accepts either
        # form, and dedup should treat "groq/x" and "x" as the same model.
        norm = m[len("groq/"):] if m.startswith("groq/") else m
        if norm and norm not in seen:
            seen.add(norm)
            out.append(m)
    return out


def _make_client(model: str, temperature: float) -> Any:
    return ChatGroq(
        api_key=config.GROQ_API_KEY,
        model=model,
        temperature=temperature,
    ).with_config({"callbacks": telemetry.callbacks()})


def _is_recoverable(exc: BaseException) -> bool:
    """Should we try the next model in the fallback chain?

    Kept permissive on purpose: any LLM-provider error is worth retrying on
    a different model, because model-specific failures (rate limits,
    decommissioned models, temporary outages) are the most common causes.
    Only genuine wiring bugs (bad prompts, network errors we can't recover
    from) should ever surface to the caller.
    """
    s = str(exc).lower()
    # Explicit tags we've seen in the wild
    for tag in (
        "rate_limit", "rate limit", "429",
        "model_not_found", "does not exist",
        "decommissioned", "no longer supported",
        "deprecated", "unavailable",
        "quota", "too many requests",
        "service_unavailable", "503",
        "internal_server_error", "500",
        "bad_gateway", "502",
        "gateway_timeout", "504",
        "overloaded",
    ):
        if tag in s:
            return True
    # Any known Groq/OpenAI error class name → retry next model
    for name in (
        "badrequesterror", "ratelimiterror", "internalservererror",
        "apierror", "apiconnectionerror", "apistatuserror",
    ):
        if name in s:
            return True
    return False


def _invoke_with_fallback(prompt: str, temperature: float = 0.2) -> Any:
    """Invoke the LLM against each model in the chain until one succeeds."""
    last_exc: Optional[BaseException] = None
    for model in _model_chain():
        try:
            client = _make_client(model, temperature)
            return client.invoke(prompt)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            telemetry.emit(
                "llm.fallback",
                level="warning",
                model=model,
                error=str(exc)[:200],
                recoverable=_is_recoverable(exc),
            )
            if _is_recoverable(exc):
                continue
            raise
    raise last_exc if last_exc else RuntimeError("no models available")


def _stream_with_fallback(prompt: str, temperature: float = 0.2):
    """Stream from the first model that yields any content. If the first token
    fails, transparently fall over to the next model."""
    last_exc: Optional[BaseException] = None
    for model in _model_chain():
        try:
            client = _make_client(model, temperature)
            gen = client.stream(prompt)
            first = next(gen)  # force at least one chunk to detect rate limits
            yield first
            for chunk in gen:
                yield chunk
            return
        except StopIteration:
            return
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            telemetry.emit(
                "llm.stream_fallback",
                level="warning",
                model=model,
                error=str(exc)[:200],
                recoverable=_is_recoverable(exc),
            )
            if _is_recoverable(exc):
                continue
            raise
    raise last_exc if last_exc else RuntimeError("no models available")


def _llm(temperature: float = 0.2) -> Any:
    """Backwards-compatible LLM factory. Returns an object that supports
    `.invoke(prompt)` and `.stream(prompt)` with automatic fallback."""

    class _FallbackLLM:
        def __init__(self, t: float) -> None:
            self._t = t

        def invoke(self, prompt: str, *_, **__):
            return _invoke_with_fallback(prompt, self._t)

        def stream(self, prompt: str, *_, **__):
            return _stream_with_fallback(prompt, self._t)

    return _FallbackLLM(temperature)


def _tavily() -> TavilyClient:
    return TavilyClient(api_key=config.TAVILY_API_KEY)


def _content(msg) -> str:
    """ChatGroq returns AIMessage.content as str in practice; coerce for safety."""
    raw = getattr(msg, "content", msg)
    if isinstance(raw, list):
        return "".join(str(x) for x in raw)
    return str(raw or "")


# --------------------------------------------------------------------------
# Node 1 - PLAN
# --------------------------------------------------------------------------
def plan_node(state: ResearchState) -> Dict[str, Any]:
    question = state["question"]
    prompt = (
        "You are a research planner. Break the user's question into "
        f"{config.MAX_SUBQUESTIONS} focused, non-overlapping sub-questions that, "
        "answered together, fully cover it.\n"
        "Return ONLY a JSON array of strings, no prose, no markdown.\n\n"
        f"Question: {question}"
    )
    try:
        raw = _content(_llm(temperature=0.3).invoke(prompt)).strip()
        subs = _parse_json_list(raw) or [question]
    except Exception as exc:  # noqa: BLE001
        # Every model failed. Skip planning and just search the raw question.
        telemetry.emit("plan.llm_failed", level="warning", error=str(exc)[:200])
        subs = [question]
    subs = subs[: config.MAX_SUBQUESTIONS]

    steps = state.get("steps", []) + [
        f"Planned {len(subs)} sub-questions:"
    ] + [f"   - {s}" for s in subs]

    return {
        "subquestions": subs,
        "pending_queries": list(subs),
        "sources": [],
        "seen_urls": [],
        "round": 0,
        "gaps": "",
        "steps": steps,
    }


# --------------------------------------------------------------------------
# Node 2 - SEARCH (Tavily + optional RAG)
# --------------------------------------------------------------------------
def search_node(state: ResearchState) -> Dict[str, Any]:
    tavily = _tavily()
    sources = list(state["sources"])
    seen = set(state["seen_urls"])
    steps = list(state["steps"])
    sid = len(sources) + 1
    round_no = state["round"] + 1

    steps.append(f"== Search round {round_no} ==")

    for q in state["pending_queries"]:
        steps.append(f"Searching web: {q}")
        try:
            resp = tavily.search(
                query=q,
                max_results=config.RESULTS_PER_SEARCH,
                search_depth="advanced",
            )
        except Exception as e:
            steps.append(f"   ! search failed ({e.__class__.__name__}); skipping")
            resp = {"results": []}

        added = 0
        for r in resp.get("results", []):
            url = r.get("url", "")
            if url and url in seen:
                continue
            seen.add(url)
            sources.append({
                "id": sid,
                "title": r.get("title", "Untitled"),
                "url": url,
                "content": r.get("content", ""),
                "query": q,
                "source_type": "web",
            })
            sid += 1
            added += 1
        steps.append(f"   +{added} web sources")

        if config.ENABLE_RAG:
            try:
                from app import rag as rag_mod
                hits = rag_mod.query_documents(q, top_k=config.RAG_TOP_K)
            except Exception as e:
                hits = []
                steps.append(f"   ! RAG lookup failed ({e.__class__.__name__})")

            doc_added = 0
            for h in hits:
                url = h.get("url", "")
                if url and url in seen:
                    continue
                seen.add(url)
                sources.append({
                    "id": sid,
                    "title": h.get("title", "document"),
                    "url": url,
                    "content": h.get("content", ""),
                    "query": q,
                    "source_type": "document",
                    "score": h.get("score"),
                })
                sid += 1
                doc_added += 1
            if doc_added:
                steps.append(f"   +{doc_added} document chunks (RAG)")

    steps.append(f"Total sources so far: {len(sources)}.")
    return {
        "sources": sources,
        "seen_urls": list(seen),
        "round": round_no,
        "pending_queries": [],
        "steps": steps,
    }


# --------------------------------------------------------------------------
# Node 3 - ASSESS
# --------------------------------------------------------------------------
def assess_node(state: ResearchState) -> Dict[str, Any]:
    steps = list(state["steps"])

    if state["round"] >= config.MAX_ROUNDS:
        steps.append(f"Reached round budget ({config.MAX_ROUNDS}); synthesizing.")
        return {"gaps": "", "pending_queries": [], "steps": steps}

    coverage = "\n".join(
        f"- [{s['id']}] ({s.get('source_type','web')}|{s['query']}) "
        f"{s['title']}: {s['content'][:200]}"
        for s in state["sources"]
    ) or "(no sources yet)"

    prompt = (
        "You are a research supervisor deciding whether the collected sources are "
        "sufficient to write a thorough answer to the question.\n\n"
        f"Question: {state['question']}\n\n"
        f"Collected source snippets:\n{coverage}\n\n"
        "Respond ONLY with JSON of the form:\n"
        '{"sufficient": true|false, "gaps": "one sentence on what is missing", '
        '"followups": ["new search query", ...]}\n'
        "If sufficient is true, followups must be an empty array. "
        "Otherwise give 1-3 NEW, specific follow-up search queries that target the gaps."
    )
    try:
        raw = _content(_llm(temperature=0.2).invoke(prompt)).strip()
        decision = _parse_json_obj(raw)
    except Exception as exc:  # noqa: BLE001
        # Every model failed. Treat as sufficient so we exit the loop and
        # let synthesis (with its own fallback + salvage) handle the write.
        telemetry.emit("assess.llm_failed", level="warning", error=str(exc)[:200])
        steps.append("Assessment: LLM unavailable -> forcing synthesis.")
        return {"gaps": "", "pending_queries": [], "steps": steps}

    sufficient = bool(decision.get("sufficient", True))
    followups = [str(q) for q in decision.get("followups", []) if str(q).strip()][:3]
    gaps = str(decision.get("gaps", "")).strip()

    if sufficient or not followups:
        steps.append("Assessment: coverage sufficient -> synthesizing.")
        return {"gaps": "", "pending_queries": [], "steps": steps}

    steps.append(f"Assessment: gap found -> {gaps}")
    steps.append(f"Queuing {len(followups)} follow-up search(es).")
    return {"gaps": gaps, "pending_queries": followups, "steps": steps}


def route_after_assess_full(state: ResearchState) -> str:
    return "search" if state["pending_queries"] else "synthesize"


def route_after_assess_research_only(state: ResearchState) -> str:
    return "search" if state["pending_queries"] else "done"


# --------------------------------------------------------------------------
# Synthesis prompt builder (shared by blocking + streaming synthesis)
# --------------------------------------------------------------------------
def _salvage_report(question: str, sources: List[Dict[str, Any]], exc: BaseException) -> str:
    """Emit a machine-generated fallback report when every LLM is exhausted."""
    kind = "rate limit" if any(t in str(exc).lower() for t in ("rate_limit", "429", "quota")) else "LLM error"
    lines = [
        f"## Synthesis unavailable — {kind}",
        "",
        "The research collected sources successfully, but every configured LLM "
        "was unavailable when it was time to write the report. Nothing is lost — "
        "**you can retry when the rate window resets**, or open the **Chat** tab "
        "to ask questions directly against the sources below.",
        "",
        f"**Question:** {question}",
        "",
        f"## Sources ({len(sources)})",
        "",
    ]
    for s in sources[:40]:
        title = (s.get("title") or "Untitled").strip()
        url = s.get("url", "")
        snip = (s.get("content") or "").strip().replace("\n", " ")[:220]
        lines.append(f"**[{s.get('id')}] {title}** — {url}")
        if snip:
            lines.append(f"> {snip}")
        lines.append("")
    return "\n".join(lines).strip()


def _build_synthesis_prompt(state: ResearchState) -> str:
    question = state["question"]
    sources = state["sources"]
    template_key = state.get("template") or DEFAULT_TEMPLATE
    template_prompt = TEMPLATES.get(template_key, TEMPLATES[DEFAULT_TEMPLATE])

    source_block = "\n\n".join(
        f"[{s['id']}] ({s.get('source_type','web')}) {s['title']} ({s['url']})\n"
        f"{s['content'][:1200]}"
        for s in sources
    )

    return (
        "You are a senior research analyst. Using ONLY the numbered sources below, "
        "write a report answering the question.\n\n"
        f"Template rules:\n{template_prompt}\n\n"
        "Additional rules:\n"
        "- Do not invent facts. If the sources don't cover something, say so.\n"
        "- Sources tagged (document) are the user's own uploaded material.\n\n"
        f"Question: {question}\n\n"
        f"Sources:\n{source_block}"
    )


# --------------------------------------------------------------------------
# Node 4 - SYNTHESIZE (blocking; used by run_research)
# --------------------------------------------------------------------------
def synthesize_node(state: ResearchState) -> Dict[str, Any]:
    sources = state["sources"]
    template_key = state.get("template") or DEFAULT_TEMPLATE

    steps = list(state["steps"])
    steps.append(f"Synthesizing with template: {template_key}")

    if not sources:
        report = (
            "## No sources found\n\n"
            "The agent could not retrieve any sources. Check your Tavily key "
            "and network connection, then try again."
        )
        return {"report": report, "steps": steps + ["No sources to synthesize."]}

    prompt = _build_synthesis_prompt(state)
    report = _content(_llm(temperature=0.2).invoke(prompt)).strip()
    steps.append(
        f"Synthesized {len(report)} chars from {len(sources)} sources "
        f"over {state['round']} round(s)."
    )
    return {"report": report, "steps": steps}


# --------------------------------------------------------------------------
# Node 5 - ENRICH: mermaid diagram + follow-up questions + suggested tags + metrics
# --------------------------------------------------------------------------
def enrich_node(state: ResearchState) -> Dict[str, Any]:
    steps = list(state["steps"])
    report = state.get("report", "")
    sources = state.get("sources", [])

    if not report or not sources:
        metrics = _compute_metrics(state, diagram="", followups=[])
        return {
            "diagram": "",
            "followups": [],
            "suggested_tags": [],
            "metrics": metrics,
            "steps": steps + ["Enrichment skipped (no report/sources)."],
        }

    diagram = _generate_diagram(state["question"], report)
    if diagram:
        steps.append("Generated mermaid mind-map.")
    else:
        steps.append("Skipped mermaid generation.")

    followups = _generate_followups(state["question"], report)
    if followups:
        steps.append(f"Suggested {len(followups)} follow-up question(s).")

    tags = _generate_tags(state["question"], report)
    if tags:
        steps.append(f"Suggested {len(tags)} tag(s): {', '.join('#'+t for t in tags)}")

    metrics = _compute_metrics(state, diagram, followups)
    steps.append(
        f"Run complete in {metrics['duration_seconds']}s · "
        f"{metrics['source_count']} sources · "
        f"{metrics['report_chars']} chars."
    )
    return {
        "diagram": diagram,
        "followups": followups,
        "suggested_tags": tags,
        "metrics": metrics,
        "steps": steps,
    }


def _generate_diagram(question: str, report: str) -> str:
    prompt = (
        "Given a research report, produce a compact Mermaid mindmap that "
        "captures its structure. Rules:\n"
        "- Return ONLY the mermaid code, no ``` fences, no prose.\n"
        "- Start with `mindmap` on line 1.\n"
        "- Root node in ((double parens)) with the topic (max 6 words).\n"
        "- 3-6 top-level branches, each 2-5 leaf nodes.\n"
        "- Node labels: 2-5 words, plain text, no punctuation except spaces.\n\n"
        f"Question: {question}\n\n"
        f"Report:\n{report[:4000]}"
    )
    try:
        raw = _content(_llm(temperature=0.3).invoke(prompt)).strip()
    except Exception:
        return ""
    raw = _strip_fences(raw)
    if not raw.lower().startswith("mindmap"):
        return ""
    return raw


def _generate_followups(question: str, report: str) -> List[str]:
    prompt = (
        "Given a research question and its answer, suggest 3 concrete follow-up "
        "questions the reader might want to explore next. Each should be:\n"
        "- A complete question (not a topic name)\n"
        "- Specific enough to be researchable\n"
        "- Meaningfully different from the original question\n\n"
        "Return ONLY a JSON array of 3 strings.\n\n"
        f"Question: {question}\n\n"
        f"Report:\n{report[:3000]}"
    )
    try:
        raw = _content(_llm(temperature=0.4).invoke(prompt)).strip()
    except Exception:
        return []
    return _parse_json_list(raw)[:4]


def _generate_tags(question: str, report: str) -> List[str]:
    prompt = (
        "Given a research question and its answer, propose 3 short topical tags "
        "(single words or hyphenated pairs, no spaces, no # symbol) that describe "
        "what this research is about, useful for later filtering.\n"
        "Rules:\n"
        "- Lowercase, 1-2 words with a hyphen between them if two.\n"
        "- Topical, not descriptive of the format.\n"
        "- No punctuation.\n\n"
        "Return ONLY a JSON array of 3 short strings.\n\n"
        f"Question: {question}\n\n"
        f"Report:\n{report[:2500]}"
    )
    try:
        raw = _content(_llm(temperature=0.4).invoke(prompt)).strip()
    except Exception:
        return []
    tags = _parse_json_list(raw)[:4]
    cleaned: List[str] = []
    for t in tags:
        t = t.strip().lower().lstrip("#").strip()
        t = t.replace(" ", "-")
        t = "".join(ch for ch in t if ch.isalnum() or ch == "-")
        t = t.strip("-")
        if 2 <= len(t) <= 30 and t not in cleaned:
            cleaned.append(t)
    return cleaned


def _compute_metrics(
    state: ResearchState, diagram: str, followups: List[str]
) -> Dict[str, Any]:
    started_at = state.get("started_at") or time.time()
    duration = max(0.0, time.time() - started_at)
    sources = state.get("sources", [])
    web = sum(1 for s in sources if s.get("source_type") != "document")
    docs = sum(1 for s in sources if s.get("source_type") == "document")
    report_chars = len(state.get("report", ""))
    words = len((state.get("report") or "").split())
    reading_time = max(1, round(words / 200 * 60)) if words else 0

    # Real usage from telemetry callback (falls back to chars/4 heuristic if
    # the callback never fired, e.g. under the FakeChatGroq test double).
    usage = telemetry.get_usage().as_dict()
    if usage["total_tokens"] > 0:
        token_estimate = usage["total_tokens"]
    else:
        token_estimate = round(report_chars / 4) if report_chars else 0

    return {
        "duration_seconds": round(duration, 2),
        "sub_questions": len(state.get("subquestions", [])),
        "search_rounds": state.get("round", 0),
        "source_count": len(sources),
        "web_sources": web,
        "doc_sources": docs,
        "report_chars": report_chars,
        "report_words": words,
        "reading_time_seconds": reading_time,
        "token_estimate": token_estimate,
        "input_tokens": usage["input_tokens"],
        "output_tokens": usage["output_tokens"],
        "cost_usd": usage["cost_usd"],
        "llm_calls": usage["llm_calls"],
        "has_diagram": bool(diagram),
        "followups_count": len(followups),
    }


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        if len(parts) >= 2:
            raw = parts[1]
            lstripped = raw.lstrip()
            for tag in ("mermaid", "json"):
                if lstripped.lower().startswith(tag):
                    raw = lstripped[len(tag):]
                    break
    return raw.strip()


def _parse_json_list(raw: str) -> List[str]:
    raw = _strip_fences(raw)
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(x) for x in data if str(x).strip()]
    except json.JSONDecodeError:
        pass
    lines = [l.strip("-* \t") for l in raw.splitlines() if l.strip()]
    return [l for l in lines if len(l) > 8]


def _parse_json_obj(raw: str) -> Dict[str, Any]:
    raw = _strip_fences(raw)
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    return {"sufficient": True, "gaps": "", "followups": []}


# --------------------------------------------------------------------------
# Graphs
# --------------------------------------------------------------------------
def build_full_agent():
    """Full pipeline used by the blocking run_research entrypoint."""
    g = StateGraph(ResearchState)
    g.add_node("plan", plan_node)
    g.add_node("search", search_node)
    g.add_node("assess", assess_node)
    g.add_node("synthesize", synthesize_node)
    g.add_node("enrich", enrich_node)

    g.set_entry_point("plan")
    g.add_edge("plan", "search")
    g.add_edge("search", "assess")
    g.add_conditional_edges(
        "assess",
        route_after_assess_full,
        {"search": "search", "synthesize": "synthesize"},
    )
    g.add_edge("synthesize", "enrich")
    g.add_edge("enrich", END)

    return g.compile()


def build_research_agent():
    """Research phases only (plan+search+assess loop). Streaming synthesis is
    driven outside the graph by stream_research."""
    g = StateGraph(ResearchState)
    g.add_node("plan", plan_node)
    g.add_node("search", search_node)
    g.add_node("assess", assess_node)

    g.set_entry_point("plan")
    g.add_edge("plan", "search")
    g.add_edge("search", "assess")
    g.add_conditional_edges(
        "assess",
        route_after_assess_research_only,
        {"search": "search", "done": END},
    )

    return g.compile()


# Backwards-compatible alias.
def build_agent():
    return build_full_agent()


# --------------------------------------------------------------------------
# Convenience run
# --------------------------------------------------------------------------
def run_research(question: str, template: str = DEFAULT_TEMPLATE) -> Dict[str, Any]:
    config.validate()
    run_id = telemetry.start_run(question, mode="langgraph")
    try:
        agent = build_full_agent()
        result = agent.invoke(_initial_state(question, template))
        telemetry.end_run(
            "success",
            report_chars=len(result.get("report", "")),
            source_count=len(result.get("sources", [])),
            **telemetry.pop_usage(run_id),
        )
        return result
    except Exception as exc:  # noqa: BLE001
        telemetry.end_run("error", error=str(exc)[:200])
        raise


def stream_research(
    question: str, template: str = DEFAULT_TEMPLATE
) -> Generator[Dict[str, Any], None, None]:
    """Yield SSE-shaped updates:
      - {"steps": [...]}                new step lines
      - {"sources": [...]}              source list snapshot
      - {"report_delta": "chunk"}       token(s) as synthesis streams
      - {"report": "..."}               final report
      - {"diagram": "..."}, {"followups": [...]}, {"suggested_tags": [...]}, {"metrics": {...}}
    """
    config.validate()
    run_id = telemetry.start_run(question, mode="langgraph")

    state: Dict[str, Any] = dict(_initial_state(question, template))

    # ------- Phase 1: research (plan+search+assess) via LangGraph -------
    research_agent = build_research_agent()
    previous_steps = 0
    for update in research_agent.stream(cast(ResearchState, state), stream_mode="updates"):
        node_update = next(iter(update.values()), {})
        for k, v in node_update.items():
            state[k] = v
        steps = node_update.get("steps", [])
        new_steps = steps[previous_steps:] if steps else []
        if steps:
            previous_steps = len(steps)
        payload: Dict[str, Any] = {}
        if new_steps:
            payload["steps"] = new_steps
        if node_update.get("sources"):
            payload["sources"] = node_update["sources"]
        if payload:
            yield payload

    # ------- Phase 2: streaming synthesis -------
    sources = state.get("sources", []) or []
    if not sources:
        report = (
            "## No sources found\n\n"
            "The agent could not retrieve any sources. Check your Tavily key "
            "and network connection, then try again."
        )
        state["report"] = report
        yield {"steps": ["No sources to synthesize."], "report": report}
    else:
        template_key = state.get("template") or DEFAULT_TEMPLATE
        yield {"steps": [f"Streaming synthesis (template: {template_key})…"]}
        prompt = _build_synthesis_prompt(state)  # type: ignore[arg-type]
        parts: List[str] = []
        try:
            for chunk in _llm(temperature=0.2).stream(prompt):
                delta = _content(chunk)
                if delta:
                    parts.append(delta)
                    yield {"report_delta": delta}
        except Exception as exc:  # noqa: BLE001
            # Fallback to a blocking call if streaming fails mid-flight.
            if not parts:
                try:
                    full = _content(_llm(temperature=0.2).invoke(prompt)).strip()
                    parts = [full]
                    yield {"report_delta": full}
                except Exception as exc2:  # noqa: BLE001
                    # Every model was exhausted. Degrade gracefully: emit a
                    # source-only report so the run isn't a total loss.
                    salvage = _salvage_report(state["question"], sources, exc2)
                    yield {"report_delta": salvage}
                    yield {
                        "steps": [
                            "All models failed. Emitted a source-only report; "
                            "retry after the rate window resets."
                        ],
                        "report": salvage,
                    }
                    return
            else:
                yield {"steps": [f"Streaming ended early ({exc.__class__.__name__}); using partial."]}
        report = "".join(parts).strip()
        state["report"] = report
        yield {
            "steps": [
                f"Synthesized {len(report)} chars from {len(sources)} "
                f"sources over {state['round']} round(s)."
            ],
            "report": report,
        }

    # ------- Phase 3: enrichment (diagram + follow-ups + tags + metrics) -------
    enrich_update = enrich_node(state)  # type: ignore[arg-type]
    all_steps = enrich_update.get("steps", [])
    new_enrich_steps = all_steps[previous_steps:] if all_steps else []
    for k, v in enrich_update.items():
        state[k] = v

    tail_payload: Dict[str, Any] = {}
    if new_enrich_steps:
        tail_payload["steps"] = new_enrich_steps
    for key in ("diagram", "followups", "suggested_tags", "metrics"):
        if enrich_update.get(key):
            tail_payload[key] = enrich_update[key]
    if tail_payload:
        yield tail_payload

    telemetry.end_run(
        "success",
        report_chars=len(state.get("report", "")),
        source_count=len(state.get("sources", [])),
        **telemetry.pop_usage(run_id),
    )


def _initial_state(question: str, template: str) -> ResearchState:
    return {
        "question": question,
        "template": template if template in TEMPLATES else DEFAULT_TEMPLATE,
        "subquestions": [], "pending_queries": [], "sources": [],
        "seen_urls": [], "round": 0, "gaps": "", "report": "",
        "diagram": "", "followups": [], "suggested_tags": [],
        "metrics": {}, "steps": [], "started_at": time.time(),
    }


if __name__ == "__main__":
    import sys
    q = " ".join(sys.argv[1:]) or "What are the main risks facing the EV battery industry in 2026?"
    result = run_research(q)
    print("\n".join(result["steps"]))
    print("\n" + "=" * 70 + "\n")
    print(result["report"])
    if result.get("diagram"):
        print("\n" + "=" * 70 + "\nMERMAID:\n")
        print(result["diagram"])
    if result.get("followups"):
        print("\n" + "=" * 70 + "\nFOLLOW-UPS:\n")
        for f in result["followups"]:
            print(" - " + f)
