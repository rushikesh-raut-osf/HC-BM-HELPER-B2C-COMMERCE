from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Optional

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
    updated_at: Optional[datetime]
    storage_value: str


@dataclass
class ConfluenceSpaceInfo:
    key: str
    name: str


@dataclass
class ConfluenceFolderInfo:
    page_id: str
    title: str


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

    cql_parts = [f"space in ({','.join(keys)})", "type=page"]
    if cql_extra:
        cql_parts.append(cql_extra)
    cql = " AND ".join(cql_parts)

    ids: list[str] = []
    seen_ids: set[str] = set()
    start = 0
    limit = 50
    max_iterations = 500
    iterations = 0
    with _client() as client:
        while True:
            iterations += 1
            if iterations > max_iterations:
                # Defensive guard against upstream pagination loops.
                break
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
            new_count = 0
            for item in results:
                page_id = str(item.get("id", "")).strip()
                if not page_id or page_id in seen_ids:
                    continue
                seen_ids.add(page_id)
                ids.append(page_id)
                new_count += 1
            # If API keeps returning duplicates, do not spin forever.
            if new_count == 0:
                break
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


def list_spaces() -> list[ConfluenceSpaceInfo]:
    spaces: list[ConfluenceSpaceInfo] = []
    start = 0
    limit = 100
    with _client() as client:
        while True:
            response = client.get("/rest/api/space", params={"limit": limit, "start": start})
            response.raise_for_status()
            payload = response.json()
            results = payload.get("results", [])
            for item in results:
                key = str(item.get("key", "")).strip()
                if not key:
                    continue
                name = str(item.get("name", key)).strip() or key
                spaces.append(ConfluenceSpaceInfo(key=key, name=name))
            if len(results) < limit:
                break
            start += limit
    spaces.sort(key=lambda s: s.name.lower())
    return spaces


def list_folder_pages(space_key: str) -> list[ConfluenceFolderInfo]:
    folders: list[ConfluenceFolderInfo] = []
    with _client() as client:
        response = client.get(
            "/rest/api/content/search",
            params={
                "cql": f'space="{space_key}" AND type=page ORDER BY title',
                "limit": 200,
            },
        )
        response.raise_for_status()
        payload = response.json()
        for item in payload.get("results", []):
            page_id = str(item.get("id", "")).strip()
            title = str(item.get("title", "")).strip()
            if not page_id or not title:
                continue
            folders.append(ConfluenceFolderInfo(page_id=page_id, title=title))
    return folders


def find_child_page(space_key: str, parent_id: str, title: str) -> Optional[ConfluenceFolderInfo]:
    clean_title = title.replace('"', '\\"').strip()
    if not clean_title:
        return None
    with _client() as client:
        response = client.get(
            "/rest/api/content/search",
            params={
                "cql": f'space="{space_key}" AND title="{clean_title}" AND ancestor={parent_id}',
                "limit": 1,
            },
        )
        response.raise_for_status()
        payload = response.json()
        results = payload.get("results", [])
        if not results:
            return None
        item = results[0]
        return ConfluenceFolderInfo(page_id=str(item.get("id", "")), title=str(item.get("title", "")))


def create_child_page(space_key: str, parent_id: str, title: str, storage_html: str) -> ConfluencePage:
    payload = {
        "type": "page",
        "title": title,
        "space": {"key": space_key},
        "ancestors": [{"id": str(parent_id)}],
        "body": {"storage": {"value": storage_html, "representation": "storage"}},
    }

    with _client() as client:
        response = client.post("/rest/api/content", json=payload)
        response.raise_for_status()
        data = response.json()

    webui = data.get("_links", {}).get("webui", "")
    base = data.get("_links", {}).get("base", "")
    return ConfluencePage(
        page_id=str(data.get("id", "")),
        title=str(data.get("title", title)),
        url=f"{base}{webui}",
        space_key=space_key,
        updated_at=None,
        storage_value=storage_html,
    )
