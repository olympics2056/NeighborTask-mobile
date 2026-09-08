# NeighborTask Mobile v3 — Discovery Engine MVP

## Administrator preview (2026-09-07)

`/admin` adds authenticated Helper approval/suspension/revocation, Need rejection/expiry, search, counts and audit history. See [ADMIN_GUIDE.md](ADMIN_GUIDE.md) for owner-only credential setup. No default password: set `ADMIN_PASSWORD` (16+ characters) or `ADMIN_PASSWORD_HASH`; use `NODE_ENV=production` online.

Controlled test release only: member authentication/ownership and verified external claims remain missing; JSON requires durable hosting before real operations. A person may be requester and helper by design, but shared member accounts are not yet implemented. Admin approval is not identity/background verification or insurance.

Validation: 28 automated tests plus extended full-server smoke; local browser login, moderation confirmation and audit display. Three admin review rounds are recorded in MODEL_REVIEW.md.

Mobile-first NeighborTask MVP built around the product model: **Need → Understand → Verify → Open → Match → Connect**.

This version replaces the chat-first v1 homepage with a mobile/PWA interface focused on:
- **I need help** — create a native local request
- **I can help** — create a helper profile
- **Needs near me** — distance-sorted local needs
- **Public leads** — externally discovered needs clearly labeled unverified
- **Match preview** — verified helper ranking for open needs
- **Privacy projection** — no raw coordinates/requester fields in the public feed

Phase 2 adds the complete Public Need Discovery pipeline:

`public connector → raw candidate → classification → PII redaction → field extraction → confidence gate → deduplication → external Need`

Connectors are deliberately limited to sources explicitly marked public. The included `PublicJsonFeedConnector` accepts only HTTPS JSON feeds without embedded credentials; the engine does not bypass logins, CAPTCHAs, private groups, or platform restrictions.

## Run

Requires Node.js 20+.

```bash
npm install
npm start
```

Open `http://localhost:3000`.

The core PWA can run without an OpenAI key. To enable the secondary AI concierge, set:

```bash
export OPENAI_API_KEY="sk-..."
export NEIGHBORTASK_API_KEY="choose-a-private-secret"
```

Optional:

```bash
export OPENAI_MODEL="gpt-5.6-sol"
export OPENAI_VECTOR_STORE_ID="vs_..."
export SEED_DEMO="false"   # disables first-run demo data
```

## Validation

```bash
npm run check
npm run smoke
```

`check` performs syntax checks and 24 automated domain, storage, discovery, privacy and integration tests. `smoke` starts the real application and verifies 10 end-to-end API checks.

## Discovery ingestion API

`POST /api/discovery/ingest` accepts a batch of 1–100 already-public candidate items. The caller must send `publicAccess: true`, a source identity, and candidates containing raw `text`. Optional approximate `location`, `lat`, and `lng` values power server-side Needs Near Me distance sorting. Exact coordinates are never returned by the public feed.

The older `POST /api/discovery/import` route remains available for v2 compatibility, but now runs through the same classification, redaction, confidence and deduplication pipeline.

Classification in this offline MVP is deterministic and replaceable through the `ActionableNeedClassifier` interface. It distinguishes actionable requests, recommendations, and other content without requiring an API key. A production AI classifier can implement the same interface and must retain the confidence and privacy gates.

## Important MVP behavior

External discoveries are **not jobs**. They enter as `unclaimed`. They cannot match to helpers until the requester is explicitly confirmed and the state progresses through claim/verification to `open`.

New helper profiles are also not automatically verified. Demo seed helpers are verified only so the matching UI can be exercised locally.

See `MODEL_REVIEW.md` for both the original model review and the Phase 2 three-pass Discovery Engine review.

## Current storage

`data/neighbortask.json` is intentionally a simple local JSON store for the MVP. Production should move to PostgreSQL with geospatial support before public deployment.
