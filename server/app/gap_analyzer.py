from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Optional

from .chroma_service import ChromaService
from .llm_service import generate_text


logger = logging.getLogger(__name__)

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
    return 0.5 * similarity + 0.5 * llm_confidence


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
    response = chroma.query(requirement, top_k)
    documents = response["documents"][0]
    metadatas = response["metadatas"][0]
    distances = response["distances"][0]

    top_chunks = []
    top_score = 0.0
    for doc, meta, dist in zip(documents, metadatas, distances):
        score = _score_from_distance(dist)
        top_score = max(top_score, score)
        top_chunks.append(
            {
                "text": doc,
                "metadata": meta,
                "score": score,
            }
        )

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
                llm_confidence = float(parts[1])
                if len(parts) >= 3:
                    rationale = parts[2]
            else:
                logger.warning("LLM classify unparseable_response=%r", response_text[:500])
        except Exception as exc:
            logger.warning("LLM classify failed, using similarity only: %s", exc)
            rationale = "Similarity-based classification (LLM unavailable)"

    confidence = _combine_confidence(similarity_confidence, llm_confidence)
    citations = _build_citations(top_chunks)

    if classification == "Open Question" or confidence < 0.5:
        try:
            clarifying_questions = _generate_clarifying_questions(requirement, context)
        except Exception as exc:
            logger.warning("LLM questions failed: %s", exc)

    return GapResult(
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
    )
