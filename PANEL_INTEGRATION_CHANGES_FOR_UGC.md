# Panel Integration Changes for the UGC Platform

**From:** Marketing Panel team
**To:** UGC Creator Platform team/
**Date:** 21 Jul 2026
**Status:** Built in the panel; ships on the next deploy. This document is the migration guide: what changed, and what you need to change on your side.

There are two categories of change: (A) how you **authenticate and read** content (a new scoped API key + a dedicated `/api/ugc/*` surface, replacing the email/JWT service account), and (B) how content **reaches you** (HMAC-signed webhooks for approved breaking-news and movers scripts, with a poll fallback). Movers-as-scripts and the approved-only curation gate (previously delivered) are folded in below.

---

## TL;DR: what you need to change

1. **Stop logging in.** Drop `POST /api/auth/login` and the 24 h token refresh. Send a single header `X-API-Key: <key>` on every request instead. We will give you the key.
2. **Repoint your reads to `/api/ugc/*`** (a small, stable, approved-only surface) instead of the internal `/api/content-scripts`, `/api/politician-scripts`, `/api/breaking-scripts`, `/api/album-mover-scripts` routes.
3. **Stand up a webhook receiver.** We POST approved breaking-news and movers scripts to a URL you give us, signed with a shared HMAC secret you verify. Keep a light `updated_since` poll as a fallback.

Everything is additive on our side and dormant until configured, so nothing breaks the moment we deploy; you migrate on your own schedule.

---

## Responses to your review (21 Jul)

1. **Retraction (biggest gap): fixed.** Added a `script.retracted` webhook event. It fires when an approved breaking-news or movers script is un-approved OR deleted, so you learn to stop serving it. Poll fallback: reconcile the ids you hold against `GET /api/ugc/scripts?feed=...`; any id you hold that is no longer in the approved feed has been un-approved or deleted (both drop out of the approved-only feed). See section C.
2. **Replay/ordering: fixed.** Each webhook now carries a `sent_at` timestamp INSIDE the signed body (also mirrored in an `X-Stalvian-Timestamp` header). Reject deliveries with a stale `sent_at` (it is signed, so it cannot be forged), and keep your plan to ignore any payload whose `data.updated_at` is not newer than what you hold.
3. **Rate limits: documented (and this surface has its own limiter, separate from the public portfolio API).** 240 requests / 60 s per key across `/api/ugc/*`, plus a tighter 30 / 60 s on `POST /api/ugc/album-story` (each call is a paid generation). Exceeding either returns 429.
4. **Confirmations:** (a) Yes, the `POST /api/ugc/album-story` response includes `id` (use it as your panel reference). (b) `kind` is now OPTIONAL on `GET /api/ugc/albums`: omit it for one call returning funds and politicians. (c) The catalog lists exactly the albums generation will accept (the fully-backfilled set).
5. **Slug: accepted.** `POST /api/ugc/album-story` now takes `slug` (preferred, exact) or `name`. Use `slug` to remove the fuzzy-name-matching failure mode.

Your upsert note is correct and expected: with `updated_since` and webhooks, the same `id` legitimately reappears when a script is edited and re-approved, so treat your sync as an upsert and invalidate cached translations when the content changes.

---

## A. Authentication: scoped API key (replaces email/JWT)

**Why it changed:** the old model logged in a service account and received a JWT that passed authentication on *every* internal route (it could do anything a panel operator can). The new `X-API-Key` is scoped to just the `/api/ugc/*` surface below and needs no login or refresh.

**How to use it:** send `X-API-Key: <key>` on every `/api/ugc/*` request. That is the only auth. We provide the key out of band; rotating it is a one-line change on our side.

Responses: `503` if the UGC API is not enabled on our side yet, `401` on a missing or wrong key.

---

## B. The `/api/ugc/*` surface

Base URL: the panel production API. All endpoints require the `X-API-Key` header (the single UGC key). The content reads (B.1 to B.3) only ever return **approved** content; the portfolio reads (B.4) are the same read-only data as the public portfolios API. Rate limits: 240 requests / 60 s per key across the surface, plus 30 / 60 s on `POST /album-story` (each is a paid generation); 429 on exceed.

### B.1 `GET /api/ugc/albums?kind=fund|politician`
Catalog for the album-story picker. `kind` is OPTIONAL: omit it to get funds and politicians in one call. The list is exactly the set album-story generation accepts.
```json
{
  "albums": [
    { "name": "Scion Asset Management", "slug": "scion-asset-management",
      "kind": "fund", "party": null, "chamber": null,
      "returns": { "total_return": "+142.00%", "cagr": "+31.20%", "alpha": "+8.10%",
                   "sharpe": "1.42", "max_drawdown": "-24.30%" } }
  ],
  "total": 27
}
```

### B.2 `POST /api/ugc/album-story`
Generate one album-story script on demand (runs the exact panel pipeline, so output is identical to us generating it). Pass `slug` (preferred, exact match) or `name` (matched fuzzily); `angle` is one of the documented angles.
```
Body: { "kind": "fund" | "politician", "slug": "scion-asset-management", "angle": "origin_story" }
```
Valid angles: funds -> `origin_story, performance, scandal, positions, strategy, ceo_founder, funny_quirky, comparison`; politicians -> `origin_story, trading_record, scandal, committee_trades, hypocrisy, best_trades, comparison, funny_quirky`. An unknown angle returns 400; an unknown slug returns 404.
Response: the full script object, INCLUDING `id` (your panel reference), same shape as B.3 items (`id, title, hook, script_body, scenes[], alternative_hooks[], call_to_action, hashtags[], virality_score, ...`). Generation can take up to ~90 s.

### B.3 `GET /api/ugc/scripts?feed=breaking|movers&updated_since=&page=&limit=`
The approved-only forwarded feed (this is the webhook poll fallback).
- `feed`: `breaking` (breaking-news scripts) or `movers` (album-trades movers scripts). Required.
- `updated_since`: ISO 8601. Returns only items changed at or after that time. Use it for incremental sync.
- `page` (default 1), `limit` (default 20, max 100). Envelope `{ items, total, page, limit }`, newest-changed first.

Item shape (same object used in the webhook payload):
```json
{
  "id": 4821,
  "feed": "movers",
  "trade_type": "album_mover_script",
  "source_post_id": 4703,
  "ticker": "NVDA",
  "title": "The fund that held NVDA before the run",
  "hook": "This hedge fund disclosed NVDA on 2025-02-14, at $118. It now trades at $172.",
  "script_body": "full narration",
  "scenes": [
    { "scene_number": 1, "duration_seconds": 6, "narration": "...",
      "visual_description": "...", "text_overlay": "..." }
  ],
  "hashtags": ["#investing"],
  "alternative_hooks": ["hook A", "hook B", "hook C"],
  "call_to_action": "Track institutional and insider positioning on Stalvian",
  "virality_score": 8,
  "virality_reasoning": "...",
  "sources": [],
  "chart_data": { "album_name": "...", "entry_date": "...", "entry_price": 118.0,
                  "current_price": 172.0, "insider_return_pct": 45.8, "...": "..." },
  "status": "approved",
  "generated_at": "2026-07-21T09:12:00",
  "updated_at": "2026-07-21T09:40:00"
}
```
`hook == alternative_hooks[0]`. `feed` tells you which section it belongs to. `chart_data` may include base64 image data URLs (`person_photo_url` etc.) when present.

### B.4 Portfolio charts + holdings + history
Added so you get charts, holdings, and history from the SAME base URL + UGC key, with **no separate public key needed**. These mirror the public portfolios API exactly (byte-identical response shapes); the only difference is which key gates them.
- `GET /api/ugc/portfolios/{slug}` -> metrics/returns + current holdings + `holdings_as_of`.
- `GET /api/ugc/portfolios/{slug}/holdings` -> `[{ticker, weight, last_price, is_stale}]` + `as_of`.
- `GET /api/ugc/portfolios/{slug}/history?range=1y|all` -> daily index series `points: [{date, portfolio, spy}]` (100 = series start, not dollars) + `holdings_history` (top holdings per 13F / disclosure over time).

**Single-key consolidation:** repoint any `/api/public/portfolios/*` calls to the matching `/api/ugc/portfolios/*` path, send the UGC `X-API-Key` (the key you already use), and drop the separate `PANEL_PUBLIC_API_KEY` entirely. (The public `/api/public/portfolios/*` API stays available and unchanged for any other consumers.)

---

## C. Webhooks (push) for breaking-news and movers scripts

When the panel team **approves** (or later un-approves or deletes) a breaking-news or movers script, we POST an event to a URL you give us. This replaces (or supplements) polling.

**Events:** `script.approved` (start serving it) and `script.retracted` (stop serving it: the script was un-approved or deleted).

**Request we send:**
- Method: `POST` to your `UGC_WEBHOOK_URL`.
- Headers: `Content-Type: application/json`, `X-Stalvian-Event: script.approved | script.retracted`, `X-Stalvian-Timestamp: <iso>`, `X-Stalvian-Signature: sha256=<hex>`.
- Body: `{ "event": "<event>", "sent_at": "<iso>", "data": { ...the B.3 script object... } }`. `sent_at` is inside the signed bytes.

**Verify the signature** (this is the auth, not IP: our Render egress IP is not stable). Compute HMAC-SHA256 over the RAW request body bytes with the shared secret, and constant-time compare to the header.

Python (FastAPI):
```python
import hmac, hashlib
raw = await request.body()
expected = "sha256=" + hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
if not hmac.compare_digest(expected, request.headers.get("X-Stalvian-Signature", "")):
    raise HTTPException(401)
```
Node (Express, raw body):
```js
const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(req.get("X-Stalvian-Signature") || "")))
  return res.status(401).end();
```
Important: verify over the exact bytes received, before any JSON re-parse or reformat.

**Delivery:** best-effort with up to 3 retries and short backoff. Webhooks are not guaranteed, so **keep the `updated_since` poll (B.3) as a fallback**. Ids are stable and never reused, but the same id legitimately reappears when a script is edited and re-approved, so **upsert by `id`** (do not treat a repeat id as a duplicate to drop). Respond 2xx quickly; do the heavy work async on your side.

**Retraction:** on `script.retracted`, stop serving that `id`. Poll fallback for a missed retraction: reconcile the ids you currently serve against `GET /api/ugc/scripts?feed=...`; any id you hold that is no longer present has been un-approved or deleted (both leave the approved-only feed), so retire it.

**Replay and ordering:** reject a delivery whose signed `sent_at` is older than your freshness window (it cannot be forged), and ignore any payload whose `data.updated_at` is not newer than the version you already hold. Together these stop a replayed or out-of-order retry from overwriting a newer edit.

**What you provide us:** a public HTTPS URL for the receiver, and we agree on the shared secret out of band.

---

## D. The curation flow (how content becomes "approved")

1. The panel continuously generates breaking-news scripts and Album Trades movers posts.
2. The panel team turns movers posts into scripts and reviews both feeds.
3. On approval, the script's status becomes `approved`; that is the moment the webhook fires and the item appears in `GET /api/ugc/scripts` (which is forced to approved-only).
4. Album stories are different: they are generated on demand via `POST /api/ugc/album-story` and returned to you directly, so they do not go through the approve/queue step.

---

## E. Panel-side configuration (reference)

For your awareness (we set these in our Render dashboard; nothing for you to set):
- `UGC_API_KEY`: the scoped key we issue you.
- `UGC_WEBHOOK_URL`: your receiver URL.
- `UGC_WEBHOOK_SECRET`: the HMAC shared secret.
Any unset value keeps that half dormant (the API returns 503, or webhooks are simply not sent).

---

## F. Your migration checklist

- [ ] Swap the email/JWT login for the `X-API-Key` header on all calls.
- [ ] Read the catalog from `GET /api/ugc/albums`.
- [ ] Generate album stories via `POST /api/ugc/album-story`.
- [ ] Read breaking-news and movers via `GET /api/ugc/scripts?feed=...&updated_since=...` (approved-only).
- [ ] Read charts/holdings/history via `GET /api/ugc/portfolios/{slug}[/holdings|/history]` (repoint from `/api/public/portfolios/*`, using the UGC `X-API-Key`).
- [ ] Drop `PANEL_PUBLIC_API_KEY` (config, `.env`, render.yaml) once the portfolio calls point at `/api/ugc/portfolios/*`.
- [ ] Stand up the webhook receiver: verify the HMAC signature, return 2xx fast, dedupe by `id`, upsert the script.
- [ ] Keep a light `updated_since` poll as the fallback.
- [ ] Send us your webhook URL; receive the API key and webhook secret from us.

Questions or shape changes you need: tell us before you build against a field, and we will keep the `/api/ugc/*` contract stable.
