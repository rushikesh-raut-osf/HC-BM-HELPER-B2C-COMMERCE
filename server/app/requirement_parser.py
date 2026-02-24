from __future__ import annotations

from io import BytesIO
import os
import tempfile

from docx import Document
from pypdf import PdfReader


def parse_requirements_from_text(text: str) -> list[str]:
    lines = [line.strip() for line in text.splitlines()]
    items = [line.lstrip("-*0123456789. ").strip() for line in lines]
    return [item for item in items if len(item) > 3]

def _extract_text_with_llamaindex(data: bytes, suffix: str) -> str | None:
    try:
        from llama_index.core import SimpleDirectoryReader
    except Exception:
        return None

    path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(data)
            path = temp_file.name
        reader = SimpleDirectoryReader(input_files=[path])
        docs = reader.load_data()
        text = "\n".join(doc.text for doc in docs if doc.text)
        return text or None
    except Exception:
        return None
    finally:
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass


def parse_requirements_from_docx(data: bytes) -> list[str]:
    text = _extract_text_with_llamaindex(data, ".docx")
    if text:
        return parse_requirements_from_text(text)
    doc = Document(BytesIO(data))
    text = "\n".join(p.text for p in doc.paragraphs)
    return parse_requirements_from_text(text)


def parse_requirements_from_pdf(data: bytes) -> list[str]:
    text = _extract_text_with_llamaindex(data, ".pdf")
    if text:
        return parse_requirements_from_text(text)
    reader = PdfReader(BytesIO(data))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return parse_requirements_from_text(text)
