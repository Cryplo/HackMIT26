# Shared contracts: investigation and booking-reference learning

**Proposed implementation contract, frozen for this build pack on 2026-09-20. These additions are not implemented at `9f3d593`.** Read [README](README.md). B alone publishes shared TypeScript declarations, request validation, storage and API adapters; A/C/Devin consume them. Changes to this document during implementation are coordinated through B before dependent edits. Preserve existing `contract_version: 2`, alias types/endpoints, `AssessExample`, search, decisions, retry and export. Add fields; do not silently reinterpret old fields.

## 1. Existing invariants still apply

A claim is one purchase, one original receipt, USD in integer cents. Supporting documents are evidence for that purchase, not additional reimbursable totals. Machine assessment is `matched | flagged | needs_review | null`; human decision is `pending | approved | rejected`. All mandatory checks must pass for `matched`. Known mandatory failure wins over unknown checks. Exact amount, currency, policy/date/cap, successful extraction and confirmed duplicate protection remain mandatory.

Approval uses the existing common guarded operation, reviewer note, expected review revision, current assessment/knowledge and an atomic current duplicate check. Reassessment and learning never modify human decision history. Same merchant/date/amount alone is not duplicate proof. Hash equality means reused bytes, not blanket permission for a split. P0 has no split/aggregation support.

Evidence or knowledge changes invalidate affected assessments and activation tests. Capture evidence/review/knowledge revisions at operation start; validate them in the same transaction/lease as publication. A stale attempt can remain in history but cannot replace the current assessment. Source withdrawal or source-evidence change invalidates dependent active knowledge. Keep existing `409 STALE_REVIEW`, `STALE_RULE`, `STALE_RULE_TEST`, `STALE_SNAPSHOT` behavior; use `STALE_RUN` for superseded runs. No stale success, client test proof or silent overwrite.

## 2. Additive data types

Types below belong beside the existing declarations in `reconciliation/src/lib/review-contracts.ts`; referenced `Assessment`, `Check`, `ProviderMode`, `ActiveAlias`, `EvaluationCase`, `EvaluationMetrics`, `ProviderOptions` already exist. Storage-only paths, credentials, raw provider payloads and activation proof never enter browser DTOs. ISO timestamps and server-issued UUIDs throughout; `claim_id` below is the existing submission ID, not a new entity.

```ts
export type DocumentKind = 'booking_confirmation' | 'itemized_document' | 'itinerary' | 'payment_confirmation' | 'other';
export interface EvidenceRef {
  kind: 'receipt' | 'supporting_document' | 'claim' | 'policy' | 'alias' | 'procedure';
  id: string;
}
export interface SupportingDocument {
  id: string; claim_id: string; kind: DocumentKind;
  file_type: string; sha256: string; created_at: string;
  extraction_status: 'pending' | 'succeeded' | 'failed';
  extraction_error: string | null; extraction_provenance: string | null;
  extracted_text: string | null;
  facts: {
    vendor: string | null; booking_reference: string | null;
    receipt_number: string | null; names: string[];
    purchase_date: string | null; currency: string | null; amount_minor: number | null;
  } | null;
}
export interface InvestigationFinding {
  id: string; check: string; statement: string; evidence_refs: EvidenceRef[];
}
export interface InvestigationAssessment {
  assessment_status: Assessment | null; checks: Check[];
  review_revision: number; evidence_revision: number; knowledge_revision: number;
}
export interface ProcedureCandidate {
  kind: 'booking_reference_identity';
  trigger_scope: { category: 'hotel'; currency: 'USD'; observed_vendor: string; canonical_vendor: string };
  required_evidence: ['receipt', 'booking_confirmation'];
  matching_fields: ['booking_reference']; source_evidence_refs: EvidenceRef[];
}
export interface InvestigationRunStep {
  id: string; run_id: string; sequence: number;
  tool: 'read_receipt' | 'read_supporting_documents' | 'find_related_claims' | 'read_policy' | 'read_active_aliases';
  status: 'running' | 'completed' | 'failed';
  started_at: string; completed_at: string | null;
  summary: string; evidence_refs: EvidenceRef[]; error: string | null;
}
export interface InvestigationRun {
  run_id: string; claim_id: string;
  trigger: 'manual' | 'recoverable_uncertainty';
  status: 'running' | 'completed' | 'failed' | 'superseded';
  outcome: 'resolved' | 'discrepancy_found' | 'needs_human' | null;
  headline: string; summary: string; unresolved_question: string | null;
  findings: InvestigationFinding[];
  before_assessment: InvestigationAssessment;
  after_assessment: InvestigationAssessment | null;
  proposed_learning: ProcedureCandidate | null;
  steps: InvestigationRunStep[];
  started_at: string; completed_at: string | null;
  mode: ProviderMode; model: string | null; error: string | null;
}
export interface ProcedureTestReport {
  procedure_id: string; procedure_version: number; knowledge_revision: number;
  suite_version: 'booking-reference-v1'; mode: ProviderMode; tested_at: string;
  passed: boolean; applied_case_ids: string[]; regressed_case_ids: string[];
  before: EvaluationMetrics; after: EvaluationMetrics; reasons: string[];
}
export interface ResolutionProcedure extends ProcedureCandidate {
  id: string; version: number; state: 'draft' | 'active' | 'disabled';
  source_claim_id: string; source_run_id: string; source_correction_id: string;
  created_at: string; latest_test: ProcedureTestReport | null;
  latest_test_error: string | null;
}
```

Add optional `WorkspaceCapabilities.supporting_documents`, `.investigations`, `.resolution_procedures`; absent means false, true only for implemented paths. Add optional `ReviewRow.latest_investigation: InvestigationRun | null`. Keep existing `ReviewRow.investigation` as its compatible legacy `InvestigationResult` projection. Do not feed the new run shape into a legacy renderer. New screens use the new run DTO.

Add optional `PolicyRule.claimant_identity_evidence: 'receipt_only' | 'receipt_or_linked_itinerary'` in both shared and storage policy types; absent means `receipt_only`. Persist the explicit reviewed choice on the applicable policy, including snapshots and knowledge-revision invalidation. There is no policy editor in P0. The itinerary exception requires nonempty matching booking/trip reference evidence, the named claimant, and no conflicting purchase/traveler facts; an unrelated itinerary is insufficient. B supplies a reviewed, targeted policy update for the isolated demo only after the human confirms it. Do not reinterpret all existing policies as allowing supporting identity.

`before_assessment` is the frozen pre-investigation state. `after_assessment` is core's published assessment, never model-authored. Failed/superseded runs have `outcome:null` and no successful after-assessment. Preserve known financial failures/current valid history while displaying operation failure. Core derives outcomes: a complete `matched` assessment means `resolved`; a mandatory `flagged` assessment means `discrepancy_found`; otherwise `needs_human`. `resolved` still leaves the human decision pending. `unresolved_question` is required meaningful text for `needs_human`, otherwise null unless a discrepancy also requires clarification.

Evidence references must resolve to actual server-stored records supplied to that run; validate kind, ownership and revision, not just UUID shape. Referenced related claims are read-only. A generated quotation, URL or ID is not evidence. Step summaries are short factual descriptions of tool input/output, never hidden chain of thought. Failed actual calls remain steps. Synthetic/recorded provenance is explicit.

## 3. HTTP surface owned by B

All mutations retain origin and synthetic-only guards, strict input validation and `{error:{code,message}}`. GET requests never invoke models. UUIDs, enums, revisions and unexpected properties are checked on the server. No new authentication claim: this remains a private synthetic demo.

| Endpoint | Request | Response / behavior |
| --- | --- | --- |
| `GET /api/submissions/:id/supporting-documents` | none | `{documents: SupportingDocument[]}` for that existing claim |
| `POST /api/submissions/:id/supporting-documents` | multipart `file`, `kind`, `expected_review_revision` | `{document: SupportingDocument, row: ReviewRow}`; await bounded extraction, preserve visible failure |
| `GET /api/submissions/:id/supporting-documents/:documentId` | none | Private original bytes, correct MIME and safe filename; verify document belongs to claim |
| `POST /api/submissions/:id/investigate` | `{expected_review_revision:number}` | Await bounded execution, then `{run: InvestigationRun, row: ReviewRow}`; no detached promise/queued fiction |
| `GET /api/investigations` | optional `claim_id` UUID | `{runs: InvestigationRun[], coverage:{complete:boolean,returned:number,total:number}}`; newest first, bounded at 1,000, explicit limit error instead of hidden truncation |
| `GET /api/investigations/:runId` | none | `{run: InvestigationRun}` |
| `GET /api/procedures` | none | `{procedures:ResolutionProcedure[],knowledge_revision:number}` |
| `POST /api/procedures` | `{run_id:string,expected_review_revision:number}` | `{procedure:ResolutionProcedure,knowledge_revision:number}`; derive reviewed candidate/source from persisted completed run |
| `POST /api/procedures/:id/test` | `{expected_procedure_version:number}` | `ProcedureTestReport`; report generated/stored server-side |
| `POST /api/procedures/:id/activate` | `{expected_procedure_version:number}` | `{procedure,knowledge_revision}` after atomic fresh passing-test validation |
| `POST /api/procedures/:id/disable` | `{expected_procedure_version:number}` | `{procedure,knowledge_revision}`; retain history, invalidate proof |

Once a run is persisted, an execution/provider failure returns its truthful `failed` run in the awaited response; invalid input/missing capability/stale start remains the error envelope with appropriate HTTP status. On transport interruption the client reads the saved run; do not auto-repeat a paid POST. Read list by claim while start POST is pending so progress is visible before it returns. Capability unavailable returns `503 INVESTIGATION_UNAVAILABLE` or `PROCEDURE_UNAVAILABLE` without spending.

Supporting upload reuses existing PDF/PNG/JPEG signature validation and 8 MiB file limit; maximum eight supporting documents per claim. Validate serialized decimal revision. Acquire claim operation protection before storing/extracting, compute SHA-256 from bytes, never trust filename/type/hash or client-authored facts. Reject evidence edits on approved/rejected claims in this phase. Appending failed extraction still records provenance and invalidates affected assessments. Refuse active-operation conflicts with `409 RUN_ACTIVE`; duplicate upload bytes within the claim return `409 DOCUMENT_EXISTS` without another extraction. No replace/delete API in P0. Keep originals private and retain potentially committed evidence after uncertain writes.

## 4. Intelligence and shared assessment seams

Keep `IntelligencePort.investigate(input, tools, options)` with three arguments. Add `read_supporting_documents(): Promise<SupportingDocument[]>` to `InvestigationTools` and its name to `InvestigationTool`. `read_receipt` includes stored extracted text. Add optional `findings: InvestigationFinding[]`, `unresolved_question: string | null`, and `proposed_learning: ProcedureCandidate | null` to existing `InvestigationResult`. Preserve old result fields/statuses. Provider/invalid-output failures reject; old explicit unavailable behavior is only for disabled/unimplemented mode. B maps findings to the public run after evidence validation and actual core reassessment. Model output cannot supply final checks or approval.

B binds the five no-argument read tools to the current claim/snapshot; C's model selects which to call. B's wrappers persist actual tool start/end/failure and sanitized evidence. No sixth write/approve tool, arbitrary SQL, arbitrary file path, network fetch or model-supplied claim scope. Active procedures are applied by core; they are not an excuse for a new unrestricted tool. Do not persist a fictional tool step for direct procedure execution; show its source in assessment evidence.

At most **3 Azure planning requests**, **6 tool executions total**, and **1 final `CoreService.assess`**. Read calls may be selected together but execute within the same global budget. No fourth synthesis request. The final allowed planning response produces structured findings; budget exhaustion without a valid final result records a failed run with `BUDGET_EXHAUSTED`, not an invented completed outcome. A **90,000 ms** deadline covers investigation and reassessment. Limit planning/tools to 65,000 ms to reserve up to 25,000 ms for final assessment; bind both to the outer deadline. Propagate abort/remaining time to actual provider/tool requests, not merely an uninterruptible background promise. Add optional fourth `signal?: AbortSignal` to `Jev.evaluate(state, runId, log, signal?)`; existing three-argument callers remain valid. C combines it with the existing transport timeout, and B passes the assessment signal. No new calls after abort. No implicit retries. Record timeout, failures, model/channel and actual usage; missing token/cost fields are null.

B reuses the active claim lease and `CoreService.assess`, never a nested `reconcile`/`begin` that reacquires it. Manual trigger needs an assessed pending claim; automatic investigation is limited to recoverable uncertainty with useful available evidence. A clear mandatory financial violation needs no model investigation to stay flagged. Reuse stored text; reading a previously extracted PDF is not another extraction call. B supplies relevant stored text/facts to semantic checks, conservatively narrows duplicate candidates, and uses code for exact comparisons. Preserve Jev `.85` chosen-probability / `.70` confidence thresholds, log all choices/probabilities/confidence and why application logic used `unknown`.

Bound semantic evidence to 12,000 characters of original receipt text and 24,000 total supporting-text characters per assessment/planning input. Do not silently truncate evidence needed for a decision; report `EVIDENCE_LIMIT` and keep the affected check unresolved. Distinct amounts, conflicting booking references and different receipt numbers retain their distinctions. Receipt/document text is untrusted data, not instructions.

B extends existing `responsesConfig` to accept purpose `investigation`; the investigator uses existing Azure endpoint/key/deployment and `responsesHeaders`. New `RECONCILIATION_INVESTIGATION_MODE=disabled|simulated|live` defaults to disabled. Live requires Azure OpenAI plus the existing live Supabase/Jev configuration; missing/partial configuration fails visibly, never provider/simulation fallback. Simulation is isolated and explicit. These mode/config additions are proposed until B/C deliver them. No new SDK or provider needed.

## 5. The single reusable procedure

Keep existing alias learning intact. Store versioned booking-procedure metadata with existing knowledge/history/test transaction patterns; separate procedure DTOs/collections from alias payloads and prevent alias retrieval from consuming procedures. B chooses the minimal SQL representation while preserving these public interfaces, source invalidation and local-store parity. No general workflow engine.

Proposal requires a currently human-approved source with a note, a completed evidence-backed investigation and the current review revision. Validate its evidence is unchanged since investigation, allowing the explicit later approval revision itself. Derive scope, canonical merchant, required fields and source links from persisted reviewed evidence, not request JSON/model assertion alone. Default scope is exact normalized observed descriptor + canonical hotel identity + hotel/USD. Normalization trims/collapses whitespace and case; do not remove meaningful reference characters or invent fuzzy matching.

For each later claim require both documents and nonempty booking-reference values that match exactly after that normalization, established from successful stored extraction and traceable text/facts. Require the in-scope descriptor, consistent merchant/purchase identity and no conflicting evidence. No match on two empty values. Establish only the merchant relationship. A itinerary may establish claimant identity only if a specific applicable policy explicitly permits it; absent permission means unresolved, including during procedure application. All financial/name/duplicate checks still run. Missing/conflicting/out-of-scope evidence makes the procedure inapplicable, never a pass or a learned blanket alias.

Human reviews a draft; test is server-run; explicit activation checks a fresh passing report. Bind proof to procedure/version, source approval and evidence/review revision, knowledge revision, suite version/hash, actual provider/model/mode. Changes invalidate proof. Failed/incomplete tests clear activation eligibility, retain observations, and expose the error. Source withdrawal, evidence changes and disabling invalidate active knowledge atomically. Re-enable by a new draft/test; old reports cannot authorize it. Increment versions on lifecycle changes and knowledge revision on active knowledge changes.

The fixed **`booking-reference-v1`** suite has 12 independent cases: two valid new purchases; missing booking; conflicting reference; unrelated descriptor; missing traveler identity; overclaim; over-cap; non-USD; outside policy dates; exact duplicate; wrong category. These are separate from source, `alias-v1`, demo20 and future held-out cases. Out-of-scope procedure does not itself make an otherwise valid claim a financial violation. Gate: all paired attempts complete without provider errors, at least one different valid case correctly uses the procedure, zero unsafe after-matches, no correctness/protected-check regressions and no decrease in correct count. Baseline may already resolve a case with more work; do not require or fabricate an accuracy gain. Keep `alias-v1`'s existing gate unchanged.

B supplies the same real assessment/procedure application path for C's suite and independent verification:

```ts
export type ProcedureFacts = EvaluationCase['facts'] & { supporting_documents: SupportingDocument[] };
export interface ProcedureEvaluationCase { id: string; facts: ProcedureFacts; expected_assessment: Assessment }
export type AssessProcedureExample = (
  facts: ProcedureFacts, aliases: ActiveAlias[], procedures: ResolutionProcedure[], signal: AbortSignal
) => Promise<Assessment>;
export interface ProcedureEvaluationInput {
  procedure: ResolutionProcedure; active_aliases: ActiveAlias[];
  active_procedures: ResolutionProcedure[]; knowledge_revision: number;
  examples: ProcedureEvaluationCase[]; mode: ProviderMode; signal: AbortSignal;
}
// B exports from src/lib/core/evaluation.ts, alongside unchanged createAssessExample:
// createAssessProcedureExample(core: CoreService, observe?: (result: EvaluationObservation) => void): AssessProcedureExample
// EvaluationObservation adds optional procedure_ids: string[].
// Add optional methods to IntelligencePort during rollout:
// build_procedure_suite(procedure: ResolutionProcedure): ProcedureEvaluationCase[];
// evaluate_procedure(input: ProcedureEvaluationInput, assess: AssessProcedureExample): Promise<ProcedureTestReport>;
```

Scorer uses only supplied facts/aliases/procedures, never demo/global state, answers or writes to claims/decisions. C strips evaluator truth from inference input. Before/after differ only by candidate active procedure knowledge. Observe every attempt/check/actual usage/error; bind procedure application to check evidence, not merely an ID supplied to the scorer. At most three case pairs concurrent. Report incomplete testing as failure. No recursive investigator during the activation scorer. Measure actual saved tool/model work separately in the first/later-claim demonstration; lower work is not automatically a quality or human-time claim.

## 6. Persistence and release contract

B first inspects actual migrations, private originals and platform version. Base `202609190001_reimbursement_core.sql` and platform `202609200002_platform.sql` are present in source, not assumed applied. Apply a reviewed missing migration once, preserving data; complete the idempotent original-receipt hash backfill. No reset/reseed of shared storage.

Forward migration reserved here: `202609200003_investigations.sql` (not yet created). Add server-controlled supporting documents (claim, kind, private path, hash/MIME, extracted text/facts, status/provenance); steps linked to existing run IDs with unique `(run_id,sequence)` and timestamps/errors/refs; run trigger/result metadata; versioned procedure metadata/history/test bindings. Reuse existing usage/run identity and locking. Include supporting evidence and procedures in relevant snapshots/revision checks. Update SQL and FileStore/MemoryStore together. Revoke public/client writes to new tables.

Coherently advance `core_platform_version()` and application readiness requirements from **2 to 3** when the new schema is delivered. Do not deploy code that still requires exactly 2 against 3, or code requiring 3 before the forward migration. The database owner delivers exact migration/recovery commands and observed state. Never claim remote application or backfill success from offline SQL tests. No destructive rollback or fallback to legacy approval bypasses.

## 7. Cross-owner acceptance examples

- Unfamiliar merchant + matching real booking evidence: recorded tools → supported finding → core checks → ready for approval; human decision unchanged.
- Same purchase with booking/folio/payment slip: one reimbursable receipt total; duplicate evidence does not create additional money.
- Similar merchant/date/amount but distinct purchase identities: no automatic duplicate flag from candidate similarity.
- Missing booking/conflicting reference: saved procedure does not apply; useful question remains visible.
- Source reviewed/tested/activated, later in-scope claim: actual procedure reference/fields recorded, fewer observed investigation calls if successful; amount/cap/date/currency/name/duplicate guards retained.
- Evidence/knowledge change during run/test or concurrent approval: stale publication/activation rejected atomically, history preserved.
- Provider/tool failure: actual failed step/run visible after refresh, no successful after-assessment fabricated and known violations not erased.

Focus tests on these boundaries and one live end-to-end flow within the agreed budget. The new 20-claim pack is development/demo data, never an independent accuracy denominator. Preserve the historical benchmark unchanged.
