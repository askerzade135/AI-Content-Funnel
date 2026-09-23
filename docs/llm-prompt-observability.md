# LLM & Prompt Observability

Status: active source of truth for Radar AI routing, prompt versions, runtime telemetry and prompt/eval regression.

## 1. Why this exists

ContentRadar uses LLMs for several distinct product jobs. We must be able to answer:

- which task ran;
- which prompt version produced the result;
- which provider/model/tier handled it;
- how many input/output/total tokens it used;
- estimated cost;
- latency;
- fallback/error reason;
- which user and product entity caused the run;
- whether a prompt/model change improved or degraded output quality.

Prompt changes are product changes and require explicit versioning plus regression coverage.

## 2. Canonical task registry

The runtime registry lives in `server/llm-tasks.ts`.

Current tasks:

| Task | Purpose | Class | Quota |
| --- | --- | --- | --- |
| radar_discovery_queries | Generate search queries from Radar profile | economy | none |
| radar_discovery_plan | Produce source-aware search plan | economy | none |
| radar_discovery_ranking | Rank eligible Discovery candidates | balanced | none |
| radar_reference_analysis | Extract topics/angles from reference content | economy | none |
| radar_opportunity_analysis | Turn analyzed source into grounded Ideas | balanced | Radar Analysis |
| radar_script_generation | Create/regenerate output from an Idea | quality | AI Generation |

Each registry entry must contain:
- task id;
- immutable prompt/task version;
- purpose;
- prompt source location;
- temperature;
- max tokens;
- routing class;
- output contract;
- quota metric where applicable;
- owning product area;
- fallback policy.

The operation written to telemetry is `taskId:version`.

## 3. Routing policy

Default included routing:

`task class → configured free pool → next free candidate → paid Gemini only when paid fallback is explicitly allowed`

BYOK routing:

`selected provider/model → user/provider credentials`

BYOK must not silently become platform-paid usage.

Admin UI may show provider/model/tier health but must never render API keys or secrets.

## 4. Runtime telemetry

The existing AI usage ledger is the canonical execution source.

Each attempted LLM execution should record:

- timestamp;
- ownerId/user;
- operation = task + version;
- provider;
- model;
- billing phase: free / paid / byok;
- success/failure;
- errorCode when failed;
- fallbackReason when another route was attempted first;
- input/prompt tokens;
- output/candidate tokens;
- thought tokens when provider exposes them;
- total tokens;
- estimatedCostUsd;
- latencyMs;
- optional source/entity ids when available.

Costs are **estimated**, not invoices.

Failed route attempts are recorded with zero tokens/cost when the provider fails before returning usage. This is intentional so fallback/error rates are measurable.

## 5. Admin views

### LLM Task Registry

For every task show:
- task/version;
- owner/product area;
- purpose;
- prompt source;
- task class;
- temperature;
- max tokens;
- output contract;
- quota metric;
- fallback policy.

### Runs / AI Usage

Filterable dimensions:
- period;
- user;
- task/operation;
- provider;
- model;
- billing phase;
- success/error.

Columns/metrics:
- latency;
- input/output/total tokens;
- estimated cost;
- error/fallback.

### Prompt versions / Evals

Prompt versions are compared by `task + version`.

Do not edit the meaning of an existing version in place for meaningful behavior changes. Increment the version when prompt/output behavior changes materially.

## 6. Evaluation strategy

CI must never depend on a paid/external LLM request.

Two layers:

### A. Deterministic CI contract tests

Use fixtures/mocked or recorded responses and assert:
- valid task registry metadata;
- parser/schema validity;
- required fields;
- allowed output formats;
- no duplicate Ideas from one source payload;
- Recommended format belongs to enabled user formats;
- Interested positive / Not interested negative / Skip neutral invariants;
- Discovery ranking eligibility remains compatible with topic/avoid rules;
- source/evidence fields are not silently dropped;
- usage aggregation preserves task/version/provider/model/tier;
- prompt/run metadata contains no API key material.

Avoid brittle full-text equality.

### B. Manual/provider eval

Optional non-CI runner may call real providers against anonymized representative fixtures.

Track results by:
- task;
- promptVersion;
- provider/model;
- timestamp.

Suggested scores:
- schema pass;
- grounding pass;
- relevance;
- duplicate rate;
- format validity;
- human quality score;
- latency;
- tokens;
- estimated cost.

Use the same fixture set when comparing prompt/model versions.

## 7. Prompt-change Definition of Done

A meaningful prompt/routing change is complete only when:

1. task registry/version is updated;
2. output contract is reviewed;
3. deterministic eval/regression is updated;
4. cost/token impact is considered;
5. Admin telemetry can distinguish old vs new version;
6. product docs/changelog are updated;
7. latest CI is green.

## 8. Current limitations

- Existing historical usage logs may not have `success/errorCode`; treat missing success as legacy/unknown, not failure.
- Estimated cost is strongest for providers/models with pricing wired into the router; zero cost for other providers may mean “not yet priced”, not truly free.
- Raw prompts/model responses are intentionally not exposed in Admin yet. A future Prompt Lab may add safe/redacted run inspection.
- Active-user analytics currently derives activity from persisted product/AI records plus login timestamps; a dedicated product-event ledger is still desirable for complete interaction analytics.
