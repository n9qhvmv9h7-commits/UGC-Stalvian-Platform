# Referral API — what the Stalvian product needs to call

**From:** UGC Creator Platform team
**To:** Stalvian product team (onboarding + billing)
**Status:** Built on the UGC side, dormant until `REFERRAL_API_KEY` is set. This document is the contract for the product side.

## The rule

Every creator in the program has a **referral code** (e.g. `POL-7K3M`). A new client enters it during onboarding. From then on the creator earns **25% of every fee that client pays**, for as long as they remain a client. No time window, no cap.

For that to work the product has to tell the UGC platform three things:

1. **Is this code valid?** — while the client is typing it in the onboarding form.
2. **This client signed up with this code** — once, when the account is created.
3. **This client paid this fee** — every time a fee is charged.

Optionally: **this client left** (so creators see the stream has stopped).

## Auth

Every call carries the header `X-API-Key: <key>`. We give you the key out of band; it is scoped to these endpoints only. Responses: `503` if the UGC side has not enabled the API yet, `401` on a missing or wrong key.

Base URL: the UGC backend (production: the `ugc-api` Render service).

## Endpoints

### 1. `GET /api/referrals/codes/{code}` — validate a code

Call this from the onboarding form (debounced) so the client gets instant feedback. Codes are case-insensitive and tolerant of missing dashes or spaces: `pol7k3m`, `POL 7K3M` and `POL-7K3M` are the same code.

```json
200 { "valid": true, "code": "POL-7K3M",
      "creator": { "id": 12, "name": "Pol Martin", "handle": "pol.invests" },
      "commission_bps": 2500, "commission_pct": 25.0, "signup_url": null }

200 { "valid": false }
```

`valid: false` also covers codes belonging to creators who have left the program. Show the creator's name back to the client ("Referred by Pol Martin") — it is the confirmation that they typed the right thing.

### 2. `POST /api/referrals/clients` — attribute a new client

Call once, after the account is created, with the code the client entered.

```json
POST /api/referrals/clients
{ "code": "POL-7K3M",
  "client_ref": "cust_8f3a2c",          // YOUR stable id for this client — required
  "label": "m***@gmail.com",            // optional, what the creator sees; mask it
  "attributed_at": "2026-09-14T10:22:00Z" }  // optional, defaults to now

201 { "created": true, "client_ref": "cust_8f3a2c", "creator": { "id": 12, "code": "POL-7K3M" } }
```

- `client_ref` must be stable for the life of the client: fees are reported against it. Use your internal customer id, never an email.
- `label` is the only thing the creator will ever see about the client. Send a masked email or a first name; never full identity.
- Idempotent: the same `client_ref` with the same code returns `201 { "created": false, ... }`. A `client_ref` already attributed to a **different** creator returns `409` — first code wins, we never move a client.
- `404` if the code is unknown or the creator is no longer active.

### 3. `POST /api/referrals/fees` — report a fee

Call every time a referred client is charged a fee. If you also charge clients who were not referred, either skip them or call anyway: an unattributed `client_ref` returns `404` and nothing is recorded.

```json
POST /api/referrals/fees
{ "client_ref": "cust_8f3a2c",
  "fee_cents": 4000,                     // integer cents, > 0
  "currency": "EUR",                     // optional, defaults to EUR
  "fee_ref": "inv_2026_09_0042",         // YOUR id for this charge — strongly recommended
  "occurred_at": "2026-09-14T10:22:00Z", // optional, when the fee was charged (defaults to now)
  "note": "September management fee" }   // optional

201 { "created": true, "fee_ref": "inv_2026_09_0042",
      "fee_cents": 4000, "commission_cents": 1000, "commission_bps": 2500 }
```

- `fee_ref` is the idempotency key. A retried delivery with the same `fee_ref` returns `201 { "created": false, ... }` and is **not** counted twice. Always send it.
- `occurred_at` is the date the fee appears on in the creator's daily chart. Send the real charge time, not the time of the API call, if you batch reports.
- The creator's share is computed and stored at the moment we receive the fee, at the rate in force then. A later rate change never rewrites history.
- Refunds: not modelled yet. If a fee is refunded, tell us and an admin corrects it by hand; if this becomes frequent we will add a negative-fee endpoint.

### 4. `PATCH /api/referrals/clients/{client_ref}` — client left (optional)

```json
{ "status": "churned" }   // or "active" to reinstate
200 { "status": "ok" }
```

Past fees still count; the creator simply sees the client marked as gone.

## Onboarding UX we suggest

- One optional field, "Referral code", on the signup form. Validate on blur with endpoint 1 and show "Referred by {name}" on success, "We don't recognise this code" on failure. Never block signup on a bad code.
- Store the (normalised) code on the account, then call endpoint 2 from your backend once the account exists — not from the browser.
- Report fees from your billing job (endpoint 3), with `fee_ref` = your invoice/charge id, in the same batch that charges the card.

## Delivery guarantees

- All endpoints are safe to retry. Retry on network errors and on `5xx`; do not retry `4xx`.
- Order does not matter between different clients. For one client, attribute (2) before fees (3): a fee for an unknown `client_ref` is rejected with `404`, so on a race just retry the fee after the attribution succeeds.
- No rate limit today. Batches of a few hundred calls per minute are fine; tell us if you plan bulk backfills.

## Manual fallback

Until this integration ships, the Stalvian team can attribute clients and record fees by hand in the UGC admin panel (Admin › Referrals). The data model is the same, so nothing needs migrating when the API goes live.
