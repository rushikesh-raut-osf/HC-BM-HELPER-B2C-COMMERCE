from sqlalchemy import Column, Integer, Text, DateTime, JSON, UniqueConstraint
from sqlalchemy.orm import declarative_base
from pgvector.sqlalchemy import Vector


Base = declarative_base()


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("source", "source_id", "chunk_index", name="documents_source_id_chunk"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    source = Column(Text, nullable=False)
    source_id = Column(Text, nullable=False)
    title = Column(Text)
    url = Column(Text)
    space_key = Column(Text)
    updated_at = Column(DateTime(timezone=True))
    content_hash = Column(Text)
    chunk_index = Column(Integer, nullable=False)
    chunk_text = Column(Text, nullable=False)
    embedding = Column(Vector(1536))
    metadata_json = Column("metadata", JSON)
