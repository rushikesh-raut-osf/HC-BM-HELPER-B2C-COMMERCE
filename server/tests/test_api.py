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
    def fake_query(_question, _top_k):
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
