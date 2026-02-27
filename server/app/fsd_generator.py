from __future__ import annotations

import json
import logging

from docx import Document

from .fsd_template import FSD_SECTIONS, build_fsd_prompt
from .llm_service import generate_text

logger = logging.getLogger(__name__)


def _empty_fsd() -> dict:
    return {section: [] for section in FSD_SECTIONS}


def _parse_fsd_json(text: str) -> dict:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found")
    payload = json.loads(text[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("FSD JSON must be an object")
    for section in FSD_SECTIONS:
        payload.setdefault(section, [])
        if not isinstance(payload[section], list):
            payload[section] = [str(payload[section])]
        payload[section] = [str(item) for item in payload[section]]
    return payload


def generate_fsd_json(gap_results: list[dict]) -> dict:
    prompt = build_fsd_prompt(gap_results)
    response_text = generate_text(prompt)
    try:
        return _parse_fsd_json(response_text)
    except Exception as exc:
        logger.warning("FSD JSON parse failed: %s", exc)
        return _empty_fsd()


def render_fsd_text(fsd_json: dict) -> str:
    lines: list[str] = []
    for section in FSD_SECTIONS:
        lines.append(section)
        items = fsd_json.get(section, [])
        if not items:
            lines.append("- No items.")
            continue
        for item in items:
            lines.append(f"- {item}")
    return "\n".join(lines)


def generate_fsd(gap_results: list[dict]) -> str:
    fsd_json = generate_fsd_json(gap_results)
    return render_fsd_text(fsd_json)


def generate_fsd_docx(fsd_json: dict) -> Document:
    doc = Document()
    doc.add_heading("Functional Specification Document", level=1)
    if not fsd_json:
        doc.add_paragraph("No content generated.")
        return doc

    for section in FSD_SECTIONS:
        doc.add_heading(section, level=2)
        items = fsd_json.get(section, [])
        if not items:
            doc.add_paragraph("No items.")
            continue
        for item in items:
            doc.add_paragraph(str(item), style="List Bullet")
    return doc


def export_fsd_to_docx(fsd_json: dict) -> Document:
    return generate_fsd_docx(fsd_json)
