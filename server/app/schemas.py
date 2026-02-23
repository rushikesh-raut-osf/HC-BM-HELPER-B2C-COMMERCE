from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    question: str
    top_k: int | None = Field(default=None, ge=1, le=100)
    include_answer: bool = False


class ChunkResult(BaseModel):
    source: str
    source_id: str
    title: str | None
    url: str | None
    space_key: str | None
    chunk_index: int
    chunk_text: str
    score: float


class QueryResponse(BaseModel):
    question: str
    top_k: int
    results: list[ChunkResult]
    answer: str | None = None
