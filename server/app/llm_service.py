from __future__ import annotations

from typing import Iterable

from .config import settings
from .gemini_service import embed_texts as gemini_embed_texts
from .gemini_service import generate_text as gemini_generate_text
from .openai_service import embed_texts as openai_embed_texts
from .openai_service import generate_text as openai_generate_text


def _provider() -> str:
    return (settings.llm_provider or "gemini").strip().lower()


def embed_texts(texts: Iterable[str], task_type: str) -> list[list[float]]:
    provider = _provider()
    if provider == "openai":
        return openai_embed_texts(texts, task_type=task_type)
    if provider == "gemini":
        return gemini_embed_texts(texts, task_type=task_type)
    raise ValueError(f"Unsupported LLM_PROVIDER '{settings.llm_provider}'")


def generate_text(prompt: str) -> str:
    provider = _provider()
    if provider == "openai":
        return openai_generate_text(prompt)
    if provider == "gemini":
        return gemini_generate_text(prompt)
    raise ValueError(f"Unsupported LLM_PROVIDER '{settings.llm_provider}'")
