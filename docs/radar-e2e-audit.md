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


## 2026-09-23 Content format regression

Scenario A — multi-format profile:

1. Select Short video, Article and Post in My Radar.
2. Save the profile.
3. Run/obtain Radar Ideas.
4. Verify each new Idea has one `recommendedFormat` from the selected set.
5. Verify `alternativeFormats` contains only other selected formats and no duplicates.
6. Verify the same Idea is not duplicated once per format.
7. Verify the Idea card visibly shows Best format and optional alternatives.

Scenario B — script inheritance:

1. Open an Idea whose recommended format is Article.
2. Leave the format selector unchanged.
3. Generate Script.
4. Verify generation uses Article guidance and persisted `Script.outputFormat === article`.

Scenario C — override:

1. On the same Idea, select Post before generation.
2. Generate.
3. Verify the request sends `format=post`.
4. Verify the generated Script persists `outputFormat === post`.
5. Verify an override to a format not selected in My Radar is rejected server-side.

Scenario D — Discovery isolation:

1. Keep Topics / Avoid / sources unchanged.
2. Change only Content formats.
3. Verify this does not invalidate Discovery candidates or trigger a Discovery rerank solely because output formats changed.
4. Verify source discovery remains independent of output medium.

Scenario E — legacy fallback:

1. Load an older Idea without `recommendedFormat`.
2. Verify UI/generation falls back to an enabled profile format.
3. If no formats are selected, verify backward-compatible fallback to Short video.

Responsive/localization:

- verify EN/RU Content formats hint;
- verify Best format / alternatives / selector at 375–390, 768, 1280 and 1440+ widths;
- verify no horizontal overflow with long Russian format labels;
- verify format selector + Generate button remain usable on narrow layouts.


## 2026-09-23 Ideas / Outputs regression

Scenario A — card hierarchy:

1. Open Ideas with at least four Ideas.
2. Verify each card shows metadata, title, one concise thesis, Recommended format, source provenance and actions.
3. Verify Hook and detailed reasoning are hidden by default.
4. Expand Why this idea? and verify Hook, Why, Angle, Evidence and alternative formats appear without duplicating the Idea content.

Scenario B — Saved + Outputs coexist:

1. Save an Idea with no outputs.
2. Verify it appears in Saved.
3. Create an output from the same Idea.
4. Verify the Idea remains Saved and also appears in Outputs.
5. Unsave it and verify the output remains available.
6. Reload and repeat the assertions.

Scenario C — recommended Create:

1. Use an Idea whose Recommended format is Article and whose enabled profile formats include Article.
2. Open Create.
3. Verify Article is marked Recommended.
4. Create Article.
5. Verify the Idea is not duplicated.
6. Verify an Article output is linked to the same Idea.

Scenario D — Create another format:

1. On an Idea that already has Article, choose Create another → Post.
2. Verify a Post output is created as a separate format lineage.
3. Verify the Idea card reports multiple outputs.
4. Verify Outputs tab still contains one Idea card, not one card per format.

Scenario E — Regenerate same format:

1. On an Idea with Article output, open Create another.
2. Select Article again.
3. Verify the action is presented as Regenerate Article.
4. Verify a new Article version is created in the same Article lineage.
5. Verify Post/other output lineages are not replaced.

Scenario F — tabs and filters:

1. Verify tabs: All ideas / From liked videos / Saved / Outputs.
2. Verify Saved count is based on saved state, not scripted status.
3. Verify Outputs count is Ideas with at least one output.
4. Filter by Topic and verify only matching Ideas remain.
5. Filter by Format and verify matching Recommended/existing-output formats remain.
6. Search by title/core/source and verify matching Ideas remain.
7. Verify Source and Score filters are absent from the MVP toolbar.

Scenario G — legacy compatibility:

1. Load a legacy Idea with status=saved and no savedAt.
2. Verify it is treated as Saved.
3. Load legacy scripts with missing outputFormat and verify fallback behavior remains compatible.
4. Verify old Ideas do not duplicate simply because multiple formats are now supported.

Responsive/localization:

- verify RU/EN labels for Outputs, Create, Create another, Regenerate, filters and Why this idea?;
- verify 375–390, 768, 1280 and 1440+;
- verify dropdown menus remain accessible and do not create horizontal page scroll;
- verify long Russian titles/topics/format names wrap or truncate intentionally.


## 2026-09-23 Admin analytics / LLM observability regression

1. Non-admin user receives 403 for Admin analytics/LLM registry.
2. Admin period 24h/7d/30d changes all period-based metrics.
3. Total/active/new users are derived server-side.
4. User table totals match persisted per-owner Radar/AI data.
5. User detail can show Saved + Outputs simultaneously.
6. AI total tokens = persisted usage sum for selected period.
7. Input/output tokens are separate.
8. Estimated cost is labeled estimated.
9. Cost-by-operation preserves operation/task version source.
10. Free/Paid/BYOK model rows remain distinguishable.
11. Failed routing attempts increment error count but do not invent tokens/cost.
12. Fallback attempts are visible without exposing keys.
13. Discovery feedback semantics remain Interested positive / Not interested negative / Skip neutral.
14. Funnel stages are user counts, not raw event counts.
15. LLM Task Registry returns every current task with version, prompt source and output contract.
16. No Admin response contains API keys/secrets.
17. Deterministic prompt/eval tests execute without external provider calls.
18. RU/EN labels and 375–390 / 768 / 1280 / 1440+ Admin layouts are checked.
19. Legacy automation settings are absent from the embedded Admin workspace.


## 2026-09-23 Ideas editorial visual parity regression

Scenario A — hierarchy / source visual:

1. Open Ideas with source thumbnails available.
2. Verify thumbnail is visible and cropped without stretching.
3. Verify the platform badge is readable on the thumbnail.
4. Verify topic/category is not duplicated as thumbnail overlay tags.
5. Verify title + one thesis remain the dominant textual hierarchy.
6. Verify missing thumbnail falls back without breaking card height/layout.

Scenario B — recommended format:

1. Open an Idea with Recommended format = Article and no Article output.
2. Verify the highlighted Recommended format block shows Article.
3. Verify the primary action says Create Article.
4. Click Create Article and verify generation request uses Article.
5. After generation, verify the primary action becomes Open Article.
6. Verify the same Idea remains one card.

Scenario C — alternate format choice:

1. Use a profile with multiple enabled content formats.
2. Verify non-recommended enabled formats appear as quick actions.
3. Click a format with no existing output and verify that format is generated.
4. If an alternate format already exists, its quick action opens that output rather than creating a duplicate.
5. Open the dropdown and verify an existing format is labeled/regarded as Regenerate same format.

Scenario D — Why this idea:

1. Verify the accordion is collapsed by default.
2. Expand and verify Hook, Why, Angle, Evidence and alternative formats.
3. Collapse and verify the card returns to its compact default height.
4. Verify long RU/EN content remains readable.

Scenario E — New / Earlier:

1. Load a mix of `status=new` and non-new Ideas in All ideas.
2. Verify New since your last visit appears before Earlier ideas.
3. Verify counts equal the visible filtered results in each section.
4. Apply Topic/Format/Search filters and verify section contents respect the filters.
5. Verify non-All tabs do not introduce an extra New tab.
6. When new Ideas arrive during active analysis, verify the banner reports the new count and points to the separated section.

Responsive/manual visual checks:

- 375–390: thumbnail stacks above content; no horizontal page scroll; format buttons wrap;
- 768: card remains readable without clipped actions/dropdowns;
- 1280: two-column editorial grid is usable;
- 1440+: visual density remains balanced;
- dropdown/accordion overlays remain accessible;
- missing optional source metadata does not break layout.

This visual regression remains a manual verification item unless browser/screenshot automation is explicitly added.


## 2026-09-23 Today / Overview snapshot regression

### Data contract

1. Enter Today and verify one `/api/radar/today` request provides the Today snapshot.
2. Verify Today does not need separate client requests to Scripts, Discovery or source availability to render its core blocks.
3. Verify snapshot metadata reports:
   - auto refresh = 60 seconds;
   - focus limit = 2;
   - recommended Ideas limit = 3;
   - upcoming limit = 3;
   - externalCalls = false.
4. Keep Today visible for over 60 seconds and verify a silent persisted-data refresh occurs without triggering Discovery/LLM/transcription work.
5. Hide the browser tab and verify the interval does not issue background Today refreshes while hidden.
6. Navigate away and back; verify Today reloads.

### Summary

1. New ideas = Opportunities created within rolling 24h.
2. Needs review = latest non-published/non-archived Outputs that are not reviewed.
3. Publications today respects the browser time zone.
4. Ideas ready to create excludes Ideas that already have an Output lineage.
5. Zero counts render without layout shift.

### Today's focus

1. Maximum 2 cards.
2. An Output needing review ranks before a ready-to-schedule Output.
3. Ready-to-schedule Output ranks before an Idea without Output.
4. Output card opens that Output in Scripts.
5. Idea card opens the exact Idea.
6. Empty state shows caught-up UX and routes to Ideas.

### Recommended next

1. Maximum 3 cards.
2. Only Ideas with no Output lineage are eligible.
3. `status=new` ranks first.
4. Saved ready Ideas rank before ordinary ready Ideas.
5. Relevance breaks ties before creation time.
6. Creating an Output from a recommended Idea removes it from this list on the next Today refresh.
7. Missing source thumbnail uses a safe placeholder.

### Upcoming

1. Includes scheduled + unpublished + non-archived Outputs.
2. Ordered by earliest scheduledAt first.
3. Maximum 3 visible on Today.
4. If total > 3, header link shows total and routes to Content Plan.
5. Platform icon/date/time/title remain visible.
6. Google Calendar connection is not required.

### Improve your Radar

1. Preference signals = Interested + Not interested.
2. Skip is displayed but does not increase preferenceSignals.
3. No arbitrary learning percentage/completion bar is shown.
4. Train Radar routes to Discover.

### State / responsive / localization

Check:
- initial loading;
- previous snapshot during silent refresh;
- retry/error;
- no focus;
- no recommended Ideas;
- no upcoming;
- missing thumbnail/platform;
- long RU/EN titles.

Widths:
- 375–390;
- 768;
- 1280;
- 1440+.

Expected:
- no horizontal page scroll;
- summary metrics reflow safely;
- desktop paired blocks remain visually balanced;
- mobile order remains Header → Summary → Focus → Recommended → Upcoming → Improve Radar.
