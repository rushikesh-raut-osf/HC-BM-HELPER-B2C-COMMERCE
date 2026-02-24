from __future__ import annotations

import sys
from pathlib import Path

# Ensure the server package root is on sys.path so "import app" works in tests.
SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))
