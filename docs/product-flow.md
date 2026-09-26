# Content Radar — Product Flow

Status: **working product specification**  
Owner: product + engineering  
Last updated: 2026-09-25  
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

The first commercial model is **Free + Pro**. The UI may preview the target model before billing is connected, but it must not claim those target limits are enforced until the backend plan catalog and subscription state use them.

Current target model for product design:

| Product quota | Free target | Pro target |
| --- | ---: | ---: |
| Radar Analysis | 20 / month | 300 / month |
| AI Generation | 5 / month | 100 / month |
| Transcriptions | 10 / month | 100 / month |
| Transcript minutes | 60 / month | 1,000 / month |
| Temporary publishing storage | 1 GB active | 10 GB active |
| Active scheduled publications | 5 | 100 |

The current beta account limits returned by `/api/quotas` remain the enforced source of truth until the plan backend is migrated. Provider quotas remain infrastructure diagnostics and are never presented as customer plan allowances.

Quota UX:

- below 80%: no interruption; full usage remains visible on **Plan & Quotas**;
- 80–99%: soft contextual warning near the relevant costly action plus a small sidebar attention state;
- 100%: block only the expensive action and explain reset/upgrade; ordinary navigation, saving and taste feedback continue;
- **Plan & Quotas** is a dedicated account/service destination, separate from the main content workflow navigation;
- the sidebar shows only compact plan status and remaining Radar Analysis capacity, not multiple progress bars.

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


## Discovery sources and output-format semantics

### My Radar chooses where to search

My Radar no longer asks the creator to pre-select output formats. Instead it stores `profile.discoverySources`.

Supported source choices:
- YouTube;
- Web;
- X when the adapter is actually available.

At least one source is required. The client prevents removing the last source and the server rejects an empty `discoverySources` list.

Source selection controls which Discovery adapters may run:
- Web only → no YouTube search calls;
- YouTube only → no Web Search calls;
- multiple sources → Radar may search each selected source.

Changing source selection changes the Discovery context and invalidates unhandled candidates. A disabled/unconfigured provider does not create fake availability.

### Output format is chosen at the Idea stage

Source type and output type are separate dimensions.

After source analysis, Radar selects:
- one `recommendedFormat`;
- zero to two `alternativeFormats`.

Supported output formats remain:
- Short video;
- Long video / podcast;
- Article;
- Post.

The recommendation is based on the specific Idea, not on a profile-level output preference and not on the medium of the source.

Examples:
- a compact thesis with a strong hook may recommend Short video;
- a nuanced argument with several evidence points may recommend Article;
- a broad structured discussion may recommend Long video / podcast;
- a concise observation may recommend Post.

### Create / generation behavior

The Idea's `recommendedFormat` is the default CTA and generation format.

The user may override it with any supported output format. My Radar does not restrict generation formats.

Choosing a format that already exists means Regenerate that format and creates a new version in the same output lineage. Creating another format creates another lineage under the same Idea; it never duplicates the Idea.

Legacy `profile.contentFormats` data may remain in stored profiles for backward compatibility, but it is not shown in My Radar, does not change tasteVersion, and does not affect Discovery planning/ranking or the default Idea CTA.

### 2026-09-24 superseding decision

This section supersedes the previous ordered Content formats / primary-format behavior.

Superseded:
- Content formats selection in My Radar;
- first selected format as primary/default;
- output format as a Discovery search/ranking signal;
- reranking Discovery when contentFormats changes;
- restricting recommended/override formats to selected profile formats.

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

The default CTA uses the Idea's `recommendedFormat` (falling back to Short video only for legacy Ideas without format metadata). The menu always contains every supported product output format. The Idea recommendation is marked Recommended.

If an Idea already has output(s):

`Open {latest output}` + `Create another ▾`

The Idea may show a compact output count and output-format chips.

Within the Create menu:

- all supported formats are always available, regardless of My Radar selection;
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
- Create dropdown uses all supported formats and marks the Idea's recommended format;
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

Do not show a second large banner above the New section.

Use one source of truth:

`New since your last visit · N · from your latest Radar analysis`

The section header itself carries the count/context; **Earlier ideas** remains the second section.

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


### 2026-09-24 — Ideas 3-column grid + Discover Similar content

Changed:

- Ideas library uses a responsive **3 / 2 / 1** grid:
  - wide/desktop: 3 cards per row;
  - tablet/medium: 2;
  - mobile: 1;
- Idea card typography and body copy are slightly denser so the library scans like a content opportunity grid rather than a large editorial feed;
- Discover thumbnail overlay now shows only the platform/source badge;
- topic chips were removed from the Discover thumbnail because **Key topics** is the canonical topic list for that candidate;
- Similar content now shows up to **5** items in its collapsed desktop state, producing a block height close to the primary media/info region;
- **Show all** appears only when more similar candidates exist than the collapsed visible capacity;
- Show all expands the same candidate list without duplication.

Superseded:

- two Ideas per row on wide desktop;
- duplicated Discover topic chips on the thumbnail;
- a fixed three-item Similar content preview regardless of available vertical space.


### 2026-09-24 — Primary format preference + single New section

Changed:

- My Radar content formats are now an **ordered preference list**;
- the first selected format is the primary/default Idea creation format;
- primary format influences Discovery planning/ranking as a strong soft signal;
- secondary selected formats influence Discovery more weakly;
- format preference never becomes a source-type restriction;
- reordering/changing content formats changes the Radar ranking context;
- Ideas Create dropdown always exposes all supported output formats, not only selected preferences;
- supported but unselected formats remain creatable;
- default Idea CTA follows the current primary My Radar format;
- the separate “N new ideas from your latest Radar analysis” banner was removed;
- New Ideas now have one section header with count and lightweight latest-analysis context.

Superseded:

- treating selected My Radar formats as generation permissions;
- blocking unselected but supported output formats;
- content-format changes being isolated from Discovery ranking;
- duplicate New banner + New section header messaging.


## Add source — Radar source model

The Add source modal belongs to Radar, not the legacy video-library workflow.

### Source types

The modal exposes two explicit YouTube paths:

**YouTube video**
- may be used as a personalization/reference signal;
- may be queued for Radar Analysis to create Ideas;
- these actions are independently selectable;
- Analyze for ideas consumes **1 Radar Analysis** when processing actually runs.

**YouTube channel**
- is a Discovery source;
- a sample of channel videos enters the candidate pool;
- candidates still must pass ACTIVE TOPICS, quality gate and ranking;
- adding a channel never bypasses relevance rules.

### Video actions

**Learn from this**
- persists the video as a Radar reference;
- adds a positive preference signal for that video;
- updates Radar taste context;
- may affect future Discovery planning/ranking.

**Analyze for ideas**
- ingests the video into the user's Radar corpus if needed;
- queues that exact source for Radar Analysis;
- does not require the source to be selected through the Discover UI first;
- can run without persisting a long-term taste/reference signal.

The two actions are distinct:

`reference/personalization ≠ analysis`

A user may choose one or both.

### Channel behavior

Current channel behavior:

`Channel → sample videos → candidate pool → topic eligibility → quality gate → ranking → recommendations`

Do not send every new channel video directly to transcription/LLM.

Automatic periodic channel checking is not exposed in the client until a safe background workflow exists.

### UI language

Do not expose legacy/internal implementation language such as:
- video library;
- convert to text;
- send to Gemini;
- provider/transcription details;
- automatic LLM processing of every new channel video.

User-facing language should describe product intent:
- Learn from this;
- Analyze for ideas;
- Use as Discovery source.

### 2026-09-24 — Add source redesign

Changed:
- replaced legacy tabs/copy with Video vs Channel product intent;
- moved modal to Slate + Sage styling;
- Video can independently Learn and/or Analyze;
- Analyze shows the 1 Radar Analysis quota hint;
- Channel is defined as a Discovery source rather than an auto-processing feed;
- old Gemini/transcription/video-library language removed from the popup;
- channel auto-check is not shown as a fake control.

Superseded:
- “video library” mental model;
- “convert to text and send to Gemini” copy;
- claim that adding a channel automatically sends every new upload into AI processing.


## Brand identity — Content Radar

The active customer-facing product name is **Content Radar**.

Legacy name **AI Content Funnel** is superseded and must not appear in active product UI, browser metadata or customer-facing product copy.

### Logo system

Chosen direction: **Radar Pulse**.

Primary mark:
- concentric radar rings;
- central signal point;
- directional sweep/needle;
- emerald/sage brand color.

Required surfaces:
- desktop sidebar lockup;
- mobile header;
- browser title;
- SVG favicon;
- future installed/PWA app icon when a manifest is introduced.

Primary lockup:

`[Radar Pulse] Content Radar`

Tagline:

`Find signals. Create what matters.`

The mark should stay simple enough to remain legible at favicon size.

### 2026-09-24 — Content Radar rebrand

Changed:
- product lockup renamed from AI Content Funnel to Content Radar;
- selected Radar Pulse as the canonical mark;
- desktop sidebar and mobile header use the same reusable brand component;
- browser title and metadata renamed to Content Radar;
- browser favicon replaced with Radar Pulse SVG;
- active tagline changed to “Find signals. Create what matters.”

Superseded:
- AI Content Funnel customer-facing name;
- “Find. Learn. Create. Grow.” tagline;
- generic sparkle mark as the product logo;
- legacy funnel-oriented browser metadata.


---

## 2026-09-24 — Web Search source + OpenAI paid fallback

Discovery now supports an optional **Web** adapter backed by OpenAI Web Search.

Rules:
- Web is a source alongside YouTube; it does not replace YouTube.
- Web candidates enter the same candidate pool, topic eligibility, quality gate, ranking, feedback and deduplication flow.
- Web Search is enabled only when the server has `OPENAI_API_KEY` and `OPENAI_WEB_SEARCH_ENABLED=true`.
- A missing/failed Web provider is a partial-source failure: other configured Discovery sources continue.
- OpenAI text generation is a separate LLM provider. It is paid-only in platform routing and is attempted only when paid fallback is explicitly enabled.
- Existing configured free/included providers remain first; existing Gemini paid order is preserved before OpenAI.
- Multimodal tasks remain on providers that support the current multimodal payload.
- API keys and provider errors are server-side only; client diagnostics may expose provider/model/reason codes but never secrets or raw provider response bodies.

Source type and output format remain independent: a creator preferring Article may receive a YouTube or Web source if it passes topic and quality rules.


## Provider quota observability

Admin → AI Usage is the operational source for external AI/search consumption.

The dashboard separates:
- local measured usage;
- published provider allowance;
- calculated remaining when the allowance is known;
- unknown remaining when the provider/project limit is dynamic or unavailable;
- free/included vs paid vs BYOK usage.

Web Search default cost order is:

`Google grounding → Tavily → Brave → OpenAI Web Search`

Google is first because the paid Gemini tier currently includes a monthly Search-grounding allowance. This allowance applies to Search requests only; Gemini model tokens may still be billable and must be reported separately.

Quota UI must never turn a published generic/base limit into a claim about an exact account balance. Rows based on local usage + public allowances are labeled estimated; exact provider balances are shown only when obtained from provider telemetry.


---

## 2026-09-24 — Admin RBAC, invite links and Ideas responsive layout

Access model:
- every authenticated account has exactly one role: `owner`, `admin` or `member`;
- the primary product owner remains `owner`;
- new authenticated users default to `member`;
- `owner` and `admin` may enter Admin workspace and call `/api/admin/*`;
- admin-management endpoints are a stricter subset and require `owner`;
- only `owner` can create/revoke admin invitations or promote/demote an account between `admin` and `member`;
- owner role cannot be assigned or removed through the admin-management API.

Admin invite contract:
- invite is bound to one normalized email address;
- raw token is returned once when the owner creates the invitation; only its SHA-256 hash is stored;
- expiry is configurable from 1 hour to 7 days;
- creating a new active invite for the same email revokes the earlier active invite;
- owner can revoke an unused invite;
- invite is single-use;
- after Firebase authentication, the invite-link token is accepted only when the authenticated email matches the invited email;
- successful acceptance upgrades that account to `admin` and marks the invite consumed.

Ideas layout:
- 390 px: one-column cards;
- 768 px: two-column Ideas grid and two-column filter controls;
- 1280 px and wider: three Ideas cards remain visible in one row when space allows;
- idea cards stretch to equal height within a row;
- Recommended format panels use one fixed equal-height compact layout;
- the primary action is only `Create` / `Open`, with a separate adjacent format dropdown;
- the dropdown defaults to the Radar-recommended format and can switch to any supported output format;
- the old `Create in another format` chip row and split-button menu are superseded;
- RU and EN labels/actions must stay inside the card without horizontal page overflow.


---

## 16. Provider quota visibility and transcription infrastructure — 2026-09-24

Provider quotas are infrastructure diagnostics, not customer-facing product data.

Client rules:
- ordinary clients see only product quotas that affect their plan/actions;
- Supadata / ChocoData / Gemini Audio provider balances, provider keys and fallback diagnostics are not shown in client Settings;
- if a provider restriction prevents a user action, the client receives a human-readable product error rather than raw provider quota details.

Admin rules:
- **Admin → AI Usage** contains the internal **Transcription providers** block;
- the active fallback chain is documented as `YouTube captions → Supadata → ChocoData → Gemini Audio`;
- Supadata may use its live account endpoint for provider-reported quota;
- ChocoData quota metadata is captured from real API responses when the response exposes used/limit/remaining data;
- provider-reported quota is labeled **Live**;
- when no provider-reported balance has been observed, local usage/error state is labeled **Estimated** or **Unknown** rather than inventing a balance;
- platform-provider usage is infrastructure-wide; BYOK state remains scoped to the owning user/key.

This is separate from product quotas such as Radar Analysis, AI Generation and transcription allowances.


---

## 17. Direct publishing foundation — 2026-09-24

Publishing is modeled as a shared multi-platform flow rather than one-off platform actions.

Current user flow:

```
Script
→ Publish
→ choose YouTube / Instagram / TikTok
→ attach media
→ platform-specific settings
→ PublicationJob
→ provider adapter
→ queued / uploading / processing / published / failed
```

### PublicationJob

Publication state is persisted separately from the Script so one Script can support multiple platform attempts without collapsing them into one global status.

Current states:
- draft;
- queued;
- uploading;
- processing;
- published;
- failed.

Publication jobs are owner-scoped and active attempts are deduplicated per Script + platform.

### YouTube

YouTube is the first live provider adapter.

- Google OAuth requests `youtube.readonly` + `youtube.upload`;
- the browser uploads the selected video through the YouTube Data API resumable upload flow;
- title, description, privacy, made-for-kids and synthetic-content disclosure are supported;
- future date/time uses YouTube scheduled publishing via `status.publishAt`;
- platform quota/rate-limit failures are converted into user-facing errors rather than exposing quota counters in Settings.

### Instagram / TikTok

Instagram and TikTok are already represented in the shared Publish modal and PublicationJob model.

Their OAuth / Direct Post adapters are **not active yet**. The UI must label them as the next adapter/API setup rather than pretending they are connected.

This is an implementation boundary, not a product redesign: future adapters plug into the same modal and PublicationJob lifecycle.

### Connections

Settings → Connections shows publishing destinations.

- YouTube can be connected for direct publishing.
- Instagram and TikTok show adapter/setup state until their OAuth integrations are active.
- Social-network API quota counters are not a normal client-facing setting.


---

## 18. Temporary publishing media storage — 2026-09-24

Decision:
- use **Firebase Storage / Google Cloud Storage** as the first temporary media store for publishing flows that cannot hand off immediately to the destination platform;
- maximum temporary media asset size in Content Radar = **400 MB**;
- this 400 MB limit applies to storage-backed Instagram/TikTok flows, not to direct YouTube uploads;
- YouTube continues to upload directly to YouTube and therefore does not consume temporary Firebase/GCS storage.

Storage behavior:
- browser uploads temporary media directly to Firebase Storage/GCS, not into the application database;
- objects are stored under an owner-scoped `publication-assets/{uid}/...` path;
- the application database should persist only a storage object reference / publication metadata when those adapters are wired;
- successful handoff should delete the temporary object;
- cancelled publication should delete the temporary object;
- failed publication may retain the temporary object only for a bounded retry window;
- lifecycle cleanup/TTL must be added before unattended scheduled Instagram/TikTok publishing is enabled.

Rationale:
- 400 MB comfortably covers the intended short-form workflow while bounding storage and transfer cost;
- long YouTube uploads should not be forced through our temporary storage merely to satisfy a product-wide file cap.


### 2026-09-24 — Temporary storage enforcement

The repository now contains the enforceable temporary-storage policy:
- Firebase Storage rules restrict `publication-assets/{uid}/...` to the authenticated owner;
- client uploads under that path are limited to video MIME types and **400 MB** maximum;
- object overwrite/update is denied; owner read/delete is allowed;
- production deployment applies a GCS lifecycle rule that deletes `publication-assets/` objects after **7 days**;
- production deployment disables GCS soft delete on this bucket so lifecycle/app deletes do not create an additional hidden retention window;
- deployment verifies the active lifecycle/soft-delete bucket configuration before continuing.

The 7-day lifecycle is the hard safety net. Normal successful/cancelled publication flows should delete temporary media earlier when the Instagram/TikTok adapters are enabled.


### 2026-09-24 — Plan & Quotas visual foundation

- Added a dedicated **Plan & Quotas** product section.
- Replaced the decorative sidebar usage card with a compact navigational status: current plan, remaining Radar Analysis allowance and an attention dot at warning/exhausted states.
- Added RU/EN quota workspace states for current beta usage, 80% soft-warning behavior and 100% exhaustion behavior.
- Added a clearly labeled Free/Pro target-model preview; billing is not connected and target plan limits are not yet enforced by subscription state.
- Provider quotas remain excluded from ordinary customer quota UI.

### 2026-09-24 — Contextual product quotas

Radar Analysis and Generate/Regenerate Script now show no contextual notice below 80%, a remaining allowance at 80–99%, and an action-only block at 100%. RU/EN copy gives the monthly UTC reset date and links to Plan & Quotas; billing remains unavailable and is not presented as a working upgrade. Interested persists feedback at exhaustion; Skip, saved Ideas, existing outputs and navigation remain available.

Client preflight refreshes the quota before an explicit expensive action. Server reservations admit work before transcription/article fetch/LLM calls and include in-flight work in available allowance. Successful work commits once; failure releases the reservation. Generate retries use a request identifier persisted with the result. Concurrent generation for the same Idea/format shares work. Web analysis records completion even when no Ideas are produced. Admin/owner receive the same allowances. Quotas refresh after actions and every five seconds while the affected view is visible, including background analysis.

Concurrency admission is process-local under the existing snapshot storage architecture; distributed transactions and crash recovery are tracked in technical debt.


### 2026-09-25 — Publish metadata, integrations and FullCalendar

- Discover source badges identify the source type (`Web` / `YouTube`); the actual web domain is rendered separately as secondary metadata.
- Web results without `og:image`/thumbnail use a consistent Globe/domain preview instead of an empty gray block. Similar content uses the same fallback rule.
- Product surfaces use the shared `PlatformIcon` for YouTube and the shared `CustomSelect` for dropdown controls.
- Publish metadata starts empty. YouTube uses **Title + Description**; Instagram/TikTok use **Caption**.
- Description/Caption can be entered manually or generated through the explicit **AI Generation** action. AI output includes editable copy + hashtags and is never regenerated or overwritten as a side effect of editing/publishing.
- Publication metadata generation uses the existing `scriptGenerations` / AI Generation product quota. A request id is used for retry idempotency; the latest successful result for that request is cached on the script.
- Calendar, Integrations/Settings and Publish derive connection state from the same user-scoped OAuth token state and receive connection-change events, replacing screen-specific Calendar connection flags.
- Calendar uses FullCalendar with Month and Week views. Drag-and-drop updates the existing Content Radar schedule through the current schedule endpoint and does not require Google Calendar sync.
- Existing scheduling fields and the Scripts → Calendar flow remain the source of truth; Google Calendar stays an optional integration.


### 2026-09-25 — Google OAuth scope isolation

- Google Docs, Calendar and YouTube connect flows request only their own integration scopes; incremental `include_granted_scopes` merging is disabled so a previous Drive grant is not silently combined with a later YouTube authorization request.
- YouTube connection state is invalidated through the shared integration-state event. Integrations and Publish re-read the active YouTube channel when that state revision changes, so connecting/reconnecting on one surface propagates to the other without a page reload.
- Firebase sign-in identity remains separate from the optional Google product integrations.


### 2026-09-25 — Three-step publishing and publication-centric calendar

Publishing is now modeled as a three-step flow:

1. **Platform & media**
   - select one or more target platforms;
   - attach the video;
   - optionally attach a Cover / Thumbnail;
   - YouTube may upload a custom thumbnail after the video upload;
   - Instagram/TikTok remain adapter-pending but can already be represented as publication plans.

2. **Content adaptation**
   - publishing copy starts empty instead of copying the Script body;
   - multi-platform publishing supports a shared Base content plus per-platform overrides;
   - YouTube exposes Title + Description + YouTube-only visibility/kids/synthetic-content fields;
   - Instagram and TikTok expose Caption rather than a YouTube-style title;
   - AI adaptation remains an explicit AI Generation action and generated text stays editable.

3. **Schedule & publish**
   - multi-platform plans can use one date/time for all targets or separate dates/times per platform;
   - timezone is stored with the publication;
   - one Script can now have multiple PublicationJob records representing separate platform publications.

PublicationJob is the calendar-facing entity. It stores platform metadata, schedule, media/thumbnail metadata, provider status and remote URL/ID where available. Legacy Script schedules remain visible when they do not yet have a PublicationJob.

Calendar event clicks open **Publication Details** first instead of jumping directly to the Script. From that modal users can edit/reschedule, unschedule, open the Script, open/copy a provider link when available, or delete the publication plan.

The existing FullCalendar engine is retained for MVP behavior, but the presentation layer is customized with soft platform-aware event tints, an All platforms filter, custom event cards, drag-and-drop of the individual PublicationJob, and the built-in +N more day popover when a month cell contains many publications.

All user-facing dropdowns use the shared portal-based CustomSelect. Opening a dropdown never changes parent layout dimensions; the menu is positioned as a fixed overlay and may flip above the trigger when viewport space is limited.


### 2026-09-25 — Instagram and TikTok direct publishing

Instagram and TikTok are now real publishing integrations rather than placeholder adapters.

#### Canonical integration state
- Instagram and TikTok OAuth connections are owner-scoped and stored server-side.
- Provider access/refresh tokens are encrypted at rest and are never exposed back to the client.
- Integrations and Publish read the same canonical connection state and refresh through the shared integration-state event.
- OAuth callbacks are public callback routes, while start/status/disconnect endpoints remain Firebase-authenticated.

#### Instagram
- The app uses Instagram Login scopes `instagram_business_basic` and `instagram_business_content_publish`.
- Direct publishing targets Professional accounts (Business/Creator).
- Reels publishing creates a media container from a short-lived public video URL, waits for container processing to reach `FINISHED`, and then calls `media_publish`.
- The provider permalink is fetched after a successful publish when available.
- Caption and `share_to_feed` are platform-specific metadata.
- Scheduled Instagram posts are queued in Content Radar and released by the server scheduler at the requested time rather than relying on a provider-native scheduling API.

#### TikTok
- OAuth requests `user.info.basic` and `video.publish`.
- Before presenting posting settings, Content Radar queries `creator_info/query` and uses the returned privacy and interaction capabilities.
- Direct Post uses `video/init` with `FILE_UPLOAD`, followed by sequential upload chunks.
- After upload the PublicationJob remains `processing`; the scheduler polls `status/fetch` until TikTok reports `PUBLISH_COMPLETE` or `FAILED`.
- Until `TIKTOK_AUDITED=true`, Content Radar deliberately restricts privacy to `SELF_ONLY`.
- TikTok-specific metadata includes privacy, comments/Duet/Stitch controls, AI-content disclosure, paid partnership and own-business promotion toggles.

#### Temporary media
- Instagram/TikTok media is uploaded from the browser to owner-scoped temporary Firebase/GCS objects through short-lived signed PUT URLs.
- The server generates a short-lived signed read URL for Instagram or streams owner-scoped ranges to TikTok.
- Temporary video objects are removed after provider handoff and when a PublicationJob is deleted.
- Cover/Thumbnail remains a shared publishing asset. YouTube currently sends it through the YouTube thumbnail API; Instagram/TikTok cover semantics are provider-specific and are not mapped to unsupported fields.

#### Required runtime configuration
- `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, optional `INSTAGRAM_GRAPH_VERSION`.
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_AUDITED`.
- `FIREBASE_STORAGE_BUCKET` plus runtime permissions to create signed V4 URLs and read/write/delete temporary publication objects.
- Exact OAuth redirect URIs derive from `APP_URL`:
  - `${APP_URL}/api/oauth/instagram/callback`
  - `${APP_URL}/api/oauth/tiktok/callback`


### 2026-09-25 — Network recovery and integration validation

Content Radar now treats browser connectivity as a product state rather than exposing raw `Failed to fetch` errors.

- A global RU/EN offline banner appears when `navigator.onLine` becomes false.
- Existing on-screen data remains visible while online actions are unavailable.
- When connectivity returns, the banner confirms recovery and the app refreshes current data.
- Background polling pauses while the tab is hidden or the browser reports offline.
- Returning to a tab after a longer sleep refreshes the Firebase ID token and current application data.
- A root React Error Boundary replaces blank/grey render failures with an explicit reload fallback and technical detail expander.

YouTube connection state is now validated against the YouTube Data API rather than inferred from token presence alone.

- A cached OAuth token is not enough to show `CONNECTED`.
- If channel validation returns HTTP 401/403 or insufficient YouTube scopes, the cached publishing token is cleared.
- The integration card switches back to Not connected and Reconnect requests fresh consent for `youtube.readonly` + `youtube.upload`.
- Scope failures surface an actionable RU/EN explanation rather than leaving a contradictory green Connected state.


### 2026-09-25 — Compact Content plan week density

The Content plan keeps FullCalendar but its Week view now uses a bounded, denser layout inspired by Google Calendar's compact/comfortable density model.

- Week view is capped to a 620px calendar viewport instead of expanding the page for every visible hour.
- The time grid uses 30-minute slots with labels once per hour.
- The default working window is 07:00–22:00 and initially scrolls to 08:00.
- Slot rows, all-day area, date header and publication cards use tighter spacing.
- Current-time indication remains visible.
- Month view keeps its natural height and existing +N-more behavior.
- On narrow screens the calendar may still scroll horizontally inside its own shell rather than widening the page.


### 2026-09-25 — Connected YouTube card action hierarchy

A valid YouTube connection no longer keeps a primary `Reconnect` button visible.

- Connected state shows the validated channel identity and a low-emphasis `Change account` action.
- Disconnected/invalid-scope state shows the primary `Connect` action.
- Scope validation remains authoritative: if the YouTube Data API rejects the cached token, the token is cleared and the card returns to Not connected.


### 2026-09-25 — Lighter action hierarchy and workspace density

The main product surfaces now use Radar green for primary actions and soft mint selection states instead of heavy black filled controls.

- Black is reserved for text, media backgrounds and small neutral indicators rather than primary CTA buttons.
- Discover/Radar setup, Scripts, Calendar view selection, Settings tabs and Publish actions use the shared emerald action hierarchy.
- Platform branding stays independent from selection state. In Radar source selection the YouTube icon remains a red YouTube mark on a neutral badge while the selected source card uses the Radar mint/green state.
- Ideas learning summary is a single horizontal desktop composition: brain icon, learned-signal summary, compact signal stats and Refresh/Train actions. The separate "updated now" text row was removed.
- Settings → General presents Language as one compact settings row with a right-aligned RU/EN segmented control instead of a large standalone card.
- Today’s focus no longer numbers actions or repeats the item count in a badge/subtitle. Priority is expressed by ordering.
- Plan & Quotas keeps the same limits and semantics but reduces card padding, vertical gaps and explanatory surface area so the important usage state fits in substantially less vertical space.


### 2026-09-25 — Scripts 2.0: library + focused work surface

Scripts is now split into two responsibilities:

- **Library** — browse and manage the workflow.
- **Editor work surface** — work on one script without the library competing for scroll/focus.

Library:
- default **Board** view with Needs review / Approved / Scheduled / Published columns;
- optional **List** view keeps dense filtering for larger libraries;
- cards are compact and focus on thumbnail, title, duration, platform and status;
- Board cards support drag-and-drop status movement;
- dropping an unscheduled script into Scheduled opens its Publication workspace so a real date/time can be chosen instead of silently fabricating one.

Editor:
- clicking any library card opens a large modal work surface (~94vh) over the library;
- background document scroll is locked while the editor is open;
- header contains title/version/status context plus Copy / Publish / Close actions;
- tabs separate Script, Media, Publication and History;
- Script uses its own scroll/edit area and remains the primary working surface;
- Publication contains schedule/platform/Google Calendar controls and entry into the shared Publish flow;
- History contains versions and feedback;
- a fixed right details rail contains lifecycle status, version/source/platform/schedule metadata, supported AI actions, Archive and Delete.

The previous desktop split layout (library on the left + sticky script detail on the right) is removed. Library and editor no longer share the same page scroll.


### 2026-09-25 — Scripts work surface refinement

Scripts keeps the Board/List library + focused editor model, but the editor is now more document-like and publishing no longer opens a second modal.

- Script title and body are directly editable by clicking the visible text.
- The separate Edit button is removed from the primary Script reading flow.
- Switching away from Script with unsaved text opens a three-choice guard: Save & continue / Continue without saving / Cancel.
- The header-level Publish button is removed. Publication is a dedicated editor tab.
- The shared three-step publication workflow is embedded directly inside the Publication tab, so Media → platform adaptation → schedule/publish remains in the same work surface.
- AI tools contain only AI transformations. Approve remains a workflow/status action in Script details rather than an AI action.
- Improve script requires an explanatory confirmation before spending quota; it states that a new version will be created, the current version remains in History, and 1 AI Generation is used.
- Manual New script creation also has an explanatory confirmation describing that it creates a standalone manual script without AI generation or Idea linkage.
- Google Calendar is no longer a per-script opt-in control. Existing scheduling code treats a valid Calendar connection as the sync preference; when Calendar is not connected, Content Radar scheduling continues independently.


### 2026-09-25 — Radar source media and label standard

Discover, Ideas and Today now use one source-media rule:

- source preview geometry is 16:9;
- valid images use `object-cover` inside that fixed geometry;
- missing **or broken** Web images fall back to the same neutral Web article preview with Globe icon + domain + `Web article`;
- missing/broken YouTube images use a branded YouTube fallback rather than an empty grey rectangle;
- Similar content uses the same fallback behavior instead of its own special-case thumbnail treatment.

Source and destination semantics are also separated:

- `YouTube`, `Web`, `X` on Radar findings mean **where the source material came from**;
- Ideas/Discover badges now say `Source · YouTube` / `Источник · Web` explicitly;
- Today recommendation tags use the same explicit Source prefix;
- recommended output format remains a separate product concept and does not imply that a social destination was selected;
- publication-platform badges only become destination semantics after the user configures/creates a script publication.


### 2026-09-25 — Single-screen Publication and platform-neutral Scripts

This decision **supersedes the earlier three-step publishing UI** while preserving the same PublicationJob backend model.

#### Scroll model
- the Script work surface has one vertical scroll region below its fixed header/tabs;
- Script content and the right details rail move inside that single scroll context;
- the right rail no longer has its own vertical scrollbar;
- embedded Publication does not create a second vertical scrolling viewport;
- standalone Publication may use one modal-level scroll when the viewport is too small.

#### Publication UI
- the 1/2/3 wizard and step progress indicator are removed;
- platform selection uses compact multi-select chips rather than large platform cards;
- Media, copy/settings and schedule are visible in one desktop workspace;
- platform-specific copy/settings use compact Base / YouTube / Instagram / TikTok tabs only when multiple platforms are selected;
- the bottom action is contextual: Publish now, Schedule or Save changes.

#### Persistent publication state
- the Publication tab loads existing PublicationJobs for the Script and reuses the existing job for each platform instead of creating a duplicate on retry/edit;
- existing jobs hydrate selected platforms, copy and schedules;
- upload/publish failure keeps the form, selected platform, media file in the current browser session and entered metadata intact;
- failure shows Retry and reconnect action when connection is the problem;
- success/failure/progress remains visible as per-platform Publication status: Draft / Uploading / Processing / Scheduled / Published / Failed;
- after submit the Script editor does not refresh/remount the Publication tab, so it does not jump back to an initial state;
- provider URL is shown when available.

#### Script vs Publication semantics
- a Script is platform-neutral;
- legacy `publicationPlatform` is no longer rendered as a Script tag or Script detail;
- destination platform belongs to PublicationJob and appears only inside Publication/Calendar publication surfaces;
- script cards no longer show the legacy platform badge.

#### Versions
- History is renamed **Versions / Версии**;
- versions are rendered as a chronological version timeline/card list with Current marker, origin, timestamp, size and content preview;
- older versions can be restored as a **new** version, preserving immutable history;
- Radar feedback is separated below version history instead of being mixed with version selection.

#### Rare actions
- Archive / Restore and Delete move under the header **More / Ещё** menu instead of occupying permanent space in the right rail.


### 2026-09-25 — Canonical Script cover

A cover selected in Publication is no longer a one-off provider upload.

- Choosing a Cover/Thumbnail immediately saves it as the persistent cover of the Script lineage.
- Persistent covers live under owner-scoped `script-covers/{ownerId}/{scriptId}/...` storage, separate from temporary publication media and its cleanup lifecycle.
- The Script stores the persistent object reference; API reads hydrate a fresh signed image URL.
- Replacing a cover removes the previous persistent object after the new reference is saved.
- All versions in the same Script lineage inherit the same canonical cover reference.
- The active editor updates immediately after upload, without waiting for a successful social publish.
- Script library cards, Media, Publication, Today/Focus, Today/Upcoming and calendar/script surfaces that consume `script.thumbnail` use the canonical cover.
- Idea/Discover source imagery remains source imagery and is not overwritten by the Script cover.
- YouTube still receives the selected image through its native thumbnail upload API; this is in addition to saving the Script cover in Content Radar.


### 2026-09-25 — Cover priority + Publication-owned Google Calendar sync

- Content plan / Upcoming / Publication details must prefer the canonical `script.thumbnail` over a YouTube-generated `hqdefault` image. YouTube thumbnails are only a fallback when no Script cover exists.
- A persisted Script cover can be downloaded through the authenticated app and reused as the YouTube custom thumbnail even after the original local file object is gone.
- PublicationJob owns Google Calendar synchronization. It stores `calendarId`, `calendarEventId` and `calendarEventUrl`.
- When Google Calendar is connected, scheduling/editing a Publication automatically creates or updates its Calendar event. There is no per-publication sync checkbox.
- Dragging a publication in Content plan updates the corresponding Google Calendar event.
- Unscheduling/deleting a publication removes its Google Calendar event when possible.
- Native Google Calendar event cards do not support arbitrary Content Radar cover art as a visual event thumbnail through the Calendar API. We sync event metadata/link, while the cover remains visible in Content Radar.


### 2026-09-25 — Script editor metadata cleanup + manual-script tabs

- Script version metadata is no longer duplicated in the editor header or Script details rail. Version information lives in **Versions / Версии**, where the version history is actionable.
- Header utility actions **Copy** and **More / Ещё** use compact controls aligned with the title/header content instead of occupying a separate high row.
- **Media / Медиа** is a source-material surface, not a publication-upload surface. It is shown only when the Script has real source lineage/material (Radar opportunity, source video ids/titles, or equivalent source detail). A standalone manual Script therefore uses **Script → Publication → Versions**.
- Embedded Publication begins directly with platform/content controls; its duplicate Publication title/subtitle is hidden. The title/subtitle remain available when Publication is opened as a standalone modal.
- Production Cloud Run receives `FIREBASE_STORAGE_BUCKET` from the configured Firebase Storage bucket variable so persistent Script cover and publication-media signed URL operations use the same configured bucket as the client.


### 2026-09-25 — Create Script from a creator thought

The New Script flow now has two explicit entry points:

- **Write manually / Написать самому** — the creator supplies title + script text; no AI quota is consumed.
- **Create with AI / Создать с AI** — the creator supplies a thought/brief (title optional); Content Radar generates a complete editable short-form script.

Quota semantics:
- Create with AI consumes **1 AI Generation** (`scriptGenerations`).
- It does **not** consume Radar Analysis because no external source content is being analyzed.
- The request is idempotent by generation request id so a retry does not create an uncontrolled duplicate.
- The original creator thought is persisted as `sourcePrompt` and remains available as provenance.

Script provenance is explicit for new records:
- `manual` — written directly by the creator;
- `ai_prompt` — generated from the creator's thought;
- `radar_idea` — generated from a Radar Idea;
- `source_content` — reserved for direct source-content workflows.

Manual edits/version creation continue to preserve the lineage/provenance of the Script. AI generation creates a new Script and does not overwrite the creator thought.


### 2026-09-25 — Workflow status is independent from publication scheduling

The Scripts board is a workflow surface, not a publication constraint.

- A Script can be moved freely between **Needs review / Approved / Scheduled / Published**.
- Moving a card to **Scheduled** does **not** require a date, platform, PublicationJob or Calendar event.
- `workflowStatus` is the board/status source of truth for new records. Legacy Scripts fall back to their previous lifecycle fields until they are touched.
- A real Publication schedule remains separate in `scheduledAt` / PublicationJob.
- Creating a real schedule moves the workflow status to Scheduled; a successful provider publication moves it to Published.
- Moving workflow status never requires opening Publication and does not clear an existing publication date merely because the user moved the card.

### 2026-09-25 — Publication upload UX + signed URL runtime identity

- Video and Cover use equal-height upload zones.
- The whole upload zone is clickable and has a pointer/hover state; native browser file-input chrome is visually hidden.
- The Cloud Run runtime service account must be able to create V4 signed URLs and access objects in the Firebase Storage bucket.
- Deployment grants the runtime identity `roles/iam.serviceAccountTokenCreator` on itself and `roles/storage.objectAdmin` on the configured bucket.
- Missing IAM is treated as a deployment/configuration failure, not hidden behind a client fallback.

### 2026-09-25 — Script board/editor density cleanup

- Board cards use a neutral explicit border/shadow instead of the browser/current-color dark outline.
- Board cards have consistent compact height so columns remain visually aligned regardless of title length or missing thumbnails.
- Script editor Copy/More actions live in the title row instead of floating far away from Save title.


### 2026-09-25 — Script cover / small asset upload no longer depends on signBlob

Persistent Script covers and small publication thumbnails now upload through the authenticated Content Radar backend:

- the client sends the binary file directly to an authenticated API route;
- the server validates owner, MIME type and size before writing to Firebase Storage;
- no V4 signed write URL is required for Script covers or thumbnails;
- persistent Script covers receive a Firebase download token in object metadata so existing image surfaces can render the same canonical cover without `iam.serviceAccounts.signBlob`;
- YouTube thumbnail reuse still downloads the private object through the authenticated backend endpoint;
- the deploy pipeline no longer attempts to enable IAM API or grant Service Account Token Creator just for cover uploads.

Large social video uploads remain a separate large-file path and are not routed through the backend request body. This keeps the small-asset fix safe for Cloud Run limits while leaving large resumable/direct-upload architecture as a separate product/infrastructure task.


### 2026-09-25 — Firestore normalized persistence v2

Production storage no longer uses the chunked `_ai_content_funnel_state/current/chunks` snapshot as the active write model.

The active Firestore schema is entity-based:

- `users`, `adminInvites`, `channels`, `videos`, `deletedVideos`;
- `appSettings` + `userSettings`;
- `scripts` for lineage roots and `scriptVersions` for child versions;
- `promptTemplates`, `logs`, provider/LLM usage-log collections;
- `transcriptCache`;
- `userQuotas`, `radarProfiles`;
- Radar opportunities, scans, discovery runs/candidates/feedback/exposures/references/subscriptions/script feedback;
- `publicationJobs`;
- `socialIntegrations`.

Migration behavior:
- on startup, Content Radar first looks for normalized-v2 metadata;
- if normalized-v2 is absent but the legacy chunk snapshot exists, it reads the legacy snapshot, writes all normalized entities, reads them back, and verifies the normalized digest before switching the process to normalized persistence;
- the legacy snapshot is retained as a rollback source during the transition but is no longer rewritten;
- a fresh Firestore project initializes directly in normalized-v2.

Write behavior:
- the server keeps its current in-memory domain model for compatibility with existing product code;
- persistence converts that model into deterministic entity documents;
- fingerprints are tracked per document, so `saveDb()` writes only changed/new entity documents and explicit deletions instead of rewriting the full database;
- Firestore batches are capped below the 500-write platform limit.

This is the production source of truth for new writes. The legacy snapshot remains read-only fallback/rollback data until a later cleanup task removes it after sufficient production confidence.


### 2026-09-25 — Admin Firestore diagnostics

Admin → Infrastructure → Storage exposes the current persistence state without requiring DevTools.

The card shows:
- active storage mode and Firestore database;
- active schema format (`normalized-v2` when migration is complete);
- persisted entity count;
- read health + sync health;
- retained legacy snapshot status;
- active chunk count (expected `0` for normalized-v2);
- last backend storage error when present;
- manual Refresh action for re-reading `/api/admin/storage-status`.

This surface is diagnostic only; it does not expose secrets or allow destructive storage actions.


### 2026-09-26 — Infrastructure Diagnostics v2

Admin → Infrastructure is now an operational health surface instead of a storage-only card.

System Health summarizes:
- Storage
- AI
- Search
- Transcription
- Publishing
- Queue
- Integrations
- Data integrity

The backend endpoint `/api/admin/infrastructure-diagnostics` aggregates server-side state only and does not return secrets.

Diagnostics include:
- normalized Firestore schema, entity count, logical collection counts, migration state, legacy fallback retention and retirement readiness;
- pending/active queue counts, stuck video processing, stuck publication jobs, 24h publication/Discovery/Radar failures and latest run timestamps;
- LLM/Search/Transcription requests and failures over 24h, paid AI calls, configured providers and source availability;
- Instagram/TikTok OAuth configuration plus connection/expiry counts;
- Google Calendar is explicitly marked as client-session scoped because its OAuth state is not centrally persisted;
- data integrity checks for orphan Script versions, PublicationJobs without Scripts, missing owners/sources, invalid feedback references, duplicate IDs and published records missing timestamps;
- workflow-only Scheduled without a publication date is surfaced separately and is not considered an integrity error.

Health states are `healthy`, `attention`, or `unavailable`. The Refresh action re-runs both storage and infrastructure diagnostics.


### 2026-09-26 — Frontend deploy shell hardening

Production no longer serves `index.html` as a fallback for missing `/assets/*` requests.

This prevents a stale HTML shell from requesting an old hashed Vite bundle and receiving `text/html`, which previously produced a browser module MIME error and a blank/gray screen after deploy.

Production behavior:
- hashed `/assets/*` files are cacheable as immutable;
- missing `/assets/*` return a real 404 text response, never the SPA shell;
- `index.html` is served with `no-store, no-cache, must-revalidate`;
- the HTML shell contains a one-time stale-asset recovery handler that reloads with a cache-busting query when a module asset fails to load;
- deploy smoke validates JavaScript by HTTP status + Content-Type and only treats a response as HTML when the response starts with an HTML document marker; this avoids false positives from valid bundles that contain HTML strings internally;
- if the same missing asset fails twice in one session, the page shows a visible refresh message instead of staying blank.

Deployment smoke now checks both `/api/health` and the actual hashed frontend JS referenced by candidate `index.html`, including its JavaScript Content-Type.


### 2026-09-26 — Unicode media filenames + Google Calendar diagnostics

Publication cover/thumbnail uploads now encode the original filename before placing it in the `X-File-Name` HTTP header. This keeps non-Latin filenames (for example Cyrillic) within the browser header character constraints. The backend decodes the header before storage, preserving the original user-visible filename semantics.

Google Calendar remains client-token based, but operational observability is now server-side:
- client reports `connect success / failed / cancelled`;
- Calendar API network/HTTP failures are reported as structured diagnostics events;
- events include owner, provider, operation, status/error code, timestamp and a bounded message;
- access tokens and refresh tokens are never included in diagnostics payloads;
- diagnostics failures are best-effort and never block the user's Calendar flow.

Admin → Infrastructure → Integrations now shows Google Calendar events/successes/failures/cancellations for the last 24h and the latest failure. Recent Calendar failures also move overall Integrations health to Attention.
