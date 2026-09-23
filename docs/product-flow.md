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
- **Scripts**

The Scripts tab in Ideas is a lightweight lineage/filter view of ideas that already have a script. The full script editing and publishing experience remains in the separate Scripts workspace.

### 7.2 Idea provenance

Ideas created from Interested sources must clearly show their origin.

Example:

> **Based on a video you liked**  
> [thumbnail] Source title →

This is product-critical because the user should understand **why the idea appeared**.

### 7.3 Idea card

Preserve the useful opportunity structure:

- Hook;
- Core idea;
- Angle;
- Evidence / reasoning;
- source/provenance.

Actions:

- **Save**
- **Skip**
- **Generate script**

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

### 7.6 Idea filters

Keep only filters backed by real data.

MVP target:

- Topic;
- Platform;
- Source: All / From liked videos.

Add Format only if opportunity data actually stores and uses a reliable content format.

Do not add decorative filters such as Difficulty until there is real data/logic behind them.

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

Overview should summarize the creator's current state without duplicating whole product areas.

Target content:

- greeting;
- concise metrics;
- useful Radar improvement/progress block;
- upcoming scheduled content;
- actionable items.

Avoid ambiguous duplicate controls such as a “Radar activity” button unless it has a clearly defined destination/purpose.

Upcoming on Overview:

- show up to 3 items;
- use platform icons;
- if more exist, link to Calendar.

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
- Ideas tabs: All / From liked videos / Saved / Scripts;
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
