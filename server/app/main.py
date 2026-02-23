from __future__ import annotations

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import io

from .confluence import fetch_page, page_to_text, search_pages
from .ingest import IngestDocument, upsert_document_chunks

from .chroma_service import ChromaService
from .config import settings
from .gap_analyzer import analyze_requirement
from .fsd_generator import generate_fsd, generate_fsd_docx
from .requirement_parser import (
    parse_requirements_from_docx,
    parse_requirements_from_pdf,
    parse_requirements_from_text,
)
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    GapResult,
    GenerateFsdRequest,
    GenerateFsdResponse,
    QueryRequest,
    QueryResponse,
    ChunkResult,
)


app = FastAPI(title="SFRA AI Agent API", version="0.2.0")
chroma = ChromaService()

origins = [origin.strip() for origin in settings.cors_allow_origins.split(",") if origin.strip()]
allow_credentials = True
if not origins:
    origins = ["*"]
    allow_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/query", response_model=QueryResponse)
def query_docs(payload: QueryRequest):
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")

    top_k = payload.top_k or settings.top_k
    response = chroma.query(question, top_k)
    chunks = []
    for text, meta, dist in zip(
        response["documents"][0],
        response["metadatas"][0],
        response["distances"][0],
    ):
        score = max(0.0, min(1.0, 1.0 - dist))
        chunks.append(ChunkResult(text=text, metadata=meta, score=score))

    return QueryResponse(question=question, top_k=top_k, results=chunks)


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest):
    requirements = payload.requirements_list or []
    if payload.requirements_text:
        requirements.extend(parse_requirements_from_text(payload.requirements_text))
    if not requirements:
        raise HTTPException(status_code=400, detail="requirements_text or requirements_list is required")

    top_k = payload.top_k or settings.top_k
    results = []
    for requirement in requirements:
        gap = analyze_requirement(chroma, requirement, top_k)
        results.append(GapResult(**gap.__dict__))
    return AnalyzeResponse(total=len(results), results=results)


@app.post("/analyze-file", response_model=AnalyzeResponse)
async def analyze_file(file: UploadFile = File(...), top_k: int = Form(None)):
    data = await file.read()
    filename = (file.filename or "").lower()
    if filename.endswith(".docx"):
        requirements = parse_requirements_from_docx(data)
    elif filename.endswith(".pdf"):
        requirements = parse_requirements_from_pdf(data)
    else:
        requirements = parse_requirements_from_text(data.decode("utf-8", errors="ignore"))

    if not requirements:
        raise HTTPException(status_code=400, detail="Could not extract requirements")

    use_top_k = top_k or settings.top_k
    results = []
    for requirement in requirements:
        gap = analyze_requirement(chroma, requirement, use_top_k)
        results.append(GapResult(**gap.__dict__))
    return AnalyzeResponse(total=len(results), results=results)


@app.post("/generate-fsd", response_model=GenerateFsdResponse)
def generate_fsd_endpoint(payload: GenerateFsdRequest):
    fsd = generate_fsd(payload.gap_results)
    return GenerateFsdResponse(fsd=fsd)


@app.post("/generate-fsd-docx")
def generate_fsd_docx_endpoint(payload: GenerateFsdRequest):
    fsd = generate_fsd(payload.gap_results)
    doc = generate_fsd_docx(fsd)
    buffer = io.BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=fsd.docx"}
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers=headers,
    )


@app.post("/ingest-confluence")
def ingest_confluence():
    space_keys = [key.strip() for key in settings.confluence_space_keys.split(",") if key.strip()]
    if not space_keys:
        raise HTTPException(status_code=400, detail="CONFLUENCE_SPACE_KEYS is not set")

    page_ids = search_pages(space_keys, settings.confluence_cql_extra.strip())
    if not page_ids:
        return {"pages": 0, "chunks": 0}

    total_chunks = 0
    for page_id in page_ids:
        page = fetch_page(page_id)
        text = page_to_text(page)
        if chroma.should_skip("confluence", page.page_id, text):
            continue
        doc = IngestDocument(
            source="confluence",
            source_id=page.page_id,
            title=page.title,
            url=page.url,
            space_key=page.space_key,
            updated_at=page.updated_at,
            text=text,
        )
        total_chunks += upsert_document_chunks(chroma, doc, task_type="retrieval_document")

    return {"pages": len(page_ids), "chunks": total_chunks}
