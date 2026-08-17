"""FastAPI entrypoint for login-protected PDF uploads."""

from __future__ import annotations

import hashlib
import re
import uuid
from typing import Any
from typing import Dict

from fastapi import Depends
from fastapi import FastAPI
from fastapi import File
from fastapi import HTTPException
from fastapi import UploadFile
from fastapi import status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic import Field

from . import auth
from . import config
from . import db as db_mod

app = FastAPI(title="OR Open Problems Upload API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


@app.on_event("startup")
def on_startup() -> None:
    db_mod.init_db()
    auth.seed_admin_user_if_needed()


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/login")
def login(body: LoginRequest) -> Dict[str, Any]:
    user = db_mod.get_user_by_username(body.username.strip())
    if not user or not auth.verify_password(body.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )
    token = auth.create_access_token(
        user_id=int(user["id"]),
        username=user["username"],
        role=user["role"],
    )
    return {"token": token, "user": auth.public_user(user)}


@app.post("/auth/logout")
def logout(_user: Dict[str, Any] = Depends(auth.require_user)) -> Dict[str, bool]:
    # Stateless JWT: client discards the token. Endpoint kept for API symmetry.
    return {"ok": True}


@app.get("/auth/me")
def me(user: Dict[str, Any] = Depends(auth.require_user)) -> Dict[str, Any]:
    return {"user": auth.public_user(user)}


def _safe_filename(name: str) -> str:
    base = re.sub(r"[^\w.\-]+", "_", (name or "upload.pdf").strip()) or "upload.pdf"
    if not base.lower().endswith(".pdf"):
        base = f"{base}.pdf"
    return base[:180]


@app.post("/api/uploads")
async def create_upload(
    file: UploadFile = File(...),
    user: Dict[str, Any] = Depends(auth.require_user),
) -> Dict[str, Any]:
    filename = file.filename or "upload.pdf"
    content_type = (file.content_type or "").lower()
    if content_type not in {"application/pdf", "application/x-pdf", ""} and not filename.lower().endswith(
        ".pdf"
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF uploads are accepted.",
        )
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename must end with .pdf.",
        )

    digest = hashlib.sha256()
    chunks = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > config.MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds max size of {config.MAX_UPLOAD_BYTES} bytes.",
            )
        digest.update(chunk)
        chunks.append(chunk)

    if total == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file.")

    # Light magic-byte check
    head = chunks[0][:5] if chunks else b""
    if not head.startswith(b"%PDF"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File does not look like a PDF.",
        )

    stored_name = f"{uuid.uuid4().hex}_{_safe_filename(filename)}"
    path = db_mod.storage_path(stored_name)
    path.write_bytes(b"".join(chunks))

    row = db_mod.insert_upload(
        user_id=int(user["id"]),
        filename=_safe_filename(filename),
        stored_name=stored_name,
        content_type="application/pdf",
        size_bytes=total,
        sha256=digest.hexdigest(),
        status="received",
    )
    return {
        "id": row["id"],
        "filename": row["filename"],
        "size_bytes": row["size_bytes"],
        "status": row["status"],
        "uploaded_at": row["uploaded_at"],
        "sha256": row["sha256"],
    }


@app.get("/api/uploads")
def list_uploads(user: Dict[str, Any] = Depends(auth.require_user)) -> Dict[str, Any]:
    items = db_mod.list_uploads_for_user(int(user["id"]))
    return {
        "items": [
            {
                "id": item["id"],
                "filename": item["filename"],
                "size_bytes": item["size_bytes"],
                "status": item["status"],
                "uploaded_at": item["uploaded_at"],
                "sha256": item["sha256"],
            }
            for item in items
        ]
    }
