from __future__ import annotations

import json
import logging
import re

from docx import Document

from .fsd_template import FSD_SECTIONS, FSD_STRUCTURE, build_fsd_prompt
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
    lines: list[str] = [
        "# Table of Contents",
        "- [Overview](#overview)",
        "- [Background](#background)",
        "  - [Scope](#scope)",
        "  - [Out of Scope](#out-of-scope)",
        "- [Functional Specification](#functional-specification)",
        "  - [General Requirements](#general-requirements)",
        "  - [Visual Requirements](#visual-requirements)",
        "  - [Error Handling](#error-handling)",
        "",
        "# Overview",
    ]

    overview_items = fsd_json.get("Overview", [])
    if not overview_items:
        lines.append("- No items.")
    else:
        for item in overview_items:
            lines.append(f"- {item}")

    lines.extend(["", "# Background", "## Scope"])
    scope_items = fsd_json.get("Background - Scope", [])
    if not scope_items:
        lines.append("- No items.")
    else:
        for item in scope_items:
            lines.append(f"- {item}")

    lines.extend(["", "## Out of Scope"])
    out_scope_items = fsd_json.get("Background - Out of Scope", [])
    if not out_scope_items:
        lines.append("- No items.")
    else:
        for item in out_scope_items:
            lines.append(f"- {item}")

    lines.extend(["", "# Functional Specification", "## General Requirements"])
    general_items = fsd_json.get("Functional Specification - General Requirements", [])
    if not general_items:
        lines.append("- No items.")
    else:
        for item in general_items:
            lines.append(f"- {item}")

    lines.extend(["", "## Visual Requirements"])
    visual_items = fsd_json.get("Functional Specification - Visual Requirements", [])
    if not visual_items:
        lines.append("- No items.")
    else:
        for item in visual_items:
            lines.append(f"- {item}")

    lines.extend(["", "## Error Handling"])
    error_items = fsd_json.get("Functional Specification - Error Handling", [])
    if not error_items:
        lines.append("- No items.")
    else:
        for item in error_items:
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

    last_parent = None
    for parent, child, key in FSD_STRUCTURE:
        if parent != last_parent:
            doc.add_heading(parent, level=2)
            last_parent = parent
        if child:
            doc.add_heading(child, level=3)
        items = fsd_json.get(key, [])
        if not items:
            doc.add_paragraph("No items.")
            continue
        for item in items:
            doc.add_paragraph(str(item), style="List Bullet")
    return doc


def generate_fsd_docx_from_text(fsd_text: str) -> Document:
    doc = Document()
    doc.add_heading("Functional Specification Document", level=1)
    content = fsd_text.strip()
    if not content:
        doc.add_paragraph("No content generated.")
        return doc

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#"):
            heading_level = min(3, len(line) - len(line.lstrip("#")))
            heading_text = line.lstrip("#").strip()
            if heading_text:
                doc.add_heading(heading_text, level=heading_level + 1)
            continue
        if re.match(r"^[-*]\s+", line):
            doc.add_paragraph(re.sub(r"^[-*]\s+", "", line), style="List Bullet")
            continue
        if re.match(r"^\d+\.\s+", line):
            doc.add_paragraph(re.sub(r"^\d+\.\s+", "", line), style="List Number")
            continue
        if line.endswith(":") and len(line) < 140:
            doc.add_heading(line[:-1].strip(), level=2)
            continue
        doc.add_paragraph(line)
    return doc


def export_fsd_to_docx(fsd_json: dict) -> Document:
    return generate_fsd_docx(fsd_json)
