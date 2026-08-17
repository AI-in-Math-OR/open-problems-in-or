# Open Problems in Operations Research

A website to share and explore open problems in operations research. Hosted on GitHub Pages.

## Structure

- **Problems** (`index.html`, `problem.html`): Browse and view open problems (data under `data/llm_math_export/`)
- **Upload** (`upload.html`): Login-protected PDF intake UI (`js/upload.js`)
- **Upload API** (`backend/`): FastAPI service for auth + PDF storage (see `backend/README.md`)
- Shared assets: `css/style.css`, `js/site-config.js`, …

## Local Development

1. Clone the repository
2. Start the upload API:
   ```bash
   cd backend
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env   # set UPLOAD_SEED_USERNAME / UPLOAD_SEED_PASSWORD
   python -m app
   ```
3. In another terminal, serve the static site from the repo root:
   ```bash
   python -m http.server 8000
   ```
4. Visit http://localhost:8000 and http://localhost:8000/upload.html

## Deploying to GitHub Pages

1. Push this repository to GitHub
2. Go to **Settings → Pages**
3. Under "Source", select **Deploy from a branch**
4. Choose branch **main** (or your default branch) and folder **/ (root)**
5. Save — your site will be live at `https://<username>.github.io/open-problems-in-or/`

## Shared uploads (Railway)

The Upload tab talks to whatever `SITE_CONFIG.uploadApiBaseUrl` is in `js/site-config.js`. For a **shared** store (anyone with the password), deploy `backend/` to Railway with a `/data` volume, then set that URL to the Railway HTTPS origin. Steps: [`backend/README.md`](backend/README.md).

## Maintainers

Eric Fithian, Rad Niazadeh, Pranav Nuti
