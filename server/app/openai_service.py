from __future__ import annotations

from typing import Iterable

from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception

from .config import settings


def _get_client():
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY is required when LLM_PROVIDER=openai")
    from openai import OpenAI

    return OpenAI(api_key=settings.openai_api_key)


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception(lambda exc: not isinstance(exc, ValueError)),
)
def embed_texts(texts: Iterable[str], task_type: str) -> list[list[float]]:
    client = _get_client()
    response = client.embeddings.create(
        model=settings.openai_embed_model,
        input=list(texts),
    )
    return [item.embedding for item in response.data]


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception(lambda exc: not isinstance(exc, ValueError)),
)
def generate_text(prompt: str) -> str:
    client = _get_client()
    response = client.chat.completions.create(
        model=settings.openai_response_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )
    return response.choices[0].message.content or ""
