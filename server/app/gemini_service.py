from __future__ import annotations

from typing import Iterable

import google.generativeai as genai
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception
from google.api_core.exceptions import ResourceExhausted

from .config import settings


def _configure() -> None:
    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY is required when LLM_PROVIDER=gemini")
    genai.configure(api_key=settings.gemini_api_key)

def _normalize_model_name(name: str) -> str:
    if name.startswith("models/") or name.startswith("tunedModels/"):
        return name
    return f"models/{name}"


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception(
        lambda exc: not isinstance(exc, (ResourceExhausted, ValueError))
    ),
)
def embed_texts(texts: Iterable[str], task_type: str) -> list[list[float]]:
    _configure()
    embeddings: list[list[float]] = []
    model_name = _normalize_model_name(settings.gemini_embed_model)
    for text in texts:
        response = genai.embed_content(
            model=model_name,
            content=text,
            task_type=task_type,
        )
        embeddings.append(response["embedding"])
    return embeddings


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception(
        lambda exc: not isinstance(exc, (ResourceExhausted, ValueError))
    ),
)
def generate_text(prompt: str) -> str:
    _configure()
    model = genai.GenerativeModel(_normalize_model_name(settings.gemini_response_model))
    response = model.generate_content(prompt)
    return response.text or ""
