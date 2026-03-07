import os

from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test")
os.environ.setdefault("CONFLUENCE_BASE_URL", "https://example.atlassian.net/wiki")
os.environ.setdefault("CONFLUENCE_EMAIL", "test@example.com")
os.environ.setdefault("CONFLUENCE_API_TOKEN", "test")

from app import main


def test_health():
    client = TestClient(main.app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_analyze_text(monkeypatch):
    def fake_query(_question, _top_k, where_filter=None):
        return {
            "documents": [["doc chunk"]],
            "metadatas": [[{"source": "confluence"}]],
            "distances": [[0.1]],
            "ids": [["1"]],
        }

    def fake_generate_text(_prompt):
        return "OOTB Match | 0.9 | Looks good"

    monkeypatch.setattr(main.chroma, "query", fake_query)
    from app import gap_analyzer

    monkeypatch.setattr(gap_analyzer, "generate_text", fake_generate_text)

    client = TestClient(main.app)
    payload = {"requirements_text": "Support Apple Pay\nEnable gift messages"}
    response = client.post("/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2
    assert data["results"][0]["classification"] == "OOTB Match"


def test_analyze_agent_mode_uses_agentic_path(monkeypatch):
    def fake_agentic(_chroma, requirement, _top_k, max_steps, stop_confidence):
        class Result:
            pass

        result = Result()
        result.requirement = requirement
        result.classification = "Partial Match"
        result.confidence = 0.81
        result.rationale = "Agentic result"
        result.top_chunks = []
        result.citations = []
        result.clarifying_questions = None
        result.similarity_score = 0.8
        result.llm_confidence = 0.82
        result.llm_response = "trace"
        assert max_steps >= 1
        assert stop_confidence > 0
        return result

    monkeypatch.setattr(main, "analyze_requirement_agentic", fake_agentic)
    client = TestClient(main.app)
    payload = {"requirements_text": "Enable gift messages", "agent_mode": True}
    response = client.post("/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["results"][0]["classification"] == "Partial Match"
    assert data["results"][0]["rationale"] == "Agentic result"


def test_analyze_agentic_endpoint_forces_agent_mode(monkeypatch):
    def fake_agentic(_chroma, requirement, _top_k, max_steps, stop_confidence):
        class Result:
            pass

        result = Result()
        result.requirement = requirement
        result.classification = "Custom Dev Required"
        result.confidence = 0.67
        result.rationale = "Agent endpoint"
        result.top_chunks = []
        result.citations = []
        result.clarifying_questions = None
        result.similarity_score = 0.66
        result.llm_confidence = 0.68
        result.llm_response = "trace"
        assert max_steps >= 1
        assert stop_confidence > 0
        return result

    monkeypatch.setattr(main, "analyze_requirement_agentic", fake_agentic)
    client = TestClient(main.app)
    payload = {"requirements_text": "Add loyalty profile fields"}
    response = client.post("/analyze-agentic", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["results"][0]["classification"] == "Custom Dev Required"


def test_generate_fsd_docx(monkeypatch):
    monkeypatch.setattr(
        main,
        "generate_fsd_json",
        lambda _results: {
            "Overview": ["ok"],
            "OOTB Coverage": [],
            "Custom Dev": [],
            "Partial Matches": [],
            "Assumptions": [],
            "Open Questions": [],
            "Effort": [],
        },
    )
    client = TestClient(main.app)
    response = client.post("/generate-fsd-docx", json={"gap_results": []})
    assert response.status_code == 200
    assert (
        response.headers["content-type"]
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
