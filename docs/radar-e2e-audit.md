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


## 2026-09-24 Discovery sources / Idea format regression

### My Radar source selection

1. Verify My Radar shows Where Radar searches instead of Content formats.
2. Verify YouTube and Web can be selected independently.
3. Verify X is disabled/Coming soon until its adapter is available.
4. Attempt to remove the final selected source and verify the client blocks it with visible feedback.
5. Send `discoverySources=[]` directly to the profile API and verify server rejection with `RADAR_DISCOVERY_SOURCE_REQUIRED`.
6. Change only Discovery sources and verify tasteVersion changes and unhandled candidates are invalidated.
7. Verify Web-only selection makes no YouTube search API call.
8. Verify YouTube-only selection makes no Web Search provider call.

### Idea output recommendation

1. Analyze source material capable of supporting multiple output types.
2. Verify the Idea carries one AI-selected `recommendedFormat` plus optional alternatives.
3. Verify changing legacy `contentFormats` does not change tasteVersion or Discovery ranking.
4. Verify Idea recommended format is the default Create CTA.
5. Override to any other supported format and verify generation uses/persists the override.
6. Verify unsupported format values are rejected.
7. Verify one Idea is not duplicated once per output format.

### Legacy compatibility

1. Load a stored profile with `contentFormats` and verify My Radar does not render that selector.
2. Load an older Idea without `recommendedFormat` and verify fallback to Short video.
3. Verify legacy profile formats do not restrict the Create menu.

Responsive/localization:
- verify RU/EN Where Radar searches labels and validation;
- verify source cards at 375–390, 768, 1280 and 1440+;
- verify no horizontal overflow with source hints / Coming soon state;
- verify format Create menu remains usable at the same widths.


## 2026-09-23 Ideas / Created regression

Scenario A — card hierarchy:

1. Open Ideas with at least four Ideas.
2. Verify each card shows metadata, title, one concise thesis, Recommended format, source provenance and actions.
3. Verify Hook and detailed reasoning are hidden by default.
4. Expand Why this idea? and verify Hook, Why, Angle, Evidence and alternative formats appear without duplicating the Idea content.

Scenario B — Saved + Created coexist:

1. Save an Idea with no outputs.
2. Verify it appears in Saved.
3. Create an output from the same Idea.
4. Verify the Idea remains Saved and also appears in Created.
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
4. Verify Created tab still contains one Idea card, not one card per format.

Scenario E — Regenerate same format:

1. On an Idea with Article output, open Create another.
2. Select Article again.
3. Verify the action is presented as Regenerate Article.
4. Verify a new Article version is created in the same Article lineage.
5. Verify Post/other output lineages are not replaced.

Scenario F — tabs and filters:

1. Verify tabs: All ideas / From liked videos / Saved / Created.
2. Verify Saved count is based on saved state, not scripted status.
3. Verify Created count is Ideas with at least one output.
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

- verify RU/EN labels for Created, Create, Create another, Regenerate, filters and Why this idea?;
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


## 2026-09-24 Ideas library header / palette regression

### Tabs and toolbar

1. Verify tabs are All ideas / From liked videos / Saved / Created.
2. Verify Created count equals Ideas with at least one generated output.
3. Verify Saved and Created can overlap for the same Idea.
4. Verify active tab uses underline/soft state and no large black pill.
5. Verify one toolbar contains Search + Topic + Format + Sort.
6. Verify Source and Score filters are absent.
7. Verify Search/Topic/Format/Sort compose correctly and counts remain tab-based.

### Radar status

1. Verify preference signal count = Interested + Not interested.
2. Verify Skip is visible but does not increase preference-signal count.
3. Verify refresh recency updates over time.
4. Verify Refresh triggers Radar analysis/refresh behavior already supported.
5. Verify Train more routes to Discover.
6. Verify processing/waiting state does not create a second duplicate status bar.

### Thumbnail / card proportions

1. Verify YouTube/source thumbnail renders at 16:9 above card content.
2. Verify `object-cover` does not stretch the image.
3. Verify platform badge remains readable.
4. Verify topic tags are not duplicated on the thumbnail.
5. Verify missing thumbnail uses a stable fallback with the same aspect ratio.

### Color and actions

1. Create action uses sage/teal primary treatment.
2. Open existing output uses slate treatment.
3. Recommended block uses pale sage.
4. Saved/secondary controls remain neutral or soft sage.
5. No major Ideas action depends on a black primary block.
6. Existing format in dropdown remains Regenerate; alternate missing format remains Create.

### Responsive

Check 375–390 / 768 / 1280 / 1440+:
- toolbar reflows without page-level horizontal scroll;
- tabs remain usable (horizontal overflow limited to the tab row if needed);
- 16:9 thumbnail remains proportional;
- two-column grid appears only when width supports it;
- quick format actions wrap safely;
- dropdown and accordion are reachable by keyboard/touch;
- focus states remain visible.


## 2026-09-24 Ideas grid / Discover topic and Similar content regression

### Ideas grid

1. At 1440+ verify three Idea cards render per row.
2. At 1280 verify the three-column grid remains usable without clipped controls or horizontal page scroll.
3. At 768 verify two cards per row.
4. At 375–390 verify one card per row.
5. Verify 16:9 thumbnails remain proportional at all widths.
6. Verify title/thesis clamping keeps cards compact without hiding primary actions.

### Discover thumbnail topics

1. Verify the source thumbnail overlay contains the platform/source badge only.
2. Verify no topic chips or +N topic counter render over the thumbnail.
3. Verify Key topics remains the canonical topic list.
4. Verify the source badge remains readable against light/dark thumbnails.

### Similar content

1. With 1–5 related candidates, verify all available items render and Show all is hidden.
2. With more than 5 related candidates, verify exactly the collapsed visible capacity is shown and Show all appears.
3. Click Show all and verify all available related candidates render once, without duplication.
4. Click Collapse and verify the list returns to the collapsed capacity.
5. On desktop, verify the Similar content card is visually extended to roughly match the upper Discover media/info region.
6. On narrow screens, verify the block flows naturally below the main card and does not force brittle fixed-height overflow.


## 2026-09-24 Source routing / all-format generation regression

### My Radar → Discovery

1. Select YouTube + Web and verify both source plans may run.
2. Select Web only and verify no YouTube adapter call occurs.
3. Select YouTube only and verify no Web adapter call occurs.
4. Verify ACTIVE TOPICS/Avoid remain the source eligibility boundary.
5. Verify changing legacy Content formats has no effect on Discovery.
6. Verify changing Discovery sources updates taste/ranking context.

### Ideas default CTA / dropdown

1. Use an Idea whose AI Recommended format is Article.
2. Verify default CTA is Create/Open Article.
3. Open format dropdown and verify all supported formats appear:
   - Short video;
   - Long video / Podcast;
   - Article;
   - Post.
4. Verify every supported format is creatable without My Radar format permissions.
5. Existing same-format output → Regenerate that format.
6. Missing format output → Create that format.
7. Verify creating an alternate format does not duplicate the Idea.


## 2026-09-24 Add source regression

### Modal structure

1. Open Add source from Discover.
2. Verify source choices are YouTube video and YouTube channel.
3. Verify legacy copy about video library / Gemini / conversion to text is absent.
4. Verify RU and EN.
5. Verify 375–390 / 768 / 1280 / 1440+ without clipped actions or page scroll.

### YouTube video

1. Paste a valid YouTube URL.
2. Verify lightweight thumbnail preview appears when a video id can be derived.
3. Verify two actions:
   - Learn from this;
   - Analyze for ideas.
4. Verify at least one action is required.
5. Learn only:
   - source persists as a Radar reference;
   - taste context changes;
   - no Radar Analysis is queued.
6. Analyze only:
   - source is ingested for the owner;
   - exact source is queued for Radar Analysis;
   - long-term Radar reference/taste context is not required.
7. Learn + Analyze:
   - reference is persisted;
   - exact source is queued once;
   - preference and analysis flows do not double-create the source.
8. Verify Analyze shows “Uses 1 Radar Analysis”.
9. Quota exhaustion must preserve the source/reference state and leave analysis retryable/waiting according to Radar Analysis rules.

### YouTube channel

1. Add channel URL or @handle.
2. Verify it becomes a Discovery source/reference.
3. Verify a sample of channel videos may enter the candidate pool.
4. Verify those candidates still require topic eligibility, quality and ranking.
5. Verify no client promise says every new upload is automatically sent to an LLM.
6. Verify no fake auto-check toggle is shown.

### Interaction/accessibility

- Escape/close and backdrop close must not interrupt an in-flight submit;
- source-type cards expose pressed/selected state;
- Learn/Analyze controls expose pressed state;
- focus states are visible;
- primary CTA disabled for missing URL or zero selected video actions;
- error clears on a new attempt;
- success acknowledgement appears before close.


## 2026-09-24 Content Radar brand regression

### Brand surfaces

1. Desktop sidebar:
   - Radar Pulse mark is visible;
   - product name = Content Radar;
   - tagline = Find signals. Create what matters.;
   - no active AI Content Funnel / Find. Learn. Create. Grow. copy.

2. Mobile header:
   - same Radar Pulse mark is used;
   - product name = Content Radar;
   - compact layout does not overflow at 375–390.

3. Browser:
   - document title = Content Radar;
   - SVG favicon uses Radar Pulse;
   - no legacy raster/ICO favicon references remain in active HTML;
   - metadata/OG title uses Content Radar.

4. Responsive widths:
   - 375–390: compact lockup remains readable;
   - 768: header/lockup alignment remains stable;
   - 1280 and 1440+: sidebar lockup does not wrap or clip.

5. Accessibility:
   - Radar mark has an accessible label;
   - text brand remains visible and is not encoded only inside the icon.

6. Cache note:
   - after deploy, hard refresh/browser cache may be required to verify a favicon replacement.


## 2026-09-24 Cost-aware Web Search / BYOK regression

1. SearchRouter provider order defaults to Google grounding → Tavily → Brave → OpenAI.
2. Providers are called sequentially, never fanned out in parallel for one query.
3. Sufficient unique Google results stop the route; Tavily/Brave/OpenAI are not called.
4. Google quota/error or insufficient unique results allows Tavily fallback; Tavily then falls back to Brave.
5. Successful Tavily/Brave results stop before later paid fallback.
6. Google grounding is first when a Gemini key exists, unless GOOGLE_WEB_SEARCH_ENABLED=false explicitly disables it.
7. OpenAI Web Search remains the paid last-resort fallback and requires its explicit enable flag/key.
8. Quota/invalid-key failures place that provider in cooldown rather than retrying it on every search.
9. Search results are canonical-URL deduplicated.
10. Article fetch enriches title/author/date/main text/description/og:image when available and rejects private/local URLs.
11. Web candidates pass through ACTIVE TOPICS, Avoid, quality and Radar ranking like other Discovery candidates.
12. Interested on a Web candidate analyzes article text directly; it must not enter the YouTube transcription path.
13. Web Idea provenance remains `sourceType=web` and preserves URL/image/source.
14. BYOK OpenAI uses the user's stored key for that request even when a platform OpenAI key exists.
15. BYOK does not silently fall back to a platform-paid provider.
16. Settings responses mask all provider keys and never return raw secrets.
17. Provider failures expose sanitized reason codes, never API keys/raw provider response bodies.
18. `npm run lint`, `npm test` and `npm run build` pass on latest HEAD before deployment.
19. Production smoke confirms the deployed revision and configured source availability.




## 2026-09-24 Admin provider quota regression

1. Admin → AI Usage shows LLM and Web Search provider quota rows.
2. Each row shows configured state, tier, used, limit, remaining, reset policy and data source.
3. Known published allowances never produce a negative remaining value.
4. Unknown/project-specific provider limits show remaining as unknown instead of a fabricated number.
5. Google Search grounding shows the 5,000 monthly search-request allowance separately from Gemini model token billing.
6. Tavily shows 1,000 monthly free credits for Basic Search accounting.
7. Brave shows the monthly free-credit equivalent for Search requests.
8. Groq/OpenRouter published free-plan limits are labeled estimated because exact organization limits may differ.
9. Search-provider usage is metered server-side once per actual provider call; cooldown skips do not double count.
10. Paid OpenAI usage is never mislabeled as a recurring free allowance.


## 2026-09-24 RBAC / admin invite / Ideas responsive regression

Automated:
1. Role resolution covers owner, admin and member.
2. Owner role is immutable through managed-role updates.
3. Admin invite is bound to normalized email.
4. Admin invite becomes unusable after first successful acceptance.
5. Expired invite cannot be accepted.
6. Revoked invite cannot be accepted.
7. A newer invite for the same email supersedes the prior active invite.
8. Ideas grid source regression asserts 1-column mobile baseline, 2 columns from 768 through 1280, and 3 columns from 1440+.
9. Recommended format regression asserts stacked full-width actions rather than the previous cramped responsive row.
10. Filter toolbar regression asserts tablet 2-column degradation before the desktop 4-control row.

Manual / functional smoke after deploy:
- member: Settings has no Admin tab; direct `/api/admin/*` returns 403;
- admin: Admin tab is visible and operational; ordinary `/api/admin/*` succeeds; admin-management endpoints return 403;
- owner: can create invite, copy link, revoke unused invite, and manage admin/member role;
- invited user with matching email: login via invite URL grants admin and removes the token from the browser URL after successful acceptance;
- mismatched email, reused link, revoked link and expired link all fail without changing role;
- Ideas at 390 / 768 / 1280 / 1440+ has no horizontal page scroll, card overlap or clipped Recommended format actions;
- verify both RU and EN at the four control widths.


## 2026-09-24 Ideas compact format selector regression

This supersedes the earlier two-column-at-1280 Recommended-format layout decision.

Automated:
1. Ideas uses 2 columns from tablet width and 3 columns from the standard desktop `xl` breakpoint.
2. Recommended-format panels have a fixed equal height across cards.
3. The action row contains a fixed-width `Create/Open` button plus a flexible format `select`.
4. The selected format defaults to the Radar recommendation per Idea.
5. Existing output for the selected format changes the action from `Create` to `Open`.
6. The old split-button format menu and `Create in another format` row are absent.
7. Filter controls retain tablet and desktop responsive behavior.

Responsive / visual control:
- 390: single card, no horizontal page scroll; Create/Open + format selector remain on one usable row.
- 768: two cards; equal-height green panels; RU/EN stay inside each card.
- 1280: three Ideas cards; green panels align and controls do not overflow.
- 1440+: three Ideas cards; equal-height Recommended format panels remain aligned.


## 2026-09-24 Transcription provider quota / admin-only regression

1. Ordinary client Settings must not expose Supadata, ChocoData, Gemini Audio provider balances, platform API keys or internal fallback diagnostics.
2. Admin → AI Usage shows a dedicated Transcription providers section.
3. The section documents the current fallback chain: YouTube captions → Supadata → ChocoData → Gemini Audio.
4. Supadata live-account quota is labeled Live when the provider supplies a verified balance.
5. ChocoData response quota metadata is persisted when a transcript API response supplies used/limit/remaining information.
6. A later Admin analytics request uses the latest ChocoData response quota for the matching key source.
7. Platform-key quota is treated as shared infrastructure usage across owners; BYOK remains owner-scoped.
8. If no live balance has been observed, Admin shows Estimated/Unknown rather than a fabricated remaining value.
9. Provider quota exhaustion must not be confused with the customer's product quota.
10. RU/EN and 375–390 / 768 / 1280 / 1440+ Admin layouts must keep the provider cards readable without horizontal page overflow.


## 2026-09-24 Direct publishing foundation regression

1. Scripts detail exposes one Publish action opening the shared modal.
2. The modal supports YouTube / Instagram / TikTok as platform targets without creating separate UX flows.
3. YouTube OAuth requests upload permission without replacing the Firebase identity.
4. YouTube channel identity is resolved after connection.
5. Publishing requires a media file and at least one selected platform.
6. A YouTube attempt creates one owner-scoped PublicationJob.
7. Repeated create calls while the same Script + platform has an active job reuse that job.
8. Job state moves draft → uploading → processing/queued or failed.
9. A successful future-dated YouTube upload stores queued + remote ID/URL.
10. A successful immediate upload stores processing + remote ID/URL; it must not claim processed/public before YouTube finishes.
11. Provider errors are stored in the job and surfaced as human-readable client errors.
12. Quota/rate-limit errors do not expose social API counters in Settings.
13. Instagram/TikTok must be clearly labeled as adapter/setup pending until their OAuth/Direct Post providers are actually enabled.
14. PublicationJob records are owner-scoped.
15. Marking a job published updates the linked Script publication state.
16. RU/EN and 375–390 / 768 / 1280 / 1440+ Publish modal layouts require visual verification.
