# Radar Personalization Model

Status: **working specification**  
Owner: product + engineering  
Last updated: 2026-09-23

This document is the source of truth for how **My Radar → Discover → feedback → ranking** should behave.  
When product behavior changes, update this file together with the code.

---

## 1. Product goal

Radar should recommend content that is useful for the creator **right now**, based on the creator's current profile.

A past preference must not override an explicit current choice.

Example:

- old topic: `Parenting`
- current topic: `Religion and traditions`

A video only about parenting must not appear in the main Discover feed just because the user previously liked parenting content. It may appear only if it has a substantive connection to the current topic, for example:

- religious traditions in parenting;
- how faith shapes family rituals;
- cultural/religious expectations around children.

---

## 2. Signal hierarchy

Signals do not have equal authority.

### Level 1 — hard boundaries

#### Active Topics

Active Topics define what Discover is allowed to recommend.

Rules:

- every candidate in the main feed must have a substantive connection to at least one active Topic;
- removed Topics stop being eligible immediately;
- old feedback, references, subscriptions, description, goals, formats, and preferred angles cannot restore a removed Topic by themselves.

#### Avoid

Avoid is a hard negative boundary.

If a candidate substantively conflicts with an active Avoid rule, it is not eligible for the main feed.

---

### Level 2 — strong ranking signals

#### Manual references

References are strong positive taste signals, but only **inside Active Topics**.

A reference may influence:

- angle;
- depth;
- style;
- type of source;
- creator/author similarity;
- subtopic.

A reference must not broaden the topical boundary beyond Active Topics.

#### Explicit feedback

- **Interesting** = positive taste signal.
- **Not interested** = negative taste signal.
- Not-interested reason refines what the negative signal means.
- **Next** = navigation only; it must not train the model.

Feedback is associated with the taste/profile version active when the decision was made.

---

### Level 3 — ranking modifiers

#### Preferred angles

Angles answer **how to look at a topic**, not **what topic to search**.

Examples:

- myth-busting;
- cultural conflict;
- research;
- counterintuitive facts;
- strong stories.

Angles cannot create eligibility outside Active Topics.

#### Goals

Goals affect source/ranking quality, for example:

- ideas for content;
- understand a topic more deeply;
- follow trends;
- save interesting material.

Goals should not introduce new topics.

#### Formats

Formats describe the creator's output format, not the source topic.

Examples:

- short video;
- long video / podcast;
- article;
- post.

Formats should not be treated as a topical filter.

---

### Level 4 — secondary context

#### Creator description

The free-form description helps ranking and explanation, but Active Topics always override it.

If the description still mentions an old topic that has been removed from Active Topics, that old topic must not become eligible.

#### Custom instructions

Custom instructions refine behavior but cannot override hard Topic/Avoid boundaries.

#### Subscriptions / connected sources

Subscriptions are a **candidate source pool**, not a relevance override.

A subscribed channel can produce candidates, but each candidate must still pass current Topic/Avoid eligibility.

---

## 3. Taste version

The profile has a monotonic `tasteVersion`.

A version represents one coherent interpretation of the user's current taste.

### Version increments when

- Topics change;
- Avoid changes;
- Preferred angles change;
- Goals change;
- Formats change;
- discovery sources change;
- creator description changes;
- custom instructions change;
- a strong manual reference is added.

### Version does not need to increment when

- onboarding is marked complete;
- the user only opens another page;
- the user presses Next on a recommendation;
- UI-only settings change.

---

## 4. Candidate lifecycle

Each discovery candidate may store:

- `rankedForTasteVersion`;
- `eligible`;
- `eligibilityReason`;
- `rankingScore`;
- `rankingReason`;
- `keyTopics`;
- `rankedAt`.

A candidate may be shown in the main Discover feed only if:

1. it has not already received feedback;
2. `rankedForTasteVersion === profile.tasteVersion`;
3. `eligible === true`.

A stale score from an older taste version must never be displayed as a current match score.

---

## 5. Eligibility stage

Pipeline:

```
Current profile
    ↓
Search plan
    ↓
Raw candidates
    ↓
Eligibility
    ↓
Ranking
    ↓
Discover feed
```

Eligibility is conceptually separate from ranking.

### Eligibility rules

A candidate is eligible only when:

- it substantively matches at least one Active Topic;
- it does not substantively conflict with Avoid.

References, feedback, subscriptions, author affinity, goals and description may improve rank **after** eligibility, but cannot make an off-topic item eligible.

### LLM eligibility

The ranking task returns an explicit `eligible` decision and a short `eligibilityReason`.

### Deterministic fallback

If LLM ranking fails, Radar uses a conservative text/query/topic fallback.

The fallback should prefer hiding a questionable off-topic candidate over displaying an obviously stale recommendation.

---

## 6. What happens when profile settings change

### A. Add a Topic

Example:

`Religion` → `Religion + History`

Action:

- increment tasteVersion;
- invalidate old rankings;
- preserve unreviewed candidate pool where useful;
- run fresh discovery;
- rerank under the new profile.

---

### B. Remove a Topic

Example:

`Parenting + Religion` → `Religion`

Action:

- increment tasteVersion;
- remove the old unreviewed discovery queue;
- preserve historical feedback records;
- run fresh discovery;
- only current-topic candidates may return.

This is a strong reset because removed topics must disappear immediately.

---

### C. Replace all Topics

Example:

`Psychology / Parenting` → `Religion and traditions`

Action:

- increment tasteVersion;
- clear the unreviewed queue;
- keep feedback history as history;
- old feedback does not directly rank the new feed;
- create a new search plan from current Topics;
- rank only against the new context.

---

### D. Change Avoid

Action:

- increment tasteVersion;
- clear the unreviewed queue;
- refresh discovery.

Avoid is a hard rule, so stale candidates must not remain visible.

---

### E. Change angles / goals / formats / description

Action:

- increment tasteVersion;
- invalidate ranking of unreviewed candidates;
- candidates can be reranked;
- a fresh search may also add better candidates.

The Topic boundary remains unchanged.

---

### F. Add a manual reference

Action:

- increment tasteVersion;
- invalidate current unreviewed rankings;
- use the reference as a strong ranking/search-shaping signal;
- keep it constrained by Active Topics;
- refresh Discover.

---

## 7. Feedback semantics

### Interesting

Meaning:

> Show me more content with similar substance/taste inside my active topics.

Effects:

- save positive feedback with current tasteVersion;
- candidate becomes reviewed and leaves queue;
- optionally add useful source content to corpus;
- rerank remaining current-version candidates.

---

### Not interested → Not my topic

This is the strongest negative topical feedback.

Effects:

- candidate becomes reviewed;
- negative signal applies within the current taste version;
- repeated use may affect future query planning;
- does not permanently ban unrelated future profiles.

---

### Not interested → Too generic

Penalizes generic treatment, not the topic itself.

---

### Not interested → Wrong presentation

Penalizes presentation/style.

---

### Not interested → Too shallow

Penalizes depth.

---

### Not interested → Seen before

Penalizes repetition/novelty.

---

### Next

No training signal.

Effects:

- move to next queued candidate only;
- do not write positive or negative feedback.

---

## 8. Historical feedback

Feedback is never silently deleted just because the profile changes.

It is stored with its tasteVersion.

### Current rule

Ranking primarily uses feedback from the current tasteVersion.

Older feedback remains available for future product work and analytics, but should not directly overpower an explicit new Topic selection.

### Future option

We may later reuse historical feedback when semantic overlap with the current Topics is proven.

If implemented, that must be explicit and documented here.

---

## 9. Search-plan rules

The search planner must:

- build queries around Active Topics;
- use Preferred Angles to refine query style;
- use references to refine subtopics/style **inside Active Topics**;
- respect Avoid;
- use recent current-version Not interested signals and reasons;
- not allow creator description or old feedback to reintroduce removed topics.

Fallback queries follow the same rule.

---

## 10. Subscriptions

YouTube subscriptions and other connected sources are discovery pools.

Rules:

- subscription content is not automatically relevant;
- each subscription candidate still passes Topic/Avoid eligibility;
- a favorite channel does not bypass current filters.

---

## 11. Refresh rules

### Explicit Refresh

User presses Refresh:

- create a new search plan from the current tasteVersion;
- fetch new candidates;
- rank current unreviewed candidates;
- keep reviewed history excluded.

### Save & refresh from My Radar

- save profile;
- increment tasteVersion if meaningful taste context changed;
- invalidate/clear queue according to rules above;
- run discovery;
- navigate to Discover after successful refresh.

### Queue exhausted

- automatically run a fresh discovery for the current tasteVersion.

### Repeated negative feedback

Radar may broaden or adjust the **search space inside Active Topics** after repeated current-version Not interested decisions.

It must not broaden into inactive topics.

---

## 12. Match score

The UI match score is valid only for the current tasteVersion.

A candidate ranked for another tasteVersion must never display an old score such as “93% match”.

Eligibility and score are separate:

- `eligible=false` → do not show in main feed;
- `eligible=true` → rankingScore determines ordering.

---

## 13. Known compromises / MVP behavior

- Deterministic fallback eligibility uses text/query matching and is less capable than semantic LLM eligibility.
- Historical feedback is currently isolated after tasteVersion changes instead of semantically reused.
- Reference removal/versioning can be expanded later.
- Eligibility thresholds may need tuning from production data.
- Search providers may return noisy raw results; the eligibility stage is responsible for keeping them out of the main feed.

---

## 14. Product invariants

These rules should remain true unless this document is intentionally changed:

1. **Current explicit Topics beat historical behavior.**
2. **Avoid is a hard boundary.**
3. **References cannot resurrect removed topics.**
4. **Subscriptions are sources, not relevance permissions.**
5. **Next does not train Radar.**
6. **Old match scores never survive a taste-version change.**
7. **Changing Topics must produce an immediately coherent Discover feed.**
8. **Responsive UI and RU/EN localization are required for all user-facing changes.**

---

## 15. Change log

### 2026-09-23 — Taste Context v1

Introduced:

- tasteVersion;
- versioned discovery feedback;
- stale-ranking invalidation;
- hard Topic/Avoid eligibility;
- current-version-only ranking feedback;
- queue reset on Topic/Avoid changes;
- reference-triggered taste-version change;
- current-topic-only search-plan rules.


---

## 16. Content quality gate

Topical relevance is not enough. Discover must also estimate whether a candidate is worth recommending.

Pipeline:

```
Search result
  ↓
Topic/Avoid eligibility
  ↓
Quality gate
  ↓
Personal relevance ranking
  ↓
Discover queue
```

### Quality signals

For YouTube, Radar may use:

- total views;
- likes;
- comments;
- like/view ratio;
- comment/view ratio;
- publication age;
- approximate views-per-day velocity;
- whether metrics are missing;
- source type and future source credibility signals.

Quality is stored separately from personal relevance:

- `qualityScore` — 0–100;
- `qualityConfidence` — `low | medium | high`;
- `qualityReason` — internal explanation of the available evidence.

### Important rule

Low views alone do **not** automatically mean low-quality content. A niche expert may have small reach but strong engagement.

However, old content with very low reach and weak engagement should normally be filtered out before it can become a top recommendation.

Current MVP rule:

- quality is calculated deterministically from available metadata;
- when quality confidence is not low and `qualityScore < 40`, the candidate fails the quality gate;
- for eligible candidates, quality contributes to final ranking instead of replacing personal relevance;
- missing metrics result in lower confidence, not automatic rejection.

The exact thresholds are tuning parameters and may change with production data. Any threshold change must be recorded in this document.

---

## 17. Discover candidate state

Recommendation state and taste feedback are different concepts.

A candidate can be:

- unseen;
- shown;
- passed with **Next**;
- reviewed positively with **Interested**;
- reviewed negatively with **Not interested**.

### Interested

- persists positive feedback;
- removes the candidate from the active Discover queue;
- may add the material to the user's corpus;
- reranks remaining candidates;
- contributes to taste learning.

### Not interested

- persists negative feedback;
- removes the candidate from the active Discover queue;
- contributes to taste learning;
- optional reason determines what Radar should learn.

### Next

`Next` means:

> Do not use this as a positive or negative taste signal, but do not immediately show me this item again.

Implementation:

- store a separate `RadarDiscoveryExposure`;
- action = `passed`;
- store current `tasteVersion`;
- exclude passed candidates from the queue for that tasteVersion;
- do **not** count Next as positive/negative feedback;
- Next **does** count as a completed training decision for the onboarding progress threshold;
- keep a separate neutral Skip/Next count for UX/analytics;
- after a meaningful profile change creates a new tasteVersion, a previously passed item may be considered again if it is still relevant.

This separation is important: navigation must not silently train the recommendation model.

---

## 18. Negative-feedback UX and semantics

The first click on **Not interested** must not silently save a generic negative signal.

It opens an explicit reason state:

- Not my topic;
- Too generic;
- Wrong presentation/style;
- Too shallow;
- Seen before;
- Just not interested.

The UI must make this mode visually obvious and explain that the reason changes what Radar learns.

### Semantics

- `not_my_topic` — strong topical negative signal;
- `too_generic` — penalize generic treatment, not the topic;
- `wrong_style` — penalize presentation/style;
- `too_shallow` — penalize insufficient depth;
- `seen_before` — penalize repetition/novelty;
- no reason / Just not interested — general negative signal without a more specific interpretation.

---

## 19. Feedback interaction states

Discover actions must always provide visible feedback.

Supported UI states:

- `idle`;
- `interesting`;
- `choosing-negative-reason`;
- `skip`;
- `pass`.

### Interested animation

After click:

1. disable conflicting actions;
2. show a visible success state such as “Got it — tuning your Radar…”;
3. keep the state visible briefly;
4. load the next recommendation.

### Not interested animation

After a reason is selected:

1. disable conflicting actions;
2. show a visible negative-feedback acknowledgement;
3. persist feedback;
4. load the next recommendation.

### Next animation

After click:

1. persist `passed` exposure;
2. show an explicit transition state;
3. load the next non-passed recommendation.

Buttons must never merely become disabled with no explanation.

---

## 20. Persistence rules across navigation

Leaving Discover and returning must not resurrect a candidate that the user already handled.

Persistence expectations:

- Interested → never reappears as an unreviewed recommendation;
- Not interested → never reappears as an unreviewed recommendation;
- Next → does not reappear in the same tasteVersion;
- a new tasteVersion may reconsider previously passed candidates;
- the active discovery/search process should survive section navigation where possible;
- stale local React state must never be the sole source of recommendation history.

---

## 21. Discover UI responsibilities

The main card should explain:

- why the material matches the user;
- key topics;
- available engagement metrics;
- the current recommendation actions.

Raw source description is optional and may be omitted when “Why this matches you” and “Key topics” already explain the recommendation.

The UI match score represents personal fit **after** eligibility and quality checks. It must not be interpreted as a standalone content-quality score.

Future versions may expose a separate quality/confidence indicator if it helps users understand weakly validated sources.

---

## 22. Change log additions

### 2026-09-23 — Quality + persistent candidate handling

Introduced:

- deterministic content quality assessment;
- `qualityScore`, `qualityConfidence`, `qualityReason`;
- quality gate after topical eligibility;
- quality contribution to final candidate ranking;
- persistent `Next` / `passed` state via `RadarDiscoveryExposure`;
- current-taste-version exclusion of passed candidates;
- explicit Discover interaction states;
- visible Interested / Not interested / Next transitions;
- explicit negative-reason selection UI;
- rule that navigation actions must not silently train taste.


### 2026-09-23 — Three-signal feedback model

Active semantics:

- `interesting` = positive taste feedback;
- `not_interested` = negative taste feedback with optional reason;
- `passed` exposure = neutral Next/Skip, no positive/negative taste training.

The onboarding threshold is based on completed decisions, not only positive/negative feedback. This lets a user finish taste training even when some recommendations are neutrally skipped.

Interested sources may enter the Radar Analysis pipeline; Not interested and neutral Next/Skip do not.


---

## 23. Buffered ranking behavior

Explicit taste feedback and UI latency are separated.

### Interested / Not interested

- persist the feedback immediately;
- keep the already-ranked unhandled queue usable;
- persist every strong signal immediately;
- use a **2.5-second trailing debounce** before reranking, so a rapid burst is ranked from the latest accumulated state;
- allow only **one active rerank per user**;
- if feedback arrives while reranking is active, allow at most **one catch-up rerank** in that burst; anything newer is folded into the next debounced burst;
- do not block the next card on the ranking LLM.

### Next / Skip

- persists neutral exposure only;
- does not trigger taste reranking by itself;
- consumes the current ready queue.

### Buffer thresholds

- client-ready target: **15** candidates;
- low-watermark: **6** candidates;
- emergency watermark: **2** candidates;
- when low, sync existing server-side ranked candidates first;
- at emergency, prioritize refill;
- issue a new search only if the server-side queue also needs replenishment.

Background reranking must preserve the active card the user is currently reading and apply the new order to the remaining tail.

This does not weaken Topic/Avoid eligibility. Buffering changes latency and sequencing, not eligibility rules.


### Rapid-feedback burst semantics

A sequence such as `Interested → Interested → Not interested → Interested` in a few seconds is treated as one preference burst for ranking cost purposes.

All four signals remain individually persisted. Ranking is not lossy: the next rerank reads the latest stored feedback state. What is coalesced is the **number of expensive ranking executions**, not the user signals themselves.

This distinction is important:

- feedback durability = per action;
- UI advance = per action;
- ranking execution = per debounced burst;
- search execution = only when queue health requires it.

The goal is to preserve personalization fidelity without making LLM usage proportional to click speed.


---

## 24. Output-format recommendation model

Content formats belong to **Idea/output personalization**, not Discovery/source selection.

### Separation of concerns

- Discovery sources decide where content is found.
- Topics and Avoid define hard topical eligibility.
- Preferred angles and feedback shape relevance/ranking.
- Goals shape product intent.
- Content formats constrain the set of outputs Radar may recommend for an Idea.

Changing only `contentFormats` must not invalidate or rerank the Discovery candidate pool.

### Idea-level format choice

For each generated Idea, Radar chooses:

- one `recommendedFormat`;
- zero to two `alternativeFormats`.

Both must come from the creator's selected `contentFormats`.

The ranking should answer:
> In which of this creator's available output formats does this specific Idea work best?

It should not answer:
> What format was the source content?

### Multi-select

Multi-select means "I create in all of these formats."

It does not mean:
- create duplicate Ideas for every format;
- search only for sources matching these formats;
- always use the first selected format.

### Script inheritance and override

Default:
`Idea.recommendedFormat → Script.outputFormat`

Override:
the user may select another currently enabled profile output format before generation.

Invalid/unselected overrides are rejected server-side.

Existing legacy Ideas without format metadata fall back to a selected profile format, then to `short_video` if no formats are selected.

### Format recommendation quality

Opportunity analysis receives the available creator output formats and must return one best fit.

Examples:
- a single sharp thesis + hook may favor Short video;
- a nuanced multi-part argument may favor Article or Long video/podcast;
- a compact observation may favor Post.

This recommendation is about editorial expression, not source medium.


---

## 24. Ideas are content seeds, not ranking signals

Ideas and their output states are downstream of Discovery personalization.

Rules:

- Saved/Unsaved on an Idea does not retrain Discovery by itself.
- Creating Article/Post/Short video/Long video outputs does not change source eligibility or Discovery ranking.
- Multiple outputs from one Idea remain linked to the same Idea/source lineage.
- Output format is chosen from the user's enabled content formats and does not alter where Discovery searches.
- Regenerating an existing format creates a new version in that format lineage, not a new Idea and not a new taste signal.

State separation:

`Discovery feedback → Idea → Saved state + Output lineages`

Saved state and output existence are orthogonal.


---

## 25. Ordered content-format preference

`profile.contentFormats` is an ordered preference list.

Semantics:

- index 0 = primary/default output format;
- later items = secondary output preferences;
- changing the order changes taste/ranking context;
- primary format is a strong soft Discovery ranking/search-planning signal;
- secondary formats are weaker soft signals;
- output format never changes ACTIVE TOPICS eligibility;
- output format never restricts source type.

Examples:

- primary Article → favor richer evidence/research/deep-analysis source material when otherwise relevant;
- primary Short video → favor strong hooks, concise arguments and visually/story-driven source material when otherwise relevant.

Generation permissions are separate:

- all supported output formats remain creatable;
- My Radar format selection/order controls preference/defaults, not access.

This preserves:

`Topics = what may enter Discovery`

`Output format preference = what kind of relevant source is most useful to create from`


---

## 2026-09-24 — Web source normalization

Web Search is a Discovery **source pool**, not a personalization signal by itself.

- Web results are normalized into the same `RadarDiscoveryCandidate` model used by other sources.
- Canonical URL identity is used for deduplication; repeated citations of the same URL must not create duplicate candidates.
- Web candidates do not bypass ACTIVE TOPICS, Avoid, quality or ranking.
- Interested / Not interested semantics are identical across YouTube and Web candidates.
- Skip/Next remains neutral.
- Provider/source availability never changes taste semantics: a temporary Web failure must not alter the user's profile or erase feedback.
