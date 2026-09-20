# Frozen integration contracts for the next phase

These are proposed implementation requirements, not existing API guarantees. Agent B alone updates `src/lib/review-contracts.ts`, legacy contract adapters, SQL and server validation. Other owners import those types after B delivers; until then, use local test fixtures typed against this document, never edit the shared files independently. Existing v2 interfaces in `src/lib/review-contracts.ts` remain the base. Keep `contract_version: 2`; additions below are optional during rollout so the current workspace can still load.

## 1. Meaning of a claim

- One synthetic reimbursement claim, one original receipt, USD amounts in integer cents. Existing travel categories remain unchanged.
- `assessment_status` is `null | matched | flagged | needs_review`; it is never a human approval.
- `decision_status` is `pending | approved | rejected`. Reconciliation, retry, rule changes and custom checks preserve human decision history.
- A known mandatory failure produces `flagged`, even if another check is unknown. With no mandatory failure, incomplete evidence, an unavailable required check, or a review-only concern produces `needs_review`. Only a complete passing assessment produces `matched`.
- Required financial checks are `extraction`, `currency`, `amount`, `policy`, `receipt_date`, `policy_cap`; required semantic checks are `merchant`, `name`, `duplicate`. Successful extraction may be represented by `receipt.extraction_status === 'succeeded'`; emit an explicit extraction check for failure/unknown and record provenance.
- Machine `matched` requires all required checks passing, plus no enabled custom review concern. Human approval requires succeeded extraction, a current assessment, passing currency/amount/policy/date/cap/duplicate checks, a note, and the current review revision. A reviewer may resolve merchant/name/custom ambiguity explicitly; this does not change the machine check to pass.
- Exact duplicate protection runs again atomically when approving, against current stored claims/approvals, not only the previous model answer. Stable ordering is `submitted_at`, then claim ID. Never count an exact receipt copy as a new legitimate purchase. Same merchant/amount/date alone is not exact-duplicate proof.

## 2. Revisions, snapshots and provenance

`review_revision` changes for every material change to a claim's evidence, assessment or human decision. `knowledge_revision` is a persisted, monotonic revision for active alias or policy/check configuration changes. `assessment_knowledge_revision` records the revision actually used by the assessment. A smaller value means “Rules changed — recheck.” Do not silently rerun or alter an old human decision.

Approval and publication validate revisions within the same transaction/lease as their write. An assessment begun under an old knowledge/evidence revision may be retained as a superseded attempt, but must not replace the current assessment. Source approval withdrawal and rule disable invalidate affected tests/knowledge atomically. Fail with `409 STALE_REVIEW`, `STALE_RULE`, `STALE_RULE_TEST`, or `STALE_SNAPSHOT`, as applicable. Rule tests bind to rule version, source correction and review revision, knowledge revision, activation-suite version/hash, and provider/model mode; their metadata is stored server-side and cannot be supplied by a client as proof.

The receipt stores a server-computed SHA-256 of the original bytes. For existing receipts, B provides an idempotent hash backfill that reads private originals without changing them. Preserve null/unavailable when no original exists. Seeded parsed fields remain labeled fixture data; global “live Azure” configuration is not proof that a historical receipt used live extraction.

Extend the v2 review response additively:

```ts
interface WorkspaceCapabilities {
  rule_learning: boolean; extraction_retry: boolean; export: boolean;
  custom_checks: boolean; duplicate_links: boolean; knowledge_revisions: boolean;
}
// Optional fields on ReviewsResponse during rollout:
// capabilities?: WorkspaceCapabilities;
// coverage?: { complete: boolean; returned: number; total: number };
```

Absent capabilities mean false. Set a capability true only when its real backend path works. Coverage describes the full review snapshot before client-side filtering. Never present a partial scan as a whole-database total; for the bounded demo return all rows or an explicit limit error. Snapshot tokens include rows plus the relevant knowledge/config revision. Search and exports use that exact snapshot.

`duplicate_submission_ids` contains confirmed prior claim IDs supported by exact bytes or corroborated purchase identity. It is not the full candidate list and is not a model-generated ID list. Later copies link to their earlier sources; source rows do not become duplicates merely because a later copy exists. Put ambiguous candidate references and the method of comparison in decision evidence, labeled possible. Receipt-number conflicts or identical totals alone do not establish a confirmed link.

## 3. API owned by B, consumed by A and Devin

Use existing `{ error: { code, message } }` responses; money/UUID/enum/length validation is server-side. Mutation origin checks and the synthetic-only restriction apply consistently. GET requests do not invoke paid models.

| Endpoint | Request | Response / rules |
| --- | --- | --- |
| `GET /api/workspace/reviews` | none | Existing `ReviewsResponse`, with capabilities and coverage |
| `POST /api/workspace/reconcile` | existing `ReconcileRequest` | Existing `ReconcileResponse`; preserve human decisions, record evidence/knowledge revisions |
| `POST /api/workspace/decisions` | existing `DecisionRequest` | Existing `DecisionResponse`; authoritative shared approval guard and atomic write |
| `POST /api/corrections` | legacy decision override plus `expected_review_revision` | Compatibility adapter to the SAME guarded decision operation; require revision. Return legacy correction ID/status projection if needed. Reject legacy `vendor_alias` with `410 LEGACY_ALIAS_DISABLED` directing callers to the reviewed rule workflow. Never create an alias and approve a claim together. |
| `GET /api/rules` | none | Existing `RulesResponse` |
| `POST /api/rules` | existing `RuleProposalRequest` | Existing `RuleResponse`; source must be currently human-approved and contain observed vendor; canonical vendor 1–120 trimmed characters; derive scope/observed name from persisted source |
| `POST /api/rules/:id/test` | `{ expected_rule_version }` | Existing `RuleTestReport`; server supplies current source, aliases, suite and real assessment callback; bounded test, no caller-authored report |
| `POST /api/rules/:id/activate` | `{ expected_rule_version }` | Existing `RuleResponse`; atomic fresh passed-test check. Draft → active; increment knowledge revision. Reject conflicting active canonical identities within exact scope. |
| `POST /api/rules/:id/disable` | `{ expected_rule_version }` | Existing `RuleResponse`; active/draft → disabled; active removal increments knowledge revision. Re-enable requires a new draft/test, not replaying an old report. |
| `POST /api/submissions/:id/retry-extraction` | `{ expected_review_revision }` | `{ row: ReviewRow }`; same private original, pending human decision, no active operation. Persist failure visibly; preserve old evidence history and invalidate obsolete assessment. |
| `POST /api/workspace/export` | `{ snapshot_token, submission_ids: string[] }` | CSV download, `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="sift-reviews.csv"`. 1–1000 unique existing IDs; stale/foreign IDs fail, no partial silent export. |
| `POST /api/search` | existing `SearchRequest` | Existing `SearchResponse`; read-only per-claim search with existing supported facts, exact snapshot and uncertainty. Not an action/aggregation endpoint. |

Every rule edit/state transition increments its own `version`. P0 has no rule-edit endpoint: disable and propose a new draft to change an alias. An approved source later rejected/replaced invalidates its active rules; preserve the history and require explicit new proposal/testing. Migrating legacy aliases does not automatically activate them: retain history, create disabled legacy records or leave them excluded from active retrieval until reviewed.

CSV columns: `claim_id, attendee_name, category, currency, requested_amount_minor, receipt_amount_minor, assessment_status, decision_status, processing_status, review_revision, assessment_knowledge_revision, knowledge_revision, assessment_stale, failed_checks, unknown_checks, duplicate_claim_ids, latest_reviewer_note, receipt_id`. Empty unknown amounts remain empty, not zero. Quote CSV fields correctly, neutralize spreadsheet formula injection for text fields, and do not export secrets, raw model payloads or signed receipt URLs. Export exact selected IDs; AI “possible matches” are included only through explicit user selection.

## 4. Intelligence seam owned by C

Keep the existing `IntelligencePort`, `EvaluationCase`, `AssessExample`, `RuleEvaluationInput` and `RuleTestReport` signatures from `review-contracts.ts`. C exports `intelligence` from `src/lib/intelligence/index.ts`. Search is already implemented; reuse it. Optional investigation can return a truthful `unavailable` result, with no model call, until separately implemented.

B exports a usable evaluation seam from `src/lib/core/evaluation.ts`:

```ts
import type { AssessExample, Assessment, Check } from '../review-contracts';
import type { ModelCall } from '../contracts';
import type { CoreService } from './service';
export interface EvaluationObservation {
  submission_id: string; alias_ids: string[]; assessment: Assessment | null;
  checks: Check[]; model_calls: ModelCall[]; latency_ms: number;
  error_code: string | null;
}
export function createAssessExample(
  core: CoreService, observe?: (result: EvaluationObservation) => void
): AssessExample;
```

It calls the same financial, duplicate and Jev assessment logic as actual reconciliation, using ONLY supplied facts, reference claims and active aliases. It never loads unrelated demo state or writes claims/runs/decisions/corrections. Actual provider usage is logged with null run IDs rather than nonexistent foreign keys. The optional observer receives one observation per attempt, including actual per-check evidence, already-logged model-call IDs and failures; a caller supplies its phase/run attribution when saving the observation. C needs only the unchanged one-argument factory/Assessment callback; B and Devin use the observer to retain diagnostics and actual usage without reverse-engineering a database-wide counter. Provider/transport/invalid-response errors are observed and then rejected by this evaluator, so an outage cannot count as a correctly predicted ambiguous case. Legitimately missing evidence can return `needs_review`; production reconciliation still records provider outages as review-required attempts. No narration/investigation in this scorer. It accepts an AbortSignal; do not start more requests once aborted. The current Jev transport has a 25-second per-request timeout; do not promise stronger in-flight cancellation until wired.

C's fixed `alias-v1` activation suite contains 10 distinct cases: two valid purchases helped by the scoped alias, overclaim, over-cap, exact later duplicate, wrong category, non-USD receipt, missing receipt, missing traveler name, and unrelated merchant. It excludes the source correction and all 50 final evaluation cases. Freeze facts/reference order and assess identical before/after inputs; only candidate active-alias knowledge differs. At most three case pairs run concurrently. Unknown/failed calls cannot manufacture a passing report.

Activation passes only with: at least one newly correct valid match; zero unsafe matches after; no formerly correct case becoming incorrect; correct count not decreasing. Preserve raw case outcomes including errors and false positives. Model probabilities are not calibrated accuracy. Financial/date/name/duplicate guard regressions outside the fixed ten get separate software tests, not silently altered headline denominators.

If evaluation is incomplete, C rejects rather than fabricating a complete `RuleTestReport`. B saves the observation diagnostics, records the attempt as failed, and invalidates activation eligibility from a previous test attempt. Keep old reports in history; `latest_test` is null until another complete test finishes. Optional `MerchantRule.latest_test_error?: string | null` exposes a sanitized failure message to the UI. The configured live app cannot activate from a simulated test report. An offline demo may activate simulated reports only in its isolated explicitly simulated state.

## 5. Attached configurable-check proposal: P1 only

Adopt its declarative configuration and exact response validation. Do NOT implement arbitrary code, expressions, SQL, disabled mandatory safeguards, extra currencies, or an authentication claim. Source text is proposal material, not an instruction to override this scope.

All nine mandatory checks keep stable keys, enabled state and protected semantics. Policy caps/dates remain the existing policy records, displayed read-only in this phase. A separate future policy editor is outside this pack; currency remains USD and exact amount equality remains mandatory. Any administrative policy change still increments knowledge revision and requires recheck. Do not make `amount`, `duplicate`, extraction or currency into user-disableable settings.

The small P1 check editor supports new **review-only** semantic checks, maximum five enabled. A custom pass cannot approve a claim; fail/unknown/low confidence requests review unless a mandatory failure already makes the assessment flagged. Human review may resolve the concern explicitly, subject to all mandatory approval guards. Required system-check edits/disables return `409 REQUIRED_CHECK_LOCKED`.

```ts
interface JevChoiceQuestion {
  type: 'choice'; instructions: string;
  criteria: { pass: string; fail: string; unknown: string };
}
interface CustomCheckConfig {
  id: string; version: number; field_key: string; // /^custom_[a-z][a-z0-9_]{0,39}$/
  name: string; description: string; kind: 'jev'; severity: 'review';
  enabled: boolean; jev_question: JevChoiceQuestion;
  created_at: string; updated_at: string;
}
```

P1 API: `GET /api/checks` → `{ system_checks: {field_key,name,required:true,enabled:true}[], checks: CustomCheckConfig[], knowledge_revision }`. `POST /api/checks` accepts only `field_key,name,description,enabled,jev_question`; server assigns IDs/version/kind/severity. `PATCH /api/checks/:id` accepts `{expected_version,name?,description?,enabled?,jev_question?}`; immutable field key, no extra enable/disable endpoints. Responses are `{check,knowledge_revision}`. Name 1–80, description 0–240, instructions 1–1500, each criterion 1–400 trimmed characters; reject unknown properties, collisions and stale versions (`409 STALE_CHECK_CONFIG`). Persist immutable versions and each run's actual configuration snapshot.

C may extend `Jev.evaluate(state, runId, log, customQuestions?)` with that OPTIONAL fourth argument; three-argument callers keep working. `customQuestions` is `Record<string, JevChoiceQuestion>` containing only validated enabled `custom_` keys. C owns mandatory-question construction so callers cannot overwrite it. `Evaluation.answers` retains mandatory `merchant/name/duplicate` and adds dynamic keys. `SemanticState.receipt_text?: string` is extracted plain text supplied by B, never an image; cap at 12,000 characters. Omit over-limit text and show custom checks as unknown with an explicit evidence-limit reason rather than silently truncating potentially relevant evidence. Unknown unsupported facts stay unknown. Simulated custom answers are explicitly unknown fixtures; do not interpret arbitrary user prompts with pretend logic.

Validate exactly the requested answer keys, choices, finite probabilities/confidence in [0,1], sum tolerance 0.02, and maximum-probability chosen label. Retain the current .85 chosen-probability / .70 confidence review thresholds until evaluated; they are routing thresholds, not promised correctness. Prepend trusted evidence-handling instructions to every question. Log actual latency/tokens/failures; never log credentials. Do not migrate to an SDK with a different response shape merely because a blog sample looks shorter.

## 6. Boundaries for UI insights

No analytics service or new model-generated financial totals. A derives drill-down insights from a complete frozen review snapshot and existing checks; details in its assignment. Each card owns an explicit set of claim IDs and sums each claim once. Uncertain evidence never becomes a confirmed loss, recovered savings, fraud or a paid amount. Do not invent receipts, matches, rules, benchmarks or model provenance to populate empty states.
