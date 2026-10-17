"""Vercel entrypoint.

Vercel looks for a FastAPI instance named `app` in a root-level index.py.
The real application lives in app/api.py; this file just re-exports it.
"""
from app.api import app  # noqa: F401
