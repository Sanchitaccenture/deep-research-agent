# --- Deep Research Agent — backend container ---
# Multi-stage build kept simple: single stage, slim base, pip cache mounted.
# Railway detects this file automatically and builds without further config.

FROM python:3.12-slim

# System deps: build tools for sentence-transformers/chroma wheels + curl for the healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python behaviour
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # Persist HuggingFace model cache inside the mounted volume so it survives
    # redeploys (sentence-transformers/MiniLM is ~90MB).
    HF_HOME=/app/data/hf_cache \
    # Feature flags — Railway env vars will override these.
    ENABLE_CREW=true \
    ENABLE_RAG=true

# Install deps first — best cache hit rate.
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Now the app.
COPY app/ ./app/
COPY evals/ ./evals/
COPY README.md ARCHITECTURE.md LICENSE ./

# Data dirs (session store / uploads / chroma / telemetry). On Railway these
# are backed by a persistent Volume mounted at /app/data.
RUN mkdir -p /app/data/sessions /app/data/uploads /app/data/chroma /app/data/telemetry /app/data/hf_cache

# Railway injects $PORT; default 8000 for local docker runs.
ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

# Use sh so $PORT expands at container start.
CMD ["sh", "-c", "uvicorn app.api:app --host 0.0.0.0 --port ${PORT}"]
