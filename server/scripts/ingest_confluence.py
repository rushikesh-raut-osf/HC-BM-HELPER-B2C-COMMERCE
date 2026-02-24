from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parent.parent))

from app.chroma_service import ChromaService
from app.confluence import fetch_page, page_to_text, search_pages
from app.config import settings
from app.ingest import IngestDocument, upsert_document_chunks


STATE_DIR = Path(__file__).resolve().parent.parent / ".state"
LAST_RUN_FILE = STATE_DIR / "confluence_last_run.txt"


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

    chroma = ChromaService()
    for page_id in page_ids:
        page = fetch_page(page_id)
        text = page_to_text(page)
        doc = IngestDocument(
            source="confluence",
            source_id=page.page_id,
            title=page.title,
            url=page.url,
            space_key=page.space_key,
            updated_at=page.updated_at,
            text=text,
        )
        if chroma.should_skip("confluence", page.page_id, text):
            continue
        inserted = upsert_document_chunks(chroma, doc, task_type="retrieval_document")
        print(f"Ingested {page.page_id} ({inserted} chunks)")

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    LAST_RUN_FILE.write_text(
        datetime.now(timezone.utc).isoformat(), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
