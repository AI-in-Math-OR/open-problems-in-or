"""Upload API configuration (env-driven)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

# Local default: backend/data (+ uploads under it).
# On Railway, set DATA_DIR=/data (volume mount) so SQLite + PDFs persist.
_data_dir = os.getenv("DATA_DIR", "").strip()
DATA_DIR = Path(_data_dir) if _data_dir else (ROOT / "data")

_upload_dir = os.getenv("UPLOAD_DIR", "").strip()
UPLOAD_DIR = Path(_upload_dir) if _upload_dir else (DATA_DIR / "uploads")

DB_PATH = DATA_DIR / "upload_api.sqlite3"

SESSION_SECRET = os.getenv("SESSION_SECRET", "").strip() or "dev-insecure-session-secret"
SEED_USERNAME = os.getenv("UPLOAD_SEED_USERNAME", "pete").strip() or "pete"
SEED_PASSWORD = os.getenv("UPLOAD_SEED_PASSWORD", "").strip()
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:8000,http://localhost:8000,https://pranav-nuti.github.io",
    ).split(",")
    if origin.strip()
]
# Railway injects PORT; set HOST=0.0.0.0 in production.
HOST = os.getenv("HOST", "127.0.0.1").strip() or "127.0.0.1"
PORT = int(os.getenv("PORT", "8081"))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))
TOKEN_TTL_SECONDS = int(os.getenv("TOKEN_TTL_SECONDS", str(60 * 60 * 12)))
# Auto-reload for local HOST only; override with RELOAD=0|1.
_reload = os.getenv("RELOAD", "").strip().lower()
if _reload in {"0", "false", "no"}:
    RELOAD = False
elif _reload in {"1", "true", "yes"}:
    RELOAD = True
else:
    RELOAD = HOST in {"127.0.0.1", "localhost"}
