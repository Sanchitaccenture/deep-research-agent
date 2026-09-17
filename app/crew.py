"""
Multi-agent research crew — CrewAI-style, but implemented natively on
LangChain + Groq so it doesn't need the `crewai` package (which caps at
Python 3.13 as of 2026-09).

The design mirrors CrewAI's mental model:

  Agent  = (role, goal, backstory, llm) -> executes prompted tasks
  Task   = (description, agent, context) -> a unit of work
  Crew   = sequential pipeline over tasks, each task sees earlier outputs

Pipeline (sequential):

  Planner       -> decompose question into sub-questions
  Web Researcher -> Tavily search for each sub-question, collect sources
  Doc Analyst    -> semantic search over uploaded documents (if RAG on)
  Critic         -> review evidence, name gaps and must-cover angles
  Writer         -> produce structured markdown report with numbered citations

`run_crew` returns {report, sources, steps}; `stream_crew` yields updates
as each agent completes, matching the same SSE contract as the LangGraph
mode so the frontend needs no changes.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, Generator, List, Optional

from langchain_groq import ChatGroq
from tavily import TavilyClient

from app import telemetry
from app.config import config


# --------------------------------------------------------------------------
# LLM helper — same fallback chain as LangGraph mode
# --------------------------------------------------------------------------
def _llm(temperature: float = 0.2) -> Any:
    candidates = []
    configured = (config.CREW_MODEL or config.GROQ_MODEL or "").strip()
    if configured:
        candidates.append(configured)
    candidates.extend([
        "groq/compound-mini",
        "openai/gpt-oss-20b",
        "qwen/qwen3.6-27b",
    ])
    seen: set = set()
    for name in candidates:
        if not name or name in seen:
            continue
        seen.add(name)
        try:
            client = ChatGroq(
                api_key=config.GROQ_API_KEY,
                model=name,
                temperature=temperature,
            )
            return client.with_config({"callbacks": telemetry.callbacks()})
        except Exception:
            continue
    return ChatGroq(
        api_key=config.GROQ_API_KEY,
        model="groq/compound-mini",
        temperature=temperature,
    ).with_config({"callbacks": telemetry.callbacks()})


def _content(msg) -> str:
    raw = getattr(msg, "content", msg)
    if isinstance(raw, list):
        return "".join(str(x) for x in raw)
    return str(raw or "")


# --------------------------------------------------------------------------
# Agent + Task primitives
# --------------------------------------------------------------------------
@dataclass
class Agent:
    role: str
    goal: str
    backstory: str
    temperature: float = 0.2

    def system_prompt(self) -> str:
        return (
            f"You are a {self.role}.\n"
            f"Goal: {self.goal}\n"
            f"Background: {self.backstory}\n"
            "Follow the task instructions precisely. Never fabricate facts. "
            "When asked for JSON, return ONLY the JSON — no prose, no fences."
        )

    def execute(self, task_description: str, context_blocks: List[str]) -> str:
        parts = [self.system_prompt(), "", "TASK:", task_description]
        if context_blocks:
            parts.append("\nPREVIOUS AGENT OUTPUTS (in order):")
            for i, ctx in enumerate(context_blocks, 1):
                parts.append(f"\n--- context {i} ---\n{ctx}")
        prompt = "\n".join(parts)
        return _content(_llm(self.temperature).invoke(prompt)).strip()


@dataclass
class Task:
    description: str
    agent: Agent
    context: List["Task"] = field(default_factory=list)
    output: str = ""


@dataclass
class TaskResult:
    role: str
    output: str


# --------------------------------------------------------------------------
# Deterministic tools (used by web + doc research directly — no LLM tool-calling)
# --------------------------------------------------------------------------
def _tavily_search(query: str) -> List[Dict[str, Any]]:
    try:
        client = TavilyClient(api_key=config.TAVILY_API_KEY)
        resp = client.search(
            query=query,
            max_results=config.RESULTS_PER_SEARCH,
            search_depth="advanced",
        )
    except Exception as exc:  # noqa: BLE001
        telemetry.emit("crew.tavily_failed", level="warning", error=str(exc))
        return []
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


def _document_search(query: str) -> List[Dict[str, Any]]:
    if not config.ENABLE_RAG:
        return []
    try:
        from app import rag as rag_mod
        hits = rag_mod.query_documents(query, top_k=config.RAG_TOP_K)
    except Exception as exc:  # noqa: BLE001
        telemetry.emit("crew.rag_failed", level="warning", error=str(exc))
        return []
    return [
        {
            "title": h.get("title", "document"),
            "url": h.get("url", ""),
            "content": (h.get("content", "") or "")[:1200],
            "query": query,
            "source_type": "document",
            "score": h.get("score"),
        }
        for h in hits
    ]


# --------------------------------------------------------------------------
# Agents
# --------------------------------------------------------------------------
def _build_agents() -> Dict[str, Agent]:
    return {
        "planner": Agent(
            role="Research Planner",
            goal=(
                "Decompose complex user questions into a small set of focused, "
                "non-overlapping sub-questions that together fully cover the topic."
            ),
            backstory=(
                "You are a meticulous research strategist. You spot unstated "
                "assumptions and produce a crisp, orthogonal question set."
            ),
            temperature=0.3,
        ),
        "web_researcher": Agent(
            role="Web Researcher",
            goal=(
                "Interpret raw web search results, extract the most relevant and "
                "credible snippets, and normalise them into a clean source list."
            ),
            backstory=(
                "You are a professional OSINT researcher who prefers primary "
                "sources and never invents facts."
            ),
        ),
        "doc_analyst": Agent(
            role="Document Analyst",
            goal=(
                "Review the user's uploaded documents for supporting or "
                "contradicting evidence."
            ),
            backstory=(
                "You are an archivist who knows a private knowledge base end to end."
            ),
        ),
        "critic": Agent(
            role="Research Critic",
            goal=(
                "Review the collected evidence, name gaps and contradictions, "
                "and propose the angles the writer must cover."
            ),
            backstory=(
                "You are a rigorous editor who tears drafts apart before they ship."
            ),
        ),
        "writer": Agent(
            role="Report Writer",
            goal=(
                "Turn the collected evidence into a clean, structured markdown "
                "report with numbered inline citations and a sources list."
            ),
            backstory=(
                "You are a senior analyst who writes for busy executives. "
                "You favour clarity, structure, and traceable citations."
            ),
        ),
    }


# --------------------------------------------------------------------------
# Parsers
# --------------------------------------------------------------------------
def _parse_json_list(raw: str) -> List[str]:
    txt = (raw or "").strip()
    if txt.startswith("```"):
        parts = txt.split("```")
        if len(parts) >= 2:
            body = parts[1]
            if body.lstrip().lower().startswith("json"):
                body = body.lstrip()[4:]
            txt = body.strip()
    try:
        data = json.loads(txt)
        if isinstance(data, list):
            return [str(x) for x in data if str(x).strip()]
    except json.JSONDecodeError:
        pass
    lines = [l.strip("-* \t") for l in txt.splitlines() if l.strip()]
    return [l for l in lines if len(l) > 5]


# --------------------------------------------------------------------------
# Public: run_crew (blocking) — used by /api/crew/research
# --------------------------------------------------------------------------
def run_crew(question: str) -> Dict[str, Any]:
    """Blocking crew run. Returns {report, sources, steps}."""
    config.validate()
    run_id = telemetry.start_run(question, mode="crew")
    steps: List[str] = []
    all_sources: List[Dict[str, Any]] = []
    seen_urls: set = set()

    try:
        agents = _build_agents()

        # -------- 1. Planner --------
        telemetry.set_node("planner")
        steps.append("Planner: decomposing the question…")
        plan_raw = agents["planner"].execute(
            task_description=(
                f"Question: {question}\n\n"
                f"Return ONLY a JSON array of {config.MAX_SUBQUESTIONS} focused, "
                "non-overlapping sub-questions."
            ),
            context_blocks=[],
        )
        sub_questions = _parse_json_list(plan_raw)[: config.MAX_SUBQUESTIONS] or [question]
        steps.append(f"Planner: {len(sub_questions)} sub-question(s):")
        for s in sub_questions:
            steps.append(f"   - {s}")

        # -------- 2. Web Researcher (deterministic tool + LLM commentary) --------
        telemetry.set_node("web_researcher")
        steps.append("Web Researcher: running Tavily searches…")
        raw_web: List[Dict[str, Any]] = []
        for sq in sub_questions:
            hits = _tavily_search(sq)
            added = 0
            for h in hits:
                if h["url"] and h["url"] in seen_urls:
                    continue
                seen_urls.add(h["url"])
                raw_web.append(h)
                added += 1
            steps.append(f"   +{added} web sources for: {sq}")
        # Ask the researcher to briefly comment on what was found (for the critic).
        web_note = ""
        if raw_web:
            web_note = agents["web_researcher"].execute(
                task_description=(
                    "In under 120 words, summarise what these web snippets tell us "
                    "and where evidence looks strongest or weakest. Do not invent facts."
                ),
                context_blocks=[
                    "Sub-questions:\n" + "\n".join(f"- {s}" for s in sub_questions),
                    "Web snippets (JSON):\n" + json.dumps(raw_web[:12], ensure_ascii=False)[:3000],
                ],
            )

        # -------- 3. Document Analyst --------
        telemetry.set_node("doc_analyst")
        raw_docs: List[Dict[str, Any]] = []
        if config.ENABLE_RAG:
            steps.append("Document Analyst: querying uploaded documents…")
            for sq in sub_questions:
                hits = _document_search(sq)
                added = 0
                for h in hits:
                    if h["url"] and h["url"] in seen_urls:
                        continue
                    seen_urls.add(h["url"])
                    raw_docs.append(h)
                    added += 1
                if added:
                    steps.append(f"   +{added} doc chunks for: {sq}")
        else:
            steps.append("Document Analyst: RAG is disabled, skipping.")

        # Assign source ids after both collectors finish.
        for i, s in enumerate(raw_web + raw_docs, start=1):
            s["id"] = i
        all_sources = raw_web + raw_docs
        steps.append(f"Collected {len(raw_web)} web + {len(raw_docs)} doc sources.")

        # -------- 4. Critic --------
        telemetry.set_node("critic")
        steps.append("Critic: reviewing evidence and naming gaps…")
        critique = agents["critic"].execute(
            task_description=(
                "Write 4-6 short bullets: which claims are best supported, "
                "which gaps remain, and what angles the writer must cover in "
                "the final report."
            ),
            context_blocks=[
                f"Original question: {question}",
                "Sub-questions:\n" + "\n".join(f"- {s}" for s in sub_questions),
                "Web researcher's note:\n" + (web_note or "(none)"),
                "Numbered sources (JSON):\n" + _numbered_sources_block(all_sources),
            ],
        )
        steps.append("Critic: critique ready.")

        # -------- 5. Writer --------
        telemetry.set_node("writer")
        steps.append("Writer: composing the final report…")
        report = agents["writer"].execute(
            task_description=(
                f"Write the final report answering: {question}\n\n"
                "Rules:\n"
                "- Use markdown: ## Overview, ### per-theme sections, ## Key Findings.\n"
                "- Cite every factual claim inline as [n] matching the numbered sources.\n"
                "- End with ## Sources — a numbered list of title + URL.\n"
                "- Use ONLY facts from the numbered sources; if something isn't there, say so.\n"
                "- Consider the critic's feedback and cover the angles they named."
            ),
            context_blocks=[
                "Critic's feedback:\n" + critique,
                "Numbered sources:\n" + _numbered_sources_block(all_sources),
            ],
        )
        steps.append(f"Writer: {len(report)} chars produced.")

        telemetry.end_run(
            "success",
            report_chars=len(report),
            source_count=len(all_sources),
            **telemetry.pop_usage(run_id),
        )
        return {"report": report.strip(), "sources": all_sources, "steps": steps}

    except Exception as exc:  # noqa: BLE001
        telemetry.end_run("error", error=str(exc)[:200])
        steps.append(f"Crew failed: {exc.__class__.__name__}: {exc}")
        return {
            "report": f"## Crew failed\n\nThe crew could not complete: `{exc}`",
            "sources": all_sources,
            "steps": steps,
        }


def _numbered_sources_block(sources: List[Dict[str, Any]]) -> str:
    return "\n\n".join(
        f"[{s['id']}] ({s.get('source_type','web')}) {s.get('title','')} "
        f"({s.get('url','')})\n{(s.get('content','') or '')[:1000]}"
        for s in sources
    ) or "(no sources)"


# --------------------------------------------------------------------------
# Public: stream_crew — SSE-shaped generator used by /api/crew/stream
# --------------------------------------------------------------------------
def stream_crew(question: str) -> Generator[Dict[str, Any], None, None]:
    """
    Stream one crew run agent-by-agent. This is a real handoff pipeline —
    we run each agent to completion, then emit its output as an SSE-shaped
    update before starting the next.
    """
    config.validate()
    run_id = telemetry.start_run(question, mode="crew")
    yield {"steps": ["Crew: assembling planner, web researcher, doc analyst, critic, writer"]}

    all_sources: List[Dict[str, Any]] = []
    seen_urls: set = set()

    try:
        agents = _build_agents()

        # ---- Planner ----
        telemetry.set_node("planner")
        yield {"steps": ["Planner: decomposing the question…"]}
        plan_raw = agents["planner"].execute(
            task_description=(
                f"Question: {question}\n\n"
                f"Return ONLY a JSON array of {config.MAX_SUBQUESTIONS} focused, "
                "non-overlapping sub-questions."
            ),
            context_blocks=[],
        )
        sub_questions = _parse_json_list(plan_raw)[: config.MAX_SUBQUESTIONS] or [question]
        yield {"steps": [f"Planner: {len(sub_questions)} sub-question(s)"] + [f"   - {s}" for s in sub_questions]}

        # ---- Web Researcher ----
        telemetry.set_node("web_researcher")
        yield {"steps": ["Web Researcher: running Tavily searches…"]}
        raw_web: List[Dict[str, Any]] = []
        for sq in sub_questions:
            hits = _tavily_search(sq)
            added = 0
            for h in hits:
                if h["url"] and h["url"] in seen_urls:
                    continue
                seen_urls.add(h["url"])
                raw_web.append(h)
                added += 1
            yield {"steps": [f"   +{added} web sources for: {sq}"]}

        web_note = ""
        if raw_web:
            web_note = agents["web_researcher"].execute(
                task_description=(
                    "In under 120 words, summarise what these web snippets tell us "
                    "and where evidence looks strongest or weakest. Do not invent facts."
                ),
                context_blocks=[
                    "Sub-questions:\n" + "\n".join(f"- {s}" for s in sub_questions),
                    "Web snippets (JSON):\n" + json.dumps(raw_web[:12], ensure_ascii=False)[:3000],
                ],
            )
            yield {"steps": ["Web Researcher: summary drafted."]}

        # ---- Doc Analyst ----
        telemetry.set_node("doc_analyst")
        raw_docs: List[Dict[str, Any]] = []
        if config.ENABLE_RAG:
            yield {"steps": ["Document Analyst: querying uploaded documents…"]}
            for sq in sub_questions:
                hits = _document_search(sq)
                added = 0
                for h in hits:
                    if h["url"] and h["url"] in seen_urls:
                        continue
                    seen_urls.add(h["url"])
                    raw_docs.append(h)
                    added += 1
                if added:
                    yield {"steps": [f"   +{added} doc chunks for: {sq}"]}
        else:
            yield {"steps": ["Document Analyst: RAG is disabled, skipping."]}

        # Assign ids + stream sources snapshot
        for i, s in enumerate(raw_web + raw_docs, start=1):
            s["id"] = i
        all_sources = raw_web + raw_docs
        yield {
            "sources": all_sources,
            "steps": [f"Collected {len(raw_web)} web + {len(raw_docs)} doc sources."],
        }

        # ---- Critic ----
        telemetry.set_node("critic")
        yield {"steps": ["Critic: reviewing evidence and naming gaps…"]}
        critique = agents["critic"].execute(
            task_description=(
                "Write 4-6 short bullets: which claims are best supported, "
                "which gaps remain, and what angles the writer must cover in "
                "the final report."
            ),
            context_blocks=[
                f"Original question: {question}",
                "Sub-questions:\n" + "\n".join(f"- {s}" for s in sub_questions),
                "Web researcher's note:\n" + (web_note or "(none)"),
                "Numbered sources (JSON):\n" + _numbered_sources_block(all_sources),
            ],
        )
        yield {"steps": ["Critic: critique ready."]}

        # ---- Writer (streamed) ----
        telemetry.set_node("writer")
        yield {"steps": ["Writer: composing the final report…"]}
        writer_system = agents["writer"].system_prompt()
        writer_task = (
            f"Write the final report answering: {question}\n\n"
            "Rules:\n"
            "- Use markdown: ## Overview, ### per-theme sections, ## Key Findings.\n"
            "- Cite every factual claim inline as [n] matching the numbered sources.\n"
            "- End with ## Sources — a numbered list of title + URL.\n"
            "- Use ONLY facts from the numbered sources; if something isn't there, say so.\n"
            "- Consider the critic's feedback and cover the angles they named."
        )
        writer_prompt = "\n\n".join([
            writer_system,
            "TASK:\n" + writer_task,
            "PREVIOUS AGENT OUTPUTS:",
            "--- context 1 (critic) ---\n" + critique,
            "--- context 2 (sources) ---\n" + _numbered_sources_block(all_sources),
        ])

        parts: List[str] = []
        try:
            for chunk in _llm(0.2).stream(writer_prompt):
                delta = _content(chunk)
                if delta:
                    parts.append(delta)
                    yield {"report_delta": delta}
        except Exception as exc:  # noqa: BLE001
            # Fallback: blocking invoke
            report = _content(_llm(0.2).invoke(writer_prompt)).strip()
            yield {"report_delta": report}
            parts = [report]

        report = "".join(parts).strip()
        yield {
            "report": report,
            "steps": [f"Writer: {len(report)} chars produced."],
        }

        telemetry.end_run(
            "success",
            report_chars=len(report),
            source_count=len(all_sources),
            **telemetry.pop_usage(run_id),
        )

    except Exception as exc:  # noqa: BLE001
        telemetry.end_run("error", error=str(exc)[:200])
        yield {"steps": [f"Crew failed: {exc.__class__.__name__}: {exc}"]}
        yield {
            "report": f"## Crew failed\n\nThe crew could not complete: `{exc}`",
            "sources": all_sources,
        }
