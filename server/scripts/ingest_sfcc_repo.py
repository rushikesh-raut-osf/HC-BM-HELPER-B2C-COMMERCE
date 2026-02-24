from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parent.parent))

from app.chroma_service import ChromaService
from app.config import settings
from app.ingest import IngestDocument, upsert_document_chunks
from app.sfcc import load_repo_docs


def main():
    if not settings.sfcc_docs_repo_path:
        print("SFCC_DOCS_REPO_PATH is not set.")
        return

    docs = load_repo_docs(settings.sfcc_docs_repo_path)
    if not docs:
        print("No SFCC docs found.")
        return

    chroma = ChromaService()
    for doc in docs:
        if chroma.should_skip("sfcc", doc.source_id, doc.text):
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
        inserted = upsert_document_chunks(chroma, ingest_doc, task_type="retrieval_document")
        print(f"Ingested {doc.source_id} ({inserted} chunks)")


if __name__ == "__main__":
    main()
