from __future__ import annotations

import hashlib
from dataclasses import dataclass

from .chroma_service import ChromaService, ChunkRecord
from .chunking import chunk_text, dedupe_chunks
from .config import settings


@dataclass
class IngestDocument:
    source: str
    source_id: str
    title: str | None
    url: str | None
    space_key: str | None
    updated_at: object | None
    text: str


def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def to_chunks(doc: IngestDocument) -> list[ChunkRecord]:
    text = doc.text.strip()
    if not text:
        return []

    content_hash = hash_text(text)
    chunks = dedupe_chunks(chunk_text(text, settings.chunk_words, settings.chunk_overlap_words))
    records: list[ChunkRecord] = []

    for index, chunk in enumerate(chunks):
        doc_id = f"{doc.source}:{doc.source_id}:{index}"
        metadata = {
            "source": doc.source,
            "source_id": doc.source_id,
            "title": doc.title,
            "url": doc.url,
            "space_key": doc.space_key,
            "updated_at": str(doc.updated_at) if doc.updated_at else None,
            "chunk_index": index,
            "content_hash": content_hash,
        }
        records.append(ChunkRecord(doc_id=doc_id, text=chunk, metadata=metadata))
    return records


def upsert_document_chunks(chroma: ChromaService, doc: IngestDocument, task_type: str) -> int:
    records = to_chunks(doc)
    if not records:
        return 0
    chroma.delete_source(doc.source, doc.source_id)
    return chroma.upsert_chunks(records, task_type=task_type)
