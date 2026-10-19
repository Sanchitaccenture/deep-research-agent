"""Central configuration. Loads from .env once, exposes typed settings."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# On Vercel the only writable location is /tmp, and the heavy RAG stack
# does not fit the 500 MB function bundle limit. Env vars still override.
ON_VERCEL: bool = bool(os.getenv("VERCEL"))
_DATA_ROOT: str = os.getenv("DATA_DIR", "/tmp/data" if ON_VERCEL else "./data")


def _bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in ("1", "true", "yes", "on")


def _reasoning_effort() -> str:
    """GPT-OSS reasoning effort: low | medium | high; "" disables; invalid -> low."""
    value = os.getenv("REASONING_EFFORT", "low").strip().lower()
    return value if value in ("", "low", "medium", "high") else "low"


class Config:
    # --- Required keys ---
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    TAVILY_API_KEY: str = os.getenv("TAVILY_API_KEY", "")

    # --- Optional keys (unlock extra providers) ---
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")

    # --- LLM models ---
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
    CREW_MODEL: str = os.getenv("CREW_MODEL", "openai/gpt-oss-120b")
    GROQ_MODEL_CHAIN: str = os.getenv(
        "GROQ_MODEL_CHAIN",
        "openai/gpt-oss-20b,openai/gpt-oss-120b,qwen/qwen3.8-27b",
    )

    # --- Research loop budgets ---
    MAX_SUBQUESTIONS: int = int(os.getenv("MAX_SUBQUESTIONS", "4"))
    RESULTS_PER_SEARCH: int = int(os.getenv("RESULTS_PER_SEARCH", "4"))
    EXCLUDE_DOMAINS: str = os.getenv("EXCLUDE_DOMAINS", "youtube.com,youtu.be")
    MAX_ROUNDS: int = int(os.getenv("MAX_ROUNDS", "3"))
    SYNTH_CONTEXT_CHARS: int = int(os.getenv("SYNTH_CONTEXT_CHARS", "12000"))
    REASONING_EFFORT: str = _reasoning_effort()

    # --- RAG ---
    EMBEDDING_MODEL: str = os.getenv(
        "EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
    )
    RAG_TOP_K: int = int(os.getenv("RAG_TOP_K", "4"))
    RAG_CHUNK_SIZE: int = int(os.getenv("RAG_CHUNK_SIZE", "800"))
    RAG_CHUNK_OVERLAP: int = int(os.getenv("RAG_CHUNK_OVERLAP", "120"))

    # --- Data directories ---
    DATA_DIR: Path = Path(_DATA_ROOT)
    CHROMA_PERSIST_DIR: Path = Path(
        os.getenv("CHROMA_PERSIST_DIR", f"{_DATA_ROOT}/chroma")
    )
    SESSIONS_DIR: Path = Path(os.getenv("SESSIONS_DIR", f"{_DATA_ROOT}/sessions"))
    UPLOADS_DIR: Path = Path(os.getenv("UPLOADS_DIR", f"{_DATA_ROOT}/uploads"))
    COLLECTION_NAME: str = os.getenv("COLLECTION_NAME", "research_docs")

    # --- Feature flags ---
    ENABLE_RAG: bool = _bool("ENABLE_RAG", "false" if ON_VERCEL else "true")
    ENABLE_CREW: bool = _bool("ENABLE_CREW", "false" if ON_VERCEL else "true")
    CREW_VERBOSE: bool = _bool("CREW_VERBOSE", "false")

    # --- API ---
    ALLOWED_ORIGINS: str = os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    )

    def validate(self) -> None:
        missing = []
        if not self.GROQ_API_KEY or self.GROQ_API_KEY == "your_groq_key_here":
            missing.append("GROQ_API_KEY")
        if not self.TAVILY_API_KEY or self.TAVILY_API_KEY == "your_tavily_key_here":
            missing.append("TAVILY_API_KEY")
        if missing:
            raise RuntimeError(
                f"Missing API keys: {', '.join(missing)}. "
                f"Copy .env.example to .env and fill them in."
            )

    def ensure_dirs(self) -> None:
        for d in (
            self.DATA_DIR,
            self.CHROMA_PERSIST_DIR,
            self.SESSIONS_DIR,
            self.UPLOADS_DIR,
        ):
            try:
                Path(d).mkdir(parents=True, exist_ok=True)
            except OSError:
                # Read-only filesystem: features needing the dir fail individually.
                pass

    def origins(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]


config = Config()
config.ensure_dirs()
