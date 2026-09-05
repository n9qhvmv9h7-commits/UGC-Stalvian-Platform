# Stalvian UGC Creator Platform

A platform where creators sign up, get ready-to-shoot video scripts about Stalvian —
built from real market data — and get paid per video based on views.

**All content and data comes from the [Stalvian Marketing Panel](../Stalvian-Marketing-Panel) API.**
This platform holds no market data of its own: it authenticates against the panel with a
service account, pulls stories, localizes them per creator, and layers the creator
program (accounts, video tracking, payouts) on top.

## What creators get

| Section | What it is | Panel source |
|---|---|---|
| **Album Stories** | Pick an album (hedge fund or politician) + an angle (origin story, scandal, strategy, best trades…) → a full script is generated in the creator's language | `POST /api/content-scripts/generate`, `POST /api/politician-scripts/generate` |
| **Breaking News** | Market events + how tracked politicians/funds are positioned | `GET /api/breaking-scripts/scripts` |
| **Movers** | A stock that moved big + the album that caught the trade before | `GET /api/album-trades?feed=movers` (+ `feed=daily`) |
| **My Videos** | Paste published video links; views are tracked (YouTube auto, TikTok/IG verified by team) | — |
| **Earnings** | Live balance, payout history, and the pay formula with a simulator | — |

## Pay formula

- A video starts earning at **1.000 views**.
- **€5,00 base** once it passes 1.000 views.
- **+ €1,00 per extra 1.000 views** up to 50.000 views.
- **+ €0,50 per 1.000 views** beyond 50.000.
- **Cap: €250,00 per video.** Balances paid out monthly.
- **10-day window:** only views gained in the first 10 days after posting count —
  the eligible count freezes at the last `ViewSnapshot` inside the window
  (`app/services/earning_window.py`).
- **Strikes:** a creator deleting a posted video = 1 strike (admin marks the video
  `removed`); 2 strikes set the creator to `terminated` and end the partnership.

Examples: 1k → €5 · 10k → €14 · 50k → €54 · 100k → €79 · ~442k+ → €250 (cap).
Formula lives in `backend/app/payout.py`; the frontend reads it from `GET /api/earnings/formula`.

## Access — invite-only

There is **no public signup or landing page**. The Stalvian team creates
accounts on the **Creators** admin page (`/admin`) or via
`POST /api/admin/creators {email, name?, language?}` — a one-time password is
generated and shown once, to be shared with the creator (they change it in
Settings). Admins can revoke and reinstate access; two deletion strikes
terminate an account automatically. Non-approved statuses can log in but only
see a status screen; all content, video and earnings endpoints return 403.

## Data retention

Everything served to creators is stored in this project's own database:
- Feed items and generated scripts keep the **exact panel API response** in
  `stories.raw` (the rendered payload lives in `stories.payload`, translations
  per language in `stories.translations`, including the English source).
- The albums catalog is cached in `panel_cache` on every successful fetch and
  served from cache when the panel is unreachable — a panel outage never
  blanks the app.

## Language

Creators pick a language at signup (en/es/fr/de/it/pt/nl/pl). Album stories are
translated on generation; feed stories are translated lazily on first request and
cached per (story, language) — Claude Haiku via `ANTHROPIC_API_KEY`.

## Architecture

- `backend/` — FastAPI + async SQLAlchemy (SQLite dev / Postgres prod) + APScheduler
  (feed sync every 30 min, YouTube view refresh every 6 h). No Celery/Redis needed.
- `frontend/` — Next.js 16 (App Router) + Tailwind v4, styled with the **Stalvian
  Design System** (ink `#010510` / cream `#F4F2EA`, Martina Plantijn display, Geist UI,
  Phosphor icons, dashed editorial cards, European number formatting).
- Auth: self-service signup → bcrypt + HS256 JWT (`ugc-token` cookie, Bearer header).
  Admin accounts (`is_admin`) verify TikTok/IG views and record payouts via `/api/admin/*`.

## Setup

### 1. Panel service account (one-time, in the Marketing Panel repo)

```bash
cd ../Stalvian-Marketing-Panel/backend
python seed_allowed_emails.py ugc-service@stalvian.com --password <strong-password>
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in AUTH_SECRET, PANEL_*, ANTHROPIC_API_KEY
uvicorn app.main:app --port 8100 --reload
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev            # http://localhost:3100
```

### Docker / production

- Local stack: `docker compose up` (Postgres on 5433, API on 8100, web on 3100).
  A panel running on the host is reachable from the container as
  `http://host.docker.internal:8000` (preconfigured in compose).
- Render: connect the repo — `render.yaml` provisions Postgres + API + frontend
  (~$14/mo on starter plans). Set the `sync: false` secrets in the dashboard.
- **Schema changes:** tables are created by `create_all` on startup, which never
  ALTERs existing tables. The first deploy works on an empty database; after
  that, adding/renaming columns needs a manual `ALTER TABLE` (or introduce
  Alembic) before deploying the model change.

## Admin

Promote an account, then use the admin endpoints (or build a UI later):

```sql
UPDATE creators SET is_admin = true WHERE email = 'you@stalvian.com';
```

- `GET /api/admin/creators?status=pending` — creator applications with social links
- `PATCH /api/admin/creators/{id}` — `{status: "approved" | "rejected", review_note}`
- `GET /api/admin/videos?status=pending` — queue of TikTok/IG links to verify
- `PATCH /api/admin/videos/{id}` — `{status: "verified", views: 12000}`
- `POST /api/admin/payouts` — `{creator_id, amount_cents, note}` records a payment

Admins also get an **Applications** page in the web app (visible in the sidebar
when `is_admin` is set).
