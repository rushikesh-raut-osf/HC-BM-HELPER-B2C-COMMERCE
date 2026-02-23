from __future__ import annotations

from docx import Document

from .gemini_service import generate_text


FSD_SECTIONS = [
    "Overview",
    "OOTB Coverage",
    "Custom Dev",
    "Partial Matches",
    "Assumptions",
    "Open Questions",
    "Effort",
]


def generate_fsd(gap_results: list[dict]) -> str:
    prompt = (
        "You are generating a Functional Specification Document (FSD) summary.\n"
        "Use the seven sections: Overview, OOTB Coverage, Custom Dev, Partial Matches, "
        "Assumptions, Open Questions, Effort.\n"
        "Provide concise bullet points per section.\n\n"
        f"Gap Analysis Results:\n{gap_results}\n"
    )
    return generate_text(prompt)


def generate_fsd_docx(fsd_text: str) -> Document:
    doc = Document()
    doc.add_heading("Functional Specification Document", level=1)
    lines = [line.strip() for line in fsd_text.splitlines() if line.strip()]
    if not lines:
        doc.add_paragraph("No content generated.")
        return doc

    current_section = None
    for line in lines:
        normalized = line.rstrip(":")
        if normalized in FSD_SECTIONS:
            current_section = normalized
            doc.add_heading(current_section, level=2)
            continue
        if line.startswith(("-", "*")):
            doc.add_paragraph(line.lstrip("-* ").strip(), style="List Bullet")
        else:
            if current_section:
                doc.add_paragraph(line)
            else:
                doc.add_paragraph(line)
    return doc
