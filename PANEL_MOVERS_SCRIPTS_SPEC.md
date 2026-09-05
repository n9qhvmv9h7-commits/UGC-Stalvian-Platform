# Panel Delivery Spec: Album Movers Scripts + Curation Gate

**From:** Marketing Panel team
**To:** UGC Creator Platform team
**Date:** 21 Jul 2026
**Status:** Built and audited; goes live on the next panel deploy. Base URL is the existing panel production API.

This document specifies exactly what the panel now exposes for two items: (1) a new **Album Movers Scripts** feed (movers delivered as shoot-ready video scripts, not slide posts), and (2) a **curation gate** (`?status=` filtering) on the script feeds so only approved content is forwarded. It is self-contained; you do not need the requirements doc to integrate.

---

## 1. Summary

| Item | What it is |
|---|---|
| **Album Movers Scripts** | The Album Trades "movers" story (a tracked fund or politician that held a stock before a big move) is now available as a full video SCRIPT: hook, timed scenes, call to action, hashtags. Same JSON shape as the breaking-news script feed. |
| **Curation gate** | `?status=` filtering was added to every script feed that previously returned drafts. Pass `status=approved` to receive only content the panel team has curated. |

Nothing existing was renamed or removed. These are additive.

---

## 2. Auth (unchanged)

All endpoints below require the JWT service account, exactly like the other panel feeds:

1. `POST /api/auth/login` with `{ "email": "...", "password": "..." }` returns `{ "token": "<jwt>", "user": {...} }` (24 h HS256).
2. Send `Authorization: Bearer <token>` on every request below.
3. The service-account email must be present in the panel allowlist (a missing/unlisted email returns 403; a missing/expired token returns 401).

Server to server only. No new auth surface was introduced for this delivery.

---

## 3. Album Movers Scripts feed

Prefix: `/api/album-mover-scripts`

### 3.1 Read the feed (this is what you sync)

`GET /api/album-mover-scripts/scripts`

Query params:
- `status` (optional): pass `approved` to receive only curated items. Omit to see everything (drafts included).
- `page` (default 1), `limit` (default 20, max 100).

Response envelope: `{ "items": [ ...script items... ], "total": int, "page": int, "limit": int }`

Script item shape (identical to the other script feeds, plus `ticker`, `source_post_id`, and `chart_data`):

```json
{
  "id": 4821,
  "source_post_id": 4703,
  "ticker": "NVDA",
  "angle": "Movers",
  "title": "The fund that held NVDA before the run",
  "hook": "This hedge fund disclosed NVDA back on 2025-02-14, at $118. It now trades at $172.",
  "script_body": "full narration, scenes joined by blank lines",
  "scenes": [
    {
      "scene_number": 1,
      "duration_seconds": 6,
      "narration": "What the narrator says",
      "visual_description": "What is on screen",
      "text_overlay": "On-screen text"
    }
  ],
  "hashtags": ["#investing", "#nvda"],
  "alternative_hooks": ["hook A", "hook B", "hook C"],
  "call_to_action": "Track institutional and insider positioning on Stalvian",
  "virality_score": 8,
  "virality_reasoning": "why this is compelling",
  "sources": [],
  "chart_data": { "...": "see 3.4" },
  "status": "approved",
  "generated_at": "2026-07-21T09:12:00",
  "updated_at": "2026-07-21T09:40:00"
}
```

Notes:
- `hook == alternative_hooks[0]`. Render `alternative_hooks` as the A/B/C hook selector, same as breaking-news scripts.
- `angle` is always the literal string `"Movers"`.
- Ordered newest first by `generated_at`.

### 3.2 Populate the feed (panel-side, but available to the service account)

A movers script is derived from an existing Album Trades "movers" post. Two ways to create them:

- `POST /api/album-mover-scripts/from-post/{post_id}`: generate a script from one movers post. Returns the existing script if one already exists (`created: false`), otherwise creates and returns it.
  Response: `{ "status": "ok", "script_id": 4821, "created": true }`. Returns 404 if `post_id` is not an Album Trades movers post.
- `POST /api/album-mover-scripts/from-post/{post_id}/regenerate`: force a fresh generation, replacing any existing script for that post.
- `POST /api/album-mover-scripts/generate?limit=10`: batch-create draft scripts for recent movers posts that do not have one yet. `limit` default 10, max 30. Response: `{ "status": "ok", "created": 7, "ids": [4821, 4822, ...] }`.

Generation calls Claude and can take up to ~90 s each (the batch is proportional). They are idempotent per source post (one script per movers post).

### 3.3 Curate and manage

- `GET /api/album-mover-scripts/by-post/{post_id}`: `{ "script_id": 4821 }` or `{ "script_id": null }`. Lightweight existence check.
- `PATCH /api/album-mover-scripts/{script_id}`: body may include `title`, `hook`, `script_body`, `status`. `status` must be one of `draft`, `approved`, `published`, `rejected`. Response: `{ "id", "status", "title" }`. **This is how content is approved for you to sync.**
- `DELETE /api/album-mover-scripts/{script_id}`: `{ "status": "ok" }`.

### 3.4 `scenes[]` and `chart_data` shapes

`scenes[]` item (the same five keys used across all panel script feeds):
```
{ "scene_number": int, "duration_seconds": int, "narration": str, "visual_description": str, "text_overlay": str }
```

`chart_data` carries the underlying movers post data so you can show the chart and stats alongside the script:
```json
{
  "category": "album_trade",
  "kind": "fund",
  "album_name": "Scion Asset Management",
  "album_slug": "scion-asset-management",
  "ticker": "NVDA",
  "company_name": "NVIDIA Corporation",
  "entry_date": "2025-02-14",
  "entry_price": 118.0,
  "current_price": 172.0,
  "insider_return_pct": 45.8,
  "month_return_pct": 12,
  "badge_text": "13F filing",
  "amount_str": "+46%",
  "points": [{ "t": 1739500000000, "c": 118.4 }],
  "song_suggestions": [{ "title": "...", "artist": "..." }],
  "person_photo_url": null,
  "company_image_url": null,
  "company_logo_url": null
}
```
Imagery fields (`person_photo_url`, `company_image_url`, `company_logo_url`) are `null` unless a panel user uploaded one; when present they are base64 data URLs inline in `chart_data` (same convention as the other post feeds). `entry_price` is the price on the disclosure/filing date, not a "bought at" claim.

---

## 4. Curation gate (all script feeds)

`?status=` filtering was added to the script feeds that previously returned every draft. Pass `status=approved` to receive only curated items:

- `GET /api/breaking-scripts/scripts?status=approved&page=&limit=`
- `GET /api/album-mover-scripts/scripts?status=approved&page=&limit=`
- `GET /api/hindsight-scripts/scripts?status=approved&page=&limit=`
- `GET /api/trending-scripts/scripts?status=approved&page=&limit=`
- `GET /api/content-scripts/scripts?status=approved&page=&limit=`
- `GET /api/politician-scripts/scripts?status=approved&page=&limit=`

Behavior: `status` is optional and backward compatible (omitting it returns the prior unfiltered behavior). The filter is applied before the count, so `total` reflects the filtered set and pagination is correct.

Album Stories remain on-demand: you call `POST /api/content-scripts/generate` or `POST /api/politician-scripts/generate` per creator request and get the script back directly (no curation queue needed there). The `status` filter on those two list endpoints is for browsing history only.

---

## 5. End-to-end flow

1. The panel continuously generates Album Trades "movers" posts (existing behavior).
2. The panel team turns the good ones into scripts: `POST /from-post/{id}` or the batch `POST /generate`. New scripts are `draft`.
3. The panel team reviews and approves: `PATCH /{id}` with `{ "status": "approved" }`.
4. Your platform syncs on its normal cadence: `GET /api/album-mover-scripts/scripts?status=approved`, dedupes by `id`, localizes, and serves creators.

Same pattern already applies to Breaking News: sync `GET /api/breaking-scripts/scripts?status=approved`.

---

## 6. Notes and guarantees

- **Content rules:** the script is a strictly factual recap of a disclosed position and a realized price move. It never claims the album "bought at" a price, never predicts where the stock goes next (scenarios only), and does not use em dashes.
- **Model:** the same Claude Sonnet the rest of the panel uses.
- **Pagination:** `{ items, total, page, limit }` on this feed and the other script lists (the generic `/api/scripts` and `/api/trades/*` additionally include `pages`).
- **Idempotency / dedup:** one script per movers post; feed `id`s are stable and safe as your dedup key.
- **Errors:** 401 (no/expired token), 403 (email not allowlisted), 404 (unknown post/script), 400 (invalid status), 502 (model error).
- **Deploy:** built and audited; live on the next panel deploy. No config change is required on your side beyond the service account you already use.
