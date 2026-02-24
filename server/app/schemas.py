from typing import Optional

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    requirements_text: Optional[str] = None
    requirements_list: Optional[list[str]] = None
    top_k: Optional[int] = Field(default=None, ge=1, le=50)


class GapResult(BaseModel):
    requirement: str
    classification: str
    confidence: float
    rationale: str
    top_chunks: list[dict]


class AnalyzeResponse(BaseModel):
    total: int
    results: list[GapResult]


class GenerateFsdRequest(BaseModel):
    gap_results: list[dict]


class GenerateFsdResponse(BaseModel):
    fsd: str
    fsd_json: Optional[dict] = None


class QueryRequest(BaseModel):
    question: str
    top_k: Optional[int] = Field(default=None, ge=1, le=100)


class ChunkResult(BaseModel):
    text: str
    metadata: dict
    score: float


class QueryResponse(BaseModel):
    question: str
    top_k: int
    results: list[ChunkResult]
