# NeighborTask v3 — Core Model and Discovery Review

## Administrator review — 2026-09-07

### Round 1: Draft → Review → Test → Improve

Draft: isolated admin login/session routes and moderation UI. Review: missing login Origin checks, hash configuration ergonomics, storage failures could poison subsequent saves, corrupt JSON could be overwritten. Improve: Origin validation, owner-set password support (hashed at startup), stronger hash format checks, serialized initialization and moderation, rollback on moderation save failure, fail closed on corrupt files. Test: 28/28 tests pass including authorization, cookie protections, CSRF, expiry, rate limits, moderation gates and durable audit reload.

### Round 2: Draft → Review → Test → Improve

Draft: full-server smoke and local browser flow. Test: server smoke passed, but browser testing found the native prompt produced no visible confirmation and no saved action. Improve: replace prompt with an in-page dialog showing target, required reason, confirm/cancel and error state. Retest: actual browser login → Helper list → suspend demo Alex → saved state → audit reason/operator all displayed correctly. Also removed admin assets from service-worker cache and labeled demo/platform-reviewed matches honestly.

### Round 3: Draft → Review → Test → Improve

Draft: release review and handoff. Review: role text could imply implemented shared accounts; manual approval could imply identity verification; ephemeral storage cannot support real operations. Improve: explicit limitations and owner credential activation instructions in ADMIN_GUIDE/README; no paid infrastructure added. Final regression uses the complete automated suite and extended full-server smoke before publishing.

Admin does not bypass external state transitions. Legacy claim currently checks self-asserted confirmation only, not a real signature or requester identity. This is a known production blocker, not evidence of verified ownership. Shared requester/helper accounts and their lifecycle are next-phase work. Audit records remain in the same JSON file, not tamper-proof external storage.

## Product invariant
NeighborTask is a matching network, not a social feed. Every input source is normalized into a Need. External public discoveries are leads only and cannot enter matching until the requester claims and verifies them.

## Core entities

### Need
Key fields: `origin`, `source`, `category`, `title`, `description`, `helpType`, `compensation`, `location`, `time`, `urgency`, `confidence`, `status`, `privacy`, `requester`, `dedupeKey`, timestamps.

Origins: `external`, `native`, `partner`.

State machine:

`external: unclaimed → claimed → verified → open → matched → completed`

`native: verified → open → matched → completed`

Terminal/side states include `expired` and `rejected`. Invalid jumps throw an error at the domain layer.

### HelperProfile
Key fields: approximate home coordinates (server-side only), travel radius, categories, paid/volunteer preferences, availability, minimum hourly rate, reliability, verification, active status.

### Match
Computed, not stored in v2. Score combines distance, category skill, availability, help type, reliability and urgency. Hard gates override the score: need must be `open`, helper must be active + verified, helper must be in radius, volunteer preference must match, and paid hourly work cannot be below a helper's minimum hourly rate.

## Privacy model
The public API uses `publicNeedView()` rather than returning raw Need objects. Requester fields, privacy internals and coordinates are not returned. Distance is computed server-side and exposed only as a rounded number of miles. Exact addresses/contact details remain outside the public feed.

## Three review passes

### Draft 1
Implemented Need, HelperProfile, state transitions, distance + matching score, JSON persistence and initial tests.

Review finding: compensation constraints and public-data projection were not hard enough.

### Draft 2
Added public projection, blocked paid hourly matches below helper minimum, and blocked volunteer tasks from paid-only helpers.

Review finding: a `verified` Need could still be scored before explicit `open`, and coordinates were still present in one public projection path.

### Draft 3
Matching now requires `need.status === open` and `helper.verified === true`. Public projection removes coordinates entirely. Claim API requires explicit requester confirmation plus a claim method. Newly created helper profiles remain unverified.

## Phase 2: Discovery Engine three-round review

### Discovery Draft 1 — sources, candidates, classification, extraction

Draft: added `DiscoveryConnector`, a safe static/manual connector, an HTTPS-only public JSON connector, normalized raw candidates, a replaceable classifier interface, actionable/recommendation/other labels, confidence scoring, and category/location/time/paid-free extraction.

Review finding: the previous import endpoint trusted pre-structured fields and there was no persisted raw-candidate audit trail. Candidate text could also contain contact details.

Test and improve: added four Draft 1 tests. Result: 15/15 total tests passed. The next draft moved privacy ahead of persistence and made the engine own its dedupe identity.

### Discovery Draft 2 — privacy, audit persistence, confidence, deduplication

Draft: added phone/email/street-address/social-handle redaction before persistence; persisted redacted candidates and classification decisions; enforced a confidence threshold; generated source-ID, URL, or normalized-content hashes; added cross-source similarity deduplication; linked accepted candidates to external Needs.

Review finding: exact keys alone do not catch slightly edited reposts, and rejected recommendations still need an audit record without becoming Needs.

Test and improve: added five Draft 2 tests covering PII, stable identity, similarity, audit retention and recommendation rejection. Result: 20/20 total tests passed.

### Discovery Draft 3 — application integration and state-machine regression

Draft: integrated batch ingestion and the compatibility import endpoint with the engine; carried approximate source coordinates into server-side distance calculations; included discovered external leads in Needs Near Me; tested every pre-open state against matching.

Review finding caught by tests: candidate sanitization replaced metadata instead of merging it, dropping approximate coordinates. This prevented distance display and matching even after a valid open transition.

Test and improve: fixed metadata preservation without exposing coordinates publicly. The first Draft 3 run was 22/24; after the fix the full suite passed 24/24. A live-service smoke test then passed 10/10 checks.

## Validation status
24 automated tests pass. End-to-end smoke tests also verified:
- app health endpoint
- nearby Need feed
- native Need creation
- helper ranking
- external discovery import
- external lead has zero matches before claim
- claim without explicit confirmation returns HTTP 400
- confirmed claim reaches `open`
- newly submitted helper profile remains unverified
- public batch connector ingestion
- actionable request vs recommendation classification
- PII removal before response/persistence
- approximate-distance Needs Near Me integration
- duplicate and low-confidence rejection behavior

## Deliberately not solved yet
This model is MVP-grade, not production identity or crawler infrastructure. The next layer should add real authentication, signed claim links, persistent SQL storage, source-specific connectors backed by documented APIs/feeds, an AI classifier with a reviewed prompt/evaluation set, moderation/admin review, geospatial indexing, rate limiting, durable audit logs and notification delivery. Private/login-only sources remain explicitly out of scope.
