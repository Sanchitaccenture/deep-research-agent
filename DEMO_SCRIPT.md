# 90-Second Demo Script

Record a Loom of exactly **90 seconds** showing off the app. This clip
becomes your LinkedIn post + resume link.

**Setup before recording:**

1. Open a fresh browser window (Chrome recommended).
2. Set browser zoom to 100%.
3. Go to your live Vercel URL — make sure at least 3 sample research
   sessions exist in the sidebar (create them beforehand so the dashboard
   isn't empty).
4. Close every other tab, hide your bookmarks bar.
5. Have a mic that doesn't hiss.

**Recording tool:** [loom.com](https://loom.com) — free, browser-based,
records screen + face-cam. Or Windows Game Bar (`Win+G`) if you prefer
no face-cam.

---

## The script — read it in 90 seconds

### 0:00 – 0:10 — Hook
> "Meet Deep Research Agent — I built an autonomous AI research assistant
> that plans, searches, critiques, and writes cited reports for any
> question you throw at it."

*(action: show the dashboard with stat tiles + activity chart)*

### 0:10 – 0:20 — Ask a question
> "Let's ask something meaty."

Type: **"What is retrieval augmented generation and why does it matter
for enterprise AI?"**

Click **Research →**.

### 0:20 – 0:50 — Show the streaming
> "Under the hood it's a LangGraph state machine — plan, search, assess,
> synthesize — with RAG over your own documents and real-time streaming
> to the browser."

*(action: pan across the sources landing, the token-by-token report
generation with the caret, the mind map appearing)*

### 0:50 – 1:05 — Show the polish
> "Every claim is cited. There's a mind map, a table of contents, follow-up
> suggestions, and you can chat directly with the sources afterwards."

*(action: click **Chat** tab, ask "summarise this in one paragraph",
show the streaming answer with inline citations)*

### 1:05 – 1:20 — Show the engineering
> "Backend is FastAPI + LangGraph + Groq. Frontend is React with SSE
> streaming. Everything is tested — 55 pytest cases run in three seconds
> — and I built an LLM-as-judge evals harness to catch quality regressions."

*(action: quickly show README badges, then the pytest green output
screenshot, then the ARCHITECTURE.md mermaid diagram)*

### 1:20 – 1:30 — Call to action
> "Live at YOURDOMAIN.vercel.app — code on GitHub. If you're hiring AI
> engineers, let's talk."

---

## Recording tips

- **First take is never the good one.** Do 3, pick the best.
- Speak with a smile — sounds warmer on the mic.
- Cursor movements should be **slow and deliberate**; don't wave the mouse.
- Silent pauses of 1s are fine — better than "um".
- Trim the beginning + end in Loom's editor so the video starts with
  action.

## After you record

1. Copy the Loom share URL.
2. Download the .mp4 (Loom menu → Download) so LinkedIn can host it natively.
3. Post on LinkedIn — [LINKEDIN_POST.md](LINKEDIN_POST.md) has the draft.
4. Add the Loom URL to the top of your GitHub README:

   ```markdown
   > 🎥 [Watch the 90-second demo →](YOUR_LOOM_URL)
   ```
