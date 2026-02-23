from __future__ import annotations

from typing import Iterable

import google.generativeai as genai
from tenacity import retry, stop_after_attempt, wait_exponential

from .config import settings


genai.configure(api_key=settings.gemini_api_key)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
def embed_texts(texts: Iterable[str], task_type: str) -> list[list[float]]:
    embeddings: list[list[float]] = []
    for text in texts:
        response = genai.embed_content(
            model=settings.gemini_embed_model,
            content=text,
            task_type=task_type,
        )
        embeddings.append(response["embedding"])
    return embeddings


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
def generate_text(prompt: str) -> str:
    model = genai.GenerativeModel(settings.gemini_response_model)
    response = model.generate_content(prompt)
    return response.text or ""
