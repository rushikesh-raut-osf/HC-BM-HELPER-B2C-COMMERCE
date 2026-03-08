from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
import re
from typing import Optional

from .capability_synonyms import expand_requirement_query
from .chroma_service import ChromaService
from .llm_service import generate_text


logger = logging.getLogger(__name__)

_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "have",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "with",
}


@dataclass
class GapResult:
    requirement: str
    classification: str
    confidence: float
    top_chunks: list[dict]
    rationale: str
    similarity_score: float
    llm_confidence: Optional[float]
    llm_response: Optional[str]
    citations: Optional[list[dict]]
    clarifying_questions: Optional[list[str]]
    implementation_mode: Optional[str]
    coverage_status: Optional[str]
    project_match_status: Optional[str]
    gaps: Optional[list[str]]


def _score_from_distance(distance: float) -> float:
    if distance is None:
        return 0.0
    score = 1.0 - distance
    return max(0.0, min(score, 1.0))


def _classify_from_score(score: float) -> str:
    if score >= 0.85:
        return "OOTB Match"
    if score >= 0.65:
        return "Partial Match"
    if score >= 0.4:
        return "Custom Dev Required"
    return "Open Question"


def _combine_confidence(similarity: Optional[float], llm_confidence: Optional[float]) -> float:
    if similarity is None and llm_confidence is None:
        return 0.0
    if llm_confidence is None:
        return similarity or 0.0
    if similarity is None:
        return llm_confidence
    # Keep semantic retrieval as primary signal; LLM confidence is a refinement.
    return 0.6 * similarity + 0.4 * llm_confidence


def _normalize_classification_with_confidence(classification: str, confidence: float) -> str:
    # Prevent contradictory outputs such as "Partial Match" with very low confidence.
    if classification == "OOTB Match" and confidence < 0.62:
        return "Partial Match"
    if classification == "Partial Match" and confidence < 0.45:
        return "Open Question"
    if classification == "Custom Dev Required" and confidence < 0.4:
        return "Open Question"
    return classification


def _build_citations(top_chunks: list[dict], limit: int = 3) -> list[dict]:
    citations: list[dict] = []
    for chunk in top_chunks[:limit]:
        meta = chunk.get("metadata") or {}
        citations.append(
            {
                "source": meta.get("source"),
                "source_id": meta.get("source_id"),
                "title": meta.get("title"),
                "url": meta.get("url"),
                "chunk_index": meta.get("chunk_index"),
                "score": chunk.get("score"),
            }
        )
    return citations


def _extract_questions(text: str) -> list[str]:
    lines = [line.strip().lstrip("-•*").strip() for line in text.splitlines()]
    questions = [line for line in lines if line]
    if len(questions) == 1 and ";" in questions[0]:
        parts = [part.strip() for part in questions[0].split(";") if part.strip()]
        if parts:
            questions = parts
    return questions[:5]


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


def _coerce_confidence(value: object) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(number, 1.0))


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _tokenize(text: str) -> set[str]:
    tokens = re.findall(r"[a-z0-9]+", (text or "").lower())
    return {token for token in tokens if token not in _STOPWORDS and len(token) > 2}


def _lexical_overlap(a: str, b: str) -> float:
    tokens_a = _tokenize(a)
    tokens_b = _tokenize(b)
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    if not union:
        return 0.0
    return len(intersection) / len(union)


def _is_official_sfra_chunk(chunk: dict) -> bool:
    meta = chunk.get("metadata") or {}
    source = str(meta.get("source") or "").lower()
    source_id = str(meta.get("source_id") or "").lower()
    url = str(meta.get("url") or "").lower()
    if source != "baseline_web":
        return False
    return (
        "developer.salesforce.com/docs/commerce/sfra" in source_id
        or "developer.salesforce.com/docs/commerce/sfra" in url
    )


def _split_chunk_sources(chunks: list[dict]) -> tuple[list[dict], list[dict]]:
    project_chunks: list[dict] = []
    baseline_chunks: list[dict] = []
    for chunk in chunks:
        meta = chunk.get("metadata") or {}
        source = str(meta.get("source") or "").lower()
        if source == "confluence":
            project_chunks.append(chunk)
        if source in {"baseline_web", "sfcc"} or _is_official_sfra_chunk(chunk):
            baseline_chunks.append(chunk)
    return project_chunks, baseline_chunks


def _is_project_doc_trusted(chunk: dict) -> bool:
    meta = chunk.get("metadata") or {}
    token = " ".join(
        [
            str(meta.get("title") or ""),
            str(meta.get("source_id") or ""),
            str(meta.get("url") or ""),
            str(chunk.get("text") or "")[:200],
        ]
    ).lower()
    # Avoid promoting generic templates/how-to snippets as implementation proof.
    blocked = {"template", "how-to", "how to", "boilerplate", "sample"}
    return not any(term in token for term in blocked)


def _is_recent_project_doc(chunk: dict, max_age_days: int = 720) -> bool:
    meta = chunk.get("metadata") or {}
    raw = str(meta.get("updated_at") or "").strip()
    if not raw:
        # Do not block when date metadata is missing.
        return True
    try:
        normalized = raw.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return True
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    age_days = (datetime.now(timezone.utc) - dt).days
    return age_days <= max_age_days


def _project_chunk_text(chunk: dict) -> str:
    meta = chunk.get("metadata") or {}
    return " ".join(
        [
            str(meta.get("title") or ""),
            str(meta.get("source_id") or ""),
            str(chunk.get("text") or ""),
        ]
    )


def _project_reliability_gate(requirement: str, project_chunks: list[dict]) -> tuple[bool, Optional[dict]]:
    if not project_chunks:
        return False, None
    best = project_chunks[0]
    best_score = float(best.get("score") or 0.0)
    overlap = _lexical_overlap(requirement, _project_chunk_text(best))
    trusted = _is_project_doc_trusted(best)
    recent = _is_recent_project_doc(best)
    reliable = best_score >= 0.72 and overlap >= 0.18 and trusted and recent
    return reliable, best


def _detect_project_match_status(requirement: str, reliable: bool, project_chunks: list[dict]) -> str:
    if not project_chunks:
        return "not_implemented"
    best_overlap = max(_lexical_overlap(requirement, _project_chunk_text(chunk)) for chunk in project_chunks[:6])
    if reliable and best_overlap >= 0.48:
        return "already_implemented"
    if best_overlap >= 0.2:
        return "partially_implemented"
    return "not_implemented"


def _extract_requirement_clauses(requirement: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", requirement.strip())
    if not normalized:
        return []
    parts = re.split(r"\b(?:and|with|plus|including|along with)\b|[,;]", normalized, flags=re.IGNORECASE)
    clauses = [part.strip(" .:-") for part in parts]
    clauses = [clause for clause in clauses if len(_tokenize(clause)) >= 3]
    return clauses[:8]


def _derive_gaps(
    requirement: str,
    classification: str,
    project_status: str,
    project_chunks: list[dict],
    baseline_chunks: list[dict],
) -> list[str]:
    if classification not in {"Partial Match", "Open Question", "Custom Dev Required"} and project_status != "partially_implemented":
        return []
    clauses = _extract_requirement_clauses(requirement)
    if not clauses:
        return []
    project_text = " ".join((chunk.get("text") or "")[:600] for chunk in project_chunks[:6])
    baseline_text = " ".join((chunk.get("text") or "")[:600] for chunk in baseline_chunks[:6])
    gaps: list[str] = []
    for clause in clauses:
        project_overlap = _lexical_overlap(clause, project_text)
        baseline_overlap = _lexical_overlap(clause, baseline_text)
        if project_overlap < 0.22 and baseline_overlap < 0.22:
            gaps.append(clause)
    if not gaps and classification == "Partial Match":
        gaps.append("Additional extension beyond current configuration is required for complete scope.")
    return gaps[:5]


def _infer_coverage_status(
    classification: str,
    implementation_mode: str,
    baseline_chunks: list[dict],
) -> str:
    has_baseline_support = bool(baseline_chunks) or _contains_official_sfra_evidence(baseline_chunks)
    if classification == "OOTB Match" and implementation_mode == "config_only":
        return "supported"
    if classification == "Partial Match" or implementation_mode == "config_plus_code":
        return "supported_with_extensions"
    if classification == "Custom Dev Required" and not has_baseline_support:
        return "unsupported"
    if classification == "Custom Dev Required" and implementation_mode == "code_only":
        return "unsupported"
    return "uncertain"


def _apply_project_first_flow(
    requirement: str,
    classification: str,
    confidence: float,
    rationale: str,
    llm_response: Optional[str],
    chunks: list[dict],
) -> tuple[str, str, str, str, list[str], str]:
    project_chunks, baseline_chunks = _split_chunk_sources(chunks)
    reliable_project_match, _ = _project_reliability_gate(requirement, project_chunks)
    project_status = _detect_project_match_status(requirement, reliable_project_match, project_chunks)

    mode_source = project_chunks if reliable_project_match and project_chunks else chunks
    implementation_mode = _infer_implementation_mode(
        requirement=requirement,
        chunks=mode_source,
        classification=classification,
        rationale=rationale,
        llm_response=llm_response,
    )

    adjusted_classification = classification
    if reliable_project_match and project_status == "already_implemented":
        if implementation_mode == "config_only":
            adjusted_classification = "OOTB Match"
        elif implementation_mode == "config_plus_code":
            adjusted_classification = "Partial Match"
        elif implementation_mode == "code_only":
            adjusted_classification = "Custom Dev Required"
    elif reliable_project_match and project_status == "partially_implemented":
        if adjusted_classification != "Custom Dev Required" or confidence < 0.72:
            adjusted_classification = "Partial Match"
    else:
        # Baseline-led fallback still uses implementation mode to avoid over-penalizing config-only scope.
        if implementation_mode == "config_only" and adjusted_classification == "Custom Dev Required" and confidence < 0.78:
            adjusted_classification = "Partial Match"

    gaps = _derive_gaps(
        requirement=requirement,
        classification=adjusted_classification,
        project_status=project_status,
        project_chunks=project_chunks,
        baseline_chunks=baseline_chunks,
    )
    coverage_status = _infer_coverage_status(adjusted_classification, implementation_mode, baseline_chunks)

    if adjusted_classification != classification:
        rationale = f"{rationale}. Flow adjustment applied from project-first evidence and implementation mode."
    return adjusted_classification, implementation_mode, coverage_status, project_status, gaps, rationale


def _retrieve_chunks(
    chroma: ChromaService,
    query_text: str,
    top_k: int,
    source_filters: Optional[list[str]] = None,
) -> tuple[list[dict], float]:
    retrieval_query = expand_requirement_query(query_text)
    where_filter = None
    if source_filters:
        where_filter = {"source": {"$in": source_filters}}
    response = chroma.query(retrieval_query, top_k, where_filter=where_filter)
    documents = response["documents"][0]
    metadatas = response["metadatas"][0]
    distances = response["distances"][0]

    chunks: list[dict] = []
    top_score = 0.0
    for doc, meta, dist in zip(documents, metadatas, distances):
        score = _score_from_distance(dist)
        source = str((meta or {}).get("source") or "").lower()
        source_id = str((meta or {}).get("source_id") or "").lower()
        url = str((meta or {}).get("url") or "").lower()

        # Prioritize official/ingested SFRA baseline evidence so it is surfaced in top chunks.
        bonus = 0.0
        if source == "baseline_web":
            bonus += 0.08
        is_official_sfra = (
            "developer.salesforce.com/docs/commerce/sfra" in source_id
            or "developer.salesforce.com/docs/commerce/sfra" in url
        )
        if is_official_sfra:
            bonus += 0.1
            lexical = _lexical_overlap(query_text, doc or "")
            if lexical >= 0.5:
                bonus += 0.12
            normalized_query = _normalize_text(query_text)
            normalized_doc = _normalize_text(doc or "")
            if len(normalized_query) >= 12 and normalized_query in normalized_doc:
                bonus += 0.15
        if source == "confluence" and ("fsd" in source_id or "project" in source_id):
            bonus += 0.03

        boosted_score = max(0.0, min(1.0, score + bonus))
        top_score = max(top_score, boosted_score)
        chunks.append(
            {
                "text": doc,
                "metadata": meta,
                "score": boosted_score,
                "raw_score": score,
            }
        )
    chunks.sort(key=lambda item: item.get("score", 0.0), reverse=True)
    chunks = chunks[: max(top_k, 10)]
    return chunks, top_score


def _retrieve_two_pass(chroma: ChromaService, query_text: str, top_k: int) -> tuple[list[dict], float]:
    # Pass 1: project-first retrieval from Confluence/FSD space.
    project_chunks, project_top = _retrieve_chunks(
        chroma,
        query_text,
        top_k,
        source_filters=["confluence"],
    )
    reliable_project_match, _ = _project_reliability_gate(query_text, project_chunks)
    project_status = _detect_project_match_status(query_text, reliable_project_match, project_chunks)

    # Pass 2: baseline retrieval for missing/uncertain scope.
    baseline_chunks: list[dict] = []
    baseline_top = 0.0
    should_run_baseline = (not reliable_project_match) or project_status != "already_implemented"
    if should_run_baseline:
        baseline_chunks, baseline_top = _retrieve_chunks(
            chroma,
            query_text,
            top_k,
            source_filters=["baseline_web", "sfcc"],
        )

    merged = _merge_chunks(project_chunks, baseline_chunks, limit=max(top_k, 10))
    top_score = max(project_top, baseline_top)
    if merged:
        return merged, top_score

    # Fallback: mixed retrieval if source-scoped filters returned nothing.
    return _retrieve_chunks(chroma, query_text, top_k)


def _merge_chunks(existing: list[dict], incoming: list[dict], limit: int) -> list[dict]:
    seen: set[str] = set()
    merged: list[dict] = []
    for chunk in existing + incoming:
        meta = chunk.get("metadata") or {}
        dedupe_key = "|".join(
            [
                str(meta.get("source") or ""),
                str(meta.get("source_id") or ""),
                str(meta.get("chunk_index") or ""),
                (chunk.get("text") or "")[:80],
            ]
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        merged.append(chunk)
    merged.sort(key=lambda item: item.get("score", 0.0), reverse=True)
    return merged[:limit]


def _contains_official_sfra_evidence(chunks: list[dict]) -> bool:
    for chunk in chunks[:6]:
        if _is_official_sfra_chunk(chunk):
            return True
    return False


def _best_official_overlap(requirement: str, chunks: list[dict]) -> tuple[float, bool]:
    normalized_requirement = _normalize_text(requirement)
    best_overlap = 0.0
    phrase_hit = False
    for chunk in chunks[:8]:
        if not _is_official_sfra_chunk(chunk):
            continue
        text = chunk.get("text") or ""
        best_overlap = max(best_overlap, _lexical_overlap(requirement, text))
        normalized_chunk = _normalize_text(text)
        if len(normalized_requirement) >= 12 and normalized_requirement in normalized_chunk:
            phrase_hit = True
    return best_overlap, phrase_hit


def _promote_classification_with_baseline_signal(
    requirement: str,
    classification: str,
    confidence: float,
    chunks: list[dict],
) -> str:
    # If we have strong official SFRA evidence, avoid weak/flat "Partial" outputs by default.
    best_overlap, phrase_hit = _best_official_overlap(requirement, chunks)
    if phrase_hit and classification in {"Partial Match", "Custom Dev Required", "Open Question"}:
        return "OOTB Match"
    if best_overlap >= 0.55 and confidence >= 0.5 and classification in {"Open Question", "Partial Match"}:
        return "OOTB Match"
    if best_overlap >= 0.45 and confidence >= 0.58 and classification == "Custom Dev Required":
        return "Partial Match"
    if _contains_official_sfra_evidence(chunks) and confidence >= 0.6:
        if classification in {"Open Question", "Partial Match"}:
            return "OOTB Match"
    return classification


def _infer_implementation_mode(
    requirement: str,
    chunks: list[dict],
    classification: str,
    rationale: str,
    llm_response: Optional[str],
) -> str:
    text_pool = " ".join(
        [
            requirement or "",
            rationale or "",
            llm_response or "",
            " ".join([(chunk.get("text") or "")[:500] for chunk in chunks[:6]]),
        ]
    ).lower()

    config_signals = [
        "business manager",
        "page designer",
        "content slot",
        "content assets",
        "merchant tools",
        "configuration",
        "configure",
        "setting",
    ]
    code_signals = [
        "cartridge",
        "template",
        "isml",
        "controller",
        "pipeline",
        "javascript",
        "server-side",
        "custom component",
        "customization",
        "implement in code",
        "code change",
        "development effort",
    ]

    config_hits = sum(1 for signal in config_signals if signal in text_pool)
    code_hits = sum(1 for signal in code_signals if signal in text_pool)

    if classification == "OOTB Match" and code_hits == 0:
        return "config_only"
    if classification == "Custom Dev Required" and code_hits > 0 and config_hits == 0:
        return "code_only"
    if code_hits > 0 and config_hits > 0:
        return "config_plus_code"
    if config_hits > 0 and code_hits == 0:
        return "config_only"
    if code_hits > 0 and config_hits == 0:
        return "code_only"
    if classification == "Partial Match":
        return "config_plus_code"
    return "uncertain"


def _generate_clarifying_questions(requirement: str, context: str) -> Optional[list[str]]:
    prompt = (
        "Create 3-5 concise clarifying questions needed to finalize this requirement.\n"
        "Return each question on its own line with no numbering.\n\n"
        f"Requirement: {requirement}\n\n"
        f"Context:\n{context}\n"
    )
    response_text = generate_text(prompt).strip()
    if not response_text:
        return None
    questions = _extract_questions(response_text)
    return questions or None


def analyze_requirement(chroma: ChromaService, requirement: str, top_k: int) -> GapResult:
    top_chunks, top_score = _retrieve_two_pass(chroma, requirement, top_k)

    classification = _classify_from_score(top_score)
    similarity_confidence = top_score
    rationale = "Similarity-based classification"
    llm_confidence: Optional[float] = None

    llm_response: Optional[str] = None
    clarifying_questions: Optional[list[str]] = None

    context = ""
    if top_chunks:
        context = "\n\n".join([chunk["text"][:800] for chunk in top_chunks[:3]])
        prompt = (
            "You are classifying SFRA coverage for a requirement.\n"
            "Classes: OOTB Match, Partial Match, Custom Dev Required, Open Question.\n"
            "Use evidence-first reasoning.\n"
            "If context explicitly states a feature is available in SFRA out of the box, prefer OOTB Match.\n"
            "Use Custom Dev Required only when evidence indicates the feature is unsupported or requires net-new code.\n"
            "Return a single line with: <classification> | <confidence 0-1> | <short rationale>.\n\n"
            f"Requirement: {requirement}\n\n"
            f"Context:\n{context}\n"
        )
        try:
            logger.info(
                "LLM classify start requirement_len=%d context_len=%d",
                len(requirement),
                len(context),
            )
            response_text = generate_text(prompt).strip()
            llm_response = response_text
            logger.info("LLM classify raw_response=%r", response_text[:500])
            parts = [part.strip() for part in response_text.split("|")]
            if len(parts) >= 2:
                candidate = parts[0]
                allowed = {
                    "OOTB Match",
                    "Partial Match",
                    "Custom Dev Required",
                    "Open Question",
                }
                if candidate in allowed:
                    classification = candidate
                try:
                    llm_confidence = max(0.0, min(float(parts[1]), 1.0))
                except (TypeError, ValueError):
                    llm_confidence = None
                if len(parts) >= 3:
                    rationale = parts[2]
            else:
                logger.warning("LLM classify unparseable_response=%r", response_text[:500])
        except Exception as exc:
            logger.warning("LLM classify failed, using similarity only: %s", exc)
            rationale = "Similarity-based classification (LLM unavailable)"

    confidence = _combine_confidence(similarity_confidence, llm_confidence)
    classification = _normalize_classification_with_confidence(classification, confidence)
    classification = _promote_classification_with_baseline_signal(
        requirement,
        classification,
        confidence,
        top_chunks,
    )
    citations = _build_citations(top_chunks)

    if classification == "Open Question" or confidence < 0.5:
        try:
            clarifying_questions = _generate_clarifying_questions(requirement, context)
        except Exception as exc:
            logger.warning("LLM questions failed: %s", exc)

    result = GapResult(
        requirement=requirement,
        classification=classification,
        confidence=round(confidence, 3),
        top_chunks=top_chunks,
        rationale=rationale,
        similarity_score=round(similarity_confidence, 3),
        llm_confidence=llm_confidence,
        llm_response=llm_response,
        citations=citations,
        clarifying_questions=clarifying_questions,
        implementation_mode=None,
        coverage_status=None,
        project_match_status=None,
        gaps=None,
    )
    (
        result.classification,
        result.implementation_mode,
        result.coverage_status,
        result.project_match_status,
        result.gaps,
        result.rationale,
    ) = _apply_project_first_flow(
        requirement=requirement,
        classification=result.classification,
        confidence=result.confidence,
        rationale=result.rationale,
        llm_response=result.llm_response,
        chunks=result.top_chunks,
    )
    return result


def analyze_requirement_agentic(
    chroma: ChromaService,
    requirement: str,
    top_k: int,
    max_steps: int = 3,
    stop_confidence: float = 0.75,
) -> GapResult:
    """
    Agentic multi-step analysis with strict fallback to the baseline analyzer.
    """
    try:
        max_steps = max(1, min(max_steps, 6))
        retrieved_chunks, top_score = _retrieve_two_pass(chroma, requirement, top_k)
        if not retrieved_chunks:
            return analyze_requirement(chroma, requirement, top_k)

        working_chunks = retrieved_chunks[:]
        llm_trace: list[str] = []
        llm_confidence: Optional[float] = None
        classification = _classify_from_score(top_score)
        rationale = "Similarity-based classification"
        clarifying_questions: Optional[list[str]] = None
        explored_queries = {requirement.strip().lower()}

        for step in range(max_steps):
            context = "\n\n".join([chunk["text"][:800] for chunk in working_chunks[:4]])
            prompt = (
                "You are an SFRA requirement analysis agent.\n"
                "Use evidence-first reasoning; do not choose Custom Dev Required if official SFRA evidence supports OOTB coverage.\n"
                "Decide next best action based on current evidence.\n"
                "Return ONLY valid JSON with keys:\n"
                "classification: one of [OOTB Match, Partial Match, Custom Dev Required, Open Question]\n"
                "confidence: number 0..1\n"
                "rationale: short text\n"
                "next_action: one of [retrieve, clarify, finalize]\n"
                "next_query: string (required only for retrieve)\n"
                "clarifying_question: string (required only for clarify)\n\n"
                f"Requirement: {requirement}\n"
                f"Step: {step + 1}/{max_steps}\n"
                f"Current top evidence count: {len(working_chunks)}\n"
                f"Current evidence:\n{context}\n"
            )
            response_text = generate_text(prompt).strip()
            llm_trace.append(response_text)
            payload = _extract_json_object(response_text)
            if not payload:
                break

            candidate = str(payload.get("classification") or "").strip()
            if candidate in {"OOTB Match", "Partial Match", "Custom Dev Required", "Open Question"}:
                classification = candidate
            llm_confidence = _coerce_confidence(payload.get("confidence"))
            if payload.get("rationale"):
                rationale = str(payload["rationale"]).strip()

            confidence = _combine_confidence(top_score, llm_confidence)
            next_action = str(payload.get("next_action") or "finalize").strip().lower()
            if next_action == "clarify":
                question = str(payload.get("clarifying_question") or "").strip()
                if question:
                    clarifying_questions = [question]
                if confidence >= stop_confidence:
                    break
                next_action = "finalize"

            if next_action == "retrieve":
                next_query = str(payload.get("next_query") or "").strip()
                if not next_query:
                    break
                normalized = next_query.lower()
                if normalized in explored_queries:
                    break
                explored_queries.add(normalized)
                new_chunks, new_top = _retrieve_two_pass(chroma, next_query, top_k)
                top_score = max(top_score, new_top)
                working_chunks = _merge_chunks(working_chunks, new_chunks, limit=max(top_k, 10))
                continue

            if next_action == "finalize":
                break

        final_confidence = _combine_confidence(top_score, llm_confidence)
        classification = _normalize_classification_with_confidence(classification, final_confidence)
        classification = _promote_classification_with_baseline_signal(
            requirement,
            classification,
            final_confidence,
            working_chunks,
        )
        citations = _build_citations(working_chunks)

        if not clarifying_questions and (classification == "Open Question" or final_confidence < 0.5):
            try:
                context = "\n\n".join([chunk["text"][:800] for chunk in working_chunks[:3]])
                clarifying_questions = _generate_clarifying_questions(requirement, context)
            except Exception as exc:
                logger.warning("LLM questions failed: %s", exc)

        result = GapResult(
            requirement=requirement,
            classification=classification,
            confidence=round(final_confidence, 3),
            top_chunks=working_chunks,
            rationale=rationale,
            similarity_score=round(top_score, 3),
            llm_confidence=llm_confidence,
            llm_response="\n\n".join(llm_trace) if llm_trace else None,
            citations=citations,
            clarifying_questions=clarifying_questions,
            implementation_mode=None,
            coverage_status=None,
            project_match_status=None,
            gaps=None,
        )
        (
            result.classification,
            result.implementation_mode,
            result.coverage_status,
            result.project_match_status,
            result.gaps,
            result.rationale,
        ) = _apply_project_first_flow(
            requirement=requirement,
            classification=result.classification,
            confidence=result.confidence,
            rationale=result.rationale,
            llm_response=result.llm_response,
            chunks=result.top_chunks,
        )
        return result
    except Exception as exc:
        logger.warning("Agentic analyze failed, falling back to baseline: %s", exc)
        return analyze_requirement(chroma, requirement, top_k)
