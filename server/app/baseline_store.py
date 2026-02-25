from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .config import settings

_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "have",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "with",
}


def _normalize_requirement(text: str) -> str:
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return " ".join(tokens).strip()


def _tokenize(text: str) -> set[str]:
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return {token for token in tokens if token not in _STOPWORDS and len(token) > 2}


def _jaccard_similarity(a: Iterable[str], b: Iterable[str]) -> float:
    set_a = set(a)
    set_b = set(b)
    if not set_a or not set_b:
        return 0.0
    intersection = set_a & set_b
    union = set_a | set_b
    if not union:
        return 0.0
    return len(intersection) / len(union)


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip())
    return cleaned.strip("_")


def _baseline_dir() -> Path:
    path = Path(settings.baseline_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def baseline_path(name: str) -> Path:
    safe = _safe_name(name)
    if not safe:
        raise ValueError("baseline_name is required")
    return _baseline_dir() / f"{safe}.json"


@dataclass
class BaselinePayload:
    name: str
    created_at: str
    items: list[dict]


def save_baseline(name: str, requirements: list[str], results: list[dict]) -> BaselinePayload:
    now = datetime.now(timezone.utc).isoformat()
    items = []
    for result in results:
        requirement = result.get("requirement", "")
        items.append(
            {
                "requirement": requirement,
                "requirement_norm": _normalize_requirement(requirement),
                "classification": result.get("classification"),
                "confidence": result.get("confidence"),
            }
        )
    payload = {"name": name, "created_at": now, "requirements": requirements, "items": items}
    path = baseline_path(name)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return BaselinePayload(name=name, created_at=now, items=items)


def load_baseline(name: str) -> dict:
    path = baseline_path(name)
    if not path.exists():
        raise FileNotFoundError(f"Baseline '{name}' not found")
    return json.loads(path.read_text(encoding="utf-8"))


def compare_to_baseline(current_results: list[dict], baseline: dict) -> dict:
    baseline_items = baseline.get("items", [])
    baseline_tokens = []
    baseline_map = {}
    for item in baseline_items:
        norm = item.get("requirement_norm") or _normalize_requirement(item.get("requirement", ""))
        tokens = _tokenize(item.get("requirement", ""))
        baseline_tokens.append((norm, tokens, item))
        baseline_map[norm] = item

    matched_norms: set[str] = set()
    summary = {"added": 0, "changed": 0, "unchanged": 0, "removed": 0}

    for result in current_results:
        requirement = result.get("requirement", "")
        norm = _normalize_requirement(requirement)

        if norm in baseline_map:
            base_item = baseline_map[norm]
            matched_norms.add(norm)
            result["baseline_status"] = "unchanged"
            result["baseline_requirement"] = base_item.get("requirement")
            result["baseline_classification"] = base_item.get("classification")
            result["baseline_confidence"] = base_item.get("confidence")
            result["baseline_similarity"] = 1.0
            summary["unchanged"] += 1
            continue

        best_score = 0.0
        best_item = None
        tokens = _tokenize(requirement)
        for norm_key, base_tokens, base_item in baseline_tokens:
            if norm_key in matched_norms:
                continue
            score = _jaccard_similarity(tokens, base_tokens)
            if score > best_score:
                best_score = score
                best_item = base_item

        if best_item and best_score >= 0.6:
            matched_norms.add(
                best_item.get("requirement_norm")
                or _normalize_requirement(best_item.get("requirement", ""))
            )
            result["baseline_status"] = "changed"
            result["baseline_requirement"] = best_item.get("requirement")
            result["baseline_classification"] = best_item.get("classification")
            result["baseline_confidence"] = best_item.get("confidence")
            result["baseline_similarity"] = round(best_score, 3)
            summary["changed"] += 1
        else:
            result["baseline_status"] = "new"
            summary["added"] += 1

    removed = []
    for item in baseline_items:
        norm = item.get("requirement_norm") or _normalize_requirement(item.get("requirement", ""))
        if norm not in matched_norms:
            removed.append(
                {
                    "requirement": item.get("requirement"),
                    "classification": item.get("classification"),
                    "confidence": item.get("confidence"),
                }
            )
    summary["removed"] = len(removed)

    return {
        "summary": summary,
        "removed": removed,
        "created_at": baseline.get("created_at"),
        "name": baseline.get("name"),
    }
