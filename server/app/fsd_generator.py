from __future__ import annotations

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
