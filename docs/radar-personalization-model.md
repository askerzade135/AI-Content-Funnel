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
- Skip reason refines what the negative signal means.
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
- use recent current-version Skip signals;
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

### Repeated skips

Radar may broaden the **search space inside Active Topics** after repeated current-version skips.

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
