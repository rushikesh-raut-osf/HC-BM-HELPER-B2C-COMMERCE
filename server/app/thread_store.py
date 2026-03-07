from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from .config import settings


def _db_path() -> Path:
    raw = settings.thread_db_path.strip() or "./data/workspace.db"
    return Path(raw)


def _connect() -> sqlite3.Connection:
    db_path = _db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_workspace_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS workspace_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )


def load_workspace_state() -> dict[str, Any]:
    init_workspace_db()
    with _connect() as conn:
        row = conn.execute("SELECT payload_json FROM workspace_state WHERE id = 1").fetchone()
        if not row:
            return {"threads": []}
        try:
            payload = json.loads(str(row["payload_json"]))
        except Exception:
            return {"threads": []}
    if not isinstance(payload, dict):
        return {"threads": []}
    threads = payload.get("threads")
    if not isinstance(threads, list):
        return {"threads": []}
    return {"threads": threads}


def save_workspace_state(state: dict[str, Any], updated_at: str) -> dict[str, Any]:
    payload = {"threads": state.get("threads", [])}
    serialized = json.dumps(payload, ensure_ascii=True)
    init_workspace_db()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO workspace_state (id, payload_json, updated_at)
            VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                payload_json = excluded.payload_json,
                updated_at = excluded.updated_at
            """,
            (serialized, updated_at),
        )
    return payload
