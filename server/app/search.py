from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Document


def search_documents(db: Session, query_embedding: list[float], top_k: int) -> list[tuple[Document, float]]:
    distance = Document.embedding.cosine_distance(query_embedding)
    stmt = select(Document, distance.label("score")).order_by(distance).limit(top_k)
    rows = db.execute(stmt).all()
    return [(row[0], float(row[1])) for row in rows]
