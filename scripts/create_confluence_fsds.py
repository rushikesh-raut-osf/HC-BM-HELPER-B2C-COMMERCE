#!/usr/bin/env python3
import base64
import getpass
import json
import os
import random
import sys
import time
import urllib.parse
import urllib.request

BASE_URL = os.environ.get("CONFLUENCE_BASE_URL", "https://one-strong-force.atlassian.net/wiki")
SPACE_KEY = os.environ.get("CONFLUENCE_SPACE_KEY", "SFCC")
PARENT_TITLE = os.environ.get("CONFLUENCE_PARENT_TITLE", "FSD")
EMAIL = os.environ.get("CONFLUENCE_EMAIL")
TOKEN = os.environ.get("CONFLUENCE_API_TOKEN")

FOLDERS = ["PDP", "CART", "CHECKOUT", "CLP"]
PAGES_PER_FOLDER = 10

FEATURES = [
    "Product Detail Page", "Product Images/Zoom", "Product Variations", "Size/Color Swatches",
    "Product Recommendations", "Recently Viewed", "Availability & Inventory", "Store Pickup",
    "Add to Cart", "Mini Cart", "Cart Promotions", "Coupon Codes", "Gift Certificates",
    "Shipping Methods", "Tax Calculation", "Checkout Login", "Guest Checkout",
    "Address Book", "Payment Methods", "Saved Cards", "Order Confirmation",
    "Order History", "Order Details", "Returns & Exchanges", "Wishlist",
    "Search Results Page", "Search Suggestions", "Category Landing Page", "Breadcrumbs",
    "Sorting & Filtering", "Pagination", "Content Slots", "Page Designer",
    "SEO Metadata", "Canonical URLs", "Analytics Events", "A/B Testing",
    "Price Books", "Promotions Engine", "Bundle/Set Products", "Product Reviews"
]


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def require_env():
    global EMAIL, TOKEN
    if not EMAIL:
        EMAIL = input("Confluence email: ").strip()
    if not TOKEN:
        TOKEN = getpass.getpass("Confluence API token: ").strip()
    if not EMAIL or not TOKEN:
        fail("Missing Confluence email or API token.")


def auth_header():
    raw = f"{EMAIL}:{TOKEN}".encode("utf-8")
    b64 = base64.b64encode(raw).decode("ascii")
    return {"Authorization": f"Basic {b64}"}


def api_request(method, path, params=None, payload=None):
    if params:
        qs = urllib.parse.urlencode(params, doseq=True)
        url = f"{BASE_URL}{path}?{qs}"
    else:
        url = f"{BASE_URL}{path}"

    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    headers.update(auth_header())

    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            if not body:
                return None
            return json.loads(body)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8") if e.fp else ""
        raise RuntimeError(f"{method} {path} failed: HTTP {e.code} {e.reason} {err_body}")


def cql_search(cql, limit=25):
    return api_request("GET", "/rest/api/content/search", params={"cql": cql, "limit": limit})


def find_page_by_title(title, space_key):
    cql = f'space="{space_key}" AND title="{title}"'
    res = cql_search(cql)
    if not res or res.get("size", 0) == 0:
        return None
    return res["results"][0]


def find_child_page(title, space_key, parent_id):
    cql = f'space="{space_key}" AND title="{title}" AND ancestor={parent_id}'
    res = cql_search(cql)
    if not res or res.get("size", 0) == 0:
        return None
    return res["results"][0]


def create_page(title, space_key, parent_id, html_body):
    payload = {
        "type": "page",
        "title": title,
        "space": {"key": space_key},
        "ancestors": [{"id": str(parent_id)}] if parent_id else [],
        "body": {
            "storage": {
                "value": html_body,
                "representation": "storage",
            }
        },
    }
    return api_request("POST", "/rest/api/content", payload=payload)


def ensure_parent_page():
    parent = find_page_by_title(PARENT_TITLE, SPACE_KEY)
    if parent:
        return parent

    body = f"""
    <h1>{PARENT_TITLE}</h1>
    <p>Sample Functional Specification Documents (FSDs) for ecommerce features.</p>
    """.strip()
    created = create_page(PARENT_TITLE, SPACE_KEY, None, body)
    return created


def ensure_folder_page(folder_title, parent_id):
    existing = find_child_page(folder_title, SPACE_KEY, parent_id)
    if existing:
        return existing
    body = f"""
    <h2>{folder_title}</h2>
    <p>Sample FSDs for {folder_title} features.</p>
    """.strip()
    created = create_page(folder_title, SPACE_KEY, parent_id, body)
    return created


def make_fsd_body(folder, feature, index):
    return f"""
    <h1>{folder} FSD {index:02d} - {feature}</h1>
    <h2>Overview</h2>
    <p>This document defines functional requirements for the {feature} capability within the {folder} area of the storefront.</p>

    <h2>Business Goals</h2>
    <ul>
      <li>Improve conversion and reduce drop-off within {folder}.</li>
      <li>Ensure feature parity with common ecommerce expectations.</li>
      <li>Support analytics visibility for decision making.</li>
    </ul>

    <h2>Scope</h2>
    <ul>
      <li>In Scope: UI behavior, validations, data persistence, analytics events.</li>
      <li>Out of Scope: Payment gateway changes, OMS integration changes.</li>
    </ul>

    <h2>User Journeys</h2>
    <ol>
      <li>Shopper discovers the feature during normal browsing.</li>
      <li>Shopper engages with the feature and completes the primary action.</li>
      <li>System validates input, updates state, and confirms success.</li>
    </ol>

    <h2>Functional Requirements</h2>
    <ul>
      <li>Provide a responsive UI for {feature} on desktop and mobile.</li>
      <li>Enforce client- and server-side validation for required inputs.</li>
      <li>Persist user state when applicable (session or account).</li>
      <li>Gracefully handle inventory constraints and error states.</li>
    </ul>

    <h2>Data & Integrations</h2>
    <ul>
      <li>Use SFCC APIs for product, price, promotion, and inventory data.</li>
      <li>Leverage content assets for marketing copy and merchandising.</li>
      <li>Emit analytics events via the existing tag manager.</li>
    </ul>

    <h2>UX Notes</h2>
    <ul>
      <li>Above-the-fold placement for key {feature} controls.</li>
      <li>Accessible labels, focus states, and error messaging.</li>
      <li>Localized messaging for currency and region specifics.</li>
    </ul>

    <h2>Edge Cases</h2>
    <ul>
      <li>Product becomes unavailable during interaction.</li>
      <li>Session expires mid-flow.</li>
      <li>Invalid coupon or promotion conflict.</li>
    </ul>

    <h2>Analytics</h2>
    <table>
      <thead>
        <tr><th>Event</th><th>Trigger</th><th>Attributes</th></tr>
      </thead>
      <tbody>
        <tr><td>{folder.lower()}_{feature.lower().replace(' ', '_')}_view</td><td>Feature rendered</td><td>productId, categoryId</td></tr>
        <tr><td>{folder.lower()}_{feature.lower().replace(' ', '_')}_action</td><td>Primary action</td><td>sku, price, quantity</td></tr>
      </tbody>
    </table>

    <h2>Acceptance Criteria</h2>
    <ul>
      <li>All validations display inline error messages.</li>
      <li>Successful action updates UI within 1 second.</li>
      <li>Analytics events fire once per action.</li>
    </ul>

    <h2>Risks & Assumptions</h2>
    <ul>
      <li>Assumes existing SFRA templates are extendable.</li>
      <li>Performance risk if inventory calls are slow.</li>
    </ul>
    """.strip()


def main():
    require_env()

    parent = ensure_parent_page()
    parent_id = parent["id"]

    rng = random.Random(42)
    features = FEATURES[:]
    rng.shuffle(features)

    created_count = 0
    skipped_count = 0

    for folder in FOLDERS:
        folder_page = ensure_folder_page(folder, parent_id)
        folder_id = folder_page["id"]

        for i in range(1, PAGES_PER_FOLDER + 1):
            feature = features[(i - 1) % len(features)]
            title = f"{folder} FSD {i:02d} - {feature}"
            existing = find_child_page(title, SPACE_KEY, folder_id)
            if existing:
                skipped_count += 1
                continue

            body = make_fsd_body(folder, feature, i)
            create_page(title, SPACE_KEY, folder_id, body)
            created_count += 1
            time.sleep(0.2)

    print(f"Created {created_count} pages. Skipped {skipped_count} existing pages.")


if __name__ == "__main__":
    main()
