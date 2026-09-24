# ContentRadar — Unified Engineering & QA Instructions

Status: **active project instruction**
Applies to: **all product, frontend, backend, UX, QA and documentation changes**
Branch-independent rule: this file defines the default working process unless an explicit product decision overrides a specific behavior.

---

## 1. Core rule

**Do not start the next change until the previous change has been verified.**

Required working cycle:

```
Check previous CI
→ inspect previous result
→ make one coherent change
→ typecheck
→ regression tests
→ production build
→ responsive / visual regression
→ functional regression
→ update docs + changelog
→ only then start the next task
```

If the previous CI/build failed, stop adding new product work on top of it. Diagnose and restore a stable branch first.

Do not treat a cancelled superseded run as a product failure if the latest relevant commit has its own successful verification. Always verify the current HEAD.

---

## 2. Pre-flight check before every change

Before editing code:

1. Check the latest relevant CI/build for the current branch/HEAD.
2. Confirm whether the previous change passed:
   - TypeScript/typecheck;
   - regression tests;
   - production build.
3. If it failed, inspect the failed step/log before making the next change.
4. Confirm the current implementation and active product spec before changing behavior.
5. Do not assume a previous chat decision is current if code/docs say otherwise; reconcile them first.

For deploy-related work, distinguish:
- **CI/build success** — code can typecheck/test/build;
- **deployment success** — target environment received the revision;
- **production smoke success** — the actual user flow works after deployment.

These are separate gates.

---

## 3. Scope discipline

Prefer one coherent product change at a time.

Do not mix unrelated refactors, UI polish and behavior changes in one verification cycle unless they are necessary for the same user flow.

When a change affects a shared entity, state or navigation flow, do **not** validate only the edited screen.

For ContentRadar, changes involving shared Radar state may require checking the connected flow:

```
Discover
→ Interested / Not interested / Skip
→ Radar Analysis
→ Ideas
→ Generate Script
→ Scripts
→ Calendar
```

Also include Overview and Settings when the changed data or navigation is surfaced there.

---

## 4. Mandatory automated verification

After every meaningful code change, run/verify:

1. **Typecheck**
   - current command: `npm run lint`
   - must pass without TypeScript errors.

2. **Regression tests**
   - current command: `npm test`
   - add/update tests when product semantics changed.

3. **Production build**
   - current command: `npm run build`
   - a successful dev rendering alone is not sufficient.

Do not call a change complete while any required verification step is failing.

When CI runs on push, inspect the latest HEAD result rather than relying on an older green run.

---

## 5. Responsive / visual regression

Every user-facing UI/UX change requires responsive verification.

Minimum control widths:

- **375–390 px** — mobile;
- **768 px** — tablet;
- **1280 px** — standard desktop;
- **1440+ px** — wide desktop.

These are control breakpoints, not device-specific pixel-perfect targets.

At each relevant width check:

- no horizontal page scroll unless the component intentionally requires it;
- cards/columns do not overlap;
- controls stay inside their containers;
- no clipped buttons or inaccessible actions;
- long titles/descriptions wrap or truncate intentionally;
- cards that should align remain aligned;
- adjacent blocks that should have equal/stretching heights behave correctly;
- fixed/sticky elements do not cover content;
- modal/dialog content fits viewport and remains usable;
- tables/grids degrade gracefully;
- spacing does not collapse or become excessively large;
- icons remain aligned with labels/numbers;
- selected/disabled/loading states do not shift layout unexpectedly.

A UI task is **not complete** because it looks correct at one desktop width.

---

## 6. UI state regression

For changed screens, verify all relevant states, not only the happy path:

- initial/loading;
- success;
- empty;
- partial data;
- error;
- retry;
- disabled/in-flight action;
- completed action confirmation;
- long text;
- zero counts;
- larger counts;
- missing optional metadata;
- quota exhausted, when applicable.

Buttons must not merely become disabled with no visible acknowledgement after important user actions.

Stale errors must clear after a successful new request where appropriate.

---

## 7. Localization

All new client-facing text must support **RU and EN**.

For every UI change:

- verify Russian;
- verify English;
- account for different string lengths;
- do not rely on English-sized controls;
- avoid introducing untranslated mixed-language UI unless intentionally temporary and documented.

Browser language remains the default product-language behavior unless the active product spec changes it.

---

## 8. Functional regression by affected flow

Do not validate functions in isolation when the feature participates in an end-to-end journey.

### Radar baseline journey

When affected, verify:

```
My Radar / interests
→ Discover
→ Interested
→ Ideas
→ Save or Generate Script
→ Scripts
→ schedule
→ Calendar
```

Negative/neutral branches:

```
Discover → Not interested → reason persisted → next candidate
Discover → Skip/Next → neutral passed state → next candidate
```

Persistence checks:
- reload after important state changes;
- leave the section and return;
- ensure handled items do not unexpectedly return;
- ensure Saved/Scripted records survive later Radar runs.

---

## 9. Discovery-specific invariants

Unless deliberately changed in the active product spec:

- **Interested** = positive preference signal;
- **Not interested** = negative preference signal with optional reason;
- **Skip / Next** = neutral passed state, not negative preference;
- handled candidates should not immediately reappear in the same relevant queue/taste version;
- Interested may enqueue Radar Analysis;
- quota exhaustion must not erase the user's preference signal;
- expensive analysis must respect quota/idempotency protections.

Any change to these semantics requires:
- code update;
- regression update;
- product spec update;
- changelog entry.

---

## 10. Ideas-specific invariants

Unless deliberately changed in the active product spec:

- new analysis results are incremental;
- do not destructively rebuild the existing idea library;
- Saved ideas remain;
- Scripted ideas remain;
- source provenance remains traceable;
- liked-source Ideas must be distinguishable;
- Generate Script preserves Idea/source lineage;
- retries must not create uncontrolled duplicates.

Current intended tabs:
- All Ideas;
- From liked videos;
- Saved;
- Created — Ideas with at least one generated output.

---

## 11. Quota / cost safety

For actions that can create external AI/API cost:

- verify quota before avoidable expensive work;
- prevent double-charge on retries;
- protect against accidental duplicate requests/double clicks;
- log model/provider usage server-side where available;
- preserve diagnostic reason on failures;
- keep customer-facing quota concepts separate from internal provider quotas.

Current product concepts:
- **Radar Analysis** — source content processing into Ideas;
- **AI Generation** — Script/Regenerate and future generation actions.

Exact plan limits remain product data, not hardcoded assumptions unless explicitly specified.

---

## 12. Documentation is part of the change

A meaningful product change is not complete until documentation matches the code.

Required lifecycle:

```
Decision
→ Product Spec
→ UX/UI
→ Backend/Data
→ Monetization impact
→ Regression
→ Marketing facts
→ Changelog
```

Update the existing source of truth instead of creating contradictory parallel docs.

Current ownership:
- end-to-end product behavior: `docs/product-flow.md`;
- personalization / ranking / feedback semantics: `docs/radar-personalization-model.md`;
- QA / regression / production verification: `docs/radar-e2e-audit.md`;
- deferred engineering work: `docs/technical-debt.md`.

When a rule is replaced:
- update the active rule;
- record the previous rule as superseded in changelog/history;
- do not leave both versions looking active.

---

## 13. Marketing consistency

If a product change affects:
- what a user can do;
- Free/Paid behavior;
- quotas;
- supported sources;
- automation;
- analysis/generation limits;
- user-visible workflow;

then update the relevant customer-facing facts in the product documentation.

Marketing must be built from active product behavior, not from outdated mockups or chat history.

Do not promise:
- unsupported sources;
- unlimited processing without product support;
- quota values that are still TBD;
- behaviors not verified in the product.

---

## 14. Regression expectations for bug fixes

Every meaningful bug fix should answer:

1. What was broken?
2. What caused it?
3. What code changed?
4. What prevents regression?
5. What test/manual check now covers it?
6. Does it affect neighboring flows?
7. Does documentation need correction?

When practical, add an automated regression test for the failure mode.

---

## 15. Build/deploy sequencing

When several commits are pushed quickly, CI/deploy workflows may cancel older runs.

Rules:
- cancellations caused by a newer commit are not automatically failures;
- wait for/check the latest HEAD verification;
- do not conclude the branch is green from a build belonging to an older SHA;
- before starting the next product task, confirm the latest coherent change set has passed the required verification gates.

For production-visible changes:
- after deployment, perform a smoke test of the affected user flow before considering the release verified.

---

## 16. Definition of Done

A task is done only when all applicable items are true:

- [ ] Previous change/result was checked before starting.
- [ ] Implementation matches active product logic.
- [ ] Typecheck passes.
- [ ] Regression tests pass.
- [ ] Production build passes.
- [ ] Responsive/visual regression checked for affected UI.
- [ ] RU/EN checked for affected UI.
- [ ] Functional flow checked beyond the edited component where necessary.
- [ ] Persistence/reload behavior checked where state is stored.
- [ ] Quota/idempotency/cost risks checked where applicable.
- [ ] Existing docs updated rather than contradicted.
- [ ] Regression documentation/tests updated.
- [ ] Marketing facts updated if customer-facing behavior changed.
- [ ] Changelog updated for meaningful product decisions.
- [ ] Latest relevant HEAD CI is green.
- [ ] Production smoke completed when the change is deployed and user-visible.

**Only after this checklist is satisfied should the next product change begin.**
