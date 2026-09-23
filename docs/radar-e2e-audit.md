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


## 2026-09-23 Discovery post-feedback refill regression

Verify the following sequence for Interested and Not interested:

1. Start with one visible Discovery candidate.
2. Handle that candidate.
3. If another candidate is already available, it becomes the next card.
4. If the queue is exhausted, Discovery automatically starts a refresh.
5. The generic empty placeholder must not flash as the intermediate state.
6. Navigate away from Discover during/after the action, return, and verify the state is still either:
   - active refresh;
   - next recommendation;
   - genuine completed empty result.
7. The refresh UI must show only one primary "Radar is updating recommendations…" status, not duplicate spinner/text controls.
8. Repeat at mobile/tablet/desktop/wide-desktop control widths and in RU/EN.


## 2026-09-23 Buffered Discovery regression

Buffer policy under test:
- target ready queue: 15;
- low-watermark: 6;
- emergency watermark: 2;
- strong-feedback rerank debounce: 2500 ms;
- strong-feedback acknowledgement: ~350 ms before advancing.

Regression checks:

1. With several ready candidates, click Interested and verify the next card appears without waiting for the LLM rerank to finish.
2. Repeat with Not interested + reason.
3. Verify Interested/Not interested persists server-side after reload.
4. Verify background reranking changes the tail/order without replacing the card currently being read.
5. Verify neutral Next/Skip advances immediately and does not create positive/negative feedback.
6. Consume the local queue down to 6 and verify Radar first syncs cached server candidates.
7. If the server ready queue is also low, verify a fresh Discovery refresh starts under the hood.
8. Verify normal feedback does not launch a fresh search on every click.
9. Verify repeated strong signals do not create overlapping per-user rerank races; maintenance may coalesce but must include the latest feedback state.
10. Verify repeated Not interested still supports the negative-feedback refresh milestone.
11. Verify no transient empty state or full-page loader is shown while usable buffered candidates remain.
12. Reload/navigate away and return during background rerank/refill; persisted feedback and a valid next queue must survive.
13. Check RU/EN and 375–390 / 768 / 1280 / 1440+ layouts for feedback acknowledgement and card transition.


## 2026-09-23 Rapid-click quota regression

Scenario:

1. Start with at least 15 ready candidates.
2. Click Interested on candidate A.
3. Within less than 2.5 seconds click Interested on B, Not interested on C, and Interested on D.
4. Verify each action persists independently and each handled card does not return after reload.
5. Verify the UI advances through the buffered cards without waiting for ranking completion.
6. Verify the feedback burst schedules one debounced ranking cycle rather than one ranking call per click.
7. While that rerank is active, add another Interested/Not interested signal.
8. Verify there is never more than one active rerank for the same user.
9. Verify the active burst performs at most one catch-up rerank after the first pass.
10. If additional feedback arrives during the catch-up pass, verify it is retained for the next debounced burst instead of causing an unbounded rerank loop.
11. Reduce the ready queue to 6 and verify cached/server-side refill is attempted before fresh search.
12. Reduce it to 2 and verify the state is treated as emergency refill.
13. Verify fresh Discovery search is not launched after every strong-feedback click.
14. Verify neutral Next/Skip does not schedule taste reranking.
15. Verify the currently displayed card remains stable while the tail is reranked.
16. Verify RU/EN and 375–390 / 768 / 1280 / 1440+ layouts do not introduce a blocking loader or layout shift during background maintenance.

Cost expectation:

- N rapid strong-feedback actions in one burst may produce N persisted signals but should normally produce one rerank;
- at most one catch-up rerank is allowed for feedback arriving during the active pass;
- search count must be driven by low/emergency queue state, not by raw feedback count.
