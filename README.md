# 🔎 Deep Research Agent

[![CI](https://github.com/Sanchitaccenture/deep-research-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Sanchitaccenture/deep-research-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/python-3.12+-3776ab.svg)](https://www.python.org/)
[![React 18](https://img.shields.io/badge/react-18-61dafb.svg)](https://react.dev/)
[![tests: 55 passing](https://img.shields.io/badge/tests-55%20passing-brightgreen.svg)](tests/)

> 🎥 **[Watch the 90-second demo →](https://YOUR_LOOM_URL)** &nbsp;·&nbsp;
> 🌐 **[Try it live →](https://YOUR_VERCEL_URL)** &nbsp;·&nbsp;
> 🚀 **[Deploy guide →](DEPLOY.md)** &nbsp;·&nbsp;
> 📐 **[Architecture →](ARCHITECTURE.md)**



An autonomous AI research assistant that behaves like a human analyst:
it **plans** sub-questions, **searches** the web AND your uploaded documents,
**critiques** its own coverage, and **synthesizes** a structured, source-cited
report — all streamed live to a modern React UI.

Built with **LangGraph · CrewAI · LangChain · ChromaDB (RAG) · Groq · Tavily
· FastAPI · React 18 · TypeScript · TailwindCSS · Vite**.

---

## What's inside

Two independent research pipelines you can toggle between per query:

### 1. LangGraph pipeline (deterministic loop)

```
question ─▶ PLAN ─▶ SEARCH (web + RAG) ─▶ ASSESS ──(gaps left)──▶ SEARCH  (loop)
                                             │
                                             └──(satisfied)──▶ SYNTHESIZE ─▶ cited report
```

- **Plan** — decompose the question into focused sub-questions.
- **Search** — Tavily web search + semantic search over your uploaded documents.
- **Assess** — judge coverage, name gaps, generate new follow-up queries.
- **Synthesize** — write a structured, numbered-citation report.

A round budget (`MAX_ROUNDS`) guarantees termination.

### 2. CrewAI pipeline (specialist multi-agent crew)

```
Planner ─▶ Web Researcher ─▶ Doc Analyst ─▶ Critic ─▶ Writer
```

Five specialist agents, each with its own role, backstory, and tool set,
collaborating on a shared research task. Use it when you want visible
role-play + evidence critique.

---

> **📐 Architecture, design decisions & trade-offs → [ARCHITECTURE.md](ARCHITECTURE.md)**
> **🧪 Tests → `pytest`**   |   **📊 Evals → [evals/](evals/)**

## Features

### AI pipelines
- 🧠 **Two research modes** — LangGraph loop or CrewAI crew, toggled per query
- 📝 **Five report templates** — Standard, Executive one-pager, Deep Dive with
  tables, Pros / Cons + Verdict, and a chronological Timeline
- 📚 **RAG over your own docs** — upload PDF / TXT / MD, ChromaDB + local
  sentence-transformer embeddings, results merged into the same report
- ✍️ **Token-by-token streaming synthesis** — the report writes itself in
  front of you with a live caret, no more blank-screen waits
- 🕸️ **Auto-generated mind maps** — every report ships with a Mermaid mindmap
  synthesised from the findings
- 💬 **Follow-up chat** — after the run, chat with the report; every answer is
  streamed token-by-token and grounded in the same numbered sources
- 💡 **Suggested next questions** — the agent proposes 3 concrete follow-ups
  so you can drill deeper with a click
- 🏷️ **Auto-tagging** — the LLM proposes 3 topical tags at the end of each
  run and applies them if the session has none, so search / filter is free

### Productivity & organisation
- ⌨️ **Command palette (⌘K)** — jump to any session, start a new run with a
  specific template, open dashboard or settings, all via fuzzy search
- 🎙️ **Voice input** — click the mic on the ask box, dashboard, chat, or
  refine bar to dictate your question (Web Speech API; Chrome / Edge)
- 🏠 **Home dashboard** — total runs, sources gathered, chat turns, activity
  chart for the last 14 days, mode/template breakdowns, popular tags, and
  recent + bookmarked sections
- 🔍 **Sidebar search & filters** — instant filter across your history by
  keyword, bookmark, presence of notes, or mode
- ⭐ **Bookmarks + #tags + notes** — star important runs, add hashtags for
  organisation, and keep autosaving personal notes on each session
- 🧭 **Related sessions widget** — after each run, see past research on
  similar questions (keyword + tag Jaccard similarity)
- ⏱️ **Keyboard shortcuts** — ⌘K / ⌘N / ⌘H / ⌘, / ⌘/ / ⌘-Enter / Esc

### Engineering rigour
- 🧪 **Full pytest suite** — mocked LLM + Tavily, isolated per-test data
  dirs; covers session store CRUD, every LangGraph node, and every FastAPI
  route via `TestClient`. Runs offline in <5s
- 📈 **LLM-as-judge evals** — `evals/` harness runs a fixed set of research
  questions against the real agent and scores each report on 5 rubrics
  (coverage / citations / groundedness / clarity / honesty)
- 📟 **Structured telemetry** — every LLM call is captured via a LangChain
  `BaseCallbackHandler` that reads `usage_metadata`, prices it against a
  per-model table, and aggregates per `run_id`. JSONL logs to
  `data/telemetry/YYYY-MM-DD.jsonl` for grep-ability
- 💰 **Real token & USD cost tracking** — surfaced in the metrics tile
  alongside duration and source counts, not just chars/4 estimation

### Operations & UX
- 📊 **Run metrics** — duration, sub-questions, rounds, web vs. doc sources,
  report size, reading time, **real token counts, and per-run USD cost**
- 🔴 **Live SSE streaming** — every plan / search / assess / enrich step
  streams in real time
- 🗂️ **Persistent sessions with shareable links** — every run and its chat
  thread are saved; `#/session/<id>` deep-links back to it
- 📎 **Citations that click** — inline `[n]` markers become links to the
  source, colour-coded by web vs. document; documents show a `D` prefix
- ⬇️ **Export** — copy, download as `.md` (with the mermaid diagram embedded),
  or share the deep-link
- 🎨 **Modern UI** — React 18 + TypeScript + Tailwind, glass surfaces, dark
  theme, animated transitions

---

## Setup

### 1. Get two free API keys

- **Groq** — https://console.groq.com/keys
- **Tavily** — https://app.tavily.com (free tier ~1000 searches/month)

### 2. Backend

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# open .env and paste your two keys
```

Run the API:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.api:app --reload --port 8000
```

### 3. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 . The Vite dev server proxies `/api` to FastAPI on
port 8000, so no CORS wrangling needed.

### 4. (Optional) Streamlit UI

The original Streamlit UI still works:

```powershell
streamlit run streamlit_app.py
```

---

## Tests & evals

```powershell
# Unit + API tests (offline; mocks LLM + Tavily)
.\.venv\Scripts\python.exe -m pytest

# End-to-end quality evals (hits real APIs, ~5-10 cents / full sweep)
.\.venv\Scripts\python.exe -m evals.run_eval
.\.venv\Scripts\python.exe -m evals.run_eval --ids rag-basics,mcp-security
```

See [evals/README.md](evals/README.md) for what each rubric measures and
how to add new questions.

Every research run also emits a structured telemetry line to
`data/telemetry/YYYY-MM-DD.jsonl`:

```json
{"ts":"2026-09-17T...","event":"llm.call","run_id":"a1b2...","node":"synthesize","model":"groq/compound-mini","input_tokens":1240,"output_tokens":812,"cost_usd":0.000368}
```

Grep-friendly, no external observability service required.

---

## Project structure

```
deep-research-agent/
├── app/
│   ├── config.py       # env-driven typed settings + directory bootstrap
│   ├── agent.py        # LangGraph pipeline (plan → search → assess → synthesize)
│   ├── crew.py         # CrewAI 5-agent crew (planner, web, docs, critic, writer)
│   ├── rag.py          # ChromaDB vector store + PDF/TXT ingestion
│   ├── session.py      # JSON-based session persistence
│   └── api.py          # FastAPI: research, crew, docs, sessions, SSE
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/  # Header, Sidebar, SearchPanel, ResearchStage,
│   │   │                # ReportView, SourcesPanel, StepsPanel, SettingsModal,
│   │   │                # ModeSelector
│   │   ├── hooks/useResearch.ts       # SSE client + streaming state machine
│   │   ├── lib/api.ts                 # typed API client
│   │   └── types.ts
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── streamlit_app.py    # (legacy) Streamlit UI
├── requirements.txt
├── .env.example
└── README.md
```

---

## API surface

| Method | Path                                       | Notes                                   |
|--------|--------------------------------------------|-----------------------------------------|
| GET    | `/api/status`                              | Features, models, doc/session counts    |
| GET    | `/api/templates`                           | Available report templates              |
| POST   | `/api/research`                            | Blocking LangGraph run (accepts template) |
| GET    | `/api/research/stream`                     | SSE stream of a LangGraph run           |
| POST   | `/api/crew/research`                       | Blocking CrewAI run                     |
| GET    | `/api/crew/stream`                         | SSE stream of a CrewAI run              |
| POST   | `/api/documents/upload`                    | Multipart upload → ChromaDB             |
| GET    | `/api/documents`                           | List indexed documents                  |
| DELETE | `/api/documents/{doc_id}`                  | Remove one document                     |
| DELETE | `/api/documents`                           | Wipe vector store                       |
| GET    | `/api/sessions`                            | List saved research sessions            |
| GET    | `/api/sessions/search?q=...`               | Full-text search across question/report/notes/tags |
| GET    | `/api/sessions/stats`                      | Aggregate dashboard stats               |
| GET    | `/api/sessions/{id}`                       | Load a full session                     |
| GET    | `/api/sessions/{id}/related`               | Related past sessions (similarity)      |
| PATCH  | `/api/sessions/{id}`                       | Update bookmarked / tags / notes        |
| DELETE | `/api/sessions/{id}`                       | Delete a session                        |
| POST   | `/api/sessions/{id}/chat`                  | Blocking follow-up chat over a session  |
| GET    | `/api/sessions/{id}/chat/stream`           | SSE stream of a follow-up chat answer   |
| DELETE | `/api/sessions/{id}/chat`                  | Clear a session's chat thread           |

Streams emit these event kinds (as SSE `data:` JSON): `step`, `sources`,
`report_delta`, `report`, `diagram`, `followups`, `suggested_tags`,
`metrics`, `done`, `error`. `report_delta` chunks arrive during synthesis
so the client can render the report token-by-token. Chat streams
additionally emit `user_turn`, `delta`, and `assistant_turn`.

The legacy `POST /research` and `GET /research/stream` endpoints are still
served for the existing Streamlit UI.

---

## Tuning (all in `.env`)

| Var                 | Default                                       | What it does                         |
|---------------------|-----------------------------------------------|--------------------------------------|
| `GROQ_MODEL`        | `groq/compound-mini`                          | LangGraph pipeline LLM               |
| `CREW_MODEL`        | `groq/llama-3.3-70b-versatile`                | CrewAI crew LLM                      |
| `MAX_SUBQUESTIONS`  | `4`                                           | Sub-questions per plan               |
| `RESULTS_PER_SEARCH`| `4`                                           | Tavily results per query             |
| `MAX_ROUNDS`        | `3`                                           | Hard cap on the assess/search loop   |
| `RAG_TOP_K`         | `4`                                           | Doc chunks retrieved per query       |
| `RAG_CHUNK_SIZE`    | `800`                                         | Characters per chunk                 |
| `EMBEDDING_MODEL`   | `sentence-transformers/all-MiniLM-L6-v2`      | Runs locally, no API key             |
| `ENABLE_RAG`        | `true`                                        | Toggle document search               |
| `ENABLE_CREW`       | `true`                                        | Toggle CrewAI mode                   |

---

## Notes

- The **first document upload** triggers a one-time download of the embedding
  model (~90 MB). Subsequent uploads are instant.
- CrewAI can be verbose — set `CREW_VERBOSE=true` in `.env` to see agent
  chatter in the FastAPI logs.
- Everything is persisted under `./data/` (Chroma index, session JSONs,
  uploaded originals). Delete the folder to wipe local state.
