"""
Eval harness for the Deep Research Agent.

Runs the agent against `questions.yaml`, then uses an LLM judge to score
each report on five rubrics:

  - coverage     (0-5): how many expected topics were covered
  - citations    (0-5): are claims tied to numbered sources?
  - groundedness (0-5): does the report avoid inventing facts?
  - clarity      (0-5): well-structured, right length for the template?
  - honesty      (0-5): flags gaps + open questions rather than bluffing

Also captures the ground-truth stats we track: latency, source count,
input/output tokens, USD cost. Writes a single `evals/report_<ts>.json`
and prints a compact table to stdout.

Usage:
  .\.venv\Scripts\python.exe -m evals.run_eval
  .\.venv\Scripts\python.exe -m evals.run_eval --ids rag-basics,mcp-security
  .\.venv\Scripts\python.exe -m evals.run_eval --limit 2
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import yaml

from app import telemetry
from app.agent import DEFAULT_TEMPLATE, TEMPLATES, run_research, _llm, _content


ROOT = Path(__file__).parent
QUESTIONS = ROOT / "questions.yaml"


# --------------------------------------------------------------------------
# Judge
# --------------------------------------------------------------------------
JUDGE_PROMPT = """You are a research report evaluator. Score the report on
each rubric using integers 0-5. Also flag whether it follows the "must_not"
constraints (1 = respected, 0 = violated).

Rubrics (0 poor -> 5 excellent):
- coverage: covers all expected topics
- citations: every factual claim uses a numbered [n] citation
- groundedness: no fabricated facts beyond the numbered sources
- clarity: right template shape, correct length, well-structured
- honesty: acknowledges gaps and open questions instead of bluffing

Return ONLY a compact JSON object of the form:
{
  "coverage": int, "citations": int, "groundedness": int,
  "clarity": int, "honesty": int,
  "must_not_ok": int,
  "comment": "one-sentence summary of biggest weakness"
}

QUESTION:
{question}

TEMPLATE:
{template}

EXPECTED TOPICS:
{expected}

MUST NOT:
{must_not}

REPORT:
{report}

NUMBERED SOURCES:
{sources}
"""


def _judge(question_meta: Dict[str, Any], result: Dict[str, Any]) -> Dict[str, Any]:
    sources_block = "\n".join(
        f"[{s['id']}] {s.get('title', '')} — {s.get('url', '')}"
        for s in result.get("sources", [])
    ) or "(no sources)"

    prompt = JUDGE_PROMPT.format(
        question=question_meta["question"],
        template=question_meta.get("template", DEFAULT_TEMPLATE),
        expected="\n".join(f"- {t}" for t in question_meta.get("expected_topics", [])),
        must_not="\n".join(f"- {t}" for t in question_meta.get("must_not", [])) or "(none)",
        report=(result.get("report") or "")[:8000],
        sources=sources_block,
    )
    raw = _content(_llm(temperature=0.0).invoke(prompt))
    return _safe_json(raw)


def _safe_json(raw: str) -> Dict[str, Any]:
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        if len(parts) >= 2:
            body = parts[1]
            if body.lstrip().lower().startswith("json"):
                body = body.lstrip()[4:]
            raw = body
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    return {
        "coverage": 0, "citations": 0, "groundedness": 0,
        "clarity": 0, "honesty": 0, "must_not_ok": 0,
        "comment": "judge output could not be parsed",
    }


# --------------------------------------------------------------------------
# Aggregator
# --------------------------------------------------------------------------
RUBRICS = ("coverage", "citations", "groundedness", "clarity", "honesty")


def _score(judge: Dict[str, Any]) -> float:
    return sum(int(judge.get(r, 0)) for r in RUBRICS) / (5 * len(RUBRICS))


def _load_questions() -> List[Dict[str, Any]]:
    with QUESTIONS.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or []


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------
def run(ids: List[str] | None = None, limit: int | None = None) -> Dict[str, Any]:
    items = _load_questions()
    if ids:
        wanted = set(ids)
        items = [q for q in items if q["id"] in wanted]
    if limit:
        items = items[:limit]

    rows: List[Dict[str, Any]] = []
    for i, q in enumerate(items, 1):
        print(f"\n[{i}/{len(items)}] {q['id']}: {q['question']}", flush=True)
        t0 = time.time()
        try:
            template = q.get("template", DEFAULT_TEMPLATE)
            if template not in TEMPLATES:
                template = DEFAULT_TEMPLATE
            result = run_research(q["question"], template=template)
        except Exception as exc:  # noqa: BLE001
            print(f"   -> agent failed: {exc}", flush=True)
            rows.append({
                "id": q["id"], "status": "agent_error", "error": str(exc)[:200],
            })
            continue

        duration = round(time.time() - t0, 2)
        metrics = result.get("metrics") or {}
        source_count = len(result.get("sources", []))
        min_sources = int(q.get("min_sources", 0))

        judge = _judge(q, result)
        overall = _score(judge)

        row = {
            "id": q["id"],
            "category": q.get("category"),
            "template": q.get("template", DEFAULT_TEMPLATE),
            "status": "ok",
            "duration_seconds": duration,
            "source_count": source_count,
            "sources_ok": source_count >= min_sources,
            "input_tokens": metrics.get("input_tokens", 0),
            "output_tokens": metrics.get("output_tokens", 0),
            "cost_usd": metrics.get("cost_usd", 0.0),
            "llm_calls": metrics.get("llm_calls", 0),
            "judge": judge,
            "overall_score": round(overall, 3),
        }
        rows.append(row)
        print(
            f"   -> {duration}s · {source_count} sources · "
            f"score {row['overall_score']:.2f} · ${row['cost_usd']:.4f}",
            flush=True,
        )

    return _finalize(rows)


def _finalize(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    ok = [r for r in rows if r["status"] == "ok"]
    scores = [r["overall_score"] for r in ok]
    aggregate = {
        "runs": len(rows),
        "successful_runs": len(ok),
        "mean_score": round(statistics.mean(scores), 3) if scores else 0,
        "median_score": round(statistics.median(scores), 3) if scores else 0,
        "min_score": round(min(scores), 3) if scores else 0,
        "max_score": round(max(scores), 3) if scores else 0,
        "total_cost_usd": round(sum(r.get("cost_usd", 0.0) for r in ok), 4),
        "total_input_tokens": sum(r.get("input_tokens", 0) for r in ok),
        "total_output_tokens": sum(r.get("output_tokens", 0) for r in ok),
        "mean_duration_seconds": round(
            statistics.mean(r["duration_seconds"] for r in ok), 2
        ) if ok else 0,
        "sources_ok_rate": (
            round(sum(1 for r in ok if r["sources_ok"]) / len(ok), 3) if ok else 0
        ),
    }
    per_rubric = {
        r: round(
            statistics.mean(int(row["judge"].get(r, 0)) for row in ok), 2
        ) if ok else 0
        for r in RUBRICS
    }

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "aggregate": aggregate,
        "rubric_means": per_rubric,
        "rows": rows,
    }

    out = ROOT / f"report_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("\n" + "=" * 70)
    print(f"Wrote {out.relative_to(ROOT.parent)}")
    _print_table(rows, aggregate, per_rubric)
    return report


def _print_table(rows, aggregate, per_rubric):
    print("\nPer-run:")
    print(f"  {'id':22} {'score':>5}  {'src':>4}  {'sec':>5}  {'tokens':>8}  {'cost':>7}")
    for r in rows:
        if r["status"] != "ok":
            print(f"  {r['id']:22} FAILED  ({r.get('error','')})")
            continue
        tok = int(r.get("input_tokens", 0)) + int(r.get("output_tokens", 0))
        print(
            f"  {r['id']:22} {r['overall_score']:>5.2f}  {r['source_count']:>4}"
            f"  {r['duration_seconds']:>5.1f}  {tok:>8}  ${r['cost_usd']:>6.4f}"
        )

    print("\nRubric means (out of 5):")
    for k, v in per_rubric.items():
        bar = "█" * int(v) + "░" * (5 - int(v))
        print(f"  {k:14} {v:>4.2f}  {bar}")

    print("\nAggregate:")
    for k, v in aggregate.items():
        print(f"  {k:24} {v}")


def main():
    parser = argparse.ArgumentParser(description="Run agent evals.")
    parser.add_argument("--ids", help="comma-separated question ids to run")
    parser.add_argument("--limit", type=int, help="run at most N questions")
    args = parser.parse_args()
    ids = args.ids.split(",") if args.ids else None
    run(ids=ids, limit=args.limit)


if __name__ == "__main__":
    main()
