from __future__ import annotations

from dataclasses import dataclass

from .chroma_service import ChromaService
from .gemini_service import generate_text


@dataclass
class GapResult:
    requirement: str
    classification: str
    confidence: float
    top_chunks: list[dict]
    rationale: str


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
    return "Custom Dev Required"


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
    confidence = top_score
    rationale = "Similarity-based classification"

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
            response_text = generate_text(prompt).strip()
            parts = [part.strip() for part in response_text.split("|")]
            if len(parts) >= 2:
                classification = parts[0]
                confidence = float(parts[1])
                if len(parts) >= 3:
                    rationale = parts[2]
        except Exception:
            pass

    return GapResult(
        requirement=requirement,
        classification=classification,
        confidence=round(confidence, 3),
        top_chunks=top_chunks,
        rationale=rationale,
    )
