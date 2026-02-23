from __future__ import annotations

from io import BytesIO

from docx import Document
from pypdf import PdfReader


def parse_requirements_from_text(text: str) -> list[str]:
    lines = [line.strip() for line in text.splitlines()]
    items = [line.lstrip("-*0123456789. ").strip() for line in lines]
    return [item for item in items if len(item) > 3]


def parse_requirements_from_docx(data: bytes) -> list[str]:
    doc = Document(BytesIO(data))
    text = "\n".join([p.text for p in doc.paragraphs])
    return parse_requirements_from_text(text)


def parse_requirements_from_pdf(data: bytes) -> list[str]:
    reader = PdfReader(BytesIO(data))
    text = "\n".join([page.extract_text() or "" for page in reader.pages])
    return parse_requirements_from_text(text)
