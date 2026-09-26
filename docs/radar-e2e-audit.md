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


## 2026-09-24 Temporary publication storage regression

1. Storage-backed publication media accepts video files up to and including 400 MB.
2. Storage-backed publication media rejects files larger than 400 MB before upload.
3. Non-video files are rejected by the temporary media validator.
4. The 400 MB product limit applies to Instagram/TikTok temporary-storage flows, not direct YouTube uploads.
5. Temporary objects use owner-scoped Firebase Storage paths under `publication-assets/{uid}/...`.
6. Raw media bytes are never persisted in the application JSON/Firestore data model.
7. Publish modal explains the 400 MB temporary-storage limit in RU and EN.
8. Direct YouTube publishing remains usable for files above 400 MB when YouTube itself accepts them.
9. Before scheduled Instagram/TikTok is enabled, verify delete-after-success/cancel and bounded failure-retention cleanup.


## 2026-09-24 Storage policy deployment regression

1. `storage.rules` scopes `publication-assets/{uid}/...` reads/deletes/uploads to the authenticated owner.
2. Storage rules reject non-video uploads.
3. Storage rules reject uploads above 400 MB.
4. Object update/overwrite is denied.
5. GCS lifecycle config deletes only objects matching `publication-assets/` at age 7 days.
6. Production deploy applies the lifecycle file.
7. Production deploy clears soft delete on the publication bucket.
8. Production deploy deploys Firebase Storage rules.
9. Production deploy reads the live bucket config and fails if the 7-day prefix lifecycle is absent or soft delete remains enabled.
10. CI static regression validates rules/lifecycle/deploy wiring before production deployment.


## 2026-09-24 Plan & Quotas visual regression

1. Desktop sidebar keeps core workflow navigation separate from the compact **Plan & Quotas** account/service control.
2. Quota status uses the real `/api/quotas` response; the page must not fabricate provider balances.
3. At <80% usage, sidebar status is neutral.
4. At 80–99%, the relevant quota displays a warning state and sidebar attention dot.
5. At 100%, the relevant quota displays an exhausted state; the UI explanation says only the expensive action is blocked.
6. Plan & Quotas page renders at 375–390, 768, 1280 and 1440+ without horizontal overflow or clipped plan cards.
7. Verify RU and EN copies, especially long quota descriptions and Free/Pro comparison rows.
8. Mobile More contains Plan & Quotas and marks More active while the section is open.
9. Free/Pro target values are explicitly labeled as a target/preview while billing is disconnected; current beta limits remain the enforced values.
10. Ordinary users never see Gemini/Supadata/ChocoData/provider quota counters on Plan & Quotas.
11. Admin/owner uses the same customer product quota presentation; role alone does not imply unlimited product quota.

## Contextual quota verification — 2026-09-24

Baseline: remote HEAD 576d4cfc487db356e00d03e29bfc01805d7937b3; CI #1127/#1128 and deploy #472 successful. Work prepared in a separate clean clone because the existing local checkout has unresolved conflicts.

Automated regression: 39 tests pass, including 79/80/99/100 thresholds, zero allowance, UTC renewal, member/admin/owner exhaustion before provider calls, Interested/Skip persistence, last-unit concurrent reservations, reservation release, idempotent successful generation replay and concurrent source scans. npm run lint and npm run build pass.

Actual browser check: real components with isolated fixture APIs at 375px, RU; exhausted Discovery preserves Interested and Skip (both advanced the queue), Ideas disables Create/Refresh while Save and navigation remain enabled. This is not an authenticated production E2E check. Full RU/EN responsive matrix (768/1280/1440), Calendar journey and production smoke are left to the owner per their explicit request to conserve remaining usage.


## 2026-09-25 Publish / Calendar / Discover regression

1. Discover Web candidate without image renders the Globe/domain fallback; Similar content follows the same rule.
2. Source badge says `Web` or `YouTube`; domain remains separate secondary metadata.
3. YouTube uses the shared `PlatformIcon` on active Radar/source/publishing surfaces.
4. Main product dropdowns use `CustomSelect`; no native `<select>` remains on ContentRadar, PublicationModal or SettingsModal.
5. Publish opens with Description/Caption empty. YouTube shows Title + Description; Instagram/TikTok show Caption.
6. AI Generation runs only from the explicit button, returns editable text plus hashtags, and never auto-overwrites manual edits.
7. Metadata generation checks the existing `scriptGenerations` quota before the LLM call and retries with the same request id return the cached result without another charge.
8. Connect Google Calendar from Integrations, then verify Calendar reflects the same state; connect YouTube from Publish/Integrations and verify the other surface refreshes from shared integration state.
9. FullCalendar supports Month/Week and uses existing Script cards/data. Dragging a scheduled item updates only the Content Radar schedule date/time through the existing schedule endpoint.
10. Verify RU/EN at 390 / 768 / 1280 / 1440+; no page-level horizontal scroll, clipped actions, or desktop Publish whole-modal scrollbar.
11. Verify Calendar mobile/tablet horizontal overflow stays inside the calendar shell rather than creating page-level overflow.
12. Run `npm run lint`, `npm test`, and `npm run build` on the latest HEAD and verify the latest GitHub Actions CI result, not an older SHA.


## 2026-09-25 YouTube OAuth / shared integration regression

1. Connect Google Docs first, then connect YouTube. The YouTube consent request must not contain the prior `drive.file` scope.
2. Connect Google Calendar first, then connect YouTube. The YouTube consent request must stay limited to the YouTube integration scopes plus normal identity scopes.
3. YouTube authorization requests `youtube.readonly` and `youtube.upload` and does not enable `include_granted_scopes`.
4. Connect or reconnect YouTube from Integrations and verify Publish refreshes the connected channel without reloading the page.
5. Connect or reconnect YouTube from Publish and verify Integrations refreshes its CONNECTED state/channel without reloading the page.
6. Reopen either surface and verify the current session token restores the same state.
7. Verify popup cancel/error does not falsely mark YouTube connected.
8. Run `npm run lint`, `npm test`, and `npm run build` on the final HEAD before treating the fix as verified.


## 2026-09-25 Multi-platform Publish / Calendar regression

### Shared dropdown
1. No user-facing component under `src/components` contains a native `<select>`.
2. CustomSelect trigger keeps a stable height/width when the menu opens.
3. Menu renders through a portal/fixed overlay and does not push or resize its parent card/modal.
4. Menu repositions on viewport scroll/resize and can open above the trigger when required.
5. Platform options show the shared PlatformIcon and the selected option keeps its check state.
6. Verify keyboard Escape, outside click, long RU/EN labels and mobile widths.

### Publish Step 1 — Platform & media
1. Select one platform and verify the flow remains single-platform.
2. Select YouTube + Instagram + TikTok and verify all remain selected into Steps 2–3.
3. A new publication requires a video file; editing an existing publication does not require re-selecting the original file.
4. Optional Cover / Thumbnail accepts image input and keeps a preview.
5. YouTube connection state is the shared integration state.
6. Instagram/TikTok are selectable as publication plans while their direct-post adapters remain clearly pending.

### Publish Step 2 — Content adaptation
1. Publishing copy starts empty and never copies the Script body automatically.
2. Single YouTube: Title + Description only; no Instagram/TikTok caption controls.
3. Single Instagram/TikTok: Caption only; no YouTube-style Title.
4. Multi-platform: Base content plus one tab per selected platform.
5. Use base text may be disabled for one platform without changing the other platform adaptations.
6. AI adaptation is explicit and generated content remains editable.
7. YouTube-only visibility, Made for kids and AI-content controls do not appear on Instagram/TikTok tabs.

### Publish Step 3 — Schedule
1. Same date/time applies to every selected platform by default.
2. Per-platform mode stores independent schedules for YouTube/Instagram/TikTok.
3. Timezone is persisted on PublicationJob.
4. Saving a multi-platform plan creates/reuses one owner-scoped PublicationJob per platform.
5. Existing active job reuse must update the submitted metadata instead of returning stale values.

### YouTube thumbnail
1. With no custom thumbnail, video upload continues normally.
2. With a custom image, video upload completes first, then `thumbnails.set` is called for the returned video ID.
3. Thumbnail upload failure marks the YouTube PublicationJob failed rather than reporting a successful publish.
4. A remote YouTube publication may use its provider thumbnail URL in Calendar/Publication Details.

### Calendar / Publication Details
1. Calendar loads PublicationJob records and merges legacy Script schedules only when no job represents that Script.
2. Dragging a PublicationJob changes only that publication schedule.
3. Month view shows at most the configured event-row capacity and `+N more` opens the day popover.
4. All platforms filter can switch to YouTube/Instagram/TikTok without page reload.
5. Event cards use subtle platform-aware tints and the shared platform icon.
6. Event click opens Publication Details, not Script directly.
7. Publication Details → Edit opens the shared 3-step Publish modal with the existing job.
8. Open Script remains an explicit separate action.
9. Unschedule clears that publication schedule; Delete removes that publication only.
10. Remote provider URL can be opened/copied when available.

### Responsive / locale
Verify RU and EN at 390 / 768 / 1280 / 1440+:
- Publish steps remain usable without clipped footer actions;
- step navigation wraps/truncates intentionally;
- Calendar horizontal overflow stays inside the calendar shell;
- Publication Details fits viewport;
- dropdown overlays do not create page-level horizontal/vertical layout jumps.


## 2026-09-25 Instagram / TikTok direct publishing regression

### Provider setup and OAuth
1. With missing provider env variables, Integrations shows API setup required rather than a false Connected state.
2. Instagram OAuth asks only for the publishing scopes required by the Instagram integration.
3. TikTok OAuth asks for `user.info.basic` and `video.publish`.
4. OAuth state expires and is HMAC-validated before a provider authorization code is accepted.
5. Provider tokens remain server-side/encrypted and never appear in Settings, browser storage or integration status responses.
6. Connecting from Integrations updates Publish without reload; connecting from Publish updates Integrations without reload.
7. Cancelled/failed popup authorization must not mark a platform connected.

### Instagram
1. Professional account connection resolves account identity.
2. Immediate Reel publish uploads temporary media, creates a REELS container, polls it to `FINISHED`, calls `media_publish`, and stores the provider media id/permalink.
3. Container `ERROR`/`EXPIRED` and provider API errors mark only that PublicationJob failed with diagnostic text.
4. Scheduled Reel stays queued before its Content Radar schedule and is released only when due.
5. Caption and Share to feed remain editable platform-specific values.

### TikTok
1. After connect, `creator_info/query` populates permitted privacy choices and interaction restrictions.
2. When the app is not audited, the effective privacy sent to TikTok is always `SELF_ONLY`.
3. Direct Post initializes with `FILE_UPLOAD`; large videos use sequential chunks that remain within the configured TikTok chunk ceiling.
4. After upload, job state becomes `processing`; scheduler polls `status/fetch`.
5. `PUBLISH_COMPLETE` changes the job to Published; `FAILED` persists the provider fail reason.
6. TikTok-only controls do not leak onto Instagram/YouTube tabs.

### Temporary media
1. Browser obtains a short-lived signed PUT URL through an authenticated Content Radar endpoint.
2. Object path is scoped under the effective owner and cannot be read using another owner id.
3. Instagram receives only a short-lived signed read URL; TikTok chunks are streamed server-side.
4. Temporary media is deleted after provider handoff and when a planned publication is deleted.
5. If provider delivery fails before safe handoff, retain enough diagnostic/job state for retry without marking the publication successful.

### Production smoke
After provider credentials are configured:
- connect Instagram from Integrations, reopen Publish, confirm connected state;
- publish one test Reel now and one scheduled Reel;
- connect TikTok, verify creator privacy options, then make one SELF_ONLY test Direct Post;
- wait for TikTok status polling to reach Published/Failed;
- verify Calendar → Publication Details displays the real provider state;
- verify RU/EN at 390 / 768 / 1280 / 1440+.


## 2026-09-25 Network / wake / YouTube OAuth regression

### Offline
1. Load the app while online, then disable network.
2. Current page content remains rendered; a persistent RU/EN "No internet connection" banner appears.
3. API actions do not surface raw browser strings such as `Failed to fetch`; internal fetch errors are normalized.
4. Background polling does not continue aggressively while offline.
5. Restore network: show "Connection restored", trigger data refresh, then dismiss recovery state automatically.
6. Repeat at 390 / 768 / 1280 / 1440+ and verify the fixed banner does not cover inaccessible primary actions.

### Browser sleep / hidden tab
1. Open a populated product page and background/sleep the browser for more than one minute.
2. Return to the tab: refresh Firebase ID token and reload current app data.
3. Existing page structure must not collapse to an empty grey shell.
4. Force a render exception in development: the root Error Boundary must display reload + technical details instead of a blank page.

### YouTube integration scopes
1. A token in session storage alone must not produce Connected.
2. Connected requires a successful YouTube channel lookup using the cached token.
3. Simulate `insufficientPermissions` / "insufficient authentication scopes": cached YouTube publishing token is cleared and integration becomes Not connected.
4. Reconnect opens a fresh Google consent flow requesting `youtube.readonly` and `youtube.upload`.
5. If consent succeeds and channel lookup succeeds, Connected + channel identity appear.
6. If network is offline during connect, show the network state rather than a misleading scope/provider error.


## 2026-09-25 Compact Content plan regression

1. Week view fits into the intended bounded calendar viewport instead of making the whole page excessively tall.
2. Verify 07:00–22:00, 30-minute lanes, hourly labels, current-time line and internal vertical scrolling.
3. Verify publication cards remain readable and clickable after density reduction.
4. Drag/drop remains accurate at 30-minute granularity.
5. Month view remains natural-height and unchanged in event overflow behavior.
6. Verify 390 / 768 / 1280 / 1440+: horizontal overflow stays inside the calendar shell and toolbar controls remain reachable.


## 2026-09-25 YouTube connected-state UX

1. Successful YouTube validation shows Connected + channel identity.
2. Connected state does not show a primary Reconnect button.
3. A secondary Change account action can intentionally start a fresh consent/account-selection flow.
4. Invalid/expired/insufficient-scope token returns the card to Not connected and exposes the primary Connect action.
5. Verify RU/EN and long channel names without changing card height unexpectedly.


## 2026-09-25 UI density / action hierarchy regression

### Primary actions
1. Discover, Ideas, Scripts, Calendar, Settings and Publish no longer use large charcoal/black filled buttons for ordinary primary actions.
2. Primary CTA = Radar emerald; secondary actions remain white/bordered; active tabs/filters use mint/emerald states.
3. Verify hover, disabled and focus states preserve contrast in RU/EN.

### Radar source icons
1. Selected YouTube source keeps the red YouTube brand icon on a neutral/light badge.
2. Selection is communicated by the source card border/background rather than recoloring the platform brand.
3. Web and unavailable X states remain visually distinct.

### Ideas header
1. At 1280/1440+ the Radar learning block reads as one horizontal row rather than stacked text/action rows.
2. Signal stats remain readable without a separate "updated now" line.
3. At 390/768 controls may wrap intentionally without horizontal page overflow.

### Settings / Today
1. Language control is a compact row and does not visually exceed the scale of the Settings tabs.
2. Today’s focus contains no numbered circles and no duplicate focus count badge.
3. The ordered list remains understandable from vertical priority alone.

### Plan & Quotas
1. Four current quota metrics fit in a denser desktop row with reduced padding/gaps.
2. Warning/exhausted states remain visible and progress bars retain correct width.
3. Quota behavior explanation is compact and Free/Pro cards remain readable at 390 / 768 / 1280 / 1440+.


## 2026-09-25 Scripts 2.0 regression

### Library
1. Scripts opens in Board by default; List can be selected without reloading.
2. Board has Needs review / Approved / Scheduled / Published columns with current counts.
3. Search and sort affect Board cards as well as List results.
4. Dragging Review ↔ Approved ↔ Published uses the existing lifecycle API.
5. Dropping an unscheduled script onto Scheduled opens the script Publication tab and requires a real date/time.
6. Archived scripts remain reachable through List/Archived rather than becoming a fifth workflow column.
7. Cards remain usable at 390 / 768 / 1280 / 1440+; Board horizontal overflow must stay inside the workspace.

### Script work surface
1. Card click opens a large modal/work surface instead of a right-side detail column.
2. Background body scroll is locked while the editor is open and restored on close.
3. Close by explicit X and backdrop click; destructive/action clicks inside must not close the modal.
4. Script tab supports existing manual editing + save-as-new-version behavior.
5. Media shows thumbnail/source information without inventing missing media.
6. Publication preserves platform/date/Google Calendar schedule behavior and opens the shared Publish modal.
7. History preserves version switching and feedback history.
8. Right rail status selector still uses real lifecycle behavior; Improve script uses the existing quota-protected regeneration path.
9. Archive/Delete remain functional.
10. RU/EN and long titles must fit at 390 / 768 / 1280 / 1440+ with no inaccessible header/footer actions.


## 2026-09-25 Scripts work surface refinement regression

1. Click visible script body → editor activates and receives focus; no separate Edit button is required.
2. Click title → title editor activates.
3. With unsaved body changes, switching to Media / Publication / History offers Save & continue, Continue without saving, Cancel.
4. Header has no duplicate Publish action.
5. Publication tab renders the shared 3-step publishing workflow inside the same editor surface; no second overlay/modal is opened.
6. Publication workflow remains usable at 390 / 768 / 1280 / 1440+ inside the editor viewport.
7. AI tools do not contain Approve. Status approval remains available through Script details.
8. Improve script opens an RU/EN explanation before execution and explicitly states new-version behavior + 1 AI Generation usage.
9. New manual script confirmation explains that it creates a standalone manual script without AI generation / Idea link.
10. No per-script Google Calendar sync checkbox is shown. Connected Calendar is treated as automatic sync preference; disconnected Calendar does not block Content Radar scheduling.


## 2026-09-25 Radar media / source semantics regression

1. Discover YouTube/Web preview stays 16:9 at 390 / 768 / 1280 / 1440+.
2. Web item with no image shows Globe + domain + Web article placeholder.
3. Web item with an image URL that fails to load switches to the same placeholder.
4. YouTube missing/broken thumbnail uses branded YouTube fallback.
5. Similar content uses the same media fallback and fixed aspect ratio.
6. Ideas cards use the same 16:9 rule and broken-image handling.
7. Today recommended cards use a fixed 16:9 source preview rather than ad-hoc dimensions.
8. Source badges/tags explicitly read Source · YouTube/Web (or RU equivalent); they must not look like an automatically selected publication destination.
9. Recommended format remains separate from source and from Publication platform selection.


## 2026-09-25 Single-screen Publication / Scripts regression

### Scroll ownership
1. Open a long Script at 1280/1440+: only the work-surface body has a vertical scrollbar.
2. The Script details rail has no independent vertical scroll.
3. Open Publication: no new nested vertical scrollbar appears inside the embedded Publication workspace.
4. At 390/768 one work-surface scroll remains usable and all actions stay reachable.

### Publication
1. There is no 1/2/3 wizard, Back/Next step navigation or progress stepper.
2. Platforms render as compact YouTube / Instagram / TikTok chips.
3. No platform is inferred from the legacy Script `publicationPlatform` field.
4. Media + content + schedule are reachable on one desktop screen/workspace.
5. Multiple selected platforms expose compact Base/platform adaptation tabs.
6. Submit with no schedule means Publish now; a future date means Schedule.
7. Existing PublicationJobs are loaded and reused by platform; retry must not create a duplicate job.

### YouTube failure / success
1. Attach a test video and attempt YouTube publishing.
2. While uploading show in-flight state; do not navigate away or reset UI.
3. If YouTube fails, remain on the same Publication workspace with video/file metadata, title, description, privacy and schedule preserved.
4. Show Failed + provider reason + Retry. Scope/auth failures also expose Reconnect YouTube.
5. Retrying in the same session reuses the existing YouTube PublicationJob.
6. If YouTube accepts the upload, show Processing on platform or Scheduled instead of resetting the form.
7. When a provider URL exists, Open publication is available.
8. Parent Script refresh must not unmount Publication immediately after submit.

### Script semantics / versions
1. Script header, library cards and Script details do not show legacy TikTok/YouTube/Instagram destination tags.
2. Destination platforms appear only as real PublicationJobs.
3. Versions tab explains version behavior, marks the current version and shows origin/time/size/content preview.
4. Restore an old version: a new version is created; the old/current records are not overwritten.
5. Archive/Delete live under More and remain functional.


## 2026-09-25 Canonical Script cover regression

1. Open an existing Script and choose a new image in Publication → Cover.
2. The cover shows a saving state immediately; this action does not depend on Publish succeeding.
3. After save, switch to Media without closing the Script: the new cover is shown.
4. Close/reopen the Script: the new cover remains.
5. Verify the same cover on the Scripts library card, Today Focus/Upcoming and Script-backed Calendar surfaces.
6. Reload the browser: a fresh signed URL still renders the same persistent cover.
7. Replace the cover again: the newest image becomes canonical and the previous persistent object is cleaned up.
8. Publish to YouTube with the same selected image: the YouTube thumbnail upload still receives the file.
9. Fail/cancel social publication after selecting the cover: the Script cover remains saved.
10. Idea/Discover source thumbnails must remain unchanged; canonical cover applies to Script/publication surfaces only.


## 2026-09-25 Cover / YouTube / Calendar regression

1. Save a custom Script cover, then schedule a YouTube publication.
2. Upcoming and Publication details show the canonical Script cover immediately; a YouTube hqdefault placeholder must not override it.
3. Reload the browser and publish/retry without re-selecting the image: the persistent Script cover is downloaded by the app and sent to YouTube thumbnails.set.
4. Connected Google Calendar + scheduled Publication creates a PublicationJob-owned calendar event and stores its ids/url.
5. Publication details shows Google Calendar = Synced and links to the event when a URL exists.
6. Dragging the publication to another date/time updates both PublicationJob and its Google Calendar event.
7. Unschedule/delete removes the remote Calendar event when possible.
8. Do not expect a visual custom cover inside native Google Calendar event cards; Calendar API does not expose that presentation surface.


## 2026-09-25 Script editor cleanup / Storage bucket regression

1. Open a standalone manual Script: tabs are Script / Publication / Versions; Media is not rendered when there is no source material.
2. Open a Radar/Idea-backed Script with source lineage: Media remains available.
3. Script header shows status + Updated date without a duplicated Version label.
4. Script details shows status/source/created without a duplicated Version row.
5. Copy and More controls are compact and visually aligned at 390 / 768 / 1280 / 1440+.
6. Embedded Publication starts directly with platform controls; the duplicate Publication title/subtitle is absent.
7. Standalone Publication still has its own title/subtitle and close action.
8. Production Cloud Run runtime has FIREBASE_STORAGE_BUCKET configured from the deployed Firebase Storage bucket variable.
9. Save a Script cover, reload, reopen Publication and verify the persistent cover still resolves.
10. Publish/retry YouTube after reload and verify the persisted Script cover can still be downloaded and sent to the YouTube thumbnail API.


## 2026-09-25 Thought-to-script / AI Generation regression

1. Open New Script and switch between Write manually and Create with AI at 390 / 768 / 1280 / 1440+.
2. Manual mode requires title + content and consumes no AI Generation.
3. AI mode requires the creator thought; title is optional.
4. AI mode clearly shows **1 AI Generation** and states that Radar Analysis is not consumed.
5. Quota precheck blocks generation when AI Generation is exhausted.
6. Server reserves `scriptGenerations` before the provider call and commits only after a usable Script is created.
7. Retrying the same request id returns the same generated Script rather than creating a duplicate.
8. The created Script stores `sourceType=ai_prompt` and the original thought in `sourcePrompt`.
9. New manual Scripts store `sourceType=manual`; Radar Idea outputs store `sourceType=radar_idea`.
10. Script details renders Thought + AI / Мысль + AI for an AI-prompt Script.
11. AI-prompt Scripts have no source-only Media tab unless real source material is later attached.
12. The generated Script appears in Needs review / Scripts and is editable, versionable and publishable like any other Script.


## 2026-09-25 Workflow drag / upload / editor density regression

1. Drag a Script freely between Needs review, Approved, Scheduled and Published.
2. Dragging into Scheduled must update immediately without opening Publication and without requiring a date/platform.
3. A workflow-only Scheduled Script may have no `scheduledAt`.
4. If a Script already has a real publication date, moving its workflow status must not erase that date.
5. Creating a real Publication schedule still moves workflow status to Scheduled.
6. Successful platform publication moves workflow status to Published.
7. Board cards use the same compact height with and without thumbnails/long titles.
8. Board cards use neutral stone borders/shadows; no heavy black outline appears at rest.
9. At 390 / 768 / 1280 / 1440+, board columns remain equal-width and cards do not overflow.
10. Video and Cover upload zones are equal height.
11. Hover anywhere over an upload zone shows pointer + hover treatment; clicking anywhere opens the file picker.
12. Native file-input chrome does not visually leak into the Publication layout.
13. Upload/save a Script cover in production: no `iam.serviceAccounts.signBlob` error occurs.
14. Reload and verify the same persistent cover resolves and can be reused by YouTube thumbnail upload.
15. Editor title, Save title, Copy and More remain adjacent without a large empty gap at desktop widths.


## 2026-09-25 Backend upload / no-signBlob regression

1. Upload a Script cover while authenticated; request goes to POST `/api/radar/scripts/:id/cover` with binary image bytes.
2. Files over 8 MB or non-image MIME types are rejected.
3. Server writes the cover directly to Firebase Storage and persists `thumbnailObjectPath`.
4. Response returns a hydrated Script whose cover URL resolves without V4 signed URL generation.
5. Reload Scripts and verify the canonical cover appears again.
6. Open Publication and verify the same cover remains selected/visible.
7. Publish to YouTube and verify the persistent cover is fetched through `/cover/file` and reused as the thumbnail.
8. Publication thumbnail upload uses authenticated backend upload instead of a signed write URL.
9. Deploy workflow contains no IAM API enable step and no `roles/iam.serviceAccountTokenCreator` grant for this flow.
10. Production deploy must pass without the previous `iam.serviceAccounts.signBlob` / `serviceusage.services.enable` failure.


## 2026-09-25 Firestore normalized-v2 migration regression

1. Start production with an existing legacy `_ai_content_funnel_state/current/chunks` snapshot and no normalized-v2 metadata.
2. Verify startup migrates legacy state into entity collections and completes read-back digest verification before serving normalized writes.
3. Verify existing users, settings, Radar profile, Discovery candidates, Ideas/opportunities, Scripts + versions, publication jobs, quotas, transcript cache and integrations remain present after migration.
4. Verify root Scripts are stored in `scripts` and child versions in `scriptVersions`, while the API still returns one coherent Script lineage.
5. Modify one Script title and verify persistence writes that Script document rather than rewriting the full application state.
6. Create/delete a publication job and verify only the relevant entity documents/meta change.
7. Update Radar preferences/quota and verify their owner-specific documents persist independently.
8. Restart the service and verify normalized-v2 is read directly without consulting legacy chunks as the active source.
9. Confirm `/api/admin/storage-status` reports `format=normalized-v2`, entity count and whether the legacy snapshot is still retained.
10. Confirm `/api/admin/export-db` still exports a complete logical AppDatabase regardless of the physical Firestore layout.
11. Run the connected flow Discover → feedback → Radar Analysis → Ideas → Script → Versions → Publication/Calendar after migration.
12. Keep the legacy snapshot untouched during this rollout; do not delete it until a separate verified cleanup change.


## 2026-09-25 Admin storage diagnostics regression

1. Open Admin → Infrastructure at 390 / 768 / 1280 / 1440+.
2. Storage card renders without horizontal overflow.
3. Confirm Format = `normalized-v2`.
4. Confirm Entities is greater than zero for a migrated production database.
5. Confirm Sync = Healthy and Readable = Yes.
6. Confirm Legacy snapshot = Retained as fallback during the migration confidence window.
7. Confirm Chunks = 0 for the active normalized-v2 store.
8. Click Refresh and verify the card re-reads current server status without reloading the page.
9. If backend reports `syncStatus.lastError`, verify the error is visible in the card and no secrets are rendered.


## 2026-09-26 Infrastructure Diagnostics v2 regression

1. Open Admin → Infrastructure at 390 / 768 / 1280 / 1440+.
2. System Health renders Storage, AI, Search, Transcription, Publishing, Queue, Integrations and Data without horizontal page overflow.
3. Storage & migration shows normalized-v2, entity count, chunks, legacy fallback and safe-to-retire status.
4. Collections disclosure shows logical entity counts and wraps/truncates safely.
5. Queue card shows pending, active, stuck video, stuck publication, publication failures and Radar failures.
6. Provider card shows 24h usage/failures and paid AI call count without rendering API keys.
7. Integrations card shows Instagram/TikTok configured/connection/expiry counts and clearly marks Google Calendar as client-session scoped.
8. Data integrity reports orphan versions/jobs, missing owners/sources, invalid references, duplicate IDs and published-without-timestamp.
9. Workflow-only Scheduled without date is shown separately and does not increment integrity issue count.
10. Refresh reloads `/api/admin/storage-status` and `/api/admin/infrastructure-diagnostics`.
11. Admin endpoint remains behind `/api/admin` RBAC.
12. No encrypted tokens, raw provider secrets or API keys appear in diagnostics payload/UI.
