# SFRA AI Agent

This repository contains the SFRA AI Agent: a system that ingests Confluence and Salesforce Commerce Cloud (SFCC) documentation, indexes it in ChromaDB using Gemini embeddings, and exposes APIs to run requirement gap analysis and generate a structured FSD draft. It also includes a Next.js frontend for uploading requirements and visualizing results.

## What It Does
- Ingests Confluence pages by space key
- Ingests SFCC internal repo docs (Markdown, HTML, PDF, DOCX)
- Chunks text and embeds with Gemini
- Stores vectors in ChromaDB (persistent)
- Exposes APIs for query, gap analysis, and FSD generation
- Frontend UI for upload, analysis, and FSD preview

## Architecture
**Ingestion**
- Confluence REST API fetch -> HTML to text -> chunk -> embed -> Chroma upsert
- SFCC repo ingest -> text extract -> chunk -> embed -> Chroma upsert

**Query & Analysis**
- /query: vector search for ad-hoc questions
- /analyze: parse requirements, run vector search per requirement, classify OOTB/Partial/Custom/Open Question
- /generate-fsd: use Gemini to draft an FSD across 7 sections

**Storage**
- ChromaDB persistence path: `CHROMA_PERSIST_PATH` (e.g., `/data/chroma`)

**Frontend**
- Next.js + Tailwind
- Upload requirements (DOCX/PDF) or paste text
- View classifications, confidence, and evidence
- Generate and preview FSD

## Repository Layout
- `server/` FastAPI backend (ChromaDB + Gemini)
- `frontend/` Next.js frontend

## Backend Setup (FastAPI)
```bash
cd server
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

Create `server/.env` (see `server/.env.example`) and set:
- `GEMINI_API_KEY`
- `CONFLUENCE_EMAIL`
- `CONFLUENCE_API_TOKEN`
- `CONFLUENCE_SPACE_KEYS`
- `SFCC_DOCS_REPO_PATH`
- `CHROMA_PERSIST_PATH`

Run ingestion:
```bash
python scripts/ingest_confluence.py
python scripts/ingest_sfcc_repo.py
```

Run API:
```bash
uvicorn app.main:app --reload --port 8000
```

## Frontend Setup (Next.js)
```bash
cd frontend
npm install
npm run dev
```

Optional: set API base in `frontend/.env.local`:
```bash
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

## API Endpoints
- `POST /health`
- `POST /query`
- `POST /analyze`
- `POST /analyze-file`
- `POST /generate-fsd`

## Notes
- ChromaDB is configured for persistent storage. Back up the persistence folder if needed.
- Gemini model and chunk sizes are configurable via `.env`.
