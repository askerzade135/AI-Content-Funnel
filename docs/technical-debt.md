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
