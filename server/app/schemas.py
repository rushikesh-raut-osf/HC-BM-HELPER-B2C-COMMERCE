from typing import Optional

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    requirements_text: Optional[str] = None
    requirements_list: Optional[list[str]] = None
    top_k: Optional[int] = Field(default=None, ge=1, le=50)
    baseline_name: Optional[str] = None
    agent_mode: Optional[bool] = None


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
    implementation_mode: Optional[str] = None
    coverage_status: Optional[str] = None
    project_match_status: Optional[str] = None
    gaps: Optional[list[str]] = None
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


class FollowupHistoryItem(BaseModel):
    question: str
    answer: str


class FollowupStepRequest(BaseModel):
    requirement: str
    history: list[FollowupHistoryItem] = Field(default_factory=list)
    step_index: int = Field(default=0, ge=0)
    max_steps: int = Field(default=3, ge=1, le=5)


class FollowupStepOption(BaseModel):
    label: str
    recommended: bool = False


class FollowupStepResponse(BaseModel):
    question: str
    options: list[FollowupStepOption]
    allow_custom: bool = True
    is_terminal: bool = False


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


class IngestStartResponse(BaseModel):
    job_id: str
    status: str


class DataSourceLinkInput(BaseModel):
    url: str
    note: Optional[str] = None


class IngestStartRequest(BaseModel):
    baseline_links: list[DataSourceLinkInput] = Field(default_factory=list)
    include_confluence: bool = True
    crawl_depth: int = Field(default=1, ge=0, le=2)
    max_pages: int = Field(default=60, ge=1, le=300)


class IngestStatusResponse(BaseModel):
    job_id: str
    status: str
    stage: Optional[str] = None
    progress: int = 0
    pages_total: int = 0
    pages_processed: int = 0
    pages_indexed: int = 0
    pages_skipped: int = 0
    web_pages_indexed: int = 0
    web_pages_skipped: int = 0
    chunks: int = 0
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    error: Optional[str] = None


class WorkspaceThread(BaseModel):
    id: str
    title: str
    updated_at: str
    project_id: Optional[str] = None
    messages: list[dict] = Field(default_factory=list)


class WorkspaceDataSourceLink(BaseModel):
    id: Optional[str] = None
    url: str
    note: Optional[str] = None


class WorkspaceStatePayload(BaseModel):
    projects: list[str] = Field(default_factory=list)
    threads: list[WorkspaceThread] = Field(default_factory=list)
    baseline_links: list[WorkspaceDataSourceLink] = Field(default_factory=list)
