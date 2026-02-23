from __future__ import annotations

import hashlib
from dataclasses import dataclass

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .chunking import chunk_text, dedupe_chunks
from .config import settings
from .embeddings import embed_texts
from .models import Document


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


def upsert_document_chunks(db: Session, doc: IngestDocument) -> int:
    text = doc.text.strip()
    if not text:
        return 0

    content_hash = hash_text(text)
    chunks = dedupe_chunks(chunk_text(text, settings.chunk_tokens, settings.chunk_overlap))
    if not chunks:
        return 0

    embeddings = embed_texts(chunks)
    inserted = 0

    for index, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        stmt = insert(Document).values(
            source=doc.source,
            source_id=doc.source_id,
            title=doc.title,
            url=doc.url,
            space_key=doc.space_key,
            updated_at=doc.updated_at,
            content_hash=content_hash,
            chunk_index=index,
            chunk_text=chunk,
            embedding=embedding,
            metadata_json={},
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["source", "source_id", "chunk_index"],
            set_={
                "title": doc.title,
                "url": doc.url,
                "space_key": doc.space_key,
                "updated_at": doc.updated_at,
                "content_hash": content_hash,
                "chunk_text": chunk,
                "embedding": embedding,
                "metadata": {},
            },
        )
        db.execute(stmt)
        inserted += 1

    db.commit()
    return inserted
