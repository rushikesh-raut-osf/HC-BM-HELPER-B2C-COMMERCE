from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

import html2text
import httpx
from bs4 import BeautifulSoup

from .config import settings


@dataclass
class ConfluencePage:
    page_id: str
    title: str
    url: str
    space_key: str
    updated_at: datetime | None
    storage_value: str


def _client() -> httpx.Client:
    return httpx.Client(
        base_url=settings.confluence_base_url.rstrip("/"),
        auth=(settings.confluence_email, settings.confluence_api_token),
        headers={"Accept": "application/json"},
        timeout=30.0,
    )


def _storage_to_text(storage_value: str) -> str:
    soup = BeautifulSoup(storage_value, "html.parser")
    text = soup.get_text(separator="\n")
    if text.strip():
        return text
    converter = html2text.HTML2Text()
    converter.ignore_links = False
    return converter.handle(storage_value)


def search_pages(space_keys: Iterable[str], cql_extra: str = "") -> list[str]:
    keys = [key.strip() for key in space_keys if key.strip()]
    if not keys:
        return []

    cql_parts = [f"space in ({','.join(keys)})"]
    if cql_extra:
        cql_parts.append(cql_extra)
    cql = " AND ".join(cql_parts)

    ids: list[str] = []
    start = 0
    limit = 50
    with _client() as client:
        while True:
            response = client.get(
                "/rest/api/content/search",
                params={
                    "cql": cql,
                    "limit": limit,
                    "start": start,
                    "expand": "body.storage,space,version",
                },
            )
            response.raise_for_status()
            payload = response.json()
            results = payload.get("results", [])
            ids.extend([item["id"] for item in results])
            if len(results) < limit:
                break
            start += limit
    return ids


def fetch_page(page_id: str) -> ConfluencePage:
    with _client() as client:
        response = client.get(
            f"/rest/api/content/{page_id}",
            params={"expand": "body.storage,space,version"},
        )
        response.raise_for_status()
        payload = response.json()

    title = payload.get("title", "")
    space_key = payload.get("space", {}).get("key", "")
    url = payload.get("_links", {}).get("base", "") + payload.get("_links", {}).get("webui", "")
    storage_value = payload.get("body", {}).get("storage", {}).get("value", "")
    version = payload.get("version", {})
    updated_at = version.get("when")
    parsed_date = None
    if updated_at:
        parsed_date = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))

    return ConfluencePage(
        page_id=str(payload.get("id")),
        title=title,
        url=url,
        space_key=space_key,
        updated_at=parsed_date,
        storage_value=storage_value,
    )


def page_to_text(page: ConfluencePage) -> str:
    return _storage_to_text(page.storage_value)
