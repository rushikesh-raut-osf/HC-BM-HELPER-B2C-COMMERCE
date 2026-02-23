from app.config import settings
from app.db import SessionLocal
from app.ingest import IngestDocument, hash_text, upsert_document_chunks
from app.models import Document
from app.sfcc import load_repo_docs


def should_skip(db, source_id: str, content_hash_value: str) -> bool:
    existing = (
        db.query(Document.content_hash)
        .filter(Document.source == "sfcc", Document.source_id == source_id)
        .limit(1)
        .first()
    )
    return existing is not None and existing[0] == content_hash_value


def main():
    if not settings.sfcc_docs_repo_path:
        print("SFCC_DOCS_REPO_PATH is not set.")
        return

    docs = load_repo_docs(settings.sfcc_docs_repo_path)
    if not docs:
        print("No SFCC docs found.")
        return

    with SessionLocal() as db:
        for doc in docs:
            content_hash_value = hash_text(doc.text)
            if should_skip(db, doc.source_id, content_hash_value):
                continue
            ingest_doc = IngestDocument(
                source="sfcc",
                source_id=doc.source_id,
                title=doc.title,
                url=doc.url,
                space_key=None,
                updated_at=None,
                text=doc.text,
            )
            inserted = upsert_document_chunks(db, ingest_doc)
            print(f"Ingested {doc.source_id} ({inserted} chunks)")


if __name__ == "__main__":
    main()
