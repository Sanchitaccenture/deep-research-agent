# Deploy — click-by-click guide

Target: **live URL in ~60 min**. Backend on Railway, frontend on Vercel,
CI on GitHub Actions.

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

## Backend on Railway

1. Go to <https://railway.app>, sign in with GitHub.
2. Click **New Project → Deploy from GitHub repo → Sanchitaccenture/deep-research-agent**.
3. Railway auto-detects the Dockerfile and starts building.
4. While it builds, go to **Variables** and paste:

   ```
   GROQ_API_KEY=gsk_...            (from https://console.groq.com/keys)
   TAVILY_API_KEY=tvly-...          (from https://app.tavily.com)
   ALLOWED_ORIGINS=http://localhost:5173
   ENABLE_RAG=true
   ENABLE_CREW=true
   MAX_ROUNDS=3
   MAX_SUBQUESTIONS=4
   RESULTS_PER_SEARCH=4
   RATE_LIMIT_PER_MINUTE=30
   RESEARCH_CACHE_TTL_SECONDS=900
   ```

   Do NOT paste keys into the code or anywhere I can see. They're private.

5. Go to **Settings → Networking → Generate Domain**. Copy the URL — it looks like
   `https://deep-research-agent-production.up.railway.app`.
6. Add a **Volume** (Storage tab): mount path `/app/data`, 1 GB free tier.
   This persists sessions + ChromaDB + the HuggingFace model cache across
   redeploys.
7. Wait for the deploy to go **Active** (~2 min after first build).
8. Smoke test: `https://YOUR_RAILWAY_URL/health` → should return
   `{"status":"ok","checks":{...}}`.

---

## Frontend on Vercel

1. Open **[frontend/vercel.json](frontend/vercel.json)** and replace both
   occurrences of `REPLACE_WITH_RAILWAY_URL` with your Railway domain (without
   `https://` — Vercel adds it back). Commit + push:

   ```powershell
   git add frontend/vercel.json
   git commit -m "wire frontend to Railway backend"
   git push
   ```

2. Go to <https://vercel.com>, sign in with GitHub.
3. Click **Add New → Project → Import Sanchitaccenture/deep-research-agent**.
4. In the config screen:
   - **Root Directory**: `frontend`
   - Framework: Vite (auto-detected)
   - Build command: `npm run build` (auto)
   - Output: `dist` (auto)
5. Click **Deploy**. Wait ~1 min.
6. Copy the assigned URL — usually `https://deep-research-agent-<hash>.vercel.app`.

---

## Wire them together — CORS

Back on Railway, update `ALLOWED_ORIGINS`:

```
ALLOWED_ORIGINS=http://localhost:5173,https://YOUR_VERCEL_URL.vercel.app
```

Railway redeploys automatically (~30s).

---

## Smoke test the live app

1. Open your Vercel URL in a browser.
2. The dashboard should load with 0 sessions, API status "live".
3. Ask a question — say *"What is retrieval augmented generation?"*.
4. Watch it stream tokens, generate a mind map, and finish in ~20 seconds.
5. Copy the URL — this is what goes on your resume.

---

## Optional but recommended

- **Custom domain**: Vercel → Settings → Domains, add `deep-research.yourdomain.com`.
- **README badges**: pytest green ✓, MIT license, Vercel deploy. Templates
  already in the main [README.md](README.md).
- **90-second Loom demo**: [DEMO_SCRIPT.md](DEMO_SCRIPT.md) has the exact script.
- **LinkedIn post**: [LINKEDIN_POST.md](LINKEDIN_POST.md) has the draft — swap
  in the URL + video and post.

---

## Common issues

| Symptom | Fix |
|---------|-----|
| Vercel shows API 404 | You forgot to replace `REPLACE_WITH_RAILWAY_URL` in `frontend/vercel.json`. |
| CORS error in browser console | Update `ALLOWED_ORIGINS` on Railway to include your Vercel URL. |
| Frontend loads but "API live" chip is red | Backend is down. Check Railway → Deployments → Logs. |
| First research hangs for 90s | `sentence-transformers` is downloading MiniLM on first RAG call. Second call is instant. Or set `ENABLE_RAG=false` in Railway env vars. |
| `429 Too many requests` | You're spamming. Wait 60s or raise `RATE_LIMIT_PER_MINUTE` in Railway. |
| Groq rate limit | Free tier daily quota is 100k tokens on the big models. Wait or set `GROQ_MODEL=llama-3.1-8b-instant` in Railway (much higher quota). |

---

## Cost estimate

For portfolio/demo traffic (a few researches per day):

| Service | Cost |
|---------|------|
| Railway (backend + 1 GB Volume) | Free tier: $5/mo credit covers this comfortably |
| Vercel (frontend) | Free forever for personal projects |
| Groq API | Free tier: 100k tokens/day is enough for ~10 researches/day |
| Tavily search | Free tier: 1000 searches/month |
| **Total** | **$0/mo** for the first ~3 months on Railway credits, then ~$3-5/mo |

---

## Rollback

Railway keeps every deployment. If something breaks:

1. Railway → Deployments tab → find the previous green ✓ deployment.
2. Click ⋯ → Redeploy.
3. Live in ~30s.
