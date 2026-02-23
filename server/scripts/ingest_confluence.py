from datetime import datetime, timezone
from pathlib import Path

from app.confluence import fetch_page, page_to_text, search_pages
from app.config import settings
from app.db import SessionLocal
from app.ingest import IngestDocument, hash_text, upsert_document_chunks
from app.models import Document


STATE_DIR = Path(__file__).resolve().parent.parent / ".state"
LAST_RUN_FILE = STATE_DIR / "confluence_last_run.txt"


def should_skip(db, source_id: str, content_hash_value: str) -> bool:
    existing = (
        db.query(Document.content_hash)
        .filter(Document.source == "confluence", Document.source_id == source_id)
        .limit(1)
        .first()
    )
    return existing is not None and existing[0] == content_hash_value


def main():
    space_keys = [key.strip() for key in settings.confluence_space_keys.split(",") if key.strip()]
    cql_extra = settings.confluence_cql_extra.strip()
    if LAST_RUN_FILE.exists():
        last_run = LAST_RUN_FILE.read_text(encoding="utf-8").strip()
        if last_run:
            last_run_clause = f'lastmodified > "{last_run}"'
            if cql_extra:
                cql_extra = f"({cql_extra}) AND {last_run_clause}"
            else:
                cql_extra = last_run_clause

    page_ids = search_pages(space_keys, cql_extra)
    if not page_ids:
        print("No Confluence pages found.")
        return

    with SessionLocal() as db:
        for page_id in page_ids:
            page = fetch_page(page_id)
            text = page_to_text(page)
            content_hash_value = hash_text(text)
            if should_skip(db, page.page_id, content_hash_value=content_hash_value):
                continue
            doc = IngestDocument(
                source="confluence",
                source_id=page.page_id,
                title=page.title,
                url=page.url,
                space_key=page.space_key,
                updated_at=page.updated_at,
                text=text,
            )
            inserted = upsert_document_chunks(db, doc)
            print(f"Ingested {page.page_id} ({inserted} chunks)")

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    LAST_RUN_FILE.write_text(
        datetime.now(timezone.utc).isoformat(), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
