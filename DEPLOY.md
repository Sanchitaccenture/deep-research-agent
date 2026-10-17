# Deploy — click-by-click guide

Target: **live URL in ~30 min**. Frontend and backend both on Vercel (two projects
from the same repo), CI on GitHub Actions.

Live backend: <https://deep-research-api-five.vercel.app>

---

## Prereq — push code to GitHub

Run these once in the project root:

```powershell
git init
git add .
git commit -m "Deep Research Agent v3.1 — initial commit"
git branch -M main
gh auth login   # or set remote manually with `git remote add origin <url>`
gh repo create Sanchitaccenture/deep-research-agent --public --source=. --remote=origin --push
```

(No `gh` CLI? Create the repo on GitHub.com, then `git remote add origin
https://github.com/Sanchitaccenture/deep-research-agent.git && git push -u origin main`.)

After the push, GitHub Actions will start running `pytest` and the frontend
build automatically. Wait for the green ✓.

---

## Backend on Vercel

The backend uses [index.py](index.py) as its entrypoint (it re-exports the FastAPI
`app` from `app/api.py`) and the slim [requirements.txt](requirements.txt). The heavy
RAG stack lives in `requirements-full.txt` and is not installed on Vercel.

1. Go to <https://vercel.com>, sign in with GitHub.
2. **Add New → Project → Import Sanchitaccenture/deep-research-agent**.
3. In the config screen:
   - **Name**: e.g. `deep-research-api`
   - **Root Directory**: repo root (leave empty)
   - Framework: Other / FastAPI (auto-detected)
4. Under **Environment Variables** add:

   ```
   GROQ_API_KEY=gsk_...            (from https://console.groq.com/keys)
   TAVILY_API_KEY=tvly-...          (from https://app.tavily.com)
   ```

   Nothing else is required. On Vercel, RAG and Crew default to off and data
   folders default to `/tmp/data`. Never paste keys into the code.

5. Click **Deploy**.
6. Smoke test: `https://<backend-domain>/health` → should return
   `{"status":"ok","checks":{...}}`.

---

## Frontend on Vercel

1. In **[frontend/vercel.json](frontend/vercel.json)** make sure both rewrite
   destinations use your backend domain (currently
   `https://deep-research-api-five.vercel.app`). Commit + push if you change it.
2. **Add New → Project → Import Sanchitaccenture/deep-research-agent** (a second project).
3. In the config screen:
   - **Root Directory**: `frontend`
   - Framework: Vite (auto-detected)
   - Build command: `npm run build` (auto)
   - Output: `dist` (auto)
4. Click **Deploy**. Wait ~1 min.
5. Copy the assigned URL — currently `https://deep-research-agent-henna.vercel.app`.

The browser calls `/api/*` on the frontend domain and Vercel rewrites it to the
backend, so no extra CORS setup is needed for the hosted demo. If you ever call the
backend origin directly, add the frontend URL to `ALLOWED_ORIGINS` on the backend project.

---

## Smoke test the live app

1. Open your frontend URL in a browser.
2. The dashboard should load, API status "live".
3. Ask a question — say *"What is retrieval augmented generation?"*.
4. Watch it stream tokens, generate a mind map, and finish in ~20 seconds.
5. Copy the URL — this is what goes on your resume.

---

## Hosted demo limitations

- **No document upload (RAG) and no Crew mode** — Vercel's 500 MB function limit
  rules out PyTorch / sentence-transformers / ChromaDB.
- **Session history is best-effort** — Vercel storage is temporary (`/tmp`, per
  instance), so a saved report or follow-up chat can occasionally come back "not found".
- **A single run must finish within 300 seconds** (Vercel Hobby limit).
- The in-memory rate limiter and cache are per instance.

For the full feature set, run with Docker (`requirements-full.txt`):
`docker compose up --build`.

---

## Optional but recommended

- **Custom domain**: Vercel → Settings → Domains, add `deep-research.yourdomain.com`.
- **Keep-warm**: an uptime monitor hitting `https://<backend-domain>/health` every 5 minutes.
- **90-second Loom demo**: [DEMO_SCRIPT.md](DEMO_SCRIPT.md) has the exact script.

---

## Common issues

| Symptom | Fix |
|---------|-----|
| Frontend shows API 404 | Check the rewrite destinations in `frontend/vercel.json` match your backend domain. |
| Frontend build fails with `ENOENT frontend/package.json` | Make sure `frontend/` is not listed in the root `.vercelignore` (both projects share this repo). |
| Frontend loads but "API live" chip is red | Backend is down. Check the backend project's Vercel → Deployments → Logs, and `/health`. |
| Report or follow-up chat "not found" | Sessions live in per-instance `/tmp`; re-run the research. Use Docker for persistent sessions. |
| `429 Too many requests` | You're spamming. Wait 60s or raise `RATE_LIMIT_PER_MINUTE` in the backend env vars. |
| Groq rate limit | Free tier daily quota is 100k tokens on the big models. Wait or set `GROQ_MODEL=llama-3.1-8b-instant` in the backend env vars (much higher quota). |

---

## Cost estimate

For portfolio/demo traffic (a few researches per day):

| Service | Cost |
|---------|------|
| Vercel (frontend + backend, Hobby plan) | Free for personal projects, no credit card |
| Groq API | Free tier: 100k tokens/day is enough for ~10 researches/day |
| Tavily search | Free tier: 1000 searches/month |
| **Total** | **$0/mo** |

---

## Rollback

Vercel keeps every deployment. If something breaks:

1. Vercel → the affected project → Deployments → find the previous green deployment.
2. Click ⋯ → Promote to Production (or Instant Rollback).
3. Live in seconds.
