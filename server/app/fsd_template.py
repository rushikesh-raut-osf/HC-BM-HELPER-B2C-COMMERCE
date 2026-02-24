from __future__ import annotations

import json

FSD_SECTIONS = [
    "Overview",
    "OOTB Coverage",
    "Custom Dev",
    "Partial Matches",
    "Assumptions",
    "Open Questions",
    "Effort",
]


def build_fsd_prompt(gap_results: list[dict]) -> str:
    schema = {section: [] for section in FSD_SECTIONS}
    schema_json = json.dumps(schema, indent=2)
    return (
        "You are generating a Functional Specification Document (FSD) summary.\n"
        "Return ONLY valid JSON with these top-level keys and array-of-string values:\n"
        f"{schema_json}\n\n"
        "Rules:\n"
        "- Do not include Markdown or code fences.\n"
        "- Each value must be a list of short bullet strings.\n"
        "- If a section has no content, return an empty list.\n\n"
        f"Gap Analysis Results:\n{gap_results}\n"
    )
