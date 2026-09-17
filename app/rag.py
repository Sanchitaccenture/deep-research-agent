"""
RAG pipeline: ChromaDB vector store + local sentence-transformer embeddings.

Documents uploaded via the API are split into chunks, embedded, and stored in a
persistent Chroma collection. During research, the agent semantically queries
this collection alongside the live web search — retrieved chunks show up as
'document' sources in the final report.

Embeddings default to `sentence-transformers/all-MiniLM-L6-v2`, which runs
locally and needs no API key.
"""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import config


_client = None
_collection = None
_embed_fn = None


def _get_embed_fn():
    """Lazy-load the embedding function so app startup stays fast."""
    global _embed_fn
    if _embed_fn is not None:
        return _embed_fn
    from chromadb.utils.embedding_functions import (
        SentenceTransformerEmbeddingFunction,
    )
    model_name = config.EMBEDDING_MODEL.split("/")[-1]
    _embed_fn = SentenceTransformerEmbeddingFunction(model_name=model_name)
    return _embed_fn


def _get_collection():
    """Get or create the persistent Chroma collection."""
    global _client, _collection
    if _collection is not None:
        return _collection

    import chromadb
    from chromadb.config import Settings

    _client = chromadb.PersistentClient(
        path=str(config.CHROMA_PERSIST_DIR),
        settings=Settings(anonymized_telemetry=False, allow_reset=True),
    )
    _collection = _client.get_or_create_collection(
        name=config.COLLECTION_NAME,
        embedding_function=_get_embed_fn(),
        metadata={"hnsw:space": "cosine"},
    )
    return _collection


# --------------------------------------------------------------------------
# Text splitting
# --------------------------------------------------------------------------
def _split_text(text: str) -> List[str]:
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=config.RAG_CHUNK_SIZE,
        chunk_overlap=config.RAG_CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    return [c for c in splitter.split_text(text) if c.strip()]


# --------------------------------------------------------------------------
# Loaders
# --------------------------------------------------------------------------
def _load_pdf(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            continue
    return "\n\n".join(pages)


def _load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def _load_file(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return _load_pdf(path)
    if suffix in (".txt", ".md", ".markdown", ".rst", ".csv", ".json"):
        return _load_text(path)
    # Fallback — try as text.
    try:
        return _load_text(path)
    except Exception:
        return ""


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------
def ingest_file(path: Path, filename: str) -> Dict[str, Any]:
    """Load, chunk, embed and store a file. Returns the created document record."""
    text = _load_file(path)
    if not text.strip():
        raise ValueError(f"Could not extract any text from {filename}")

    chunks = _split_text(text)
    if not chunks:
        raise ValueError(f"No chunks produced from {filename}")

    doc_id = uuid.uuid4().hex[:12]
    ids = [f"{doc_id}::{i}" for i in range(len(chunks))]
    metadatas = [
        {"doc_id": doc_id, "filename": filename, "chunk": i}
        for i in range(len(chunks))
    ]

    coll = _get_collection()
    coll.add(ids=ids, documents=chunks, metadatas=metadatas)

    return {
        "doc_id": doc_id,
        "filename": filename,
        "chunks": len(chunks),
        "size": len(text),
    }


def query_documents(query: str, top_k: Optional[int] = None) -> List[Dict[str, Any]]:
    """Semantic search over ingested documents. Returns a list of source dicts."""
    top_k = top_k or config.RAG_TOP_K
    coll = _get_collection()
    if coll.count() == 0:
        return []

    result = coll.query(
        query_texts=[query],
        n_results=min(top_k, coll.count()),
        include=["documents", "metadatas", "distances"],
    )

    docs = result.get("documents", [[]])[0]
    metas = result.get("metadatas", [[]])[0]
    dists = result.get("distances", [[]])[0]

    hits: List[Dict[str, Any]] = []
    for content, meta, dist in zip(docs, metas, dists):
        hits.append({
            "title": meta.get("filename", "document"),
            "url": f"doc://{meta.get('doc_id', 'unknown')}#chunk-{meta.get('chunk', 0)}",
            "content": content,
            "query": query,
            "source_type": "document",
            "score": max(0.0, 1.0 - float(dist)),
        })
    return hits


def list_documents() -> List[Dict[str, Any]]:
    """List every distinct doc_id in the collection with chunk counts."""
    coll = _get_collection()
    if coll.count() == 0:
        return []

    got = coll.get(include=["metadatas"])
    metas = got.get("metadatas", []) or []

    grouped: Dict[str, Dict[str, Any]] = {}
    for meta in metas:
        did = meta.get("doc_id")
        if not did:
            continue
        if did not in grouped:
            grouped[did] = {
                "doc_id": did,
                "filename": meta.get("filename", "unknown"),
                "chunks": 0,
            }
        grouped[did]["chunks"] += 1

    return sorted(grouped.values(), key=lambda d: d["filename"])


def delete_document(doc_id: str) -> bool:
    """Delete every chunk belonging to doc_id."""
    coll = _get_collection()
    got = coll.get(where={"doc_id": doc_id}, include=[])
    ids = got.get("ids", []) or []
    if not ids:
        return False
    coll.delete(ids=ids)
    return True


def reset_collection() -> None:
    """Wipe the whole vector store."""
    global _collection
    coll = _get_collection()
    got = coll.get(include=[])
    ids = got.get("ids", []) or []
    if ids:
        coll.delete(ids=ids)


def document_count() -> int:
    """Return the number of distinct documents (not chunks)."""
    return len(list_documents())
