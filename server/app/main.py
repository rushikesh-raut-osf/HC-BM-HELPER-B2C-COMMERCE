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
from .fsd_generator import (
    generate_fsd_docx,
    generate_fsd_json,
    render_fsd_text,
)
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
    SaveBaselineRequest,
    SaveBaselineResponse,
    QueryRequest,
    QueryResponse,
    ChunkResult,
)
from .baseline_store import compare_to_baseline, load_baseline, save_baseline


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

    baseline_summary = None
    baseline_removed = None
    if payload.baseline_name:
        try:
            baseline = load_baseline(payload.baseline_name)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="Baseline not found")
        result_dicts = [r.model_dump() for r in results]
        comparison = compare_to_baseline(result_dicts, baseline)
        summary = comparison["summary"]
        results = [GapResult(**item) for item in result_dicts]
        baseline_summary = {
            "name": comparison.get("name") or payload.baseline_name,
            "created_at": comparison.get("created_at"),
            "added": summary.get("added", 0),
            "changed": summary.get("changed", 0),
            "unchanged": summary.get("unchanged", 0),
            "removed": summary.get("removed", 0),
        }
        baseline_removed = comparison.get("removed")

    return AnalyzeResponse(
        total=len(results),
        results=results,
        baseline=baseline_summary,
        baseline_removed=baseline_removed,
    )


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


@app.post("/save-baseline", response_model=SaveBaselineResponse)
def save_baseline_endpoint(payload: SaveBaselineRequest):
    requirements = payload.requirements_list or []
    if payload.requirements_text:
        requirements.extend(parse_requirements_from_text(payload.requirements_text))
    if not requirements:
        raise HTTPException(status_code=400, detail="requirements_text or requirements_list is required")

    top_k = payload.top_k or settings.top_k
    results = []
    for requirement in requirements:
        gap = analyze_requirement(chroma, requirement, top_k)
        results.append(GapResult(**gap.__dict__).model_dump())

    saved = save_baseline(payload.baseline_name, requirements, results)
    return SaveBaselineResponse(name=saved.name, created_at=saved.created_at, total=len(results))


@app.post("/generate-fsd", response_model=GenerateFsdResponse)
def generate_fsd_endpoint(payload: GenerateFsdRequest):
    fsd_json = generate_fsd_json(payload.gap_results)
    fsd_text = render_fsd_text(fsd_json)
    return GenerateFsdResponse(fsd=fsd_text, fsd_json=fsd_json)


@app.post("/generate-fsd-docx")
def generate_fsd_docx_endpoint(payload: GenerateFsdRequest):
    fsd_json = generate_fsd_json(payload.gap_results)
    doc = generate_fsd_docx(fsd_json)
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
