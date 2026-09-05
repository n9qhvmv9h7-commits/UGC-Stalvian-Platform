# Panel API Requirements — UGC Creator Platform

**To:** Marketing Panel team
**From:** UGC Creator Platform
**Date:** 20 Jul 2026
**Status:** Verified against the Marketing Panel backend on 20 Jul 2026 (route shapes, auth, and angle keys checked in code). Corrections vs the previous draft are flagged inline with **[CORRECTION]**.

The UGC platform serves creators ready-to-shoot scripts and holds **no content or market logic of its own**. Everything (data + generated content) comes from this panel. This document is the full integration contract: everything we pull today, everything we want to pull, the shapes we depend on (please freeze them), and the gaps we need closed so we can source **all** content from here.

---

## Update (20 Jul 2026, panel side): Asks 1 and 2 built (pending deploy)
The panel team implemented two asks below; they are in the codebase and go live on the next deploy:
- **Movers as a script (Ask 2):** new feed `GET /api/album-mover-scripts/scripts?status=approved&page=&limit=` turns each Album Trades "movers" post into a shoot-ready SCRIPT (hook, timed scenes, CTA, hashtags), same shape as breaking-news scripts. Populated via `POST /api/album-mover-scripts/from-post/{post_id}` (one post) or `POST /api/album-mover-scripts/generate` (batch recent movers posts). The UGC syncs it exactly like the other script feeds.
- **Curation gate (Ask 1):** `?status=` filtering added to the five script feeds that previously returned drafts (breaking, hindsight, trending, content, politician). Pass `status=approved` to receive only curated items.

Everything else below stands as written.

---

## 1. How we integrate

### Auth: JWT service account
- We log in with a service account (an `allowed_emails` row) via `POST /api/auth/login`, cache the JWT, and re-login at ~23 h and on any 401.
- **[CORRECTION] Login response is `{token, user: {email, name, image}}`**, not `{token}`. We only need `token`, but our client must read `token` off that object (24 h HS256 JWT signed with `AUTH_SECRET`).
- **[CORRECTION] The token alone is not enough:** every internal route also checks the caller's email against the `allowed_emails` table. A valid token whose email is not seeded returns **403**, not 401. So the service-account email must be seeded in prod (see Ask 5). Missing/expired/invalid token returns **401**.
- Server-to-server only, no CORS needed.

### Public data: separate X-API-Key surface
- `/api/public/portfolios/*` is gated by an `X-API-Key` header (against `PUBLIC_API_KEY`), not the JWT. It is the only X-API-Key surface in the panel. We use it for portfolio performance/holdings/history (see section 4).

### Cadence / idempotency
- Feeds synced every 30 min (`page=1`, `limit=20-30`); album stories generated on demand when a creator asks (we tolerate up to ~240 s latency on generate calls).
- We dedupe feed items by `id`; ids must stay stable and never be reused.
- We fail soft (empty feeds), not loud, when a shape drifts. Please tell us before renaming any field in section 3 or 4.

---

## 2. What we serve creators (product recap)

| Section | What it is | Panel source(s) |
|---|---|---|
| Album Stories | Pick a fund/politician + an angle, get a full script in the creator's language | `content-scripts` + `politician-scripts` generate |
| Breaking News | Market events + how tracked funds/politicians are positioned | `breaking-scripts` (script) |
| Movers | A stock that moved + the album that caught it before | `album-trades` (post) |
| (Roadmap) more feeds | Hindsight, Trending, Insider Picks, Big Trade, Hedge Fund Alert, Top Movers | see section 3 |
| My Videos / Earnings / Applications | Creator program (accounts, view tracking, payouts) | UGC-side only, no panel dependency |

The goal is to source **every** content feed the panel produces, so the creator menu is the full catalog (section 3) rather than three feeds.

---

## 3. Content we consume (the full menu) — please freeze these contracts

All content endpoints below are **JWT-gated** (service account). All list endpoints paginate as `{items, total, page, limit}` unless noted. Two content shapes exist: **SCRIPT** (ready to shoot: `hook` + `scenes[]` + `call_to_action` + `hashtags[]`) and **POST** (carousel slides + `chart_data`, no scene track).

### 3.1 Scene contract (shared by every SCRIPT type) — freeze
```json
{"scene_number": 1, "duration_seconds": 8, "narration": "...",
 "visual_description": "...", "text_overlay": "..."}
```
We render all five keys, including durations. `alternative_hooks[]` is the full hooks array with `hook == alternative_hooks[0]`.

### 3.2 Album Stories (on-demand SCRIPTS) — consumed today

**Catalog (keys for generate):**
- `GET /api/content-scripts/funds` -> `[{name, total_return, cagr, alpha}]` (display strings, e.g. `"+42%"`). ✅ verified.
- `GET /api/politician-scripts/politicians` -> `[{name, party, total_return}]` (`party` may be null). ✅ verified.

We use `name` verbatim as the generate key; please keep the fuzzy `ILIKE` matching on your side. (Nice-to-have: also return `slug`, a stabler key. See Ask 9.)

**Generate:**
- `POST /api/content-scripts/generate` -> body `{fund_name, angle}`
- `POST /api/politician-scripts/generate` -> body `{politician_name, angle}`

Valid angle keys (verified in code; an unknown angle returns **400**):
- funds: `origin_story, performance, scandal, positions, strategy, ceo_founder, funny_quirky, comparison`
- politicians: `origin_story, trading_record, scandal, committee_trades, hypocrisy, best_trades, comparison, funny_quirky`

**Generate response (both):**
```
id, fund_name|politician_name, angle, title, hook, script_body,
scenes[], alternative_hooks[], call_to_action, hashtags[],
virality_score, virality_reasoning, sources[], status, generated_at
```
**[CORRECTION]** vs the prior draft, the response also includes `id`, `fund_name`/`politician_name`, `angle`, `virality_reasoning`, and `status`. On generate, `sources[]` is the live Perplexity citation list (up to 10); on list reads it is re-parsed from `prompt_used` (see Ask 4).

**Lists (browse previously generated):**
- `GET /api/content-scripts/scripts?fund_name=&angle=&page=&limit=`
- `GET /api/politician-scripts/scripts?angle=&page=&limit=` (no name filter)

**[CORRECTION] Neither list has a `status` filter, so both return `draft` items.** This is the core of Ask 1.

### 3.3 Feeds we can consume as SCRIPTS (ready to shoot, no adaptation)

All `{items, total, page, limit}`, each item carries the full script shape (`id, title, angle, hook, script_body, scenes[], alternative_hooks[], call_to_action, hashtags[], virality_score, virality_reasoning, sources[], status, generated_at`).

| Feed | List endpoint | Notes |
|---|---|---|
| Breaking News | `GET /api/breaking-scripts/scripts?status=&page=&limit=` | consumed today. `angle` literal `"Breaking News"`. `?status=` filter now supported (pass `approved`). |
| Movers (album) | `GET /api/album-mover-scripts/scripts?status=&page=&limit=` | NEW. `angle` `"Movers"`. Script version of the Album Trades movers post (item also carries `ticker`, `source_post_id`, `chart_data`). Populate via `POST /api/album-mover-scripts/from-post/{post_id}` or batch `POST /api/album-mover-scripts/generate`. |
| Hindsight | `GET /api/hindsight-scripts/scripts?status=&page=&limit=` | roadmap. `angle` `"Hindsight"`. `?status=` filter now supported. |
| Trending | `GET /api/trending-scripts/scripts?status=&page=&limit=` | roadmap. `angle` `"Trending"`. `sources[]` always `[]`. `?status=` filter now supported. |
| Generic scripts | `GET /api/scripts?status=&trade_type=&trade_id=&date_from=&date_to=&page=&limit=` | insider/politician/13F narratives. Has `status` filter. Envelope adds `pages`. Also exposes translate (section 5, Ask 3). |
| Stock scripts | `GET /api/stock-scripts/?status=&page=&limit=` | on-demand from a Top Movers post (`POST /api/stock-scripts/from-post/{id}`). Has `status`. |

### 3.4 Feeds that are POSTS today (need script fields to be first-class SCRIPTS — Ask 2)

Carousel/slide items with `chart_data`; no `scenes[]`. Consumable now for card display, but to serve them as shoot-ready video scripts we need the pipeline to also emit `hook / alternative_hooks[] / scenes[] / call_to_action / hashtags[]` (the `VideoScript` columns already exist). Until then we would have to synthesize copy locally, which breaks the "all content from the curated pipeline" rule.

| Feed | List endpoint | Item highlights |
|---|---|---|
| Movers | `GET /api/album-trades?feed=movers\|daily&status=&page=&limit=` | `id, ticker, slide1_headline, slide2_company_name, slide2_description, slide3_headline, slide3_summary, caption, person_label, amount_str, company_name, virality_score, generated_at`, `chart_data.month_return_pct`. **Has status filter** (we pass `status=approved`). |
| Top Movers | `GET /api/stock-news-posts/?status=&page=&limit=` | `ticker, headline, summary, caption, chart_data{points[], pct_change, research_why, ...}, virality_score`. Has status. |
| Insider Picks | `GET /api/insider-picks/?status=&page=&limit=` | `ticker, headline, summary, caption, chart_data, insider_return_pct, virality_score`. Has status. |
| Big Trade Alert | `GET /api/big-buy-alerts?status=&page=&limit=` | slide1/2/3 + `caption, person_label, amount_str, company_name, chart_data`. Has status. |
| Hedge Fund Alert | `GET /api/hedge-fund-alerts?status=&page=&limit=` | `filer_name, slide1_headline, top_buys[], top_sells[], caption, chart_data`. Has status. |
| Breaking News posts | `GET /api/breaking-news-posts?category=macro\|stock\|fda\|gov&status=&page=&limit=` | multi-slide carousels (macro / single-stock / FDA / gov contract). |
| Trending Stories | `GET /api/trending-stories?status=&page=&limit=` | 4-slide carousel (event -> stock -> smart money -> chart). |

**Imagery note:** post imagery (`person_photo_url`, `company_image_url`, `company_logo_url`, logos) is delivered as **base64 data URLs inline in `chart_data`**, not hosted URLs. See Ask 8.

### 3.5 Long-form (optional, different medium)
- `GET /api/blog-posts?kind=ticker\|buy\|tracker\|portfolio&status=&limit=` -> SEO articles (`headline, slug, dek, sections[], faq[], seo, markdown, hero_image_url, sources[], price_chart`). Not a video script; only relevant if creators produce written/long-form content.

---

## 4. Data we pull for context and localization

### 4.1 Public portfolios (X-API-Key, no JWT)
`GET /api/public/portfolios` (`?kind=fund|politician`), `/{slug}`, `/{slug}/holdings`, `/{slug}/history?range=1y|all`. Returns metrics (`total_return, cagr, sharpe, max_drawdown, alpha, beta, volatility`), current holdings (`ticker, weight, last_price, is_stale`), and the daily index series vs SPY (indexed to 100, not dollars). 60 s cache, 300 req/min. Only `backfill_status == "done"` portfolios are visible.

### 4.2 Internal data (JWT service account)
| Endpoint | Purpose |
|---|---|
| `GET /api/albums/investors?kind=fund\|politician` | investor list + cached metrics + backfill status |
| `GET /api/albums/investors/{slug}/series?range=1y\|all` | portfolio vs SPY index series + holdings periods |
| `GET /api/albums/investors/{slug}/allocation` | current holdings + staleness |
| `GET /api/trades/politicians\|insiders\|13f` | paginated raw trade data (`{items,total,page,limit,pages}`) |
| `GET /api/trades/13f/{id}` | one 13F filing with holdings |
| `GET /api/trades/feed?limit=` | unified recent-trades feed (bare list) |
| `GET /api/news/articles?news_type=&breaking=&since=&limit=&offset=` | news feed (bare list, `offset` paging) |
| `GET /api/news/stats` | news aggregates |
| `GET /api/market/chart?ticker=&days=` | price chart for any ticker |
| `GET /api/dashboard/stats \| trending-tickers \| top-traders` | aggregates |

**[CORRECTION] Pagination is not uniform:** `/api/trades/*` and `/api/scripts` return `{items,total,page,limit,pages}`; the content routers in section 3 return `{items,total,page,limit}` (no `pages`); `/api/news/articles` and `/api/trades/feed` return **bare lists** (no envelope). See Ask 7.

---

## 5. Asks — gaps to close so we can source everything here

### Ask 1 — Approved-only content (curation gate) · priority: HIGH · **BUILT (pending deploy)**
**Done:** `?status=` filtering was added to all five script feeds (`breaking-scripts`, `hindsight-scripts`, `trending-scripts`, `content-scripts`, `politician-scripts`); pass `status=approved`. Original finding, for reference: these list endpoints previously had **no `status` filter** and returned `draft` items. Only the POST feeds (album-trades, stock-news, insider-picks, big-buy, hedge-fund-alerts) and the generic `/api/scripts` already filter by `status`.

Creators must only ever see content your team has curated. **Request:** add `?status=approved` to those five script lists and agree the workflow (your team approves in the panel -> we sync only `status=approved`). We already pass `status=approved` on every POST feed that supports it.
*(Cleaner alternative: one dedicated `GET /api/ugc/feed?type=&page=&limit=` that only ever returns approved items across all feeds, with a normalized shape. This would also let us drop per-feed shape handling.)*

### Ask 2 — Post feeds as scripts, from your pipeline · priority: HIGH · **BUILT for Movers (pending deploy)**
**Done for Movers:** the new `GET /api/album-mover-scripts/scripts` feed emits full script fields from the Album Trades movers posts (see the Update note at the top). The remaining section 3.4 feeds (Top Movers, Insider Picks, Big Trade, Hedge Fund Alert) are still slide posts, not scripts. **Request:** have their generation also emit the script fields (`hook`, `alternative_hooks[]`, `scenes[]` per the scene contract, `call_to_action`, `hashtags[]`) on the list items, at minimum for Movers first, then Top Movers / Insider Picks / Big Trade / Hedge Fund Alert. Once present we pass your copy through untouched and delete any local synthesis.

### Ask 3 — Translations · priority: MEDIUM (decision needed)
Creators pick one of 8 languages (en/es/fr/de/it/pt/nl/pl). **Verified:** a `translations` JSON column exists and `POST /api/scripts/{id}/translate` populates it, but **only on the generic `/api/scripts` router** - the specialized script/post routers neither expose translate nor return `translations` in their list items. Today we translate UGC-side (Claude Haiku, cached per (item, language)).

**Decide one:**
- **A (panel owns translations):** expose translate-by-id for the specialized types and include the `translations` dict in list items. Your prompts control tone in every language; we drop our translator.
- **B (status quo):** we keep translating UGC-side; panel content stays English-only. No panel work.

Either works; A gives you editorial control end to end.

### Ask 4 — Persist `sources` · priority: LOW
**Verified:** `sources` is not a column. On generate it is the live Perplexity citation list; on list reads it is re-parsed out of `prompt_used` text (and is always `[]` for trending scripts). A prompt-format change silently breaks attribution. **Request:** store citations in their own column and return them directly.

### Ask 5 — Service-account provisioning · priority: HIGH (ops, ~5 min)
Seed `ugc-service@stalvian.com` in the **production** allowlist and share the password through a secret channel (it goes into our `PANEL_SERVICE_EMAIL` / `PANEL_SERVICE_PASSWORD` env vars). Command (verified): `python seed_allowed_emails.py ugc-service@stalvian.com --password <pw>` (the script accepts multiple emails; password defaults to `changeme` if omitted, so please pass an explicit strong one). Also send the **production API base URL**. Optional later hardening: a scoped read+generate role, or an `X-API-Key` surface for content like `/api/public/portfolios` already has (would let us drop the login/allowlist dance entirely).

### Ask 6 — Contract guarantees · priority: HIGH (agreement, no code)
- Feed item `id`s are stable and never reused (our dedup key).
- Timestamps stay ISO 8601 (`generated_at`).
- Scene keys stay as in 3.1; `hook == alternative_hooks[0]`.
- Generate calls may take up to ~240 s; anything longer needs an async job pattern (tell us and we adapt).
- Tell us before renaming any field in sections 3 or 4.

### Ask 7 — Uniform pagination · priority: LOW
Content routers return `{items,total,page,limit}`, `/api/scripts` and `/api/trades` add `pages`, and `/api/news/articles` + `/api/trades/feed` return bare lists. We handle all three, but a single `{items,total,page,limit,pages}` envelope everywhere (or on any new `/api/ugc/feed`) would let us delete branching.

### Ask 8 — Hosted image URLs · priority: MEDIUM
Post imagery is base64 inline in `chart_data`, which bloats feed payloads we cannot cheaply show to creators. **Request:** serve `person_photo_url` / `company_image_url` / `company_logo_url` (and blog `hero_image_url`) as hosted URLs.

### Ask 9 — Catalog slugs · priority: LOW
Include the album `slug` on `content-scripts/funds` and `politician-scripts/politicians` so generate calls key on a stable slug rather than display-name matching.

### Ask 10 — Incremental sync · priority: LOW
An `updated_since=<iso>` param (or a webhook) on the list endpoints so we can drop 30-min full polling.

---

## 6. Field-by-field consumption map (reference)

| Panel field | Where it appears in the UGC app |
|---|---|
| `title` | Script card headline (serif display) |
| `hook` / `alternative_hooks[]` | HOOK panel with Option A/B/C selector |
| `scenes[].narration` | Scene body text |
| `scenes[].visual_description` | "Visual: ..." direction line |
| `scenes[].text_overlay` | `[BRACKETED OVERLAY]` above narration |
| `scenes[].duration_seconds` | Duration chip per scene ("8s") |
| `call_to_action` | CALL TO ACTION panel (ink block) |
| `hashtags[]` | Hashtag row + copy button |
| `virality_score` / `virality_reasoning` | 10-segment virality meter + pick rationale |
| `sources[]` | Stored; future "sources" disclosure for creators |
| `generated_at` | Feed ordering + "2 h ago" stamps |
| catalog `total_return/cagr/alpha` | Album picker stats |
| mover slides + `chart_data.month_return_pct` | Mover cards (`+34% - 30d` badge) |
| public `returns` / `holdings` / `history` | Album detail + performance charts shown to creators |

---

## 7. Endpoint quick reference (everything we depend on)

| Endpoint | Auth | Shape | Status filter |
|---|---|---|---|
| `POST /api/auth/login` | none | `{token, user}` | - |
| `GET /api/content-scripts/funds` | JWT | list | - |
| `GET /api/politician-scripts/politicians` | JWT | list | - |
| `POST /api/content-scripts/generate` | JWT | script obj | - |
| `POST /api/politician-scripts/generate` | JWT | script obj | - |
| `GET /api/content-scripts/scripts` | JWT | `{items,total,page,limit}` | yes |
| `GET /api/politician-scripts/scripts` | JWT | `{items,total,page,limit}` | yes |
| `GET /api/breaking-scripts/scripts` | JWT | `{items,total,page,limit}` | yes |
| `GET /api/album-mover-scripts/scripts` | JWT | `{items,total,page,limit}` | yes |
| `GET /api/hindsight-scripts/scripts` | JWT | `{items,total,page,limit}` | yes |
| `GET /api/trending-scripts/scripts` | JWT | `{items,total,page,limit}` | yes |
| `GET /api/scripts` | JWT | `{items,total,page,limit,pages}` | yes |
| `GET /api/stock-scripts/` | JWT | `{items,total,page,limit}` | yes |
| `POST /api/scripts/{id}/translate` | JWT | script obj | - |
| `GET /api/album-trades?feed=movers\|daily` | JWT | `{items,total,page,limit}` | yes |
| `GET /api/stock-news-posts/` | JWT | `{items,total,page,limit}` | yes |
| `GET /api/insider-picks/` | JWT | `{items,total,page,limit}` | yes |
| `GET /api/big-buy-alerts` | JWT | `{items,total,page,limit}` | yes |
| `GET /api/hedge-fund-alerts` | JWT | `{items,total,page,limit}` | yes |
| `GET /api/breaking-news-posts?category=` | JWT | `{items,total,page,limit}` | yes |
| `GET /api/trending-stories` | JWT | `{items,total,page,limit}` | yes |
| `GET /api/blog-posts?kind=` | JWT | `{items,total}` | yes |
| `GET /api/public/portfolios[/{slug}[/holdings|/history]]` | X-API-Key | objects | - |
| `GET /api/albums/investors[...]` | JWT | objects | - |
| `GET /api/trades/{politicians\|insiders\|13f}` | JWT | `{items,total,page,limit,pages}` | - |
| `GET /api/trades/feed` | JWT | bare list | - |
| `GET /api/news/articles` | JWT | bare list (`offset`) | - |
| `GET /api/market/chart?ticker=&days=` | JWT | chart obj | - |
| `GET /api/dashboard/{stats\|trending-tickers\|top-traders}` | JWT | objects | - |
