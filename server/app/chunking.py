from __future__ import annotations

from typing import Iterable


def chunk_text(text: str, chunk_words: int, overlap_words: int) -> list[str]:
    words = text.split()
    if not words:
        return []

    chunks = []
    start = 0
    step = max(chunk_words - overlap_words, 1)
    while start < len(words):
        end = min(start + chunk_words, len(words))
        chunk = " ".join(words[start:end]).strip()
        if chunk:
            chunks.append(chunk)
        start += step
    return chunks


def dedupe_chunks(chunks: Iterable[str]) -> list[str]:
    seen = set()
    ordered = []
    for chunk in chunks:
        key = chunk.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append(chunk)
    return ordered
