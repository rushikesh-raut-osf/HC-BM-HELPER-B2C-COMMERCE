from __future__ import annotations

import re

# Curated high-value mappings for ambiguous requirement wording.
# Keep this list intentionally small and expand based on observed misses.
_CANONICAL_SYNONYMS: dict[str, tuple[str, ...]] = {
    "content asset video component": (
        "homepage video",
        "home page video",
        "hero video",
        "banner video",
        "video banner",
    ),
    "store locator": (
        "find store",
        "store finder",
        "shop locator",
    ),
    "wishlist": (
        "save for later",
        "saved items",
        "favorites",
    ),
    "product variation attributes": (
        "size color swatches",
        "color swatches",
        "size selection",
    ),
    "product recommendations": (
        "recommended products",
        "you may also like",
        "related products",
    ),
    "product badges": (
        "product label",
        "product labels",
        "badge on product tile",
        "pdp badge",
        "plp badge",
        "sale badge",
    ),
    "product tile": (
        "product card",
        "plp card",
        "product grid item",
    ),
    "promotions and coupons": (
        "discount code",
        "promo code",
        "coupon code",
        "apply coupon",
    ),
    "product search and refinement": (
        "search filters",
        "faceted search",
        "plp filters",
    ),
    "product sorting": (
        "sort by price",
        "sort by relevance",
    ),
    "guest checkout": (
        "checkout as guest",
        "guest user checkout",
    ),
    "address book": (
        "saved addresses",
        "multiple shipping addresses",
    ),
}


def _contains_phrase(text: str, phrase: str) -> bool:
    pattern = r"\b" + re.escape(phrase.lower()) + r"\b"
    return re.search(pattern, text) is not None


def expand_requirement_query(text: str) -> str:
    """
    Expand the retrieval query with canonical SFRA capability terms based on
    common phrasing variants.
    """
    raw = (text or "").strip()
    if not raw:
        return raw

    lowered = raw.lower()
    expansions: list[str] = []
    for canonical, aliases in _CANONICAL_SYNONYMS.items():
        has_canonical = _contains_phrase(lowered, canonical)
        has_alias = any(_contains_phrase(lowered, alias) for alias in aliases)
        if has_canonical:
            # Add known variants to improve recall when project docs use alternate wording.
            expansions.extend(aliases[:3])
            continue
        if has_alias:
            expansions.append(canonical)

    if not expansions:
        return raw
    return f"{raw}\n\nSFRA capability terms: {', '.join(sorted(set(expansions)))}"
