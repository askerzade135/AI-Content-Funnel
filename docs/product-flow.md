# Content Radar — Product Flow

Status: **working product specification**  
Owner: product + engineering  
Last updated: 2026-09-23  
Branch: `feature/content-radar-mvp1`

This document is the central product-level source of truth for the end-to-end user journey:

```
My Radar → Discover → Feedback → Analysis → Ideas → Save → Script → Calendar → Publish
```

Specialized algorithmic behavior for personalization remains in `docs/radar-personalization-model.md`.  
QA findings and production verification remain in `docs/radar-e2e-audit.md`.  
Known engineering backlog remains in `docs/technical-debt.md`.

---

## 1. Product goal

Content Radar helps a creator move from **finding relevant source content** to **deciding what to create**, then to **preparing and scheduling a script**.

The product should make the causality visible:

> I told Radar what I care about → Radar found relevant material → I showed what I liked → Radar extracted useful ideas → I selected an idea → I turned it into a script → I scheduled it.

The system must not feel like a collection of unrelated pages.

---

## 2. Main navigation

Current product-level areas:

- **Overview / Today** — summary and next actions.
- **Discover** — source-content recommendations.
- **My Radar** — taste/profile configuration.
- **Ideas** — content opportunities extracted and ranked for the creator.
- **Scripts** — generated or manually created scripts and their publication settings.
- **Calendar** — scheduled content.
- **Settings** — language and user-level settings.
- **Admin areas** — integrations, sources and internal configuration; not visible to ordinary clients.

Client-facing UI is RU/EN and should follow the browser language by default.

---

## 3. End-to-end lifecycle

### 3.1 My Radar

My Radar defines the creator's current taste context.

Important inputs include:

- Active Topics;
- Avoid;
- preferred angles;
- goals;
- output formats;
- creator description;
- manual references;
- discovery sources.

The detailed signal hierarchy, `tasteVersion`, eligibility rules and reset behavior are defined in `radar-personalization-model.md`.

When meaningful taste settings change:

1. save the profile;
2. increment `tasteVersion`;
3. invalidate stale rankings as required;
4. run fresh discovery;
5. navigate to Discover after successful refresh.

---

## 4. Discover

Discover answers:

> **What source content is worth my attention right now?**

Each shown candidate must:

- match at least one current Active Topic;
- not violate Avoid;
- be ranked for the current `tasteVersion`;
- pass the content-quality gate;
- not already have a completed feedback decision for the current queue.

A recommendation card may show:

- source/platform;
- thumbnail/video;
- title and description;
- views / likes / comments when available;
- match percentage;
- why it matches;
- key topics;
- content-quality context where useful.

### 4.1 Content quality gate

Topical relevance alone is not enough.

Discovery should avoid weak recommendations such as very low-signal videos unless there is a strong reason to keep them.

Quality may consider:

- views in context of publish age;
- engagement ratio;
- channel/source credibility;
- sufficient transcript/content depth;
- duplication;
- recency where relevant;
- relevance strength.

Quality is a gate/modifier, not a replacement for topical eligibility.

Exact thresholds may evolve from production data and must not silently override current Topic/Avoid rules.

---

### 4.2 Post-feedback queue refill

After **Interested**, **Not interested**, or **Next/Skip**, Discovery must transition directly to the next useful state.

Rules:

- if another ranked candidate already exists, show it;
- if the active queue becomes empty, automatically start a fresh Discovery refresh;
- do not show the generic empty-state placeholder as a transient state between two recommendation batches;
- the true empty state is reserved for an initial/unstarted Discovery or a completed refresh that genuinely found no usable candidates;
- while an automatic refresh is running, show one clear loading state only.

This prevents a handled recommendation from appearing to "erase" Discovery when the system is actually fetching the next batch.

### 4.3 Buffered Discovery queue

Discovery must not make the user wait for ranking/search after every feedback action.

Current buffer policy:

- **ready buffer target: 15 candidates**;
- **low-watermark: 6 candidates**;
- Interested / Not interested show acknowledgement for about **350 ms**, then advance to the next already-buffered candidate;
- neutral Next/Skip advances from the same buffer without taste reranking;
- Interested / Not interested feedback is persisted immediately, but reranking is **debounced for 2.5 seconds** so a rapid burst becomes one ranking pass over the latest feedback state;
- there is at most **one active rerank per user**;
- if new strong signals arrive while a rerank is already running, the current burst may perform at most **one catch-up rerank** after it finishes; further signals roll into the next debounced burst instead of creating an unbounded chain;
- ordinary search/refill does **not** run after every feedback click;
- when the client buffer reaches the **low-watermark (6)**, first sync from the server-side cached/ranked pool;
- when the ready queue reaches the **emergency watermark (2)**, refill is treated as priority work;
- only when the server-side ready queue is also low does Radar perform a fresh Discovery search;
- repeated Not interested feedback may trigger a broader refresh at the existing negative-feedback milestone rule.

UX invariant:

> feedback acknowledgement → next buffered card → ranking/refill under the hood

The active card must not jump when a background rerank finishes. The newly ranked queue should update behind the card the user is currently reading.

This policy balances:
- fast interaction;
- personalization after explicit feedback;
- lower search/API usage;
- enough reserve for slow provider/LLM responses.

### 4.4 Rapid-click and quota scenario

Example: a user rapidly clicks four cards in three seconds:

```
Interested
→ Interested
→ Not interested
→ Interested
```

Expected behavior:

1. each feedback action is persisted immediately and the next buffered card appears after the short acknowledgement;
2. the 2.5-second trailing debounce is reset by the burst, so Radar does **not** spend one ranking LLM call per click;
3. when the burst settles, one rerank uses the latest persisted positive/negative history;
4. if another signal arrives while that rerank is active, it is folded into at most one catch-up rerank;
5. the active card is not replaced; only the queue behind it is updated;
6. if the local queue reaches 6, Radar starts buffer maintenance in the background;
7. if the server-side queue is healthy, no fresh search is issued;
8. if the ready queue reaches 2, refill becomes priority work;
9. Skip/Next remains neutral and does not add a ranking LLM call.

### Quota / cost rationale

The buffer itself is cheap: keeping 15 ready candidates does not imply 15 new paid operations.

The main cost risks are:
- ranking LLM calls after strong feedback;
- fresh multi-source Discovery searches;
- ranking newly discovered candidates.

The policy limits those costs by:
- debouncing rapid strong-feedback bursts;
- allowing only one active rerank per user;
- allowing at most one catch-up rerank per active burst;
- reusing the server-side candidate pool before new search;
- starting fresh search only when the ready pool is actually low;
- keeping neutral Skip/Next outside taste reranking.

This means fast clicking should increase stored feedback signals, not linearly multiply LLM ranking calls.

## 5. Discover feedback semantics

### 5.1 Interesting

User meaning:

> **This is the kind of substance/taste I want more of.**

Immediate behavior:

1. save positive feedback with the current `tasteVersion`;
2. mark the candidate reviewed/seen;
3. remove it from the active queue;
4. update the current taste signal;
5. rerank remaining eligible candidates;
6. enqueue the liked source for deeper analysis;
7. show explicit feedback confirmation/transition before the next card.

The UI should visibly acknowledge the action, for example:

`✓ Учтено`

followed by the next recommendation.

**Important:** Interesting does not mean “create a script immediately”.

It means:

- train ranking positively;
- make this source eligible for deeper idea extraction.

### 5.2 Not interested

User meaning:

> **This recommendation is not useful to me.**

The negative reason should be explicit enough to avoid ambiguous training.

Supported reason semantics include:

- Not my topic;
- Too generic;
- Wrong presentation;
- Too shallow;
- Seen before.

The reason panel should be visually obvious. It must not appear as an easy-to-miss secondary change after the click.

### 5.3 Next / Skip

User meaning:

> **Move on. I am not giving a positive or negative taste signal.**

Rules:

- move to the next candidate;
- do not train positive/negative taste;
- do not send the source to deep analysis;
- navigation-only behavior must remain distinct from Not interested.

A skipped item should not immediately loop back as the next card in the same discovery session/queue.

Historical handling beyond the current queue should remain consistent with the personalization specification.

---

## 6. Interesting → deep analysis

The product must make this transition understandable.

Conceptual flow:

```
Discover source
    ↓
Interesting
    ↓
Positive feedback saved
    ↓
Taste signal updated
    ↓
Source queued for deep analysis
    ↓
Transcript/content analysis
    ↓
0..N content opportunities
    ↓
Ideas
```

Deep analysis should identify useful creative opportunities rather than simply clone the source.

An opportunity should preserve provenance back to the source video/post.

Minimum relationship:

- `sourceVideoId` or equivalent source identifier;
- source title;
- source platform;
- source thumbnail/URL when available.

The source may produce zero ideas if analysis finds nothing worthwhile.

---

## 7. Ideas

Ideas answers:

> **What should I create next?**

Ideas is an opportunity feed, not a script editor.

### 7.1 Main tabs

MVP:

- **All ideas**
- **From liked videos**
- **Saved**
- **Created**

**Created** means Ideas that have at least one generated output. It is a library filter, not a separate copy of the Idea. The full editing/publishing experience remains in the separate Scripts/Outputs workspace.

### 7.2 Idea provenance

Ideas created from Interested sources must clearly show their origin.

Example:

> **Based on a video you liked**  
> [thumbnail] Source title →

This is product-critical because the user should understand **why the idea appeared**.

### 7.3 Idea card

Default hierarchy:

- 16:9 source thumbnail;
- platform badge;
- match / NEW / topic metadata;
- Idea title;
- one concise thesis/core idea;
- source/author/date and available engagement metadata;
- compact existing-output summary when applicable;
- Recommended format;
- alternate enabled formats;
- collapsed **Why this idea?**;
- Save / overflow actions.

Hook, Why, Angle, Evidence and alternative-format reasoning live inside **Why this idea?** rather than competing with the title on the default card surface.

Actions:

- **Create {recommended format}** when that output does not exist;
- **Open {recommended format}** when it does exist;
- dropdown for Regenerate same format / Create another format;
- direct quick actions for alternate enabled formats;
- **Save**;
- **Skip idea** in overflow.

### 7.4 New ideas

Fresh opportunities created from liked sources receive a new/unread state such as:

- `isNew = true`

The UI may show a **New** badge until the opportunity is viewed/read according to the final read-state rule.

New opportunities are appended/ranked into the feed.

**Do not regenerate or destructively reshuffle the user's existing Saved ideas after every Interested click.**

### 7.5 Ideas status banner

Ideas should make background liked-source analysis visible.

#### Analyzing

Example:

> **Analyzing 2 videos you liked…**  
> New ideas will appear here when analysis is complete.

#### New ideas ready

Example:

> **3 new ideas from your interests**  
> We analyzed 2 videos you liked and found new opportunities.  
> **View new ideas**

#### Empty

If there are no liked-source ideas yet:

> **No ideas from your interests yet**  
> Find something interesting in Discover and we'll turn it into content opportunities.  
> **Go to Discover**

#### Partial/error

If one source fails but others succeed, successful ideas remain usable.

Example:

> **We couldn't analyze one video**  
> **Try again**

A single failed source must not block the whole Ideas page.

### 7.6 Ideas header and controls

Use one coherent library control system rather than several disconnected bars.

Tabs:
- All ideas;
- From liked videos;
- Saved;
- Created.

Toolbar:
- Search;
- Topic;
- Format;
- Sort: Match / Newest.

Do not add Source or Score filters in MVP.

Radar personalization is shown as a compact status card with:
- explicit preference-signal count;
- Interested / Not interested / Skip context;
- refresh recency;
- Refresh action;
- Train more action.

Tabs use a soft/underline active state rather than a black segmented pill.

### 7.7 “More ideas for you”

Do not add a second competing recommendation algorithm to the MVP Ideas page.

The main Ideas feed is already personalized.

A separate “More ideas for you” block is out of MVP unless it later has a clearly different product purpose.

---

## 8. Idea actions

### 8.1 Save

Save marks an opportunity as intentionally retained by the creator.

Rules:

- Saved ideas remain stable across future discovery refreshes;
- future Interested actions must not remove Saved ideas;
- Saved tab shows them explicitly.

### 8.2 Skip idea

Skipping an idea means:

> **I do not want this specific opportunity.**

It must not automatically mean:

> **I dislike the whole source topic.**

Therefore idea-level Skip is separate from Discover-level Not interested.

### 8.3 Generate script

Generate Script:

1. takes the selected opportunity as input;
2. creates a script;
3. preserves linkage to the originating idea/source where possible;
4. opens or offers **Open in Scripts** after generation.

Ideas does not become a full script editor.

---

## 9. Scripts

Scripts answers:

> **How exactly will I create/publish this content?**

Scripts may be:

- generated from an Idea;
- manually created.

Primary responsibilities:

- title;
- editable script content;
- script regeneration/rewrite where supported;
- publication platform;
- publication date/time;
- scheduling;
- archive/delete/export actions.

### 9.1 Publication state

Current product decision:

Selecting a publication **platform + date** is enough to treat the script as approved/scheduled for MVP.

Avoid unnecessary intermediate status complexity.

The scheduled card must remain visible after scheduling.

The user can edit publication details later, including after the original date has passed.

### 9.2 Editing

- Keep a single clear title-edit affordance.
- Script body remains editable.
- Avoid duplicated “Edit name” controls.
- Publication date/platform should remain easy to reach without unnecessary extra navigation.

### 9.3 More menu

Use a compact More / three-dot menu for secondary actions such as:

- Archive;
- Delete with confirmation;
- Export.

---

## 10. Calendar

Calendar answers:

> **When and where is my content scheduled?**

### 10.1 Calendar layout

Views:

- Week;
- Month.

Scheduled content cards should use:

- consistent height;
- consistent padding;
- aligned platform icon/time/title positions;
- truncation for long titles;
- no horizontal overflow.

Month-view event rows should remain visually aligned across adjacent days.

### 10.2 Platform icons

Do not use improvised social-network logos.

Brand icons are provided through `react-icons/si` where supported:

- Instagram;
- TikTok;
- YouTube;
- Telegram.

General UI icons remain in Lucide.

### 10.3 Drag and drop

Dragging a script to another calendar day changes **the date only** while preserving the existing publication time when one exists.

The local scheduling update should not fail merely because Google Calendar is disconnected.

Remote calendar sync is optional and secondary to the product's own schedule.

### 10.4 Upcoming

Upcoming shows future unpublished scheduled content.

Rules:

- exclude published items;
- show platform;
- date/time;
- title;
- scheduled status;
- Google indicator only when a remote event exists.

The overview version may show the first 3 upcoming items and link to Calendar for more.

### 10.5 Google Calendar

Google Calendar is an optional integration.

Rules:

- own product schedule is the source required for the UI;
- connecting Google Calendar must not be required to move items locally;
- rescheduling should PATCH/update an existing remote event where possible instead of destructive delete-then-create behavior;
- failed remote sync should be surfaced without losing the local schedule.

---

## 11. Overview / Today

Today is the user's operational home screen. It must answer four questions without duplicating whole product areas:

1. What changed since I last checked?
2. What needs my attention now?
3. What should I create next?
4. What is scheduled next?

Today is a **read-only persisted snapshot**. Loading Today must not trigger Discovery search, transcription, Radar Analysis or paid LLM work.

### 11.1 Refresh cadence

Data source:

`GET /api/radar/today?timeZone={browserTimeZone}`

Refresh rules:

- load once when the user enters Today;
- while Today remains visible, refresh the persisted snapshot every **60 seconds**;
- do not auto-refresh while the browser tab is hidden;
- navigating away and back triggers a fresh load;
- retry after an error performs the same persisted-data request;
- the Today refresh itself makes **no external provider / LLM calls**.

Therefore new Ideas appear on Today after their background Radar Analysis has already persisted them. Today does not create those Ideas itself.

### 11.2 Header

Header content:

- greeting based on local time;
- append user name when known;
- no redundant `Today` label in the page header;
- current local date;
- last snapshot update time.

The header must not include an ambiguous `Radar activity` CTA.

### 11.3 Summary metrics

Show four compact metrics:

1. **New ideas** — Radar Opportunities created in the last rolling 24 hours.
2. **Needs review** — latest Output lineages that are not reviewed, published or archived.
3. **Publications today** — scheduled, unpublished, non-archived Outputs whose scheduled date matches today in the user's browser time zone.
4. **Ideas ready to create** — non-dismissed Ideas that currently have no Output lineage.

These are counts only. Clicking through belongs in the content blocks below rather than turning every metric into a second navigation system.

### 11.4 Today's focus

Purpose:

> Show the smallest set of actions that will move the user's content workflow forward now.

Maximum: **2 items**.

Priority order:

1. Outputs needing review;
2. reviewed Outputs that are ready to schedule;
3. Ideas with no Output yet.

Within each group, newest relevant work comes first; Ideas inherit the ready-Idea ranking below.

CTA:

- Idea → Ideas, focused on that Idea;
- Output needing review / ready to schedule → Scripts/Outputs workspace focused on that Output.

Empty state:

- show a caught-up state;
- CTA → Ideas.

Today Focus is not a second backlog. It intentionally stays at two items.

### 11.5 Recommended next

Purpose:

> Show the best Ideas that are ready to turn into content.

Maximum: **3 Ideas**.

Source list:

- `RadarOpportunity`;
- same user's non-dismissed Ideas;
- only Ideas with **no existing Output lineage**.

Ordering:

1. `status=new` Ideas first;
2. then Saved Ideas without Outputs;
3. then higher relevance;
4. then newer creation time.

This means Today does not repeatedly recommend an Idea the user already turned into an Output.

Each card shows:

- source thumbnail when available;
- match;
- title;
- why Radar picked it;
- topic/source metadata.

CTA → open that exact Idea in Ideas.

If no ready Ideas exist, show an empty state with a route to Ideas / Radar rather than filling the block with already-produced content.

### 11.6 Upcoming

Purpose:

> Show the next scheduled content from the user's own Content Plan.

Source:

- latest Output lineages;
- `scheduledAt` exists;
- not published;
- not archived.

Ordering:

- ascending by `scheduledAt`.

Maximum on Today: **3 items**.

Each item shows:

- date;
- time;
- title;
- platform icon;
- Scheduled status.

If more than 3 exist, the header link should expose the total and navigate to Content Plan, e.g. `View all 7`.

Today does not require Google Calendar to populate Upcoming. The product's own schedule is the source of truth.

### 11.7 Improve your Radar

Purpose:

> Explain how much explicit taste feedback Radar has learned from and give one clear route to improve it.

Data:

- Interested count;
- Not interested count;
- Skip count.

Preference-signal count:

`Interested + Not interested`

Skip remains visible for behavioral context but is **not** counted as a taste-training signal.

Do not show an arbitrary completion percentage such as `14 / 20 = 70%`. Radar learning has no meaningful fixed completion target after onboarding.

CTA:

`Train Radar → Discover`

The plant/brain visual is supportive only; the behavioral counts are the meaningful state.

### 11.8 Data ownership

Today is assembled server-side from already persisted product records:

| Today block | Canonical source |
| --- | --- |
| New ideas | Radar Opportunities |
| Needs review | latest Output/Script lineages |
| Publications today | scheduled Output/Script lineages |
| Ideas ready to create | Opportunities minus Ideas with Outputs |
| Today's focus | prioritized Opportunities + Output states |
| Recommended next | ready Ideas |
| Upcoming | scheduled Outputs |
| Improve Radar | Discovery feedback/exposure state |

No client-side local list should invent a different ranking or count from the server Today snapshot.

### 11.9 Loading / error / partial states

Loading:

- keep the overview layout stable;
- do not invoke provider work;
- avoid replacing the whole product with a blocking full-screen loader when cached/previous snapshot can remain visible.

Error:

- show one clear retry action;
- retry only the Today snapshot.

Partial optional metadata:

- missing thumbnail → neutral visual placeholder;
- missing platform → generic platform presentation;
- no upcoming items → empty state + Content Plan CTA;
- no focus items → caught-up state;
- no recommended Ideas → empty state, do not backfill with already-produced Ideas.

### 11.10 Responsive layout

Desktop 1280 / 1440+:

- four summary metrics in one row;
- two main columns;
- first row: Today's focus + Recommended next;
- second row: Upcoming + Improve your Radar;
- paired blocks should visually align and stretch consistently where practical.

Tablet 768:

- summary metrics in two columns;
- content blocks stack or use safe two-column layout only where width permits;
- no clipped CTAs.

Mobile 375–390:

- one-column flow;
- summary metrics collapse cleanly;
- thumbnails/actions remain inside cards;
- no horizontal page scroll.

### 11.11 Product rule summary

`Today = persisted overview, not generation/search automation`

It refreshes frequently because the read is cheap, but the expensive work happens elsewhere:

`Discover → Interested → Radar Analysis → Idea persisted → Today sees it on next snapshot refresh`

and:

`Idea → Output → Schedule → Today Upcoming sees it on next snapshot refresh`


---

## 12. UX feedback and loading rules

User actions with meaningful state changes must not fail silently.

Required patterns:

- disable duplicate feedback submissions while one is in flight;
- clear stale error state after a successful new request;
- show explicit reason/details for failed Discovery runs where useful;
- distinguish loading, empty, partial and error states;
- avoid leaving an old recommendation visible together with a new error in a way that implies the stale card is current;
- use an obvious transition after Interesting / Not interested.

---

## 13. Concurrency

For expensive content-generation flows in MVP:

- allow only one active generation/run at a time where parallel execution is not safely supported;
- clearly disable or explain unavailable actions during the active run.

This avoids duplicate paid calls and confusing state.

---

## 14. Data relationships

Conceptual entities:

```
UserProfile
  └─ tasteVersion

DiscoveryCandidate
  ├─ rankedForTasteVersion
  ├─ eligible
  ├─ rankingScore
  └─ feedback

LikedSource
  └─ analysis state

Idea / Opportunity
  ├─ sourceVideoId / source reference
  ├─ isNew
  ├─ saved
  └─ skipped

Script
  ├─ idea/source linkage
  ├─ publicationPlatform
  ├─ scheduledAt
  ├─ publicationTimeZone
  ├─ calendarProvider
  ├─ calendarEventId
  └─ published/archive state
```

Exact storage schemas remain an engineering concern; the relationships above are product invariants.

---

## 15. State-machine summary

### Discovery candidate

```
unreviewed
  ├─ Interesting → reviewed + positive feedback + deep-analysis queue
  ├─ Not interested → reviewed + negative feedback/reason
  └─ Next → move forward, no taste training
```

### Liked source analysis

```
queued → analyzing → completed
                  └→ partial/failed → retry possible
```

### Idea

```
new/read
  ├─ Save
  ├─ Skip
  └─ Generate Script → Script
```

### Script

```
draft
  ↓ edit/generate
scheduled (platform + date)
  ↓
published

Secondary transitions: archive / delete / export / reschedule.
```

---

## 16. Product invariants

Unless intentionally changed in this document:

1. Current explicit Topics beat historical behavior.
2. Avoid is a hard boundary.
3. Next in Discover does not train taste.
4. Interesting is both a positive taste signal and an input to idea extraction.
5. Not interested and Next are different actions.
6. Idea Skip does not automatically create topic-level negative feedback.
7. Every liked-source Idea should retain provenance.
8. Existing Saved ideas are not destructively regenerated after new feedback.
9. Ideas answers “what should I create?”; Scripts answers “how will I create it?”.
10. Scheduling must work locally without Google Calendar.
11. Social brand marks should come from a proper icon source rather than improvised drawings.
12. All new client-facing UX must support RU/EN and responsive layouts.

---

## 17. Implementation status

### Implemented / substantially present

- My Radar profile and discovery personalization foundations;
- `tasteVersion` and ranking invalidation model;
- Discover feedback foundations;
- Calendar week/month views;
- schedule drag-and-drop;
- Upcoming filtering of published content;
- optional Google Calendar integration;
- aligned month-view event cards;
- branded social platform icons via `react-icons/si`;
- Scripts workspace and scheduling controls;
- RU/EN infrastructure.

### Product decisions agreed, implementation must be verified end-to-end

- Interesting visibly triggers deep analysis;
- liked-source provenance on Ideas;
- Ideas tabs: All / From liked videos / Saved / Created;
- Ideas analysis status banner;
- New idea unread state;
- partial/error analysis UX;
- preservation of Saved ideas while new ideas arrive;
- Idea Skip semantics;
- Generate Script → explicit transition/open in Scripts.

### Still requires production validation

See `docs/radar-e2e-audit.md` for the authenticated production smoke checklist.

---

## 18. Documentation ownership

When behavior changes:

- end-to-end UX/product lifecycle → update **this file**;
- ranking, taste signals, Topics/Avoid, queue eligibility → update `radar-personalization-model.md`;
- discovered defects / smoke results / QA evidence → update `radar-e2e-audit.md`;
- intentionally deferred engineering work → update `technical-debt.md`.

Do not leave important product behavior documented only in chat or code comments.


---

## 18. Monetization and usage

### 18.1 Product units

Discovery browsing/search is not the main customer-facing paid unit.

The primary paid value unit is **Radar Analysis**:

```
transcription/content extraction
  + deep analysis
  + idea extraction
```

A separate **AI Generation** quota covers:

- Generate Script;
- Regenerate Script;
- future generative features.

Exact Free/Paid limits remain TBD until unit economics are validated from telemetry.

### 18.2 Interested with quota

```
Interested
  → positive taste signal
  → seen
  → rerank Discovery
  → Radar Analysis queued
  → Ideas
```

### 18.3 Interested without quota

Quota exhaustion must not block taste learning.

```
Interested
  → positive taste signal
  → seen
  → rerank Discovery
  → waiting_for_analysis
```

The source remains available for later analysis after quota renewal/upgrade.

### 18.4 Cost telemetry

Server-side telemetry should preserve enough detail to calculate real unit economics:

- source duration/content size;
- transcript provider/model;
- analysis model/provider;
- free vs paid model usage;
- input/output tokens;
- stage duration;
- stage cost / estimated cost;
- quota charge;
- retry count;
- diagnostic reason;
- idempotency key where relevant.

Pricing and public plan limits must be based on actual usage telemetry, not assumptions.

---

## 19. Product change Definition of Done

For meaningful product changes:

**Decision → Product Spec → UX/UI → Backend/Data → Monetization → Regression → Marketing facts → Changelog**

A product change is incomplete if code changes but active documentation/regression expectations still describe the previous behavior.

When a decision changes:

1. update the active rule;
2. mark the old rule superseded in the changelog;
3. update regression coverage;
4. update customer-facing/marketing facts when behavior or plan value changes.

### Customer-facing facts for the current Radar flow

- **Discovery** finds relevant source content and learns from explicit user feedback.
- **Interested** improves personalization and makes the source eligible for Radar Analysis.
- **Radar Analysis** processes liked content into structured Ideas.
- **Ideas** is a personalized opportunity library with source provenance.
- **Scripts** turns selected Ideas into production-ready drafts.
- Free and paid plans differ primarily in expensive AI analysis/generation allowances, not ordinary Discovery browsing.

---

## 20. Change log

### 2026-09-23 — Interested → Ideas + monetization alignment

Changed:

- Interested, Not interested and Next/Skip are three distinct signals.
- Next/Skip is persisted as neutral exposure, not negative taste feedback.
- Interested immediately updates Radar taste and queues deeper analysis.
- exhausted Radar Analysis quota preserves the liked source for later processing rather than losing the preference signal.
- Ideas tabs are now All / From liked videos / Saved / Scripts.
- Ideas expose analysis progress, new-result state and source provenance.
- new idea batches do not destructively replace Saved/Scripted history.
- Radar Analysis and AI Generation are separate product usage units.
- documentation/regression/marketing facts are mandatory parts of product Definition of Done.

Superseded:

- treating Skip/Next as negative feedback;
- the earlier Ideas decision that excluded a Scripts lineage tab;
- silently rebuilding the Ideas library after each Interested action;
- pricing primarily around Discovery search count.


### 2026-09-23 — Discovery refill and loader cleanup

Changed:

- after Interested / Not interested, an exhausted candidate queue now automatically starts a fresh Discovery refresh;
- the generic "No recommendations yet" state is no longer intended as a transient post-feedback state;
- recommendation refresh UI uses one primary loading message instead of duplicating the same spinner/text in both status and disabled action controls.

Regression expectation:

- handle the last visible recommendation, leave Discover, return, and verify the app shows the next candidate or an active refresh state rather than an incorrect empty placeholder.


### 2026-09-23 — Buffered Discovery queue

Changed:

- established a 15-item ready Discovery buffer with a low-watermark of 6 and an emergency watermark of 2;
- Interested / Not interested no longer wait for synchronous LLM reranking before the next card is shown;
- strong feedback persists first, then reranking happens in background;
- the current card remains stable while a newly ranked tail is merged behind it;
- low-buffer refill first reuses the server-side candidate pool before issuing a fresh search;
- neutral Next/Skip consumes the buffer without becoming a taste signal;
- overlapping background ranking maintenance is serialized/coalesced per user.

Superseded:

- synchronous feedback → rerank → GET → next-card sequencing;
- fresh search/refill after every feedback action.


### 2026-09-23 — Rapid-click quota protection

Changed:

- Discovery ready buffer increased from 12 to 15;
- low-watermark increased from 4 to 6;
- added emergency watermark at 2;
- strong-feedback reranking now uses a 2.5-second trailing debounce;
- only one rerank can be active per user;
- feedback arriving during an active rerank can cause at most one catch-up rerank in that burst;
- further signals are folded into the next debounced burst;
- low-buffer handling reuses cached server candidates before fresh search;
- emergency buffer state prioritizes refill;
- Skip/Next remains neutral and does not schedule taste reranking.

Reason:

- protect fast-scrolling UX from hitting an empty queue;
- avoid turning rapid Interested / Not interested clicks into one ranking LLM call per click;
- keep search/ranking spend tied to actual queue depletion and meaningful feedback bursts rather than raw click count.

Superseded:

- 12 / 4 buffer thresholds;
- immediate background rerank scheduling after every strong feedback action.


## Content format semantics

### Meaning

`profile.contentFormats` defines the creator's **output formats** — the formats they want to publish/create in.

It does **not** define which source formats Discovery may search.

Product model:

- **Sources** → where Radar searches;
- **Topics** → what Radar searches about;
- **Preferred angles** → what kind of editorial thinking/treatment the creator prefers;
- **Goals** → why the creator is using Radar;
- **Content formats** → what the resulting Idea should become.

Examples of output formats:
- Short video;
- Long video / podcast;
- Article;
- Post.

### Multi-select behavior

Multiple Content formats may be selected.

A single Idea must not be duplicated once per selected format.

Instead, every new Radar Idea stores:

- `recommendedFormat` — exactly one best-fit output format from the creator's selected formats;
- `alternativeFormats` — optional 0–2 other selected formats that genuinely fit the same Idea.

Example:

```
Idea: Why protecting children from failure can reduce independence
Best format: Short video
Also works as: Article, Post
```

The Idea remains one entity with one source lineage.

### Generate Script behavior

When the user generates from an Idea:

1. the Idea's `recommendedFormat` is selected by default;
2. the user may override it with another format currently selected in My Radar;
3. the script-generation prompt receives that chosen output format explicitly;
4. the generated Script persists `outputFormat`;
5. generation guidance changes by output format.

Examples:
- Short video → roughly 45–75 second spoken script;
- Long video / podcast → structured long-form outline/draft;
- Article → structured long-form article draft;
- Post → concise social post.

Existing Ideas without `recommendedFormat` fall back to the first currently selected output format; if none is selected, the temporary backward-compatible default is `short_video`.

### Discovery isolation

Changing Content formats must not by itself change source discovery eligibility or force a Discovery rerank.

For an output-format-only edit in My Radar:
- persist the profile change;
- show a Save changes action rather than implying recommendations must be refreshed;
- do not launch Discovery refresh/reranking solely for that edit.

Discovery ranking/search should not use creator output format as a source constraint.

A YouTube video can generate an Article idea; an article can generate a Short video idea; source type and output type are separate dimensions.

### UX copy

My Radar → Content formats:

EN:
> Choose the formats you create. Radar will recommend the best format for each idea.

RU:
> Выберите форматы, в которых вы создаёте контент. Radar подберёт лучший формат для каждой идеи.

Idea cards show:
- Best format;
- optional alternative formats;
- a format selector before Generate Script when more than one output format is available.

### 2026-09-23 — Content formats redefined as outputs

Changed:

- Content formats are now explicitly creator output formats, not Discovery/source filters;
- multi-select remains supported;
- each Idea carries one recommended format and optional alternatives;
- one Idea is not cloned per output format;
- Generate Script inherits the Idea's recommended format by default;
- users can override generation to another selected output format;
- generated scripts persist their output format;
- Content format changes no longer participate in Discovery ranking-context invalidation.

Superseded:

- treating the first selected profile format as the script format for every Idea;
- ambiguous UX copy that could imply Content formats filter what Radar searches for.


## Ideas as reusable content seeds

### Product model

An **Idea** is a reusable content seed. It is not the same thing as a Script and must not be duplicated once per output format.

One Idea may simultaneously be:

- visible in the main Ideas library;
- Saved;
- based on a liked source;
- associated with zero, one or multiple Outputs.

Saved is an independent library state. Creating an output must not unsave the Idea, and saving an Idea must not remove or replace existing outputs.

### Ideas page information hierarchy

The default card surface should prioritize fast scanning:

1. NEW state when applicable;
2. match percentage;
3. topic/category;
4. Idea title;
5. one concise thesis/core idea;
6. compact Recommended format;
7. source provenance;
8. collapsed **Why this idea?** disclosure;
9. action row.

Hook, angle, evidence and alternative formats belong inside **Why this idea?** and should not compete with the Idea title/thesis on the default card surface.

### Ideas tabs and filters

Primary tabs:

- All ideas;
- From liked videos;
- Saved;
- Created.

`Created` is the user-facing library tab for Ideas with at least one generated output. It supersedes the temporary `Outputs` tab name; generated artifacts still use the internal/output terminology in data and downstream workspaces.

MVP filters:

- Topic;
- Format;
- Search;
- Sort: Match / Newest.

Do not add Source or Score filters to the MVP toolbar. Source remains provenance metadata, and match already has sorting.

### Create / Open / Regenerate semantics

If an Idea has no outputs:

`Create ▾`

The menu contains the user-enabled `profile.contentFormats`. The Idea's `recommendedFormat` is marked Recommended.

If an Idea already has output(s):

`Open {latest output}` + `Create another ▾`

The Idea may show a compact output count and output-format chips.

Within the Create menu:

- selecting a format with no existing output creates a new output lineage for that Idea;
- selecting a format that already exists means **Regenerate {format}** and creates a new version in the same format lineage;
- Regenerate never silently changes output format;
- creating another format never duplicates the Idea itself.

Lineage:

`Source → Idea → Output format lineage → Versions`

Example:

`Video → Idea A → Article v1 → Article v2`

and independently:

`Video → Idea A → Post v1`

### Visual direction

Use a calm **Slate + Sage** editorial system:

- neutral white cards on a soft slate/stone surface;
- slate typography/navigation;
- sage/teal primary Create actions;
- slate Open/existing-content actions;
- pale sage Recommended-format surfaces;
- neutral slate chips;
- minimal purple;
- avoid large black active blocks/buttons in Ideas;
- 16:9 source thumbnails above card content;
- responsive stacking on smaller widths.

### 2026-09-23 — Ideas / Outputs redesign

Changed:

- Ideas are modeled and presented as reusable content seeds;
- Scripts tab renamed to Outputs;
- Saved is independent from output/scripted state;
- one Idea can have multiple output-format lineages;
- card surface reduced to title + thesis + recommended format + provenance;
- Hook/Core Insight are no longer both shown as large always-visible blocks;
- Why this idea? holds secondary reasoning/evidence;
- separate format select next to Generate is removed;
- Create dropdown uses enabled user formats and marks Recommended;
- existing outputs show Open plus Create another;
- selecting an existing format means Regenerate same format;
- Topic + Format + Search added as the MVP Ideas filters;
- Source and Score filters intentionally omitted.

Superseded:

- mutually exclusive Saved vs Scripted Idea status in the client experience;
- one-script-per-Idea action model;
- Scripts tab as the primary representation of created Idea outputs;
- always-visible Hook + Core Insight blocks;
- separate format selector next to Generate Script.


## Admin product operations

Admin is an operations/analytics workspace, not a legacy automation settings page.

Primary Admin sections:

- Overview;
- Users;
- AI Usage;
- Product Analytics;
- LLM & Prompts;
- Infrastructure.

### Overview

Must answer:
- how many users exist and are active;
- how many Radar Analyses and AI Outputs are created;
- estimated AI spend and cost per active user;
- product funnel from Discover to Scheduled.

Period controls: 24h / 7d / 30d.

### Users

Per-user view includes:
- identity / owner id;
- created/last active;
- onboarding;
- product quota usage;
- Radar Analysis count;
- outputs;
- input/output/total AI tokens;
- estimated AI cost;
- Interested / Not interested / Skip;
- Ideas / Saved / Scheduled.

### AI Usage

Show:
- requests;
- input/output/total tokens;
- estimated cost;
- free vs paid;
- provider/model/tier;
- spend by operation;
- errors and fallbacks when telemetry is available.

### Product Analytics

Show:
- Discovery runs and recommendations found;
- Interested / Not interested / Skip counts and rates;
- Ideas created/saved;
- Outputs and regenerations;
- Scheduled;
- user funnel Discover → Interested → Ideas → Outputs → Scheduled.

### LLM & Prompts

Canonical behavior is documented in `docs/llm-prompt-observability.md`.

Admin exposes the runtime task registry: task, version, purpose, prompt source, task class, temperature/max tokens, output contract and fallback policy.

### Infrastructure

Technical provider/storage health lives here. API keys/secrets are never returned to the browser.

Legacy daily channel scheduling, legacy auto-process controls and Included AI/BYOK controls are removed from the primary Admin experience. Backend mechanisms are not deleted solely because the old Admin controls are removed.

### 2026-09-23 — Admin operations + LLM observability

Changed:
- Admin embedded legacy Settings UI replaced by operations dashboard;
- user/cost/token/product analytics derived server-side;
- LLM task registry exposed to Admin;
- successful and failed LLM route attempts gain explicit success/error telemetry;
- Prompt/eval source of truth added.



### Ideas visual parity / editorial card

Ideas now follow the editorial-card direction rather than the earlier text-heavy card.

Default hierarchy:

`source thumbnail → platform badge → match/new/topic metadata → title → one thesis → source/date → Recommended format → alternate formats → Why this idea? → Save/secondary actions`

Rules:

- Source thumbnail is a first-class visual anchor when available.
- Platform identity is shown as a compact badge on the thumbnail (for example YouTube icon + label).
- Thematic tags are not duplicated on the thumbnail; topic/category remains in the metadata row.
- Recommended format is a dedicated highlighted block, not only a chip.
- The recommended action is explicit:
  - no output yet → `Create {recommended format}`;
  - recommended output exists → `Open {recommended format}`.
- The adjacent dropdown exposes all enabled output formats and makes same-format regeneration explicit.
- Alternate enabled formats are also exposed as quick actions under the recommendation block so format choice does not depend on discovering the dropdown.
- Why this idea? is a full-width collapsed accordion. Hook, Why, Angle, Evidence and alternative-format reasoning live inside it.
- Existing output formats are summarized compactly; one Idea remains one card regardless of output count.

### New / Earlier Ideas

Do not add a permanent New tab.

Within **All ideas**, Ideas are visually grouped into:

- **New since your last visit** — currently represented by the existing `status=new` MVP signal;
- **Earlier ideas** — all other visible Ideas.

When new Ideas arrive during Radar analysis, show a compact banner such as:

`N new ideas from your latest Radar analysis`

The banner explains that the new section is separated below.

Current MVP limitation: `status=new` is not yet a true viewport/read-state. A future read-state should clear New based on actual user viewing rather than a coarse lifecycle status.

### 2026-09-23 — Ideas editorial visual parity pass

Changed:

- added source thumbnails and compact platform badges to Idea cards;
- rebuilt the visual hierarchy around title/thesis rather than dense analysis labels;
- made Recommended format a dedicated highlighted block;
- made recommended-format Create/Open action explicit;
- added direct quick actions for other enabled formats;
- kept dropdown access for regenerate / create-format actions;
- converted Why this idea? into a full-width accordion;
- grouped All ideas into New since your last visit / Earlier ideas;
- retained Topic + Format + Search + Sort as the MVP controls;
- intentionally did not add Source/Score filters from the exploratory mockup.


### 2026-09-23 — Today snapshot contract

Changed:

- Today now uses one server-side persisted snapshot instead of separately loading Today + Scripts + Discovery + source availability;
- Today loads on page entry and silently revalidates every 60 seconds only while visible;
- Today refresh performs no external/LLM work;
- summary metrics are New ideas / Needs review / Publications today / Ideas ready to create;
- Today's focus is capped at 2 prioritized actions;
- Recommended next is capped at 3 Ideas with no existing Outputs;
- Upcoming is capped at 3 scheduled items and exposes the total when more exist;
- Improve your Radar shows real feedback counts and removes the arbitrary percentage-to-20 progress model;
- Skip stays neutral and is not counted as a preference signal.

Superseded:

- using `new Discovery candidates` as a user-facing Today KPI;
- arbitrary Radar learning completion percentage;
- separately fetching Scripts/Discovery/source availability solely to assemble Today in the client;
- recommending already-produced Ideas as normal Today recommendations.


### 2026-09-24 — Ideas Slate + Sage library redesign

Changed:

- user-facing Ideas tab renamed from **Outputs** to **Created**;
- Created means Ideas with at least one generated output;
- Ideas tabs now use a calm underline/soft active state instead of a black active pill;
- Search + Topic + Format + Sort are consolidated into one toolbar;
- Source and Score filters remain intentionally absent;
- the old heavy Radar personalized row is replaced by a compact status card with real preference-signal counts, refresh recency, Refresh and Train more;
- source thumbnails now use a top **16:9** layout rather than aggressive side-by-side cropping;
- Ideas use the Slate + Sage palette: sage Create, slate Open, pale-sage recommendation surface, neutral secondary controls;
- Recommended format remains visible while taking less visual weight;
- quick alternate-format actions remain directly accessible;
- New / Earlier grouping remains inside the All ideas library;
- desktop and mobile navigation active states move away from large black blocks toward soft sage/slate states.

Superseded:

- user-facing `Outputs` tab name in Ideas;
- black active Ideas tab/sidebar treatment;
- black primary Create/Open styling in the Ideas library;
- split header controls across several unrelated rows;
- side-by-side YouTube thumbnails that crop source artwork aggressively.
