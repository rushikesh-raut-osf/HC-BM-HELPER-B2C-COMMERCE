from __future__ import annotations

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import io
import html
import re
import json
import threading
import time
import uuid
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from .confluence import (
    create_child_page,
    fetch_page,
    find_child_page,
    list_folder_pages,
    list_spaces,
    page_to_text,
    search_pages,
)
from .ingest import IngestDocument, upsert_document_chunks

from .chroma_service import ChromaService
from .config import settings
from .gap_analyzer import analyze_requirement, analyze_requirement_agentic
from .llm_service import generate_text
from .fsd_generator import (
    generate_fsd_docx,
    generate_fsd_docx_from_text,
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
    FollowupStepRequest,
    FollowupStepResponse,
    FollowupStepOption,
    GenerateFsdRequest,
    GenerateFsdTextRequest,
    GenerateFsdResponse,
    SaveBaselineRequest,
    SaveBaselineResponse,
    QueryRequest,
    QueryResponse,
    ChunkResult,
    ConfluenceSpace,
    ConfluenceFolder,
    ConfluenceDuplicateCheckRequest,
    ConfluenceDuplicateCheckResponse,
    ConfluenceSaveRequest,
    ConfluenceSaveTextRequest,
    ConfluenceSaveResponse,
    IngestStartRequest,
    IngestStartResponse,
    IngestStatusResponse,
    WorkspaceStatePayload,
)
from .baseline_store import compare_to_baseline, load_baseline, save_baseline
from .thread_store import init_workspace_db, load_workspace_state, save_workspace_state


app = FastAPI(title="SFRA AI Agent API", version="0.2.0")
chroma = ChromaService()
ingest_jobs: dict[str, dict] = {}
ingest_jobs_lock = threading.Lock()
init_workspace_db()

FALLBACK_FOLLOWUP_STEPS = [
    {
        "question": "What exact scope and page context should this requirement apply to?",
        "options": [
            {"label": "Homepage module only", "recommended": True},
            {"label": "PLP/PDP and homepage consistency"},
            {"label": "Site-wide reusable component"},
        ],
    },
    {
        "question": "What behavior or rule should be strictly enforced?",
        "options": [
            {"label": "Business Manager configurable behavior", "recommended": True},
            {"label": "Hardcoded implementation for launch speed"},
            {"label": "Configurable + validation safeguards"},
        ],
    },
    {
        "question": "What data source and acceptance criteria should drive this requirement?",
        "options": [
            {"label": "Use existing SFRA/OOTB source first", "recommended": True},
            {"label": "Use external/custom API integration"},
            {"label": "Need both OOTB and project-specific FSD mapping"},
        ],
    },
]

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


def _analyze_single_requirement(requirement: str, top_k: int, agent_mode: bool):
    if agent_mode:
        return analyze_requirement_agentic(
            chroma,
            requirement,
            top_k,
            max_steps=settings.agentic_max_steps,
            stop_confidence=settings.agentic_stop_confidence,
        )
    return analyze_requirement(chroma, requirement, top_k)


def fsd_text_to_confluence_html(title: str, fsd_text: str) -> str:
    body_parts: list[str] = []
    in_toc_section = False
    inserted_toc_macro = False
    for raw_line in fsd_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.lower() in {"table of contents", "# table of contents"}:
            if not inserted_toc_macro:
                body_parts.append('<ac:structured-macro ac:name="toc"><ac:parameter ac:name="maxLevel">3</ac:parameter></ac:structured-macro>')
                inserted_toc_macro = True
            in_toc_section = True
            continue
        if in_toc_section:
            # Skip markdown TOC lines; Confluence TOC macro renders real heading links.
            if line.startswith("#"):
                in_toc_section = False
            else:
                continue
        if line.startswith("#"):
            level = min(3, len(line) - len(line.lstrip("#")))
            heading = html.escape(line.lstrip("#").strip())
            if heading:
                body_parts.append(f"<h{level + 1}>{heading}</h{level + 1}>")
            continue
        if re.match(r"^[-*]\s+", line):
            bullet = html.escape(re.sub(r"^[-*]\s+", "", line))
            body_parts.append(f"<ul><li>{bullet}</li></ul>")
            continue
        if re.match(r"^\d+\.\s+", line):
            numbered = html.escape(re.sub(r"^\d+\.\s+", "", line))
            body_parts.append(f"<ol><li>{numbered}</li></ol>")
            continue
        if line.endswith(":") and len(line) < 140:
            heading = html.escape(line[:-1].strip())
            body_parts.append(f"<h2>{heading}</h2>")
            continue
        body_parts.append(f"<p>{html.escape(line)}</p>")
    return f"<h1>{html.escape(title)}</h1>{''.join(body_parts)}"


def _extract_json_object(raw_text: str) -> dict | None:
    start = raw_text.find("{")
    end = raw_text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        payload = json.loads(raw_text[start : end + 1])
    except Exception:
        return None
    if isinstance(payload, dict):
        return payload
    return None


def _sanitize_followup_step(payload: dict, fallback_step: int) -> FollowupStepResponse:
    fallback = FALLBACK_FOLLOWUP_STEPS[min(fallback_step, len(FALLBACK_FOLLOWUP_STEPS) - 1)]
    question = str(payload.get("question") or fallback["question"]).strip()
    raw_options = payload.get("options")
    cleaned: list[dict] = []
    if isinstance(raw_options, list):
        for item in raw_options:
            if isinstance(item, dict):
                label = str(item.get("label") or "").strip()
                recommended = bool(item.get("recommended"))
            else:
                label = str(item).strip()
                recommended = False
            if label:
                cleaned.append({"label": label, "recommended": recommended})
    if not cleaned:
        cleaned = fallback["options"][:]

    # de-duplicate labels and clamp to 2-4 options
    deduped: list[dict] = []
    seen = set()
    for opt in cleaned:
        key = opt["label"].lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(opt)
    deduped = deduped[:4]
    if len(deduped) < 2:
        for fallback_opt in fallback["options"]:
            key = fallback_opt["label"].lower()
            if key in seen:
                continue
            deduped.append(fallback_opt)
            seen.add(key)
            if len(deduped) >= 2:
                break

    recommended_indices = [i for i, item in enumerate(deduped) if item.get("recommended")]
    if len(recommended_indices) != 1:
        for i, item in enumerate(deduped):
            item["recommended"] = i == 0

    return FollowupStepResponse(
        question=question,
        options=[FollowupStepOption(label=item["label"], recommended=bool(item["recommended"])) for item in deduped],
        allow_custom=True,
        is_terminal=bool(payload.get("is_terminal", False)),
    )


def _generate_followup_step(requirement: str, history: list[dict], step_index: int, max_steps: int) -> FollowupStepResponse:
    if step_index >= max_steps:
        fallback = FALLBACK_FOLLOWUP_STEPS[min(step_index, len(FALLBACK_FOLLOWUP_STEPS) - 1)]
        return FollowupStepResponse(
            question=fallback["question"],
            options=[FollowupStepOption(**opt) for opt in fallback["options"]],
            allow_custom=True,
            is_terminal=True,
        )

    history_text = "\n".join(
        [f"- Q: {item.get('question', '').strip()} | A: {item.get('answer', '').strip()}" for item in history]
    ).strip()
    prompt = (
        "You are preparing guided follow-up for requirement refinement.\n"
        "Return ONLY valid JSON with keys: question, options, is_terminal.\n"
        "options must be an array of 2-4 objects: {\"label\": string, \"recommended\": boolean}.\n"
        "Exactly one option must be recommended=true.\n"
        "Question should be concise and high-impact for SFRA requirement clarity.\n"
        "is_terminal should usually be false unless enough context already exists.\n\n"
        f"Step index: {step_index}\n"
        f"Max steps: {max_steps}\n"
        f"Requirement: {requirement}\n"
        f"History:\n{history_text or '(none)'}\n"
    )
    try:
        raw = generate_text(prompt).strip()
        parsed = _extract_json_object(raw) or {}
        return _sanitize_followup_step(parsed, step_index)
    except Exception:
        fallback = FALLBACK_FOLLOWUP_STEPS[min(step_index, len(FALLBACK_FOLLOWUP_STEPS) - 1)]
        return FollowupStepResponse(
            question=fallback["question"],
            options=[FollowupStepOption(**opt) for opt in fallback["options"]],
            allow_custom=True,
            is_terminal=step_index >= max_steps - 1,
        )


def _set_ingest_job(job_id: str, **updates) -> None:
    with ingest_jobs_lock:
        current = ingest_jobs.get(job_id)
        if not current:
            return
        current.update(updates)


def _run_confluence_ingest(progress_cb=None) -> dict:
    space_keys = [key.strip() for key in settings.confluence_space_keys.split(",") if key.strip()]
    if not space_keys:
        raise ValueError("CONFLUENCE_SPACE_KEYS is not set")

    if progress_cb:
        progress_cb(stage="Collecting Confluence pages...", progress=5)

    page_ids = search_pages(space_keys, settings.confluence_cql_extra.strip())
    total_pages = len(page_ids)
    if not page_ids:
        if progress_cb:
            progress_cb(
                stage="No pages found for configured Confluence spaces.",
                progress=100,
                pages_total=0,
                pages_processed=0,
                pages_indexed=0,
                pages_skipped=0,
                chunks=0,
            )
        return {"pages": 0, "chunks": 0, "indexed": 0, "skipped": 0}

    total_chunks = 0
    indexed_pages = 0
    skipped_pages = 0
    for idx, page_id in enumerate(page_ids, start=1):
        page = fetch_page(page_id)
        text = page_to_text(page)
        if chroma.should_skip("confluence", page.page_id, text):
            skipped_pages += 1
        else:
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
            indexed_pages += 1

        if progress_cb:
            page_progress = int((idx / total_pages) * 88)
            progress_cb(
                stage=f"Indexed {idx}/{total_pages} pages...",
                progress=min(98, 10 + page_progress),
                pages_total=total_pages,
                pages_processed=idx,
                pages_indexed=indexed_pages,
                pages_skipped=skipped_pages,
                chunks=total_chunks,
            )

    if progress_cb:
        progress_cb(
            stage="Ingestion completed.",
            progress=100,
            pages_total=total_pages,
            pages_processed=total_pages,
            pages_indexed=indexed_pages,
            pages_skipped=skipped_pages,
            chunks=total_chunks,
        )
    return {"pages": total_pages, "chunks": total_chunks, "indexed": indexed_pages, "skipped": skipped_pages}


def _normalize_web_url(url: str) -> str | None:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"}:
        return None
    normalized = parsed._replace(fragment="", params="")
    return normalized.geturl()


def _extract_web_links(html_text: str, base_url: str, host: str) -> list[str]:
    soup = BeautifulSoup(html_text, "html.parser")
    links: list[str] = []
    seen: set[str] = set()
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href") or "").strip()
        if not href or href.startswith(("javascript:", "mailto:", "tel:")):
            continue
        absolute = _normalize_web_url(urljoin(base_url, href))
        if not absolute:
            continue
        parsed = urlparse(absolute)
        if parsed.netloc.lower() != host.lower():
            continue
        lowered = parsed.path.lower()
        if lowered.endswith((".png", ".jpg", ".jpeg", ".svg", ".gif", ".pdf", ".zip")):
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        links.append(absolute)
    return links


def _extract_web_text(html_text: str) -> tuple[str, str]:
    soup = BeautifulSoup(html_text, "html.parser")
    for tag_name in ("script", "style", "noscript"):
        for node in soup.find_all(tag_name):
            node.decompose()
    title = (soup.title.get_text(strip=True) if soup.title else "") or "Web source"
    text = soup.get_text(separator="\n")
    cleaned = "\n".join([line.strip() for line in text.splitlines() if line.strip()])
    return title, cleaned


def _run_web_sources_ingest(links: list[dict], crawl_depth: int, max_pages: int, progress_cb=None) -> dict:
    queue: list[tuple[str, int, str, str]] = []
    seen: set[str] = set()
    total_chunks = 0
    indexed_pages = 0
    skipped_pages = 0
    processed_pages = 0
    crawl_depth = max(0, min(crawl_depth, 2))
    max_pages = max(1, min(max_pages, 300))

    for entry in links:
        raw_url = str(entry.get("url") or "").strip()
        normalized = _normalize_web_url(raw_url)
        if not normalized:
            continue
        note = str(entry.get("note") or "").strip()
        queue.append((normalized, 0, normalized, note))

    if not queue:
        return {"processed": 0, "indexed": 0, "skipped": 0, "chunks": 0}

    with httpx.Client(timeout=20.0, headers={"User-Agent": "Scout-Ingest/1.0"}) as client:
        while queue and processed_pages < max_pages:
            url, depth, seed_url, note = queue.pop(0)
            if url in seen:
                continue
            seen.add(url)

            try:
                response = client.get(url)
                response.raise_for_status()
            except Exception:
                skipped_pages += 1
                processed_pages += 1
                continue

            content_type = response.headers.get("content-type", "").lower()
            if "text/html" not in content_type:
                skipped_pages += 1
                processed_pages += 1
                continue

            html_text = response.text
            title, text = _extract_web_text(html_text)
            if not text.strip():
                skipped_pages += 1
                processed_pages += 1
                continue

            if note:
                text = f"Source Note: {note}\n\n{text}"
            source_id = url
            if chroma.should_skip("baseline_web", source_id, text):
                skipped_pages += 1
            else:
                doc = IngestDocument(
                    source="baseline_web",
                    source_id=source_id,
                    title=title,
                    url=url,
                    space_key=urlparse(seed_url).netloc.lower(),
                    updated_at=None,
                    text=text,
                )
                total_chunks += upsert_document_chunks(chroma, doc, task_type="retrieval_document")
                indexed_pages += 1
            processed_pages += 1

            if depth < crawl_depth:
                host = urlparse(seed_url).netloc
                discovered = _extract_web_links(html_text, url, host)
                for link in discovered[:40]:
                    if link not in seen:
                        queue.append((link, depth + 1, seed_url, note))

            if progress_cb:
                web_progress = 62 + int((processed_pages / max_pages) * 36)
                progress_cb(
                    progress=min(98, max(62, web_progress)),
                    web_pages_indexed=indexed_pages,
                    web_pages_skipped=skipped_pages,
                    stage=f"Indexed baseline web sources: {processed_pages} pages processed...",
                )

    return {
        "processed": processed_pages,
        "indexed": indexed_pages,
        "skipped": skipped_pages,
        "chunks": total_chunks,
    }


def _run_ingest_pipeline(payload: dict | None, progress_cb=None) -> dict:
    include_confluence = True if payload is None else bool(payload.get("include_confluence", True))
    baseline_links = payload.get("baseline_links", []) if payload else []
    crawl_depth = int(payload.get("crawl_depth", 1)) if payload else 1
    max_pages = int(payload.get("max_pages", 60)) if payload else 60

    total_chunks = 0
    confluence_result = {"pages": 0, "indexed": 0, "skipped": 0, "chunks": 0}
    web_result = {"processed": 0, "indexed": 0, "skipped": 0, "chunks": 0}

    if include_confluence:
        if progress_cb:
            progress_cb(stage="Starting Confluence ingestion...", progress=3)
        try:
            confluence_result = _run_confluence_ingest(progress_cb=progress_cb)
            total_chunks += confluence_result["chunks"]
        except ValueError:
            # Allow baseline-web-only ingestion when Confluence config is unavailable.
            if not baseline_links:
                raise
            if progress_cb:
                progress_cb(stage="Confluence ingestion skipped (configuration unavailable).", progress=58)

    if baseline_links:
        if progress_cb:
            progress_cb(stage="Starting baseline web source ingestion...", progress=62)
        web_result = _run_web_sources_ingest(
            baseline_links,
            crawl_depth=crawl_depth,
            max_pages=max_pages,
            progress_cb=progress_cb,
        )
        total_chunks += web_result["chunks"]

    return {
        "pages": confluence_result["pages"],
        "chunks": total_chunks,
        "indexed": confluence_result["indexed"],
        "skipped": confluence_result["skipped"],
        "web_pages_processed": web_result["processed"],
        "web_pages_indexed": web_result["indexed"],
        "web_pages_skipped": web_result["skipped"],
    }


def _run_ingest_job(job_id: str) -> None:
    _set_ingest_job(job_id, status="running")
    try:
        with ingest_jobs_lock:
            payload = dict(ingest_jobs.get(job_id, {}).get("payload") or {})

        result = _run_ingest_pipeline(progress_cb=lambda **kwargs: _set_ingest_job(job_id, **kwargs), payload=payload)
        _set_ingest_job(
            job_id,
            status="completed",
            progress=100,
            stage="Ingestion completed.",
            pages_total=result["pages"],
            pages_processed=result["pages"],
            pages_indexed=result["indexed"],
            pages_skipped=result["skipped"],
            web_pages_indexed=result["web_pages_indexed"],
            web_pages_skipped=result["web_pages_skipped"],
            chunks=result["chunks"],
            finished_at=time.time(),
            error=None,
        )
    except Exception as exc:
        _set_ingest_job(
            job_id,
            status="failed",
            stage="Ingestion failed.",
            finished_at=time.time(),
            error=str(exc),
        )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/workspace/state", response_model=WorkspaceStatePayload)
def workspace_state_get():
    state = load_workspace_state()
    return WorkspaceStatePayload(**state)


@app.post("/workspace/state", response_model=WorkspaceStatePayload)
def workspace_state_save(payload: WorkspaceStatePayload):
    latest = "1970-01-01T00:00:00.000Z"
    if payload.threads:
        latest = max((item.updated_at for item in payload.threads), default=latest)
    saved = save_workspace_state(payload.model_dump(), latest)
    return WorkspaceStatePayload(**saved)


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
    use_agent_mode = settings.agentic_default if payload.agent_mode is None else payload.agent_mode
    results = []
    for requirement in requirements:
        gap = _analyze_single_requirement(requirement, top_k, use_agent_mode)
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


@app.post("/analyze-agentic", response_model=AnalyzeResponse)
def analyze_agentic(payload: AnalyzeRequest):
    enforced_payload = payload.model_copy(update={"agent_mode": True})
    return analyze(enforced_payload)


@app.post("/analyze-file", response_model=AnalyzeResponse)
async def analyze_file(
    file: UploadFile = File(...),
    top_k: int = Form(None),
    agent_mode: bool | None = Form(None),
):
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
    use_agent_mode = settings.agentic_default if agent_mode is None else agent_mode
    for requirement in requirements:
        gap = _analyze_single_requirement(requirement, use_top_k, use_agent_mode)
        results.append(GapResult(**gap.__dict__))
    return AnalyzeResponse(total=len(results), results=results)


@app.post("/requirements/followup-step", response_model=FollowupStepResponse)
def followup_step(payload: FollowupStepRequest):
    requirement = payload.requirement.strip()
    if not requirement:
        raise HTTPException(status_code=400, detail="requirement is required")

    history = [item.model_dump() for item in payload.history]
    return _generate_followup_step(requirement, history, payload.step_index, payload.max_steps)


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
        gap = _analyze_single_requirement(requirement, top_k, settings.agentic_default)
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


@app.post("/generate-fsd-docx-text")
def generate_fsd_docx_text_endpoint(payload: GenerateFsdTextRequest):
    if not payload.fsd_text.strip():
        raise HTTPException(status_code=400, detail="fsd_text is required")
    doc = generate_fsd_docx_from_text(payload.fsd_text)
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
    try:
        result = _run_confluence_ingest()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to ingest Confluence content: {exc}") from exc
    return {"pages": result["pages"], "chunks": result["chunks"]}


@app.post("/ingest-confluence/start", response_model=IngestStartResponse)
def ingest_confluence_start(background_tasks: BackgroundTasks, payload: IngestStartRequest | None = None):
    job_id = str(uuid.uuid4())
    started_at = time.time()
    request_payload = payload.model_dump() if payload else {}
    with ingest_jobs_lock:
        ingest_jobs[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "stage": "Queued for ingestion.",
            "progress": 0,
            "pages_total": 0,
            "pages_processed": 0,
            "pages_indexed": 0,
            "pages_skipped": 0,
            "web_pages_indexed": 0,
            "web_pages_skipped": 0,
            "chunks": 0,
            "started_at": started_at,
            "finished_at": None,
            "error": None,
            "payload": request_payload,
        }
    background_tasks.add_task(_run_ingest_job, job_id)
    return IngestStartResponse(job_id=job_id, status="queued")


@app.get("/ingest-confluence/status/{job_id}", response_model=IngestStatusResponse)
def ingest_confluence_status(job_id: str):
    with ingest_jobs_lock:
        job = ingest_jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Ingestion job not found")
        payload = dict(job)
        payload.pop("payload", None)
    return IngestStatusResponse(**payload)


@app.get("/confluence/spaces", response_model=list[ConfluenceSpace])
def confluence_spaces():
    try:
        spaces = list_spaces()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch Confluence spaces: {exc}") from exc
    return [ConfluenceSpace(key=item.key, name=item.name) for item in spaces]


@app.get("/confluence/folders/{space_key}", response_model=list[ConfluenceFolder])
def confluence_folders(space_key: str):
    clean_space = space_key.strip()
    if not clean_space:
        raise HTTPException(status_code=400, detail="space_key is required")
    try:
        folders = list_folder_pages(clean_space)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch Confluence folders: {exc}") from exc
    return [ConfluenceFolder(id=item.page_id, title=item.title) for item in folders]


@app.post("/confluence/check-duplicate", response_model=ConfluenceDuplicateCheckResponse)
def confluence_check_duplicate(payload: ConfluenceDuplicateCheckRequest):
    if not payload.space_key.strip() or not payload.parent_id.strip() or not payload.title.strip():
        raise HTTPException(status_code=400, detail="space_key, parent_id, and title are required")
    try:
        existing = find_child_page(payload.space_key.strip(), payload.parent_id.strip(), payload.title.strip())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed duplicate check in Confluence: {exc}") from exc
    if not existing:
        return ConfluenceDuplicateCheckResponse(exists=False)
    return ConfluenceDuplicateCheckResponse(exists=True, page_id=existing.page_id)


@app.post("/confluence/save-fsd", response_model=ConfluenceSaveResponse)
def confluence_save_fsd(payload: ConfluenceSaveRequest):
    space_key = payload.space_key.strip()
    parent_id = payload.parent_id.strip()
    title = payload.title.strip()
    if not space_key or not parent_id or not title:
        raise HTTPException(status_code=400, detail="space_key, parent_id, and title are required")
    if not payload.gap_results:
        raise HTTPException(status_code=400, detail="gap_results is required")

    try:
        existing = find_child_page(space_key, parent_id, title)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed duplicate check in Confluence: {exc}") from exc

    if existing:
        raise HTTPException(status_code=409, detail="A Confluence page with this title already exists in selected folder")

    fsd_json = generate_fsd_json(payload.gap_results)
    fsd_text = render_fsd_text(fsd_json)
    storage_html = fsd_text_to_confluence_html(title, fsd_text)

    try:
        created = create_child_page(space_key, parent_id, title, storage_html)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to save page in Confluence: {exc}") from exc

    return ConfluenceSaveResponse(page_id=created.page_id, title=created.title, url=created.url)


@app.post("/confluence/save-fsd-text", response_model=ConfluenceSaveResponse)
def confluence_save_fsd_text(payload: ConfluenceSaveTextRequest):
    space_key = payload.space_key.strip()
    parent_id = payload.parent_id.strip()
    title = payload.title.strip()
    fsd_text = payload.fsd_text.strip()
    if not space_key or not parent_id or not title:
        raise HTTPException(status_code=400, detail="space_key, parent_id, and title are required")
    if not fsd_text:
        raise HTTPException(status_code=400, detail="fsd_text is required")

    try:
        existing = find_child_page(space_key, parent_id, title)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed duplicate check in Confluence: {exc}") from exc

    if existing:
        raise HTTPException(status_code=409, detail="A Confluence page with this title already exists in selected folder")

    storage_html = fsd_text_to_confluence_html(title, fsd_text)

    try:
        created = create_child_page(space_key, parent_id, title, storage_html)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to save page in Confluence: {exc}") from exc

    return ConfluenceSaveResponse(page_id=created.page_id, title=created.title, url=created.url)
