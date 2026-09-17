# Stalvian UGC Creator Platform

A platform where invited creators get ready-to-shoot video scripts about Stalvian —
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
| **Daily Threads** (X creators) | The same breaking and trending posts composed as X threads by the panel | `GET /api/ugc/scripts?feed=tweets_breaking\|tweets_trending` |
| **My Videos** | Paste published video links; views are tracked (YouTube auto, TikTok/IG verified by team) | — |
| **Earnings** | Live balance, payout history, and the pay formula with a simulator | — |

## Account types — videos or X

Every creator is one of two **account types**, chosen by the admin at invite
(`Creator.account_type`, `video` | `tweets`) and switchable later through
`PATCH /api/admin/creators/{id}`. A creator only ever sees their own surface:

| | Video creator | X creator (`tweets`) |
|---|---|---|
| Content | Album Stories, Daily Scripts (breaking, movers, top trades) | **Daily Threads**: Breaking News and Trending, as ready-to-post X threads |
| Panel feeds | `feed=breaking\|movers\|hindsight\|trending` | `feed=tweets_breaking\|tweets_trending` — items carry `tweets: [{text, order}]` |
| Submissions | My Videos — TikTok, Instagram, YouTube links | My Posts — X links (`x.com/…/status/…`, `t.co` resolved) |
| Earnings | views pay + client referrals | the same, on post views |

Both surfaces are paid by the same formula on the same `video_submissions`
table — a submission's `platform` says which surface it came from, and
`view_tracker.SURFACE_PLATFORMS` decides which links an account may submit
(a video account is refused an X link and vice versa). X publishes no view
count we can read, so every post is verified by an admin, like TikTok and
Instagram. Album-story generation stays video-only (403), since the panel has
no thread version of it.

The feed list (`GET /api/feed/types`) is filtered by account type, so the app
never has to know which feed keys belong to which surface; `src/lib/surface.ts`
holds the per-surface navigation and the guard that sends a creator home from
the other surface's pages. Threads are translated like scripts, with the extra
rule that a translation is only cached if every tweet stays under 280 characters.

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

## Client referrals — the second income stream

Every creator has a **referral code** (`POL-7K3M` style, generated on invite and
backfilled on startup for older accounts). New Stalvian clients enter it during
the product's onboarding; the creator then earns **25% of every fee that client
pays** for **one year from that client's first trade**. Views pay and fee
share land in the same balance and are paid out together.

- The Stalvian product reports sign-ups and fees over an API-key surface
  (`GET /api/referrals/codes/{code}`, `POST /api/referrals/clients`,
  `POST /api/referrals/fees`) — contract in `REFERRAL_API_REQUIREMENTS.md`.
  `REFERRAL_API_KEY` unset → those endpoints answer 503.
- Until the product integration is live (or to correct a record), admins
  attribute clients and record fees by hand in **Admin › Referrals**.
- Each fee event stores the creator's share computed at the rate in force
  (`REFERRAL_COMMISSION_BPS`, default 2500); changing the rate never rewrites history.
- Creators see their code on the dashboard, earnings page and settings, plus a
  client list (masked labels only, never client identity) and their share.
- Logic: `backend/app/services/referrals.py`, routes in `routes_referrals.py`,
  tables `referred_clients` + `fee_events`.

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

Each creator has a language (en/es/fr/de/it/pt/nl/pl), set when the team invites
them and changeable in Settings. Album stories are
translated on generation; feed stories are translated lazily on first request and
cached per (story, language) — Claude Haiku via `ANTHROPIC_API_KEY`.

## Architecture

- `backend/` — FastAPI + async SQLAlchemy (SQLite dev / Postgres prod) + APScheduler
  (feed sync every 30 min, YouTube view refresh every 6 h). No Celery/Redis needed.
- `frontend/` — Next.js 16 (App Router) + Tailwind v4, styled with the **Stalvian
  Design System** (ink `#010510` / cream `#F4F2EA`, Martina Plantijn display, Geist UI,
  Phosphor icons, dashed editorial cards, European number formatting).
  One codebase, **two deployments**: `NEXT_PUBLIC_APP_MODE` (`creator` | `admin` | `all`)
  decides which surface a build serves. `src/lib/app-mode.ts` holds the vocabulary,
  `src/middleware.ts` enforces it. Locally the default `all` serves both on :3100.
- Auth: invite-only accounts → bcrypt + HS256 JWT (`ugc-token` cookie, Bearer header).
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
- **Schema changes:** tables are created by `create_all` on startup, which never
  ALTERs existing tables. The first deploy works on an empty database; after
  that, adding/renaming columns needs a manual `ALTER TABLE` (or introduce
  Alembic) before deploying the model change.

## Production deploy (Render)

`render.yaml` provisions **four things in Frankfurt**: Postgres, the API, and *two*
frontend services built from the same `frontend/Dockerfile` —

| Service | Serves | Mode |
|---|---|---|
| `ugc-platform-api` | FastAPI + scheduler | — |
| `ugc-creators-web` | the creator app; `/admin/*` redirects to `/dashboard` | `creator` |
| `ugc-admin-web` | `/admin/*` and `/login` only; everything else redirects to `/admin` | `admin` |

The admin panel is therefore never reachable on the public creator URL.

`NEXT_PUBLIC_*` values are inlined at **build** time (Render passes a service's env
vars to the Docker build as build args), and Render only assigns a service its URL
after the first deploy — so the first rollout is two passes:

1. **Create the blueprint.** Connect the repo; Render picks up `render.yaml` and
   prompts for every `sync: false` value. Fill in the panel and API keys; leave the
   three URL vars blank for now. Set `BOOTSTRAP_ADMIN_EMAIL` and
   `BOOTSTRAP_ADMIN_PASSWORD` on the API — a fresh database has no accounts and
   there is no signup, so this is the only way in.
2. **Wire the URLs.** Once the three services are up, copy their `onrender.com` URLs:
   - API → `NEXT_PUBLIC_API_URL` on **both** web services
   - creator URL → `FRONTEND_URL` (API) and `NEXT_PUBLIC_CREATOR_URL` (admin web)
   - admin URL → `ADMIN_URL` (API, for CORS). The creator app needs nothing here —
     it never links to the admin panel.
3. **Redeploy both web services** so the new build args are baked in. Changing a
   `NEXT_PUBLIC_*` var needs a *redeploy*, not a restart.
4. **Log in** at the admin URL with the bootstrap credentials, change the password in
   the creator app's Settings, then clear the `BOOTSTRAP_ADMIN_*` vars.

Both URLs are separate origins, so the `ugc-token` cookie is not shared: an admin
signs in once per URL. That is deliberate — it keeps the internal panel's session
isolated from the public app.

Custom domains can be added in the Render dashboard later with no code change; only
the URL env vars above need updating (and a redeploy of the web services).

## Admin

The first admin comes from the `BOOTSTRAP_ADMIN_*` env vars (see
[Production deploy](#production-deploy-render)). To promote someone afterwards:

```sql
UPDATE creators SET is_admin = true WHERE email = 'you@stalvian.com';
```

### Locked out?

Passwords are bcrypt hashes and cannot be read back, and the bootstrap above
deliberately does nothing once an admin exists — so a forgotten admin password
needs an explicit reset. Two ways, no database client required:

1. **Env + redeploy** (no shell): on `ugc-platform-api` set `BOOTSTRAP_ADMIN_EMAIL`,
   `BOOTSTRAP_ADMIN_PASSWORD` and `BOOTSTRAP_ADMIN_RESET=true`, then redeploy. The
   account is reset to that password on boot (created if missing, and always left
   admin + approved). **Clear `BOOTSTRAP_ADMIN_RESET` straight afterwards** — it
   re-applies on every restart while it is set.
2. **One-off script**, from the Render shell or a One-Off Job:

   ```bash
   python reset_admin_password.py you@stalvian.com            # generates one
   python reset_admin_password.py you@stalvian.com --password 'chosen'
   ```

Either way the reset invalidates every outstanding token for that account, since
a token is tied to the password hash.

- `GET /api/admin/creators?status=pending` — creator applications with social links
- `PATCH /api/admin/creators/{id}` — `{status: "approved" | "rejected", review_note}`
- `GET /api/admin/videos?status=pending` — queue of TikTok/IG links to verify
- `PATCH /api/admin/videos/{id}` — `{status: "verified", views: 12000}`
- `POST /api/admin/payouts` — `{creator_id, amount_cents, note}` records a payment
- `GET /api/admin/referrals` — codes, referred clients and fee ledger per creator
- `POST /api/admin/referrals/clients` / `POST /api/admin/referrals/fees` — manual attribution / fee entry

The admin panel is reached only at the admin URL, by typing it. The creator app
never links to it — an admin signing in there sees exactly the creator sidebar a
creator sees. The admin shell has a one-way "Creator App" link back.
