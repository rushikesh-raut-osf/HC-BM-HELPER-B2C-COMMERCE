from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from .config import settings
from .db import get_session
from .embeddings import embed_texts
from .schemas import QueryRequest, QueryResponse, ChunkResult
from .search import search_documents


app = FastAPI(title="Doc Search API", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/query", response_model=QueryResponse)
def query_docs(payload: QueryRequest, db: Session = Depends(get_session)):
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")

    top_k = payload.top_k or settings.top_k
    query_embedding = embed_texts([question])[0]
    results = search_documents(db, query_embedding, top_k)

    chunks = [
        ChunkResult(
            source=item.source,
            source_id=item.source_id,
            title=item.title,
            url=item.url,
            space_key=item.space_key,
            chunk_index=item.chunk_index,
            chunk_text=item.chunk_text,
            score=score,
        )
        for item, score in results
    ]

    return QueryResponse(question=question, top_k=top_k, results=chunks, answer=None)
