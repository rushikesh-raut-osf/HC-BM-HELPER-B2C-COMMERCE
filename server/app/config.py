from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: str
    gemini_embed_model: str = "gemini-embedding-001"
    gemini_response_model: str = "gemini-1.5-flash"

    confluence_base_url: str
    confluence_email: str
    confluence_api_token: str
    confluence_space_keys: str = ""
    confluence_cql_extra: str = ""

    sfcc_docs_repo_path: Optional[str] = None

    chunk_words: int = 400
    chunk_overlap_words: int = 80
    top_k: int = 15
    chroma_persist_path: str = "./data/chroma"
    baseline_dir: str = "./.state/baselines"
    rerank_enabled: bool = True
    rerank_candidates: int = 45
    rerank_lexical_weight: float = 0.25
    cors_allow_origins: str = ""


settings = Settings()
