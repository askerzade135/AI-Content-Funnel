# Technical Debt

## Gemini free/paid routing

**Status:** Backlog  
**Priority:** Medium  
**Area:** AI infrastructure / billing

### Problem

Gemini requests currently use a single `GEMINI_API_KEY`. The application already separates a free model pool from an authorized paid model pool at the routing level, but both pools still execute against the same Google project/API key.

Because Gemini Free Tier vs Paid Tier is determined by the Google Cloud project/billing configuration, switching model priority alone is not a true billing-tier switch.

### Desired state

Support separate credentials/projects:

- `GEMINI_FREE_API_KEY`
- `GEMINI_PAID_API_KEY`

Routing should:

1. Try the complete free model priority pool using the free project/key.
2. Move to the paid pool only after the free pool is exhausted.
3. Use the paid key only when paid usage is explicitly authorized.
4. Preserve task-based priorities:
   - economy tasks: cheapest capable models first;
   - quality/creative tasks: strongest models first.
5. Track usage and estimated cost against the actual key/tier used.
6. Keep the current `GEMINI_API_KEY` as a temporary backwards-compatible fallback during migration.

### Acceptance criteria

- Free and paid Gemini clients are instantiated independently.
- A free-tier quota error never causes a paid call without prior authorization.
- Logs record billing phase (`free` / `paid`), model, operation, tokens, and estimated cost.
- Audio transcription uses the same tier-aware router.
- Existing installations with only `GEMINI_API_KEY` continue to work until migration is complete.


## Product event ledger / full Admin analytics

**Status:** Backlog  
**Priority:** High  
**Area:** Product analytics / observability

### Current state

Admin analytics can already derive useful metrics from persisted users, login timestamps, Radar runs, feedback, Ideas, Scripts/Outputs, quotas and AI usage logs.

This is sufficient for MVP operations, but it is not a complete product-event stream.

### Desired state

Introduce a normalized server-side product event ledger for:
- login/session activity;
- onboarding;
- recommendation shown;
- feedback;
- Idea actions;
- output actions;
- schedule/publish actions;
- errors.

Suggested fields:

`eventId, timestamp, ownerId, eventType, entityType, entityId, metadata, success, errorCode`

This will improve DAU/WAU/MAU, retention, exact funnels and recent user activity.

## Safe Prompt Lab run inspection

**Status:** Backlog  
**Priority:** Medium  
**Area:** LLM observability

The Admin LLM registry exposes prompt source/version/config and aggregate execution telemetry.

Future Prompt Lab may add:
- safe/redacted input summary;
- parser result;
- raw model response only under explicit admin-safe policy;
- prompt-version comparison;
- recorded fixture management.

Do not expose secrets, full private user context or API keys in browser responses.


## Durable Idea read state

**Status:** Backlog  
**Priority:** Medium  
**Area:** Ideas / UX state

### Current state

The Ideas UI separates **New since your last visit** from **Earlier ideas** using the existing `RadarOpportunity.status === 'new'` signal.

This is sufficient for MVP visual separation, but it is not a true read/viewport state.

### Desired state

Persist per-user Idea read/view state, for example:

- `firstSeenAt`;
- `lastSeenAt`;
- or a lightweight read marker tied to Idea id.

Recommended behavior:

- an Idea is New until it has actually been presented/read according to a defined UI rule;
- entering Ideas should not automatically mark every unseen Idea as read;
- filters/tabs should not accidentally clear New;
- read-state should survive reload/device changes;
- new analysis batches should be distinguishable from already-read Ideas.

Add automated state tests when this backend state is introduced.


## Automatic YouTube channel refresh

**Status:** Backlog  
**Priority:** Medium  
**Area:** Discovery sources

### Current state

A manually added YouTube channel contributes a sample of videos to the Radar candidate pool.

The new Add source UI intentionally does **not** expose a periodic auto-check toggle.

### Desired state

Add a safe background channel-refresh workflow with:
- per-user enabled subscriptions;
- bounded polling cadence;
- dedupe;
- metadata/search ingestion first;
- ACTIVE TOPICS + quality + ranking before expensive processing;
- no automatic transcription/LLM analysis of every upload;
- server-side diagnostics and quota/cost protection.

Only expose “Check for new videos automatically” after this workflow is implemented and regression-covered.

## Add source metadata preview

**Status:** Backlog  
**Priority:** Low  
**Area:** Add source UX

The Video modal currently derives a lightweight YouTube thumbnail from the URL before submit.

A future safe metadata-preview endpoint may resolve:
- title;
- channel;
- duration;
- thumbnail;
without mutating Radar state.


## Social publishing adapters

- **Instagram Direct Publishing OAuth/provider adapter** — shared PublicationJob + Publish modal are ready; provider auth/media-container implementation remains.
- **TikTok Content Posting API OAuth/provider adapter** — shared PublicationJob + Publish modal are ready; creator-info, direct-post init/upload/status implementation remains.
- **Publication status reconciliation** — YouTube processing/status polling and later Instagram/TikTok status polling should reconcile remote state instead of assuming provider processing completed.
- **Durable OAuth tokens** — YouTube publishing currently uses the user-scoped browser session token. Background/server-side publishing will require secure refresh-token storage before unattended scheduled uploads can be supported.


## Temporary publication asset lifecycle

**Status:** In progress  
**Priority:** High  
**Area:** Publishing / storage cost

Firebase Storage / GCS is the selected first temporary media store. The client-side resumable uploader and 400 MB validator are in place.

Completed infrastructure safeguards:
- owner-scoped Firebase Storage rules for `publication-assets/{uid}/...`;
- video-only and 400 MB enforcement in Storage Rules;
- 7-day GCS lifecycle delete for `publication-assets/`;
- soft delete cleared by the production deployment;
- deployment-time verification of lifecycle and soft-delete state.

Before enabling unattended scheduled Instagram/TikTok publishing:
- persist only object path/reference in PublicationJob, not media bytes;
- add server-side object access for provider workers;
- delete immediately after successful provider handoff;
- delete on user cancellation;
- define bounded retry retention for failures (target: 72 hours);
- add orphan cleanup/observability and storage-cost metrics.
