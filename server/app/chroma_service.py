from __future__ import annotations

import hashlib
from dataclasses import dataclass

import chromadb
from chromadb.config import Settings as ChromaSettings

from .config import settings
from .gemini_service import embed_texts


@dataclass
class ChunkRecord:
    doc_id: str
    text: str
    metadata: dict


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


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
        return self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            include=["documents", "metadatas", "distances"],
        )

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
