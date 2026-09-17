# Evals

Small offline harness to measure the agent's quality on a fixed set of
research questions.

## What it measures

Runs the agent against every question in [`questions.yaml`](questions.yaml),
then asks an LLM judge to score the report on five rubrics (0–5 each):

| Rubric        | What "5" looks like                                          |
|---------------|--------------------------------------------------------------|
| coverage      | Every `expected_topic` is addressed                          |
| citations     | Every factual claim is tied to a numbered `[n]` source       |
| groundedness  | No claim goes beyond what the numbered sources actually say  |
| clarity       | Matches the template's shape and length                      |
| honesty       | Gaps and open questions are flagged, not bluffed             |

Alongside that it captures ground-truth stats: latency, source count,
input/output tokens, and USD cost (real numbers from the telemetry
callback, not the char/4 estimate).

## Run

```powershell
# All questions
.\.venv\Scripts\python.exe -m evals.run_eval

# Just a few
.\.venv\Scripts\python.exe -m evals.run_eval --ids rag-basics,mcp-security

# First N
.\.venv\Scripts\python.exe -m evals.run_eval --limit 2
```

Writes `evals/report_<timestamp>.json` and prints a table like:

```
Per-run:
  id                     score   src   sec    tokens     cost
  rag-basics              0.82     6   9.3     12420   $0.0089
  langgraph-vs-crewai     0.76     5   7.1      9880   $0.0071
  ...

Rubric means (out of 5):
  coverage        4.20   ████░
  citations       4.60   ████░
  groundedness    4.00   ████░
  clarity         4.40   ████░
  honesty         3.80   ███░░

Aggregate:
  mean_score               0.80
  sources_ok_rate          1.00
  total_cost_usd           0.043
  mean_duration_seconds    8.2
```

## Adding questions

Edit `questions.yaml`. Each row needs:

```yaml
- id: unique-slug
  question: The prompt sent to the agent.
  template: default          # or executive / deep_dive / pros_cons / timeline
  expected_topics:           # 3-6 topics a good report must cover
    - one
    - two
  must_not:                  # behaviours that would fail the run
    - fabricate specific dates
  min_sources: 3             # below this counts against sources_ok_rate
  category: concepts
```

Keep questions short-lived and factual so that live web search can
actually verify them. Avoid trivia (things Wikipedia obviates) and pure
opinion questions (nothing to ground against).

## Interpreting drops

If `groundedness` drops after a change, look at the failing reports'
`judge.comment` field. If `citations` drops, the synthesis prompt likely
regressed. If `sources_ok_rate` drops, the search / assess loop is
terminating too early.
