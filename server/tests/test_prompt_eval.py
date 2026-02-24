import json

from app import fsd_generator
from app.fsd_template import FSD_SECTIONS, build_fsd_prompt


def test_fsd_prompt_includes_all_sections():
    gap_results = [
        {
            "requirement": "Support Apple Pay at checkout",
            "classification": "Partial Match",
            "confidence": 0.72,
            "rationale": "Payment methods are available but require customization.",
        },
        {
            "requirement": "Provide store locator with map",
            "classification": "OOTB Match",
            "confidence": 0.9,
            "rationale": "Store locator is available out of the box.",
        },
    ]
    prompt = build_fsd_prompt(gap_results)
    for section in FSD_SECTIONS:
        assert section in prompt


def test_generate_fsd_json_parses_known_samples(monkeypatch):
    gap_results = [
        {
            "requirement": "Support Apple Pay at checkout",
            "classification": "Partial Match",
            "confidence": 0.72,
            "rationale": "Payment methods are available but require customization.",
        },
        {
            "requirement": "Provide store locator with map",
            "classification": "OOTB Match",
            "confidence": 0.9,
            "rationale": "Store locator is available out of the box.",
        },
        {
            "requirement": "Gift messages on order confirmation",
            "classification": "Custom Dev Required",
            "confidence": 0.55,
            "rationale": "Not supported by default.",
        },
    ]

    response_payload = {
        "Overview": ["Summary based on 3 requirements."],
        "OOTB Coverage": ["Store locator is available out of the box."],
        "Custom Dev": ["Gift messages require custom development."],
        "Partial Matches": ["Apple Pay needs configuration and testing."],
        "Assumptions": ["Using SFRA reference architecture."],
        "Open Questions": ["Any third-party payment gateway constraints?"],
        "Effort": ["1-2 sprints depending on integrations."],
    }

    def fake_generate_text(_prompt):
        return json.dumps(response_payload)

    monkeypatch.setattr(fsd_generator, "generate_text", fake_generate_text)
    fsd_json = fsd_generator.generate_fsd_json(gap_results)
    assert fsd_json["Overview"] == response_payload["Overview"]
    assert fsd_json["Open Questions"] == response_payload["Open Questions"]
