# C — Bounded investigation, semantic evidence, and booking-reference tests

Implementation assignment for Sift’s 4–8 hour investigation phase. [00-contracts.md](00-contracts.md) owns all shared types; [01-platform.md](01-platform.md) owns persistence and guarded reassessment. Deliver one working investigation and reviewed-procedure flow before optional work. This is an assignment, not a record of passing checks or live accuracy.

## Ownership and delivered baseline

| Owner | Write scope |
| --- | --- |
| C | `reconciliation/src/lib/intelligence/**`, `src/lib/core/jev.ts`, and `src/lib/core/tests/jev.test.ts` |
| B | Shared contracts, core assessment/retrieval/procedure application, providers/config, intake, stores, migrations, APIs, and core docs |
| A | Review workspace, supporting-document controls, Investigations UI, and UI tests |
| Devin + fourth teammate | Devin alone writes the `evals/**` pack/artifacts; the human reviews evidence/policies/labels and handles demo/pitch |

- Work only on `main` in your separate clone; preserve unrelated edits and use the coordinator’s serialized delivery slot. Do not edit B’s files, UI, `evals/**`, package/lock files, or shared data.
- Do not parallel-edit Devin’s evidence files; request corrections through that owner. Human policy/label sign-off is separate from implementation and model input.
- Existing search and the ten-case `alias-v1` learning suite are implemented. Jev already strictly validates answer keys/distributions, preserves mandatory fields, logs attempts, and uses a 25-second timeout. Reuse them.
- `intelligence/index.ts` has an unavailable investigation stub. Implement that seam; investigation is now P0. No custom-question editor or new dependency in this phase.
- Keep one original receipt and exact financial matching. Supporting documents are additional evidence for the purchase; they are never added together as reimbursable purchases.
- Do not implement an independent assessor. Core alone writes state, computes published assessment/outcome, and decides whether approval is allowed.

## Read before editing

Paths below are under `reconciliation/` unless prefixed with `../`.

1. `AGENTS.md`, `src/lib/core/README.md`, `../docs/next-work/{00-contracts,01-platform,04-devin-benchmark}.md`.
2. `src/lib/review-contracts.ts`, `src/lib/intelligence/{index,learning,search}.ts`, and `learning.test.ts`.
3. `src/lib/core/jev.ts`, its dedicated test, `service.ts`, `checks.ts`, `retrieval.ts`, `safety.ts`, `evaluation.ts`, `rules.ts`, `rule-state.ts`, and `runtime.ts`; trace every `Jev.evaluate`/investigate caller.
4. Read-only: `src/lib/providers/responses.ts`, `src/lib/intake/extract.ts`, and B’s delivered supporting-document and procedure contracts.
5. `evals/comparison/findings/2026-09-20/{README,report}.md`; preserve those published artifacts.

The isolated benchmark reported Sift **39/50** correct and **19/30** valid matched versus **47/50** and **29/30** for the direct PDF-to-Azure baseline. Sift flagged 8/8 violations and 6/6 duplicates, with zero unsafe matches; every valid exception had an unknown merchant check. Ten unfamiliar merchants lack corroborating identity evidence. Median 2.287s versus 2.542s and estimated $0.0183 versus $0.0726 do not establish equivalent quality, human-time savings, production behavior, or isolated Jev causality. Labels are unreviewed and costs assumed.

## 1. Consume B’s additive seams

**Files:** `intelligence/index.ts`; new `intelligence/investigation.ts` and `investigation.test.ts`; no shared-contract edits.

- [ ] Keep `investigate(input, tools, options)` at three arguments and retain every existing port method/export. Existing `ProviderOptions` supplies mode, cancellation, and usage logging.
- [ ] Tools are exactly `read_receipt`, `read_supporting_documents`, `find_related_claims`, `read_policy`, and `read_active_aliases`; B binds them to authoritative stored evidence and persists each real invocation.
- [ ] `read_receipt` includes stored extracted text. Supporting-document results include extracted facts/provenance and source references. Use those facts without re-extracting the original PDF.
- [ ] Preserve existing `InvestigationResult` fields/status (`completed|unavailable`), adding findings, unresolved question, and proposed learning only as frozen. Completion here describes C’s work, not a published resolution or human approval.
- [ ] B preserves the legacy `ReviewRow.investigation` projection and adds `latest_investigation?: InvestigationRun|null`; list/detail endpoints use the full public run. C never returns a competing public run DTO.
- [ ] Public tool progress uses `InvestigationRunStep`; legacy `InvestigationStep` remains compatible. `InvestigationFinding.evidence_refs` uses typed `EvidenceRef` records with kind/id, not invented freeform links.
- [ ] B implements `RECONCILIATION_INVESTIGATION_MODE=disabled|simulated|live`, default disabled, and extends `responsesConfig('investigation')`. Import it and `responsesHeaders`; do not implement another endpoint/key resolver.
- [ ] Live investigation requires the existing Azure deployment and B’s live Supabase/Jev configuration. Disabled makes no calls; explicit simulation is offline and labeled. No fallback from live errors to fixture answers.
- [ ] B exposes capability flags only for implemented paths. A failed/unavailable dependency cannot be represented as a completed simulation; disabled start returns the frozen unavailable error.

**Dependency acceptance:** confirm types compile after B’s contract delivery. If a required field/config seam is absent, report the exact dependency; continue mocked planner tests rather than modifying B’s files.

## 2. Implement a small tool-calling planner

**Files:** `intelligence/investigation.ts`, `index.ts`, and `investigation.test.ts`.

- [ ] Use the existing Azure Responses transport pattern and server-only configuration. The model chooses relevant read tools from the five-tool allowlist; do not route on claim/fixture IDs or expected labels.
- [ ] Start from the claim and existing checks, including unknown reasons. Request additional evidence for recoverable uncertainty; do not promise a merchant identity absent from receipt/supporting evidence.
- [ ] Enforce at most **three model planning rounds and six read-tool calls**. Count every attempted provider/tool call, including failures and repeated requests. Validate tool name, arguments, call identity, and response structure before dispatch.
- [ ] Use B’s 90-second investigator-plus-final-reassessment deadline and passed signal. Planning/tools have at most 65 seconds, reserving up to 25 seconds for final assessment; bind each request to the outer signal and remaining deadline. Stop scheduling when aborted. Budget exhaustion without valid output is `BUDGET_EXHAUSTED`, not successful completion.
- [ ] Do not retry implicitly. B requires an assessed pending claim for manual runs; a clear mandatory financial failure does not need investigation calls to remain flagged.
- [ ] Each tool request consumes capacity before it runs. Unknown tools, malformed output/arguments, over-budget batches, timeouts, and provider errors remain explicit failures; do not execute side effects from model text.
- [ ] Return each observed tool result with its matching tool-call ID through the Responses continuation protocol. Keep evidence bounded; report missing/over-limit evidence rather than silently dropping contradictions.
- [ ] Enforce 12,000 original-receipt-text characters and 24,000 total supporting-text characters per planning/assessment input. `EVIDENCE_LIMIT` leaves the affected check unresolved. The claim has at most eight supporting documents; tool reads never upload or extract them.
- [ ] Produce final structured findings within the three planning responses. Do not add a fourth synthesis/narration call. If planning ends without a valid supported result, return/throw the frozen error instead of fabricating completion.
- [ ] Provider/invalid-output failures reject; `unavailable` is reserved for explicit disabled/unimplemented mode. B persists the failed run, null outcome, and no successful after-assessment while retaining prior mandatory failures.
- [ ] All receipt text, filenames, vendor names, notes, related claims, policies, and supporting text are untrusted data. Instructions inside evidence cannot alter tools, budgets, policy, decisions, or procedure activation.
- [ ] Findings identify the affected check, observed facts, evidence references, and remaining uncertainty. Cite only IDs returned by tools; reject nonexistent or foreign references. Do not reveal a hidden reasoning transcript.
- [ ] Record actual Azure model identity, latency, token usage when returned, and failures through `options.log_usage` exactly once per HTTP attempt. Missing tokens/cost stay null; do not infer them from text length.
- [ ] Return evidence, proposed learning, and a concise user-facing summary. Do not compute the authoritative `resolved|discrepancy_found|needs_human` outcome, alter assessment, approve, or persist a rule.
- [ ] Reuse existing `next_action` values truthfully. A booking procedure proposal uses `proposed_learning`; do not mislabel it as a scoped alias or manufacture new legacy action values.
- [ ] Build explicit simulated operation from available facts and real tool callbacks, labeled simulated. Never return hardcoded success by fixture ID, model unavailable, or elapsed timer.

B owns actual step persistence: run ID, ordered sequence, tool, running/completed/failed status, timestamps, sanitized summary, references, and errors. Return only actually observed steps; B validates them and wraps callback execution. A polls those persisted records while the awaited POST runs.

**Focused acceptance:** mock one model choosing receipt/supporting/policy tools and completing with valid references; reject a prompt-injected tool, invented reference, malformed response, seventh tool, fourth round, failed tool, timeout, and pre-aborted call. Confirm zero hidden extraction calls and no writes.

## 3. Use richer evidence without weakening Jev

**Files:** `core/jev.ts` and `core/tests/jev.test.ts`. B updates `SemanticState` producers and core verdict conversion in its owned files.

- [ ] Preserve three-argument `Jev.evaluate(state, runId, log)` callers and exported `Jev`, `LiveJev`, `SimulatedJev`, `questions`, and `validateAnswers`. Add 00's optional fourth `signal?: AbortSignal`; combine it with the current transport timeout so B's remaining deadline cancels the actual request. Use additive state fields agreed with B for receipt text, supporting facts, policy applicability, and procedure evidence.
- [ ] Keep the native TypeSafe/Gateway transports and existing configured model selection; this phase does not migrate Jev APIs or add an SDK.
- [ ] Merchant judgment may use actual receipt text, linked booking identity/reference, and applicable active knowledge. Missing or conflicting corroboration stays unknown; a name that merely resembles a hotel is not evidence of category.
- [ ] Name judgment may use a linked itinerary only when B supplies an applicable policy with `claimant_identity_evidence: 'receipt_or_linked_itinerary'` and matching nonempty reference/claimant evidence. Absent policy metadata means receipt-only; an absent receipt traveler remains unknown. Never invent a global identity exemption.
- [ ] Duplicate judgment uses B’s narrowed prior candidates and actual corroboration. Same amount/merchant/date alone is insufficient; similarity scores are not duplicate proof. Different document forms can still identify the same purchase.
- [ ] Keep exact required answer keys `merchant`, `name`, `duplicate`; choices and probability keys `pass|fail|unknown`; finite range checks, sum/max validation, confidence validation, timeout, and once-per-attempt logging.
- [ ] Preserve application thresholds **0.85 chosen-answer probability / 0.70 confidence**. B records chosen answer/probability/confidence and explicit conversion reasons; do not reinterpret probability as calibrated accuracy.
- [ ] Keep trusted evidence instructions on every question. Model answers cannot bypass extraction, amount, currency, policy/date/cap, duplicate, revision, or approval checks.
- [ ] Keep provider errors visible. Simulated semantics stays explicitly labeled, fact-based, and network-free; it must not learn fixture IDs or hidden expected outcomes.

**Acceptance:** dedicated tests preserve old three-argument callers and strict validation, demonstrate evidence passed unchanged, reject instruction-bearing evidence as authorization, and cover supporting-name permission present/absent. Coordinate actual deterministic matching and mandatory financial assertions with B’s tests; C does not duplicate core policy logic.

## 4. Add the separate booking-reference activation suite

**Files:** new `intelligence/procedures.ts` and `procedures.test.ts`; `index.ts` wiring. Keep existing `learning.ts`/`learning.test.ts` and ten-case `alias-v1` unchanged.

B exports `createAssessProcedureExample(core, observe?): AssessProcedureExample` from `core/evaluation.ts`. `ProcedureFacts` extends `EvaluationCase['facts']` with `supporting_documents: SupportingDocument[]`. Its callback is `assess(facts, aliases, procedures, signal): Promise<Assessment>`; `EvaluationObservation` adds optional `procedure_ids` without breaking old callers.

C supplies optional port methods `build_procedure_suite(procedure): ProcedureEvaluationCase[]` and `evaluate_procedure(input: ProcedureEvaluationInput, assess: AssessProcedureExample): Promise<ProcedureTestReport>`. Import exact types from B’s contract; do not create parallel interfaces.

- [ ] Build fixed `booking-reference-v1` facts for the candidate’s exact hotel/USD observed descriptor and canonical merchant. Exclude the source claim and the 20 demo claims; use independent deterministic synthetic bytes/facts and stable case IDs.
- [ ] Required matching values come from extracted receipt and linked booking evidence. Both references must be nonempty and agree after case/trimmed-collapsed-whitespace normalization; preserve meaningful reference characters, nonmatching references, and canonical identity conflicts.
- [ ] Freeze these **12 cases**, including source references and applicable policy in each input. Expected outcomes stay outside provider-visible facts.

| Case | Required assertion |
| --- | --- |
| `valid_a`, `valid_b` | Two distinct new eligible purchases, matching references and identity; each can match safely |
| `missing_booking` | No required booking evidence; procedure cannot apply |
| `conflicting_reference` | Receipt and booking disagree; procedure cannot apply |
| `unrelated_descriptor` | Different ambiguous descriptor; procedure cannot apply |
| `missing_traveler` | No identity evidence or applicable exception; remains unresolved |
| `overclaim` | Requested cents exceed receipt by one; flagged |
| `over_cap` | Matching requested/receipt amount exceeds policy cap by one; flagged |
| `non_usd` | Explicit non-USD receipt; flagged |
| `out_of_policy_date` | Receipt outside applicable date range; flagged |
| `exact_duplicate` | Earlier same purchase with real matching evidence; flagged |
| `wrong_category` | Procedure is out of scope; assess remaining facts, with no forced category flag |

- [ ] For unresolved negative cases, freeze ambiguous facts so the expected label is supported. Do not change truth simply because the model returns a different safe label. Wrong-category facts must clearly specify their independent expected assessment.
- [ ] Reject malformed procedure scope, incomplete/changed suite, duplicate identities, source leakage, and already-active candidate inclusion. Do not accept arbitrary client-authored cases.
- [ ] Compare identical facts, aliases, references, and evidence before/after; change only candidate procedure availability. Call the supplied production scorer for both phases, preserving paired order and at most three concurrent pairs.
- [ ] Preserve observations for every attempted assessment. Stop scheduling on failure/abort and await already started work; never turn a failed provider into a correct `needs_review` or report an incomplete suite as passed.
- [ ] Gate on at least one correctly resolved different positive purchase using the procedure, zero unsafe matches, zero previously correct regressions, no protected-check regressions, no decrease in correct count, and complete observations. Actual check evidence must prove application; scorer input IDs alone are insufficient. If baseline already resolved it using more work, new correctness is not required; do not fabricate accuracy improvement.
- [ ] A later claim must still satisfy evidence requirements. Missing/conflicting booking evidence cannot be replaced by a blanket vendor alias; active procedures cannot bypass name or financial/duplicate checks.
- [ ] Return `ProcedureTestReport` with actual counts, `applied_case_ids`, regressions, reasons, suite version, and mode. Do not add invented model/hash fields to that DTO. B stores observations and source/evidence/knowledge/procedure/model/suite-hash bindings separately, saves failures, and checks freshness on activation.

**Dependency acceptance:** B must supply the real supporting-evidence/procedure scorer before the integration gate can pass. Fake scorers test C’s orchestration only; no copied assessor or model-only alternative is acceptable.

## 5. Integrate one truthful learning demonstration

- [ ] With B, Devin, and the fourth teammate, choose a supported source from the separate 20-claim pack: 10 straightforward valid, 8 evidence/duplicate/lookalike/identity cases, one genuinely incomplete, and one clear violation.
- [ ] Verify first investigation reads actual synthetic clues and returns linked findings. B performs one final `CoreService.assess` in the existing lease; C never calls `reconcile` or acquires a second lease.
- [ ] Reviewer accepts the supported correction through a separate human decision. B derives a draft via `{run_id,expected_review_revision}`; C does not create a procedure merely because the model proposed one.
- [ ] B allows the later approval revision when evidence is unchanged, then binds the current approval/source revision to proof. Source withdrawal or changed evidence invalidates the candidate’s eligibility.
- [ ] Test/activate the versioned procedure through B’s server-bound lifecycle, then assess a different later claim with its own matching booking evidence. Keep the incomplete and financial-violation cases visibly blocked.
- [ ] Record actual steps/calls/time for first investigation and later procedure reuse. A correctness tie is valid; reduced work must be measured from the real trace, not assumed from activation or shown by fake activity.
- [ ] Keep any recorded demonstration labeled as a recording and simulation labeled simulated. No human-time or independent accuracy claim follows from the development pack.

## Focused verification and handoff

Run from `reconciliation/` on Node 24 after B’s typed handoff. New paths below become runnable when created:

```sh
node --conditions=react-server --import tsx --test src/lib/intelligence/investigation.test.ts src/lib/intelligence/procedures.test.ts src/lib/core/tests/jev.test.ts
npm run test:intelligence
npm run typecheck
```

Mock transport tests cover round/tool/deadline limits, exact references, hostile evidence, failures, no writes, and actual usage once per attempt. Procedure tests cover 12-case repeatability/label isolation, facts-only pairing, missing/conflicting evidence, unsafe matches, regression, complete observations, and interrupted evaluation. B verifies freshness, SQL, source withdrawal, and real financial guards; retain existing tests.

The coordinator reserves the live slice budget before execution: supporting extraction as needed, at most three Azure planning calls, one final Jev assessment, and separately budgeted paired procedure tests. Record every attempt and error; do not probe providers or run broad live suites repeatedly. Existing runtime rejects live core on local storage; use the agreed isolated Supabase target, with no workaround.

Deliver changed paths/signatures, actual offline commands/results, model/tool count trace, one supported findings example, one missing/conflicting-evidence example, and remaining B dependencies. Distinguish mock, simulated, historical benchmark, and fresh live observations. No optional custom editor or P1 financial grouping until P0 is accepted and allocation contracts are explicitly renewed.
