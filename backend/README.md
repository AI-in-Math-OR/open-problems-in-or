# Upload API (login-protected PDF intake)

Small FastAPI service that backs `upload.html` on the static site.

## Local setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # then set UPLOAD_SEED_USERNAME / UPLOAD_SEED_PASSWORD
python -m app
```

API listens on `http://127.0.0.1:8081` by default.

Serve the site from the repo root:

```bash
python -m http.server 8000
```

Then open http://127.0.0.1:8000/upload.html

## Shared production (Railway)

Anyone with the shared password uploads to **one** Railway volume (not each person's laptop).

### 1. Create the service

1. [Railway](https://railway.app) → New Project → Deploy from GitHub (this repo).
2. Set the service **Root Directory** to `backend`.
3. Railway will build via [`Dockerfile`](Dockerfile) / [`railway.toml`](railway.toml).

### 2. Attach a volume

1. Service → **Volumes** → Add volume.
2. Mount path: `/data`
3. Size: start with 1–5 GB.

This persists SQLite + PDFs across deploys.

### 3. Environment variables

In Railway → Variables (do **not** commit these):

| Variable | Example |
|----------|---------|
| `HOST` | `0.0.0.0` |
| `DATA_DIR` | `/data` |
| `UPLOAD_DIR` | `/data/uploads` |
| `UPLOAD_SEED_USERNAME` | `pete` |
| `UPLOAD_SEED_PASSWORD` | *(shared password)* |
| `SESSION_SECRET` | *(long random string)* |
| `CORS_ORIGINS` | `https://ai-in-math-or.github.io,http://127.0.0.1:8000,http://localhost:8000` |

`PORT` is set automatically by Railway.

`CORS_ORIGINS` must name the exact scheme and host the site is served from, with
no path — `https://ai-in-math-or.github.io` covers the whole project page. The
value is read once at import, so changing it in Railway needs a redeploy to take
effect. Because the API runs with `allow_credentials=True`, `*` is not accepted
as a shortcut; every origin has to be listed.

### 4. Public URL

1. Service → **Settings** → **Networking** → Generate domain (e.g. `https://opor-upload-api.up.railway.app`).
2. Confirm `GET https://<domain>/health` returns `{"status":"ok"}`.
3. Set that origin (no trailing slash) in [`../js/site-config.js`](../js/site-config.js) as `uploadApiBaseUrl`, then commit/push so GitHub Pages picks it up.

### 5. Smoke test

Open the live Upload tab → log in → upload a small PDF → it should appear in the list and land on the Railway volume under `/data/uploads/`.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | no | Liveness |
| POST | `/auth/login` | no | `{username,password}` → `{token,user}` |
| GET | `/auth/me` | bearer | Current user |
| POST | `/auth/logout` | bearer | Client discards token |
| POST | `/api/uploads` | bearer | multipart `file` (PDF) |
| GET | `/api/uploads` | bearer | List caller's uploads |

## Data layout

| Env | Local default | Railway |
|-----|---------------|---------|
| `DATA_DIR` | `backend/data/` | `/data` |
| `UPLOAD_DIR` | `backend/data/uploads/` | `/data/uploads` |
| DB | `$DATA_DIR/upload_api.sqlite3` | same |

First boot seeds the admin user from `UPLOAD_SEED_*` if the users table is empty.

## Scaling later

- Add more users (same `users` table / roles)
- Swap volume files for R2/S3 without changing the HTTP contract
- Rotate `SESSION_SECRET` and the shared password periodically
