"""FastAPI entrypoint for login-protected PDF uploads and extract jobs."""

from __future__ import annotations

import hashlib
import re
import uuid
from typing import Any
from typing import Dict
from typing import List
from typing import Optional

from fastapi import Depends
from fastapi import FastAPI
from fastapi import File
from fastapi import HTTPException
from fastapi import UploadFile
from fastapi import status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pydantic import Field

from . import auth
from . import config
from . import db as db_mod

app = FastAPI(title="OR Open Problems Upload API", version="0.2.0")
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


class CreateJobRequest(BaseModel):
    kind: str = Field(default="extract", min_length=1, max_length=64)


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
    return {"ok": True}


@app.get("/auth/me")
def me(user: Dict[str, Any] = Depends(auth.require_user)) -> Dict[str, Any]:
    return {"user": auth.public_user(user)}


def _safe_filename(name: str) -> str:
    base = re.sub(r"[^\w.\-]+", "_", (name or "upload.pdf").strip()) or "upload.pdf"
    if not base.lower().endswith(".pdf"):
        base = f"{base}.pdf"
    return base[:180]


def _upload_meta(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "filename": row["filename"],
        "size_bytes": row["size_bytes"],
        "status": row["status"],
        "uploaded_at": row["uploaded_at"],
        "sha256": row["sha256"],
        "user_id": row.get("user_id"),
        "parent_upload_id": row.get("parent_upload_id"),
        "kind": row.get("kind") or "source",
    }


def _authorize_upload_access(row: Dict[str, Any], actor: Dict[str, Any]) -> None:
    if actor.get("is_worker"):
        return
    if int(row["user_id"]) != int(actor["id"]) and actor.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your upload.")


async def _read_pdf_upload(file: UploadFile) -> tuple[str, bytes, str]:
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
    chunks: List[bytes] = []
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

    data = b"".join(chunks)
    if not data.startswith(b"%PDF"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File does not look like a PDF.",
        )
    return _safe_filename(filename), data, digest.hexdigest()


@app.post("/api/uploads")
async def create_upload(
    file: UploadFile = File(...),
    user: Dict[str, Any] = Depends(auth.require_user),
) -> Dict[str, Any]:
    filename, data, sha256 = await _read_pdf_upload(file)
    stored_name = f"{uuid.uuid4().hex}_{filename}"
    db_mod.storage_path(stored_name).write_bytes(data)
    row = db_mod.insert_upload(
        user_id=int(user["id"]),
        filename=filename,
        stored_name=stored_name,
        content_type="application/pdf",
        size_bytes=len(data),
        sha256=sha256,
        status="received",
        kind="source",
    )
    return _upload_meta(row)


@app.get("/api/uploads")
def list_uploads(user: Dict[str, Any] = Depends(auth.require_user)) -> Dict[str, Any]:
    items = db_mod.list_uploads_for_user(int(user["id"]))
    out = []
    for item in items:
        meta = _upload_meta(item)
        if (item.get("kind") or "source") == "source":
            jobs = db_mod.list_jobs_for_upload(int(item["id"]), limit=5)
            meta["jobs"] = [db_mod.job_public(j) for j in jobs]
        else:
            meta["jobs"] = []
        out.append(meta)
    return {"items": out}


@app.get("/api/uploads/{upload_id}")
def get_upload(
    upload_id: int,
    actor: Dict[str, Any] = Depends(auth.require_user_or_worker),
) -> Dict[str, Any]:
    row = db_mod.get_upload_by_id(upload_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found.")
    _authorize_upload_access(row, actor)
    meta = _upload_meta(row)
    meta["jobs"] = [db_mod.job_public(j) for j in db_mod.list_jobs_for_upload(upload_id)]
    return meta


@app.get("/api/uploads/{upload_id}/file")
def download_upload_file(
    upload_id: int,
    actor: Dict[str, Any] = Depends(auth.require_user_or_worker),
) -> FileResponse:
    row = db_mod.get_upload_by_id(upload_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found.")
    _authorize_upload_access(row, actor)
    path = db_mod.storage_path(row["stored_name"])
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Upload file missing on disk.",
        )
    return FileResponse(
        path,
        media_type=row.get("content_type") or "application/pdf",
        filename=row["filename"],
    )


@app.post("/api/uploads/{upload_id}/jobs")
def create_upload_job(
    upload_id: int,
    body: CreateJobRequest,
    user: Dict[str, Any] = Depends(auth.require_user),
) -> Dict[str, Any]:
    kind = (body.kind or "extract").strip().lower()
    if kind != "extract":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only kind=extract is supported for now.",
        )
    row = db_mod.get_upload_by_id(upload_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found.")
    _authorize_upload_access(row, user)
    if (row.get("kind") or "source") != "source":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only extract from source paper uploads.",
        )
    job = db_mod.create_job(upload_id=upload_id, kind=kind)
    return db_mod.job_public(job)


@app.get("/api/uploads/{upload_id}/jobs")
def list_upload_jobs(
    upload_id: int,
    user: Dict[str, Any] = Depends(auth.require_user),
) -> Dict[str, Any]:
    row = db_mod.get_upload_by_id(upload_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found.")
    _authorize_upload_access(row, user)
    jobs = db_mod.list_jobs_for_upload(upload_id)
    return {"items": [db_mod.job_public(j) for j in jobs]}


@app.get("/api/jobs/{job_id}")
def get_job(
    job_id: int,
    actor: Dict[str, Any] = Depends(auth.require_user_or_worker),
) -> Dict[str, Any]:
    job = db_mod.get_job_by_id(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    upload = db_mod.get_upload_by_id(int(job["upload_id"]))
    if not upload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found.")
    _authorize_upload_access(upload, actor)
    return db_mod.job_public(job)


@app.post("/api/jobs/claim")
def claim_job(
    kind: str = "extract",
    _worker: Dict[str, Any] = Depends(auth.require_user_or_worker),
) -> Dict[str, Any]:
    if not _worker.get("is_worker"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Worker token required.",
        )
    job = db_mod.claim_next_job(kind=(kind or "extract").strip().lower())
    if not job:
        return {"job": None}
    upload = db_mod.get_upload_by_id(int(job["upload_id"]))
    return {
        "job": db_mod.job_public(job),
        "upload": _upload_meta(upload) if upload else None,
    }


@app.post("/api/jobs/{job_id}/fail")
def fail_job(
    job_id: int,
    body: Dict[str, Any],
    worker: Dict[str, Any] = Depends(auth.require_user_or_worker),
) -> Dict[str, Any]:
    if not worker.get("is_worker"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker token required.")
    job = db_mod.get_job_by_id(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    if job["status"] not in {"queued", "running"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Job is not active.")
    error = str(body.get("error_message") or body.get("error") or "Worker failed").strip()
    return db_mod.job_public(db_mod.mark_job_failed(job_id=job_id, error_message=error))


@app.post("/api/jobs/{job_id}/result")
async def upload_job_result(
    job_id: int,
    file: UploadFile = File(...),
    worker: Dict[str, Any] = Depends(auth.require_user_or_worker),
) -> Dict[str, Any]:
    """Worker posts the extracted-problems PDF; stored as a new upload on the tab."""
    if not worker.get("is_worker"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker token required.")
    job = db_mod.get_job_by_id(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    if job["status"] != "running":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Job is not running.")
    source = db_mod.get_upload_by_id(int(job["upload_id"]))
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source upload missing.")

    filename, data, sha256 = await _read_pdf_upload(file)
    # Prefer a clear name on the Upload tab.
    display = _safe_filename(f"extracted_{source['filename']}")
    if filename and filename != "upload.pdf":
        display = _safe_filename(filename)
    stored_name = f"{uuid.uuid4().hex}_{display}"
    db_mod.storage_path(stored_name).write_bytes(data)
    result = db_mod.insert_upload(
        user_id=int(source["user_id"]),
        filename=display,
        stored_name=stored_name,
        content_type="application/pdf",
        size_bytes=len(data),
        sha256=sha256,
        status="extracted",
        parent_upload_id=int(source["id"]),
        kind="extraction",
    )
    done = db_mod.mark_job_done(job_id=job_id, result_upload_id=int(result["id"]))
    return {"job": db_mod.job_public(done), "upload": _upload_meta(result)}
