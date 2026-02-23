from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from bs4 import BeautifulSoup
from docx import Document
from pypdf import PdfReader


@dataclass
class SfccDoc:
    source_id: str
    title: str
    url: str | None
    text: str


def _extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".html", ".htm"}:
        content = path.read_text(encoding="utf-8", errors="ignore")
        soup = BeautifulSoup(content, "html.parser")
        return soup.get_text(separator="\n")
    if suffix == ".pdf":
        reader = PdfReader(BytesIO(path.read_bytes()))
        return "\n".join([page.extract_text() or "" for page in reader.pages])
    if suffix == ".docx":
        doc = Document(BytesIO(path.read_bytes()))
        return "\n".join([p.text for p in doc.paragraphs])
    return path.read_text(encoding="utf-8", errors="ignore")


def load_repo_docs(repo_path: str) -> list[SfccDoc]:
    root = Path(repo_path)
    if not root.exists():
        return []

    docs: list[SfccDoc] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".md", ".txt", ".html", ".htm", ".pdf", ".docx"}:
            continue
        text = _extract_text(path)
        title = path.stem
        source_id = str(path.relative_to(root))
        docs.append(
            SfccDoc(
                source_id=source_id,
                title=title,
                url=None,
                text=text,
            )
        )
    return docs
