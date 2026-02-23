from openai import OpenAI

from .config import settings


client = OpenAI(api_key=settings.openai_api_key)


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    params = {
        "model": settings.openai_embedding_model,
        "input": texts,
    }
    if settings.openai_embedding_dimensions:
        params["dimensions"] = settings.openai_embedding_dimensions
    response = client.embeddings.create(**params)
    return [item.embedding for item in response.data]
