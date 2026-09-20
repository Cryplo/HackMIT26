# B — Supporting evidence, guarded investigation, and procedure persistence

Implementation assignment for the 4–8 hour Sift investigation phase. Follow [00-contracts.md](00-contracts.md) for additive DTOs and [README.md](README.md) for integration order. This document describes work to implement; it does not claim that migrations, tests, or live calls have run.

## Scope and current baseline

- Work only on `main` in your separate clone. Preserve unrelated edits; take the coordinator’s serialized delivery slot before integrating. No resets, shared reseeds, broad refactors, or new dependencies.
- Own `reconciliation/src/lib/core/**` except C’s `jev.ts` and `tests/jev.test.ts`; own `intake/**`, `providers/**`, shared contracts, API routes, SQL, and the core README.
- C owns `intelligence/**`, the semantic adapter, bounded planning, and procedure evaluation fixtures. A owns the workspace and Investigations UI. Devin alone writes the `evals/**` pack/artifacts; the fourth human teammate reviews evidence/policies/labels and handles demo/pitch, without parallel edits to those files.
- At `9f3d593`, guarded decisions, receipt retry/hash handling, SQL/FileStore locking, scoped alias proposal/test/activation/disable, and the real `createAssessExample` scorer already exist. Preserve them.
- `intelligence/index.ts` still returns unavailable. `DatabaseRetrieval` currently includes candidates sharing any amount, merchant, or date. `assess` supplies parsed receipt fields but not stored receipt text or supporting evidence.
- P0 preserves one original receipt and exact requested/receipt amount equality. Supporting booking, folio, itinerary, and payment documents describe that purchase; never sum them.
- P1 same-category USD distinct purchases needs renewed allocation contracts after P0 acceptance. No custom-check editor or unrestricted split reconciliation in this assignment.

## Read before editing

Paths below are under `reconciliation/` unless prefixed with `../`.

1. `AGENTS.md`, `src/lib/core/README.md`, `../docs/next-work/00-contracts.md`, and `02-intelligence.md`.
2. `src/lib/review-contracts.ts`, `src/lib/contracts.ts`, `src/lib/core/service.ts`, `runtime.ts`, `workspace.ts`, `projection.ts`, `checks.ts`, and `safety.ts`.
3. `src/lib/core/store.ts`, `file-store.ts`, `receipts.ts`, `rules.ts`, `rule-state.ts`, `evaluation.ts`, and `retrieval.ts`; trace all callers of the methods you change.
4. `src/lib/intake/{service,store,http,schema,extract,config}.ts`, `src/lib/providers/responses.ts`, existing submission/receipt/rule routes, and both SQL migrations.
5. `src/lib/core/tests/{approval-regression,platform,platform-routes,live-readiness}.test.ts`, `database.test.mjs`, and intake storage tests.
6. `evals/comparison/findings/2026-09-20/{README,report}.md`. The 39/50 versus 47/50 result remains published; uncertainty needs evidence, not globally lower thresholds.

Read the relevant installed Next.js guide before touching route code, as required by `AGENTS.md`.

## 1. Freeze additions and provider configuration

**Files:** shared contracts, `core/runtime.ts`, `providers/responses.ts`, and relevant contract/config tests.

- [ ] Implement only the additions in `00-contracts.md`. Retain `contract_version: 2`, existing alias payloads, `RuleTestReport`/`alias-v1`, and the old scorer signature.
- [ ] Add supporting-document DTOs, public `InvestigationRun`/`InvestigationRunStep`/`InvestigationFinding`, and a separate `ResolutionProcedure` lifecycle. Preserve legacy `InvestigationStep`/`InvestigationResult` and `ReviewRow.investigation`; add optional `ReviewRow.latest_investigation` for the new run.
- [ ] Public runs contain `run_id`, `claim_id`, `status` (`running|completed|failed|superseded`), nullable `outcome` (`resolved|discrepancy_found|needs_human`), headline, summary, unresolved question, findings/evidence references, before/after assessment, proposed learning, steps, timestamps, mode/model, and error.
- [ ] Keep `IntelligencePort.investigate(input, tools, options)` at three arguments. Add `read_supporting_documents`; C returns evidence/findings/proposed learning. Core owns authoritative assessment, outcome, and all writes.
- [ ] Add `RECONCILIATION_INVESTIGATION_MODE=disabled|simulated|live`, default `disabled`. Simulated operation stays explicitly isolated and labeled; live requires existing Azure endpoint/key/deployment plus the existing live Supabase/Jev setup.
- [ ] Extend `responsesConfig` with purpose `investigation`; C imports it and `responsesHeaders`. Require Azure for this purpose without changing extraction/narration behavior. GET/config validation makes no provider call.
- [ ] Preserve the synthetic-only and same-origin mutation gates. Add server validation for document kind, identifiers, revision, text bounds, extracted facts, and procedure scope; use the frozen limits.
- [ ] Add optional `supporting_documents`, `investigations`, and `resolution_procedures` capabilities; absent is false, true requires a working backend path. Disabled/unavailable investigation returns `503 INVESTIGATION_UNAVAILABLE` without spending.

**Handoff:** publish typed additions/config to C and A first. No consumer invents a second public DTO or turns an absent capability into success.

## 2. Add private supporting documents and revision invalidation

**Files:** `intake/{schema,http,store,service,extract}.ts`; `core/{store,file-store,projection,workspace}.ts`; new focused helpers only where needed; supporting-document routes.

- [ ] Implement `GET/POST /api/submissions/:id/supporting-documents`; POST accepts exactly one multipart `file`, `kind`, and `expected_review_revision` per upload, as frozen in `00-contracts.md`.
- [ ] Reuse the bounded upload reader, 8 MiB file ceiling, detected PDF/PNG/JPEG type, private storage, UUID namespace, and uncertain-write recovery behavior. A client cannot submit a storage path or extraction result.
- [ ] Allow at most eight supporting documents per pending claim; validate revision as serialized decimal. Acquire operation protection before storing/extracting. Reject approved/rejected claims, concurrent operations, and repeated same-claim bytes (`409 DOCUMENT_EXISTS`, no second extraction). P0 has no replacement/deletion endpoint.
- [ ] Store claim link, kind, private path, SHA-256, MIME type, extraction state/error/provenance, extracted text/facts, and timestamps. Keep original receipt identity separate.
- [ ] Extract each new document once through the existing adapter. Reuse stored extraction during investigation; record actual provider usage once and retain failures. Do not reread an unchanged original PDF through a model on every run.
- [ ] Persist explicit booking/reference fields from observed document evidence. Preserve nulls and conflicts; a receipt number is not automatically a booking reference, and claim fields cannot fill missing evidence.
- [ ] Implement `GET /api/submissions/:id/supporting-documents/:documentId` using the persisted claim/document association and private bytes. Reject a foreign document ID; expose no storage credentials or public bucket URL.
- [ ] Check expected revision and active lease before publishing new evidence. Atomically advance evidence/review revisions, invalidate the affected assessment/test eligibility, and invalidate dependent active knowledge where its source changed.
- [ ] Extend MemoryStore/FileStore and Supabase consistently. Restart must retain supporting originals, failed extractions, revision state, runs, steps, and procedures. Preserve human decisions/history.

**Acceptance:** two linked documents survive restart; stale/concurrent upload cannot overwrite newer evidence; a failed extract stays visible; a duplicate representation of one purchase never increases payable amount.

## 3. Forward migration and database-owner setup

**Files:** new `supabase/migrations/202609200003_investigations.sql`; store/RPC adapters; `core/tests/database.test.mjs`; `core/README.md`.

Shared database state is unknown. Source migration files and old delivery notes are not proof of application. The database owner records the target, migration history, row counts, readiness function, private bucket state, and null receipt-hash count before any DDL.

Read-only inspection from `reconciliation/`, using an independently configured SQL connection:

```sh
psql "$SIFT_DATABASE_URL" --set=ON_ERROR_STOP=1 --command="select to_regclass('public.submissions'), to_regclass('public.platform_state'), to_regclass('supabase_migrations.schema_migrations'), to_regprocedure('public.core_platform_version()');"
```

If present, read `supabase_migrations.schema_migrations` and call `select core_platform_version();`; inspect deployed objects too, because manually applied SQL may not appear in migration history. If an old reviewed migration is missing, apply it once in order only after confirming its objects are absent. Never replay `202609200002` against an existing platform schema or edit an applied migration.

- [ ] Add `supporting_documents`, `investigation_steps`, investigation fields on existing reconciliation runs, and versioned procedure/history/test storage. Reuse existing run/usage IDs and claim lease; avoid another job system.
- [ ] Keep new tables/RPCs server-controlled with RLS, service-role grants, and no anon/authenticated write grants. Extend atomic snapshots/evidence bindings without leaking raw provider responses into public DTOs.
- [ ] Extend run operation/status constraints deliberately; preserve old assessment/extraction rows and audit history. Transactionally guard final publication against evidence/review/knowledge changes.
- [ ] Advance `core_platform_version()` from 2 to 3 only when the forward schema/RPC set is ready. Update every core/intake readiness gate and local SQL test together; version 2 must fail before new writes.
- [ ] Retain existing guarded approval, duplicate, alias, retry, export, and abandoned-lease behavior. Extend source-withdrawal/evidence invalidation to procedures in SQL and local storage.

After review and confirmed prerequisite state, apply the missing forward migration once:

```sh
psql "$SIFT_DATABASE_URL" --single-transaction --set=ON_ERROR_STOP=1 --file=supabase/migrations/202609200003_investigations.sql
psql "$SIFT_DATABASE_URL" --set=ON_ERROR_STOP=1 --command="select core_platform_version();"
```

Expected readiness after successful deployment is `3`; verify retained counts/history and private bytes before app restart. Do not claim this happened from documentation changes. If deployment fails, keep mutations unavailable and repair the forward schema/application pairing; retain data and audit tables.

Complete the existing original-byte hash backfill only after inspecting the target and readiness:

```sh
node --env-file=.env.local --conditions=react-server --import tsx -e 'const {getCore}=require("./src/lib/core/runtime.ts"); const {getStore}=require("./src/lib/intake/store.ts"); const {backfillReceiptHashes}=require("./src/lib/core/receipts.ts"); backfillReceiptHashes(getCore(),getStore()).then(console.log).catch(e=>{console.error(e.code || "BACKFILL_FAILED");process.exitCode=1;});'
```

It reads originals, skips existing hashes, and preserves unavailable originals as null. Never generate replacement originals or run `seed:receipts` as a backfill. Refresh/reassess invalidated rows afterward; report actual counts/errors.

## 4. Improve the shared assessment evidence path

**Files:** `core/{service,retrieval,checks,safety,evaluation}.ts`; contract additions already agreed with C. C alone edits `core/jev.ts`.

- [ ] Narrow the broad candidate scan with explicit corroborating purchase facts; same amount, vendor, or date alone is not a reason to send every lookalike. Preserve deterministic ordering and the existing corpus limit.
- [ ] Keep confirmed duplicate detection independent of candidate narrowing and repeat it atomically at approval. Equal original hashes or corroborated purchase identity retain protection; different documents for one purchase are not automatically distinct purchases.
- [ ] Supply relevant stored receipt text, supporting facts/reference provenance, and applicable policy to C’s semantic state. Limit original receipt text to 12,000 characters and total supporting text to 24,000 per input; `EVIDENCE_LIMIT` leaves affected checks unresolved, without silent truncation.
- [ ] Resolve exact unambiguous comparisons in code, while retaining semantic checks for ambiguity. Store method and source references; never invent a passing check or lower Jev thresholds globally.
- [ ] Add 00's optional `claimant_identity_evidence` policy field, defaulting absent values to receipt-only; persist it with policy snapshots/revisions. Fix the missing-name gate only for a linked itinerary permitted by that explicit applicable policy. The human reviews any targeted demo-policy update; no global permission or policy editor.
- [ ] Record actual model choice, chosen-answer probability, confidence, and the application reason for `unknown` (missing/conflicting evidence, threshold, provider failure). Preserve existing probability fields’ meaning.
- [ ] Implement the booking-reference procedure matcher here so ordinary reconciliation, final investigation reassessment, and evaluation use the same path. Require exact hotel/USD descriptor scope, nonempty matching receipt/booking references, canonical merchant evidence, and no conflicts. Normalize only case and trimmed/collapsed whitespace; retain meaningful reference characters.
- [ ] Export `createAssessProcedureExample(core, observe?): AssessProcedureExample` before C’s gate integration. `ProcedureFacts` extends existing evaluation facts with `supporting_documents`; callback arguments are `(facts, aliases, procedures, signal)`. It calls `CoreService.assess` with only supplied inputs; no production-state reads, recursive investigation, or claim/decision/run writes.
- [ ] Preserve `createAssessExample(core, observe?)` unchanged for alias-v1/benchmark callers. New evaluation observations retain actual checks, unique usage IDs, failures, evidence/knowledge/model bindings, and before/after phase; missing provider results throw.

**Handoff:** send C one typed supported-booking example and one conflicting-reference example through the real new scorer, with offline output clearly labeled. Do not give C a substitute assessor.

## 5. Run one awaited investigation under one lease

**Files:** `core/service.ts` or a small core helper, stores, runtime/projections, and investigation routes.

- [ ] `POST /api/submissions/:id/investigate` validates `{expected_review_revision}`, mode, source existence, and operation conflicts before starting. Await bounded execution and return `{run,row}`; do not launch a detached promise or return fake queued work.
- [ ] Manual investigation requires an assessed pending claim; automatic triggering is limited to recoverable uncertainty with useful available evidence. A clear mandatory violation stays flagged without spending on investigation.
- [ ] Acquire the claim lease once; snapshot before assessment/evidence/knowledge. Persist a `running` investigation using the existing run ID and bind tools to that authoritative claim snapshot.
- [ ] Supply only `read_receipt` (with stored text), `read_supporting_documents`, `find_related_claims`, `read_policy`, and `read_active_aliases`. Tools are read-only, bounded, and cannot escape their claim/corpus scope.
- [ ] Wrap each actual call with ordered persisted step start/completion/failure, timestamps, sanitized summary, and resolvable evidence references. C cannot manufacture storage records by returning a claimed step.
- [ ] Enforce three model planning rounds, six read-tool calls, one final `CoreService.assess`, and a 90-second investigator-plus-reassessment deadline. Limit planner/tools to 65 seconds and reserve up to 25 seconds for reassessment under the outer deadline. Pass the signal through C's optional fourth Jev argument; propagate it into actual requests, stop scheduling at exhaustion, and discard late output. No implicit retries.
- [ ] Call `assess` directly inside the existing lease. Never call `reconcile`, `begin`, or another lease-taking operation from inside investigation; never add an Azure synthesis call beyond the three planning rounds.
- [ ] Validate C’s findings/references against observed tool evidence. Core derives check changes and outcome: all required checks pass → resolved; a known mandatory failure → discrepancy found; otherwise → needs human.
- [ ] Capture assessor provider errors/cancellation explicitly rather than interpreting its fallback unknown check as success. Persist failed status/error with nullable outcome; retain known financial failures and the last valid published assessment.
- [ ] Once a run exists, return its truthful failed run in `{run,row}` on execution failure. Start validation errors keep the normal envelope. Failed/superseded runs have null outcome and no successful after-assessment; `needs_human` has a meaningful unresolved question.
- [ ] Atomically validate evidence/review/knowledge freshness before publishing the assessment/result. A changed snapshot produces `superseded`, retains diagnostics, and cannot overwrite the current row.
- [ ] Human approval remains a separate guarded decision. A resolved pending claim is ready for approval; investigation never approves, creates an alias, or activates a procedure.
- [ ] Implement `GET /api/investigations` (optional `claim_id`, newest first, coverage, limit 1,000 or explicit error) and `GET /api/investigations/:runId` with persisted progress and no model calls. Surface actual failures/mode; polling after interrupted transport must not replay the paid POST.

**Acceptance:** polling can observe a real started tool before POST finishes; timeout/failure settles visibly; refresh restores the result; concurrent retry/approval/reconciliation cannot deadlock or overwrite it.

## 6. Persist the reviewed booking-reference procedure

**Files:** core procedure helper/state, stores, SQL from Task 3, and `/api/procedures` routes. Reuse lifecycle patterns from `rules.ts`/`rule-state.ts`; keep alias DTOs unchanged.

- [ ] Add `GET/POST /api/procedures`; proposal accepts only `{run_id,expected_review_revision}`. Require current human approval of the source, a supported completed run, current evidence, and a server-derived candidate/source correction.
- [ ] Allow the source’s explicit approval revision after the investigation when evidence is unchanged. Verify current evidence separately; do not reject every legitimate proposal because human approval advanced `review_revision`.
- [ ] Persist hotel/USD trigger descriptor/canonical merchant, required receipt+booking evidence, comparison fields, source run/correction/document references, and version. Do not turn the candidate into a blanket alias.
- [ ] Add `/api/procedures/:id/test`, `/activate`, `/disable` with `{expected_procedure_version}`. Reject client-authored suite inputs, result proofs, or canonical overrides.
- [ ] Invoke C’s separate 12-case `booking-reference-v1` suite through the new real scorer. Preserve optional observation `procedure_ids` and actual check evidence proving application. Save complete/failed observations; failed/incomplete tests clear earlier activation eligibility while retaining history.
- [ ] Bind activation to procedure/source versions, human correction, evidence hashes/revisions, knowledge, mode/model, and suite version/hash. Require a different valid positive correctly using the procedure, zero unsafe matches, zero correctness/protected-check regressions, and no correct-count decrease; live cannot activate simulated proof. Baseline may already resolve it: measure reduced work separately, without requiring or inventing accuracy gain.
- [ ] Activation/disable, source withdrawal, and changed source evidence atomically invalidate dependent knowledge/tests. Missing/conflicting later evidence blocks application even when a procedure is active.

## Focused checks and delivery

Add focused tests to new `core/tests/investigations.test.ts`, `core/tests/procedures.test.ts`, `intake/supporting-documents.test.ts`, and extend existing SQL/route tests only where their boundary needs coverage. Cover one successful evidence-supported reassessment, stale publication, one-lease concurrency, provider timeout, foreign document access, stale source/test, missing/conflicting references, unchanged human decisions, and preserved amount/cap/currency/date/duplicate guards.

Run from `reconciliation/` on Node 24; new paths below become runnable when created:

```sh
npm run typecheck
node --conditions=react-server --import tsx --test src/lib/intake/supporting-documents.test.ts src/lib/core/tests/investigations.test.ts src/lib/core/tests/procedures.test.ts
node --conditions=react-server --import tsx --test src/lib/core/tests/approval-regression.test.ts src/lib/core/tests/platform-routes.test.ts src/lib/core/tests/database.test.mjs src/lib/core/tests/live-readiness.test.ts
npm run test:intelligence
```

Use mock providers/offline stores for these checks. Run one budgeted live vertical slice only in the coordinator’s agreed isolated target; count extraction, up to three Azure planning calls, final Jev assessment, and separately reserved procedure-test calls. No unbudgeted probes or local live-core workaround.

Deliver changed paths, exact DTO/scorer signatures, migration inspection/application/backfill status, commands and actual results, and one sanitized response per new endpoint to A/C. Update the core README from the implemented behavior. Hand off supported first investigation → separate approval → proposal/test/activate → later evidence-backed reuse → blocked bad case; stop at P0 before requesting any P1 allocation work.
