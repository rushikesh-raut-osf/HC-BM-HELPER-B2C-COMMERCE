from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str
    openai_embedding_model: str = "text-embedding-3-small"
    openai_embedding_dimensions: int | None = None
    openai_response_model: str = "gpt-4o-mini"

    database_url: str

    confluence_base_url: str
    confluence_email: str
    confluence_api_token: str
    confluence_space_keys: str = ""
    confluence_cql_extra: str = ""

    sfcc_docs_repo_path: str | None = None

    chunk_tokens: int = 800
    chunk_overlap: int = 100
    top_k: int = 15


settings = Settings()
