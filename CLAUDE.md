# Deep Research Agent

## Architecture

- `app/config.py` loads environment variables and exposes typed runtime settings.
- `app/agent.py` owns the LangGraph research graph: `plan -> search -> assess -> (search loop) -> synthesize`.
- `app/api.py` is the FastAPI transport layer. Keep API routes thin and delegate research behavior to the agent.
- `streamlit_app.py` is the existing Python UI.
- `frontend/` is the Vite + React portfolio UI and talks to FastAPI over HTTP/SSE.

## Research behavior

- Planning creates focused sub-questions.
- Search runs Tavily queries, deduplicates URLs, and records source metadata.
- Assessment either queues targeted follow-up queries or routes to synthesis.
- Synthesis produces markdown with numbered inline citations and a source list.
- The round budget in configuration must always guarantee termination.

## Conventions

- Keep graph nodes pure with respect to state: read the incoming state, perform their owned operation, and return state updates.
- Keep configuration tunables in `app/config.py` and document new environment variables in `.env.example`.
- Preserve graceful failure: API errors should be explicit, search failures should not crash the whole research run, and no-source runs should still produce a useful report.
- Keep FastAPI routes thin; streaming routes should emit incremental events and must not duplicate agent logic.
- Prefer small, readable modules and focused changes. Avoid observability or tracing frameworks.
- Do not expose API keys in logs, UI, source output, or client-side code.
- Frontend changes should remain responsive, accessible, and use the existing FastAPI API as the source of truth.
- Use plain CSS and native browser APIs unless a dependency provides clear value.

## Development commands

Backend:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.api:app --reload --port 8000
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

The Vite dev server runs on port 5173 and proxies `/api` requests to FastAPI on port 8000.
