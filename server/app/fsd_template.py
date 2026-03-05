from __future__ import annotations

import json

FSD_STRUCTURE = [
    ("Overview", None, "Overview"),
    ("Background", "Scope", "Background - Scope"),
    ("Background", "Out of Scope", "Background - Out of Scope"),
    ("Functional Specification", "General Requirements", "Functional Specification - General Requirements"),
    ("Functional Specification", "Visual Requirements", "Functional Specification - Visual Requirements"),
    ("Functional Specification", "Error Handling", "Functional Specification - Error Handling"),
]

FSD_SECTIONS = [item[2] for item in FSD_STRUCTURE]


def build_fsd_prompt(gap_results: list[dict]) -> str:
    schema = {section: [] for section in FSD_SECTIONS}
    schema_json = json.dumps(schema, indent=2)
    return (
        "You are generating a Functional Specification Document (FSD) summary.\n"
        "Return ONLY valid JSON with these top-level keys and array-of-string values.\n"
        "These keys map to this final structure:\n"
        "- Overview\n"
        "- Background -> Scope, Out of Scope\n"
        "- Functional Specification -> General Requirements, Visual Requirements, Error Handling\n"
        "Use the exact keys shown below:\n"
        f"{schema_json}\n\n"
        "Rules:\n"
        "- Do not include Markdown or code fences.\n"
        "- Each value must be a list of short bullet strings.\n"
        "- If a section has no content, return an empty list.\n\n"
        f"Gap Analysis Results:\n{gap_results}\n"
    )
