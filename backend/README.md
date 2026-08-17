# Upload API (login-protected PDF intake)

Small FastAPI service that backs `upload.html` on the static site.

## Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # then set UPLOAD_SEED_USERNAME / UPLOAD_SEED_PASSWORD
```

## Run

```bash
cd backend
source .venv/bin/activate
python -m app
```

API listens on `http://127.0.0.1:8081` by default.

In the static site, set `SITE_CONFIG.uploadApiBaseUrl` in `js/site-config.js` to that origin (already set for local dev).

Serve the site separately, e.g. from the repo root:

```bash
python -m http.server 8000
```

Then open http://127.0.0.1:8000/upload.html

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | no | Liveness |
| POST | `/auth/login` | no | `{username,password}` → `{token,user}` |
| GET | `/auth/me` | bearer | Current user |
| POST | `/auth/logout` | bearer | Client discards token |
| POST | `/api/uploads` | bearer | multipart `file` (PDF) |
| GET | `/api/uploads` | bearer | List caller's uploads |

## Data

- SQLite: `backend/data/upload_api.sqlite3` (gitignored)
- Files: `backend/uploads/` (gitignored)
- First boot seeds the admin user from `UPLOAD_SEED_*` env vars if the users table is empty.

## Scaling later

- Add users with hashed passwords (same `users` table / roles)
- Swap local `uploads/` for S3/R2 without changing the HTTP contract
- Point production `uploadApiBaseUrl` at the deployed API and rotate `SESSION_SECRET`
