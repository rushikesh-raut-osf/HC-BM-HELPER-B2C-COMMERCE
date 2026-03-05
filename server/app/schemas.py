from typing import Optional

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    requirements_text: Optional[str] = None
    requirements_list: Optional[list[str]] = None
    top_k: Optional[int] = Field(default=None, ge=1, le=50)
    baseline_name: Optional[str] = None


class GapResult(BaseModel):
    requirement: str
    classification: str
    confidence: float
    rationale: str
    top_chunks: list[dict]
    citations: Optional[list[dict]] = None
    clarifying_questions: Optional[list[str]] = None
    similarity_score: Optional[float] = None
    llm_confidence: Optional[float] = None
    llm_response: Optional[str] = None
    baseline_status: Optional[str] = None
    baseline_requirement: Optional[str] = None
    baseline_classification: Optional[str] = None
    baseline_confidence: Optional[float] = None
    baseline_similarity: Optional[float] = None


class BaselineSummary(BaseModel):
    name: str
    created_at: Optional[str] = None
    added: int
    changed: int
    unchanged: int
    removed: int


class BaselineRemovedItem(BaseModel):
    requirement: Optional[str] = None
    classification: Optional[str] = None
    confidence: Optional[float] = None


class AnalyzeResponse(BaseModel):
    total: int
    results: list[GapResult]
    baseline: Optional[BaselineSummary] = None
    baseline_removed: Optional[list[BaselineRemovedItem]] = None


class GenerateFsdRequest(BaseModel):
    gap_results: list[dict]


class GenerateFsdTextRequest(BaseModel):
    fsd_text: str


class SaveBaselineRequest(BaseModel):
    baseline_name: str
    requirements_text: Optional[str] = None
    requirements_list: Optional[list[str]] = None
    top_k: Optional[int] = Field(default=None, ge=1, le=50)


class SaveBaselineResponse(BaseModel):
    name: str
    created_at: str
    total: int


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


class ConfluenceSpace(BaseModel):
    key: str
    name: str


class ConfluenceFolder(BaseModel):
    id: str
    title: str


class ConfluenceDuplicateCheckRequest(BaseModel):
    space_key: str
    parent_id: str
    title: str


class ConfluenceDuplicateCheckResponse(BaseModel):
    exists: bool
    page_id: Optional[str] = None


class ConfluenceSaveRequest(BaseModel):
    space_key: str
    parent_id: str
    title: str
    gap_results: list[dict]


class ConfluenceSaveResponse(BaseModel):
    page_id: str
    title: str
    url: str


class ConfluenceSaveTextRequest(BaseModel):
    space_key: str
    parent_id: str
    title: str
    fsd_text: str
