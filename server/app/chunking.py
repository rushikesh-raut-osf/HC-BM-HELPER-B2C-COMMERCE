from __future__ import annotations

from typing import Iterable

import tiktoken


def _encoding():
    return tiktoken.get_encoding("cl100k_base")


def chunk_text(text: str, chunk_tokens: int, overlap: int) -> list[str]:
    encoding = _encoding()
    tokens = encoding.encode(text)
    if not tokens:
        return []

    chunks = []
    start = 0
    step = max(chunk_tokens - overlap, 1)
    while start < len(tokens):
        end = min(start + chunk_tokens, len(tokens))
        chunk = encoding.decode(tokens[start:end]).strip()
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
