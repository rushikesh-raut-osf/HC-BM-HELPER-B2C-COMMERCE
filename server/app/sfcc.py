from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from bs4 import BeautifulSoup


@dataclass
class SfccDoc:
    source_id: str
    title: str
    url: str | None
    text: str


def _extract_text(path: Path) -> str:
    content = path.read_text(encoding="utf-8", errors="ignore")
    if path.suffix.lower() in {".html", ".htm"}:
        soup = BeautifulSoup(content, "html.parser")
        return soup.get_text(separator="\n")
    return content


def load_repo_docs(repo_path: str) -> list[SfccDoc]:
    root = Path(repo_path)
    if not root.exists():
        return []

    docs: list[SfccDoc] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".md", ".txt", ".html", ".htm"}:
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
