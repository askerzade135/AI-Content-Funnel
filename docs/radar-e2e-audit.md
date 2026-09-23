# Content Radar MVP1 journey audit — 2026-09-20

Baseline: `49cc8d59b47aab0ece562f79216c01a642e004fe`, branch `feature/content-radar-mvp1`.
Production target: https://contentradar.ai.studio/ (the earlier askerzade12 address is a different UI).

## Findings recorded before fixes

| Severity | Flow and evidence | Files | Correction |
| --- | --- | --- | --- |
| P1 | Anonymous visitors see Today, navigation and a false “all done” state. Reproduced on production. Auth state was not used to gate rendering; dev mode supplied a fake primary-owner identity. | `src/App.tsx`, `server/auth.ts` | Require login before rendering/fetching protected content; remove implicit dev auth bypass. |
| P1 | New user enters Today; `initialView=discover` overrides setup even with empty topics. Confirmed in code. | `src/App.tsx`, `src/components/ContentRadar.tsx` | Resolve profile after login, route incomplete onboarding to Discover, enforce setup for empty topics. |
| P1 | Optional OAuth integration calls signInWithPopup and can switch Firebase identity during a pending operation. Tokens were shared across UIDs. Confirmed in code; account switching was not exercised in production. | `src/services/googleAuth.ts` | Reauthenticate the current user, key OAuth tokens by UID and expire cached tokens. |
| P2 | Discover loading/profile/feedback errors are hidden; exhausted discovery has no retry action. | `src/components/ContentRadar.tsx` | Surface failures, prevent concurrent feedback clicks, add retry/search controls. |
| P2 | Reschedule deletes the remote event before creating a replacement; removal changes Google before the database and swallows deletion failures. | `src/components/RadarScriptsWorkspace.tsx`, `src/services/googleCalendarService.ts`, `server/radar.ts` | Persist locally first, PATCH existing events, retain failed-cleanup identifiers for retry, show remote-sync warnings. Google sync is opt-in. |
| P2 | Today uses server-local dates while Calendar uses browser-local dates. | `server/radar.ts`, `server.ts`, `src/components/RadarWorkspace.tsx` | Pass an IANA timezone and compare calendar dates in it. Invalid/absent timezone falls back to UTC. |
| P2 | Published scripts with a future schedule appear in Upcoming. | `src/components/CalendarWorkspace.tsx` | Exclude published items from Upcoming; retain calendar history. |
| P2 | CI only typechecks/builds; the old auth script reports a valid-token test without executing it. | `.github/workflows/ci.yml`, `scripts/test-auth-middleware.ts` | Add asserting middleware tests and isolated journey regression tests to CI. |
| P2 | Manual edit of an exported script inherits exportedAt/exportMethod into a new unreviewed version. Found during lifecycle verification. | `server/radar.ts` | Clear export fields on new manual versions and assert the reset. |

## Verification and limits

- Production anonymous UI and Discover inspected in the browser. Google login returned `auth/network-request-failed` in the available browser. No authenticated production session was available at the time of this audit.
- Local production UI verified: anonymous visitor sees only Content Radar and “Войти через Google”.
- `npm run lint`, `npm test`, production build used for validation.
- `scripts/test-auth-middleware.ts` checks missing/empty/rejected tokens and middleware propagation of a mocked verified identity. It does not claim real Firebase sign-in coverage.
- `scripts/test-radar-journey.ts` uses a disposable local JSON database, never production Firestore. It covers five feedback decisions, onboarding completion, owner isolation, manual version, approve/export, invalid date, schedule/reschedule/remove, failed remote-cleanup identifier retention, published, and Today across UTC/Baku midnight.
- LLM output is a fixture in regression tests. Live Discover search, script generation/rewrite, Google Docs, Telegram and Google Calendar are still pending production validation with authorized test accounts.
- Commit `0ec22d6`: first correction group; GitHub Actions push run `35467391286` succeeded, including production build.

## Remaining production smoke

1. Confirm deployed revision includes these corrections; a green GitHub build alone does not prove deployment.
2. New test account: Login → setup → Discover → five distinct decisions → Ideas → Generate Script → Rewrite → Approve → Copy/TXT → Schedule → optional Google Calendar sync → Mark Published → Today.
3. Existing test account: Login → Today → attention item → matching script/idea → Schedule/Published.
4. Reload after each persisted transition; reject/cancel OAuth and retry after expiry; verify two owners cannot read or mutate each other's IDs through authenticated API requests.
5. Exercise Google Calendar create/reschedule/remove and retry after API failure. Restricted calendar scopes remain unchanged.

The production E2E is not complete until these authenticated checks pass. No production user records were edited during the anonymous smoke.


## 2026-09-23 regression additions

New regression scope for Discovery → Ideas:

1. Interested persists as positive feedback and removes the candidate after reload.
2. Not interested persists as negative feedback with optional reason.
3. Next/Skip persists as neutral `RadarDiscoveryExposure` and does not create negative feedback.
4. Taste-training progress counts completed decisions while keeping feedback counts semantically separate.
5. Interested source is marked waiting/processing/completed for Radar Analysis.
6. Radar Analysis quota is checked before expensive transcription/analysis work.
7. Quota exhaustion keeps the source waiting for later processing.
8. Background Interested analysis is owner-deduplicated to avoid overlapping owner scans.
9. Ideas API preserves source feedback provenance.
10. Ideas filters: All / From liked videos / Saved / Scripts.
11. New analysis results are incremental; Saved and Scripted opportunities remain intact.
12. Generate Script keeps Idea/source lineage and consumes script-generation quota independently.
13. Retry/quota failures must not create duplicate Ideas or double-charge quota.

The CI regression fixture now separately asserts:
- feedbackCount;
- decisionCount;
- interested count;
- not-interested count;
- neutral skip/pass count.
