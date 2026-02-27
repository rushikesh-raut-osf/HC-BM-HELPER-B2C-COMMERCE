from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

import chromadb
from chromadb.config import Settings as ChromaSettings

from .config import settings
from .llm_service import embed_texts


@dataclass
class ChunkRecord:
    doc_id: str
    text: str
    metadata: dict


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "have",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "with",
}


def _tokenize(text: str) -> set[str]:
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return {token for token in tokens if token not in _STOPWORDS and len(token) > 2}


def _lexical_overlap(query_text: str, doc_text: str) -> float:
    query_tokens = _tokenize(query_text)
    if not query_tokens:
        return 0.0
    doc_tokens = _tokenize(doc_text)
    if not doc_tokens:
        return 0.0
    intersection = query_tokens & doc_tokens
    union = query_tokens | doc_tokens
    if not union:
        return 0.0
    return len(intersection) / len(union)


class ChromaService:
    def __init__(self) -> None:
        self.client = chromadb.PersistentClient(
            path=settings.chroma_persist_path,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        self.collection = self.client.get_or_create_collection("documents")

    def upsert_chunks(self, records: list[ChunkRecord], task_type: str) -> int:
        if not records:
            return 0

        embeddings = embed_texts([r.text for r in records], task_type=task_type)
        ids = [r.doc_id for r in records]
        metadatas = [r.metadata for r in records]
        documents = [r.text for r in records]

        self.collection.upsert(ids=ids, embeddings=embeddings, metadatas=metadatas, documents=documents)
        return len(records)

    def query(self, query_text: str, top_k: int) -> dict:
        query_embedding = embed_texts([query_text], task_type="retrieval_query")[0]
        n_results = top_k
        if settings.rerank_enabled:
            n_results = max(top_k, settings.rerank_candidates)
        response = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            include=["documents", "metadatas", "distances"],
        )
        if not settings.rerank_enabled:
            return response

        documents = response["documents"][0]
        metadatas = response["metadatas"][0]
        distances = response["distances"][0]

        lexical_weight = max(0.0, min(settings.rerank_lexical_weight, 1.0))
        semantic_weight = 1.0 - lexical_weight

        scored = []
        for doc, meta, dist in zip(documents, metadatas, distances):
            semantic = max(0.0, min(1.0, 1.0 - dist))
            lexical = _lexical_overlap(query_text, doc or "")
            combined = (semantic_weight * semantic) + (lexical_weight * lexical)
            scored.append((combined, doc, meta, dist))

        scored.sort(key=lambda item: item[0], reverse=True)
        top_scored = scored[:top_k]

        return {
            "documents": [[item[1] for item in top_scored]],
            "metadatas": [[item[2] for item in top_scored]],
            "distances": [[item[3] for item in top_scored]],
        }

    def should_skip(self, source: str, source_id: str, content: str) -> bool:
        content_hash = _content_hash(content)
        results = self.collection.get(
            where={"$and": [{"source": source}, {"source_id": source_id}]},
            include=["metadatas"],
        )
        if not results or not results.get("metadatas"):
            return False
        for metadata in results["metadatas"]:
            if metadata and metadata.get("content_hash") == content_hash:
                return True
        return False

    def delete_source(self, source: str, source_id: str) -> None:
        self.collection.delete(where={"$and": [{"source": source}, {"source_id": source_id}]})
