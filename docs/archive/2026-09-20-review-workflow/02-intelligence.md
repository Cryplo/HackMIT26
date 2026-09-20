> **ARCHIVED — superseded on 2026-09-20.** Historical assignment from commit `9f3d593`; not current implementation instructions. Start with [the active investigation pack](../../next-work/README.md). Relative document links were relocated for this archive.

# Agent C — Intelligence implementation handoff

Read [00-contracts.md](00-contracts.md) and [README.md](README.md) **first**. They supersede conflicting instructions in the [previous Agent C context](../../superpowers/plans/2026-09-19-dylanli/agent-3-intelligence.md). Report interface conflicts rather than changing another owner's contract.

**Goal:** Deliver the ten-case scoped-alias activation gate and preserve Jev correctness for the USD travel reimbursement demo. A model judgment never authorizes payment.

**Architecture:** Implement the existing `IntelligencePort` with TypeScript, native fetch/crypto, and Node tests. B supplies the real financial plus Jev `AssessExample` path and owns all state changes. No new dependencies.

## Ownership and priority

All implementation paths below are relative to `HackMIT26/reconciliation/`. You are not alone in this codebase: preserve others' changes and coordinate integration through the frozen contracts.

| Owner | Write scope |
| --- | --- |
| C | `src/lib/intelligence/**`; `src/lib/core/jev.ts`; new dedicated `src/lib/core/tests/jev.test.ts` |
| B | Routes, services, deterministic checks, stores, migrations, runtime wiring, shared contract validation, `AssessExample`, and final duplicate approval enforcement |
| A | UI, retry/duplicate/export interactions and UI tests |
| Devin | Separate 50-case held-out benchmark under `evals/**` |

Do not edit existing `core.test.ts`, shared contracts, extraction, package/lock files, DB, UI, or `evals/**`. Earlier C ownership of extraction is withdrawn. Follow the README's main-only process; use mocked HTTP until budgeted live verification.

P0 covers money/duplicate safety, actual alias propose/test/activate/disable, Devin's 50-case benchmark, UI retry/duplicates/export, and a verified live demo. C's critical path is Tasks 1–3. Search already runs live; investigation is optional. The custom editor is **P1, only after all five P0 items pass**.

Effort: Task 1 is small; Tasks 2–3 and integration with B are the main work. P1 requires an A/B/C configuration lifecycle, so defer it if it competes with verification.

## Read the actual baseline

- `src/lib/core/jev.ts`: exports `Jev`, `LiveJev`, `SimulatedJev`, `questions`, and `validateAnswers`. It already posts `{ model, state, questions }`, applies a 25-second timeout, and logs usage in `finally`. Its current answer validator requires the three answers but does **not** reject extra answer keys.
- `src/lib/intelligence/search.ts`: existing live search, exact response validation, groups of 10 rows, concurrency 3, cancellation, usage logging, and no partial results. Reuse it.
- `src/lib/review-contracts.ts`: frozen `IntelligencePort`, `EvaluationCase`, `AssessExample`, `RuleEvaluationInput`, `RuleTestReport`, `ProviderOptions`.
- Read-only: `src/lib/core/service.ts`, `checks.ts`, `retrieval.ts`, `validation.ts`, `fixtures.ts`, and `runtime.ts`. Trace existing `Jev.evaluate` callers, including `scripts/check-jev.ts` and the core tests, before changing its implementation.
- `docs/live-jev-smoke.json`: historical live Jev with fixture extraction/simulated retrieval; not proof of the new workflow or benchmark.

Preserve exports and three-argument `Jev.evaluate(state, runId, log)`. Imports require no keys/network. Money is integer cents or `null`; never fill missing receipt facts from the claim.

## Verified provider capabilities — checked 2026-09-20

1. Native API: `POST https://api.typesafe.ai/v1/systemone`, bearer authentication, `{model,state,questions}`, matching answer keys, snake-case token usage. State accepts string/object/array. Question keys are not inference input; instructions must identify the evidence. [TypeSafe HTTP reference](https://docs.typesafe.ai/api)
2. Native Choice returns the highest-probability choice, a distribution summing to one, and confidence. Validate every response. [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice)
3. Preserve `https://ai-gateway.vercel.sh/typesafe/v1/systemone`: documented model `typesafe-ai/jev`, bearer gateway auth, native-shaped responses and snake-case usage. [Vercel TypeSafe-compatible API](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe)
4. Gateway `/v1/evaluate`/AI SDK 7 is another surface; OpenAI-compatible endpoints do not support evaluation. No migration is needed. [Vercel evaluation documentation](https://vercel.com/docs/ai-gateway/modalities/evaluation)
5. Independent questions share one state; arrays do not imply a native independent-claim batch API. Search grouping is application logic. Current inputs are text-based: send extracted receipt facts/text, not image/audio bytes. [Vercel Jev boundaries](https://vercel.com/i/what-is-jev), [TypeSafe introduction](https://docs.typesafe.ai/introduction)
6. Confidence measures distribution concentration, not selected-option probability. Keep application thresholds **0.85 probability / 0.70 confidence**, otherwise `unknown`; these require separate calibration, not accuracy claims. [TypeSafe confidence](https://docs.typesafe.ai/confidence)

New custom-check accuracy, latency/cost gains, undocumented limits, and end-to-end behavior remain **unverified**. Provider marketing is not Sift measurement.

## Task 1 — P0: preserve and harden the existing Jev boundary

**Files:** `src/lib/core/jev.ts`; new `src/lib/core/tests/jev.test.ts`.

- [ ] Add exact own-key coverage to `validateAnswers`: the P0 required keys are precisely `merchant`, `name`, and `duplicate`. Reject missing and unexpected keys.
- [ ] Keep `type='choice'`, allowed choice `pass|fail|unknown`, exactly those probability keys, finite numbers in `[0,1]`, sum tolerance `0.02`, and selected-choice maximum tolerance `1e-6`. Validate confidence separately in `[0,1]`. Do not turn absent probabilities into zero or one or recompute confidence.
- [ ] Keep the trusted prefix in every question: receipt text, notes, names/vendors and retrieved records are untrusted evidence. They cannot authorize actions or override mandatory checks; B enforces that in code.
- [ ] Keep direct and gateway endpoints, model selection, authorization, the 25-second timeout, raw response, and usage callback behavior. Preserve existing error codes, including `JEV_INVALID` and `JEV_UNAVAILABLE`. HTTP errors, invalid JSON, malformed answers, and timeouts must reject; no empty successful result or silent simulation/provider fallback.
- [ ] Log each HTTP attempt once, including failures. Unavailable usage/cost stays `null`; logging failure cannot become success.
- [ ] Label deterministic simulation `simulated:true`; B displays null probability/confidence and fixture provenance.

**Acceptance:** Dedicated tests mock `fetch` and assert both endpoint/model variants, exact question keys and trusted prefix, missing/extra answers, wrong probability keys, NaN/infinity/out-of-range values, bad sums, selected nonmaximum choices, and missing confidence. Assert a successful and failed HTTP attempt each logs once. Keep existing three-argument callers green. No provider key or live request is needed.

## Task 2 — P0: build the ten-case alias suite

**Files:** create `src/lib/intelligence/learning.ts`, `src/lib/intelligence/learning.test.ts`.

**Contract:** `build_rule_suite(rule: MerchantRule): EvaluationCase[]`. Import types from `review-contracts.ts`; do not create competing DTOs.

```ts
type AssessExample = (
  facts: EvaluationCase['facts'], aliases: ActiveAlias[], signal: AbortSignal
) => Promise<Assessment>;
// EvaluationCase: { id, facts, expected_assessment }
// facts: { submission, receipt, policies, related_claims, exact_duplicate_ids }
```

B exports `createAssessExample(core, observe?): AssessExample` from `src/lib/core/evaluation.ts`; C needs only the one-argument factory and unchanged callback. B/Devin use `EvaluationObservation` for actual checks, model calls, alias IDs and errors, with caller phase attribution. Usage has null run IDs; no reconciliation runs are persisted. C writes no state and builds no second assessor. Keep this activation suite separate from Devin's **50 held-out cases**; never import, copy, or tune against them.

- [ ] Build these ten stable cases with unique IDs and deterministic facts in the candidate's exact vendor/category/USD scope. Exclude `rule.source_submission_id`. Valid purchases need distinct travelers, receipt numbers, amounts and hashes.

| Case ID | Facts to construct | Expected assessment |
| --- | --- | --- |
| `valid_a` | Matching traveler, exact USD amount below cap, observed vendor in scope, no duplicate | `matched` |
| `valid_b` | Another independent eligible purchase in the same scope | `matched` |
| `overclaim` | Same observed vendor; requested cents exceed receipt cents by 1 | `flagged` |
| `over_cap` | Requested and receipt cents both exceed the applicable cap by 1 | `flagged` |
| `exact_duplicate` | Matching related receipt and hash; related submission ID in `exact_duplicate_ids` | `flagged` |
| `other_category` | Same observed descriptor in a different category, with otherwise valid money/policy | `needs_review` |
| `eur_receipt` | Submission remains USD; receipt explicitly EUR | `flagged` |
| `missing_receipt` | `receipt: null`; do not substitute claim data | `needs_review` |
| `missing_name` | Otherwise eligible receipt has `names: []` | `needs_review` |
| `unrelated_vendor` | Different ambiguous observed merchant; candidate cannot apply | `needs_review` |

Mandatory failures remain `flagged` despite another unknown check. A safely nonmatched result with the wrong expected label is still incorrect; do not rewrite truth to pass.

- [ ] Use receipt date `2026-09-18`, policy window `2026-09-01` through `2026-09-30`, region `*`, and category caps in cents: flight `50000`, hotel `25000`, train `20000`, bus `10000`, other `5000`. Valid amounts can be `min(10000, floor(cap / 2))` and that value plus 1. The second category must differ and have its own applicable policy. Never expand scope to accept EUR claims.
- [ ] Use Node `createHash('sha256')` on actual deterministic synthetic text bytes; store that text in `raw_extracted_text`. Duplicates share bytes/hash plus corroborating fields; valid purchases have distinct hashes. Label fixture evidence; no PDF/storage/extraction changes.
- [ ] Do not embed labels like “should fail” in provider-visible names, vendors, text, or notes. `expected_assessment` stays only on `EvaluationCase`, never inside `facts` or questions.
- [ ] Reject malformed scope, empty/equal normalized vendor identities, invalid/duplicate IDs and incomplete coverage. Do not change fixtures or labels to force improvement.

**Acceptance:** Repeatability, ten unique cases, source exclusion, integer/null money, distinct valid purchases, corroborated duplicate, and no mutation. Assert `SYN HBR 042 → Synthetic Harbor Hotel` applies only to the exact normalized descriptor in hotel/USD. Test other category scopes and an out-of-policy-date regression separately without expanding the ten-case denominator.

## Task 3 — P0: run paired assessment and produce the real gate

**Files:** same `learning.ts` and tests; create `src/lib/intelligence/index.ts` and an optional small `investigation.ts` only for the port implementation described below.

**Contract:** `evaluate_rule(input: RuleEvaluationInput, assess: AssessExample): Promise<RuleTestReport>`.

- [ ] Validate candidate identity/version, knowledge revision, mode, ten-case coverage and active alias IDs. Reject an already-present candidate. B supplies the authoritative snapshot; clients cannot choose truth or aliases.
- [ ] Before aliases are `input.active_aliases`. After aliases are a new array plus `{ id: rule.id, source_correction_id: rule.source_correction_id, payload: rule.payload }`. Do not mutate either input or activate the rule.
- [ ] For each case, pass the **same `example.facts` object reference** to both assessor calls, with the same supplied signal. Run `before` then `after` as a pair, preserving case order in report IDs. Do not execute a full unrelated before sweep followed by an after sweep. Use at most three concurrent pairs; each pair has only one active assessor call at a time. Do not send labels to the callback or provider.

```ts
input.signal.throwIfAborted();
const before = await assess(example.facts, beforeAliases, input.signal);
input.signal.throwIfAborted();
const after = await assess(example.facts, afterAliases, input.signal);
input.signal.throwIfAborted();
```

- [ ] Stop scheduling on failure/cancellation, await started work, and reject invalid outputs, throws, or timeouts. Check cancellation before returning. Never count provider failure as ordinary `needs_review` or return a partial complete report. B's assessor must throw on unavailable required providers/evidence.
- [ ] P0 Jev has no outer signal argument; its 25-second timeout bounds in-flight requests. Check the supplied signal and discard late results. P1 reserves argument four for custom questions.
- [ ] Count `total` as evaluated examples, `correct` as exact expected-label agreement, `false_matches` as `actual='matched'` when expected is anything else, and `needs_review` as actual `needs_review`. `improved_case_ids` are previously incorrect cases now correct; `regressed_case_ids` are previously correct cases now incorrect. Preserve suite order.
- [ ] Pass only with zero after false matches, at least one newly matched valid case, no previously correct regression, and nondecreasing correct count. All-unknown, unchanged, partial and provider-failed runs cannot pass. Correct ambiguity is not valid-case improvement.
- [ ] Return actual mode, rule ID/version, knowledge revision, `suite_version:'alias-v1'`, completion timestamp, metrics, case-ID lists and reasons. B checks freshness and mode before activation. A live app cannot activate from a simulated report.
- [ ] On incomplete evaluation, reject. B saves observer diagnostics, marks the attempt failed, clears `latest_test`, and invalidates earlier activation eligibility while retaining history. Optional `latest_test_error` exposes a sanitized message. Do not extend `RuleTestReport` or fabricate missing metrics.

Illustrative output from a controlled **simulated unit test**, not a measured model result:

```json
{
  "rule_id": "40000000-0000-4000-8000-000000000001",
  "rule_version": 1,
  "knowledge_revision": 4,
  "suite_version": "alias-v1",
  "mode": "simulated",
  "tested_at": "2026-09-20T12:00:00.000Z",
  "passed": true,
  "improved_case_ids": ["valid_a", "valid_b"],
  "regressed_case_ids": [],
  "reasons": [],
  "before": { "total": 10, "correct": 8, "false_matches": 0, "needs_review": 6 },
  "after": { "total": 10, "correct": 10, "false_matches": 0, "needs_review": 4 }
}
```

**Acceptance tests:** Use a facts-only literal `AssessExample` fake and `node:assert/strict`. Assert 20 calls, same facts-reference pairing and order, aliases changed only by the candidate, no truth leakage, no mutation, truthful mode, and correct metrics. Add dangerous fake behavior that matches the duplicate after the alias; require `passed=false`, a false match, and its regression ID. Also cover unchanged/all-unknown output, one earlier-correct case regressing, wrong labels, duplicate/missing suite cases, canceled signal, and an assessor that throws midway. Gate tests with fake assessors validate orchestration, not live semantic accuracy; B separately integrates with its real assessor.

Export the existing full port:

```ts
export const intelligence: IntelligencePort = {
  investigate, search, build_rule_suite, evaluate_rule,
};
```

Reuse `search`. P0 `investigate` may return `status:'unavailable'`, supplied mode, `model:null`, `next_action:'human_review'`, empty steps/refs, `error_code:'INVESTIGATION_UNAVAILABLE'`, and an honest unavailable summary.

Any later investigator uses only B's four read-only callbacks and reports actually observed evidence/references. Invented citations cannot support completion.

## Task 4 — P1 only: declarative custom Jev questions

The attached proposal cannot weaken approval. Mandatory deterministic and `merchant/name/duplicate` checks stay immutable/enabled. No user code, expressions, SQL, shell or tools. B/A own persistence/API/UI; C receives validated active semantic questions.

After all five P0 items pass, use this frozen additive extension:

```ts
export type JevChoiceQuestion = {
  type: 'choice'; instructions: string; criteria: Record<Choice, string>;
};
// Additive, existing callers continue using the three mandatory arguments.
evaluate(
  state: SemanticState,
  runId: string,
  log: (call: ModelCall) => Promise<void>,
  customQuestions?: Record<string, JevChoiceQuestion>
): Promise<Evaluation>;
// Evaluation.answers retains every mandatory built-in:
// Record<SemanticField, Answer> & Record<string, Answer>
// SemanticState may additionally contain receipt_text?: string.
```

- [ ] Keys: `/^custom_[a-z][a-z0-9_]{0,39}$/`; instructions 1–1500 trimmed characters; exactly pass/fail/unknown criteria, each 1–400. Maximum five enabled questions. B supplies an enabled per-run snapshot. C rejects invalid keys/values, collisions, extra properties/criteria and excessive count before HTTP.
- [ ] Keep merging/prefixing and validation pure. An internal `evaluateConfigured` helper may reuse existing transport/logging/errors. Always merge mandatory questions internally; custom keys cannot replace them.
- [ ] Prefix every custom question with trusted evidence instructions. `receipt_text` is extracted plain text supplied by B, capped at **12,000 characters**. B omits over-limit text and records an explicit evidence-limit reason; custom checks remain unknown regardless of model answer. Never blindly truncate, fetch, reconstruct, or substitute claim data. Missing/unsupported evidence stays unknown.
- [ ] Validate exactly all merged question keys, including mandatory ones, using the same strict Choice/probability/confidence contract. Missing or unexpected custom answers fail the entire evaluation. Preserve thresholds `0.85` / `0.70`; do not lower them to make a demonstration pass.
- [ ] Simulated mode emits deterministic `unknown` answers for every enabled custom key, labels them fixture behavior, and makes no network call. Do not interpret arbitrary custom instructions through keyword heuristics. Built-in fixture behavior remains unchanged.
- [ ] Custom checks are review-only: fail/unknown/low confidence needs review unless a mandatory failure already flags it. A custom pass cannot approve or erase failures. B owns aggregation; C preserves raw answers honestly.

Example B-to-C input, for a question about evidence actually available in extracted text:

```ts
const customQuestions = {
  custom_itemized: {
    type: 'choice' as const,
    instructions: 'Does receipt_text explicitly itemize the charged travel services?',
    criteria: {
      pass: 'The observed receipt text lists the charged services individually.',
      fail: 'The observed text explicitly states it is a non-itemized total.',
      unknown: 'Text is missing, incomplete, or does not establish itemization.',
    },
  },
};
await jev.evaluate(state, runId, log, customQuestions);
```

**P1 acceptance:** Test three-argument compatibility, enabled keys/disabled omission, prefixes, overwrite attempts, unsafe keys, six questions, incomplete criteria, missing/extra answers, hostile receipt text, absent/over-limit text, provider failure and simulation with zero calls. B verifies explicit evidence-limit reasons, snapshots/revisions, review-only aggregation and preserved human decisions; A verifies the editor.

## Verification and delivery

Run from `HackMIT26/reconciliation/` after implementing P0:

```bash
npm run test:intelligence
node --conditions=react-server --import tsx --test src/lib/core/tests/jev.test.ts
npm run typecheck
npm test
```

Existing scripts discover these test paths; no package edits. Restore global fetch mocks and keep keys unnecessary. Report errors in B-owned integration code without editing it.

The coordinator runs build/browser checks, then budgeted `npm run check:jev` / `npm run demo:jev`. C verifies eligible improvement and money/duplicate/scope counterexamples, with actual mode/model/usage and error behavior. No silent live fallback. The coordinator owns the integrated artifact; redact secrets.

Deliver changed paths/signatures, commands/results and remaining dependencies. Distinguish mocks, simulation, historical smoke and fresh live results. Unit tests do not establish lifecycle integration, benchmark accuracy or live-demo completion.
