# SFRA AI Agent Backend (FastAPI + ChromaDB + Gemini)

## Setup

1. Create a virtualenv and install deps:
```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

2. Copy `server/.env.example` to `server/.env` and fill in values.

## Ingest

Confluence:
```bash
python scripts/ingest_confluence.py
```

SFCC internal repo:
```bash
python scripts/ingest_sfcc_repo.py
```

## Run API
```bash
uvicorn app.main:app --reload --port 8000
```

## Query Example
```bash
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"question": "How do I set up payment methods?", "top_k": 10}'
```

## Analyze Example
```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"requirements_text": "Checkout must support Apple Pay\nAdd store locator", "top_k": 10}'
```

## Notes
- Chroma persists vectors under `CHROMA_PERSIST_PATH`.
- Confluence ingest stores last run in `server/.state/confluence_last_run.txt`.
