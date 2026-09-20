# Synthetic reimbursement platform

Entry point: `runtime.ts`; orchestration: `service.ts`; public v2 types: `../review-contracts.ts`. The frozen requirements are in `../../../../docs/next-work/00-contracts.md`. This remains an unauthenticated synthetic-data-only demo. Keep originals private and credentials on the server.

## Delivered behavior

The workspace advertises `rule_learning`, `extraction_retry`, `export`, `custom_checks`, `duplicate_links`, and `knowledge_revisions`. Supporting documents are implemented. Investigation and procedure capabilities remain unavailable in the default runtime until C delivers the complete intelligence port and investigation is explicitly enabled. See [the investigation handoff](INVESTIGATION_HANDOFF.md). Reviews return complete coverage for at most 1,000 claims and fail explicitly above that bound.

Custom checks (`/api/checks`, migration `202609210011`) let reviewers author extra Jev questions: a label, instructions, optional pass/fail/unknown criteria, and an optional category scope. Each active applicable check joins the Jev request as an additional `custom_*` question and is required for `matched`; unknown or missing results route to review and any fail flags the claim. They never relax the mandatory financial/duplicate approval gate. Create/update/enable/disable bump `knowledge_revision` (except editing a disabled check), the configuration fingerprint joins run evidence so in-flight runs go stale, and optimistic `version` numbers reject stale edits. In simulated mode custom checks honestly return `unknown`; no fixture fabricates semantic answers.

Machine assessment (`matched`, `flagged`, `needs_review`, or null) is separate from human decision (`pending`, `approved`, `rejected`). Reconciliation preserves human decisions and history. A known mandatory failure remains flagged despite another unknown check. Approval requires succeeded extraction, current evidence/knowledge, passing financial and duplicate checks, a reviewer note, and the expected review revision. Merchant/name ambiguity can be explicitly reviewed. Both decision routes use the same guarded operation; legacy alias corrections are rejected.

SQL serializes the bounded ledger's guarded writes; FileStore uses a cross-process lock and durable snapshots. Current receipt identity is checked again during approval, including approvals of other claims. Later exact copies link to earlier claims, ordered by submission time and ID; candidate similarity alone is not a confirmed duplicate. Runs bind evidence and knowledge before publication. Conflicting operations are rejected. After five minutes, abandoned operations display a retryable failure; the next operation expires the persisted SQL lease. Human actions do not cancel an active operation.

Rules require a human-approved source, a draft proposal, C's implemented fixed ten-case `alias-v1` suite, and explicit activation. Testing calls the same assessment computation as reconciliation through `createAssessExample`; it does not create claims or human decisions. Stored proof binds rule/source revisions, knowledge, suite hash, and provider/model mode. Failed or incomplete tests clear activation eligibility while retaining diagnostics. Activation/disable and source withdrawal or changed source receipt evidence invalidate knowledge atomically. Historical aliases are excluded from active retrieval; historical assessments with unknown knowledge revisions require recheck.

Retry uses the same private original and a guarded operation, archives prior extraction evidence, and invalidates obsolete assessment. Only pending human decisions can retry. Failed extraction remains visible. Initial upload publication is also guarded: it cannot overwrite an active operation or an extraction already completed by retry. An uncertain database insert response retains the private uploaded original for recovery instead of deleting potentially committed evidence.

## Configuration and provider calls

- Set `RECONCILIATION_SYNTHETIC_ONLY=true`; mutations require the exact `Origin` configured by `RECONCILIATION_APP_ORIGIN` or the request origin.
- Local simulation requires `RECONCILIATION_MODE=simulated`, `RECONCILIATION_INTAKE_MODE=demo`, and no Supabase credentials. FileStore persists under `RECONCILIATION_INTAKE_DEMO_DIR` or `.intake-demo`, outside `public/`. Restarts preserve reviews, rules, usage, and history.
- Live assessments require Supabase and Jev credentials, even when `RECONCILIATION_MODE` is unset. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, with intake mode `live`. Core also accepts `NEXT_PUBLIC_SUPABASE_URL`, but intake requires `SUPABASE_URL`. Simulation cannot use shared Supabase.
- Jev uses `TYPESAFE_API_KEY`/`JEV_API_KEY` directly, or `AI_GATEWAY_API_KEY` through Gateway. `JEV_MODEL` overrides the channel default. Retrieval scans authoritative stored data; Elasticsearch provisioning is unnecessary.
- Live extraction uses the existing Responses adapter. `RECONCILIATION_EXTRACTION_MODE` selects `live` or `demo`, otherwise it follows intake mode. Receipt provenance records the actual extraction result; global configuration does not prove historical live extraction.
- Narration is deterministic unless explicitly enabled with `RECONCILIATION_JUSTIFICATION_MODE=live` and the existing Azure/OpenAI configuration. Provider failures never silently switch assessments to simulated answers.

| Operation | Model calls in live mode |
| --- | --- |
| GET routes, export, startup configuration validation | None |
| Upload / extraction retry | Responses extraction; usage retained when persistence succeeds |
| Reconcile | Jev for usable extracted evidence; optional opted-in narration |
| Rule test | Before/after Jev assessments through C's suite; no narration |
| Search | Jev over the supplied frozen review snapshot; no claim mutation |
| Decision, rule proposal/activation/disable | None |
| POST `/api/justifications` | Narration only when opted in |

Missing evidence or reconciliation provider failures require review unless a mandatory failure already flags the claim. Evaluation provider errors reject the attempt and cannot manufacture a passing test. Search fails without partial results. Narration failure falls back to a deterministic summary. Jev requests have a 25-second transport timeout. Core passes an optional fourth AbortSignal into evaluation; the upstream Jev transport consumes it. The default runtime remains disabled until public investigator wiring and the procedure suite arrive. Reconcile accepts 1–50 IDs, uses three workers, and stops launching work after 180 seconds.

## Supporting evidence and investigations

Supporting uploads accept one PDF/PNG/JPEG up to 8 MiB and at most eight documents per pending claim. Server-generated private paths and byte hashes remain separate from the original receipt. Duplicate bytes are rejected before extraction. Each upload acquires the existing operation lease, retains a failed extraction, and advances review/evidence revisions. Supporting amounts are never summed into the reimbursable total. SQL and FileStore persist the same workflow and source invalidation.

Set `RECONCILIATION_INVESTIGATION_MODE=disabled|simulated|live` (default disabled). Simulation requires isolated local core/intake; live requires live Supabase/Jev plus complete Azure settings. `responsesConfig('investigation')` refuses public-OpenAI fallback. No mode switch occurs on provider failure. The default runtime conservatively waits for C's full investigation/procedure exports; unavailable capability returns 503 without spending.

An assessed pending claim can be investigated through an awaited POST. Core acquires one lease, persists each actual read-tool step, validates returned references against supplied stored evidence, and calls `CoreService.assess` once. A successful machine result never creates a human approval or knowledge. Provider/timeout failure retains the prior assessment; stale publication becomes superseded. The orchestrator also accepts an internal `recoverable_uncertainty` trigger only with unknown checks and useful supporting evidence; ordinary reconciliation does not automatically launch paid investigations during rollout.

The planning interface is limited to five no-argument read tools, six executions, and three planning requests. Signals reserve 65 seconds for planning/tools and 25 seconds for final assessment within 90 seconds. The upstream internal planner enforces pre-request planning budgets, and Jev consumes transport cancellation; B records calls, rejects over-budget results, and supplies cancellation. Public port wiring remains C’s integration dependency. There is no extra synthesis request or nested reconcile/begin. Original receipt text is bounded at 12,000 characters, supporting text at 24,000; over-limit evidence produces `EVIDENCE_LIMIT` rather than silent truncation.

Assessment passes stored text/supporting facts/policies to the semantic adapter. Candidate retrieval now requires corroborating purchase facts. Different explicit receipt numbers are preserved, while a shared labelled booking reference plus amount/date/currency can still warrant semantic duplicate review. Confirmed duplicates remain independent of that narrowing and are checked again at approval. Exact claimant-name matches are deterministic; Jev's .70 confidence/.85 chosen-probability thresholds remain unchanged and conversions to unknown record their reason.

Booking procedures require a reviewed completed source investigation, exact hotel/USD descriptor scope, successful stored booking extraction, a nonempty matching labelled reference, traceable canonical vendor, and consistent purchase/traveler evidence. The original receipt reference comes from an explicit `Booking reference:`, `Booking ref:`, `Reservation reference:`, or `Trip reference:` text label; it never substitutes a receipt number. Proposal derives metadata from those records. Procedure application only establishes merchant identity; financial/name/duplicate checks still run. `claimant_identity_evidence` defaults to receipt-only. No policy permission has been broadened or edited in this delivery.

`createAssessProcedureExample(core, observe?)` calls that same computation with only supplied facts/aliases/procedures, logs actual usage, and never writes claims/decisions. Procedure tests bind source evidence/review/correction, knowledge, suite hash, provider identity/mode and procedure version. Failed tests clear proof; disabling or withdrawing a source invalidates active knowledge. Alias types and alias-v1 gating remain intact. C's twelve-case suite is still a separate dependency; backend mock tests are not live activation proof.

## HTTP contracts

The workspace review response retains `contract_version: 2`. Mutation errors use `{ "error": { "code": "…", "message": "…" } }`; revisions, UUIDs, money, enums, and bounded text are validated server-side. Refresh on `STALE_REVIEW`, `STALE_RULE`, `STALE_RULE_TEST`, or `STALE_SNAPSHOT` rather than replaying old proof.

| Route | Request → response |
| --- | --- |
| GET `/api/workspace/reviews` | `ReviewsResponse`: rows, snapshot token, knowledge revision, capabilities, coverage |
| POST `/api/workspace/reconcile` | `{submission_ids}` → `ReconcileResponse` |
| POST `/api/workspace/decisions` | `DecisionRequest` → `{correction_id,row}` |
| POST `/api/corrections` | Same guarded decision fields, including `expected_review_revision` → legacy `{correction_id,status}`; `vendor_alias` returns `410 LEGACY_ALIAS_DISABLED` |
| GET `/api/rules` | `{rules,knowledge_revision}` |
| POST `/api/rules` | `{submission_id,expected_review_revision,canonical_vendor}` → `{rule,knowledge_revision}` |
| POST `/api/rules/:id/test` | `{expected_rule_version}` → `RuleTestReport`; caller-supplied reports are not accepted |
| POST `/api/rules/:id/activate` | `{expected_rule_version}` → `{rule,knowledge_revision}` |
| POST `/api/rules/:id/disable` | `{expected_rule_version}` → `{rule,knowledge_revision}`; re-enable requires a new proposal/test |
| POST `/api/submissions/:id/retry-extraction` | `{expected_review_revision}` → `{row}` |
| POST `/api/workspace/export` | `{snapshot_token,submission_ids}` → `text/csv; charset=utf-8`, attachment `sift-reviews.csv` |
| GET/POST `/api/submissions/:id/supporting-documents` | List DTOs / multipart `{file,kind,expected_review_revision}` → `{document,row}` |
| GET `/api/submissions/:id/supporting-documents/:documentId` | Ownership-checked private bytes |
| POST `/api/submissions/:id/investigate` | `{expected_review_revision}` → awaited `{run,row}` |
| GET `/api/investigations` | Optional `claim_id`; newest-first persisted runs and coverage; explicit 1,000-run limit |
| GET `/api/investigations/:runId` | `{run}`; never invokes models |
| GET/POST `/api/procedures` | List DTOs / `{run_id,expected_review_revision}` → `{procedure,knowledge_revision}` |
| POST `/api/procedures/:id/test` | `{expected_procedure_version}` → server-generated `ProcedureTestReport` |
| POST `/api/procedures/:id/activate` or `/disable` | `{expected_procedure_version}` → `{procedure,knowledge_revision}` |
| POST `/api/search` | `{query,snapshot_token,filters}` → exact-snapshot matches and possible matches |

`DecisionRequest` contains `submission_id`, `expected_review_revision`, `human_verdict`, `human_note`, `correction_type: "decision_override"`, and `correction_payload_json: {}`. Export requires 1–1,000 unique existing IDs, rejects stale/foreign selections without partial output, quotes fields, neutralizes spreadsheet formulas, and leaves unknown amounts empty. It excludes raw provider payloads, secrets, and signed URLs.

## Deployment, backfill, and recovery

**Recorded deployment before decision-email work (not re-inspected for this PR):** SQL inspection confirmed the original schema only; platform migrations `202609200002` and `202609200003` were then applied together in one transaction on September 20, 2026. Readiness was 3, existing row counts are preserved, and the receipt bucket remains private. The restarted local app reads all 122 claims successfully. Original-byte hash backfill completed with 122 hashed and 0 unavailable; affected historical assessments require reassessment. No model calls were made. See [the handoff](INVESTIGATION_HANDOFF.md) for inspection, applied checksums, and backfill results. Do not replay these migrations against this target.

Migration order for a new target (inspect first; 001–003 were previously applied on the configured target; 004 is not applied by this PR):

1. `supabase/migrations/202609190001_reimbursement_core.sql`
2. `supabase/migrations/202609200002_platform.sql`
3. `supabase/migrations/202609200003_investigations.sql`
4. `supabase/migrations/202609200004_communications.sql`

The platform migration is additive and preserves the existing shared rehearsal claims and their history. Do not rerun a seed or reset shared data. Version `202609200002` avoids a concurrent migration-number collision; integration owns reconciliation with PR #5. Deploy the migration before this application: shared platform operations are unavailable until its tables and RPCs exist. **Migrations 002/003 were previously applied; this PR does not apply 004.**

Every Supabase core operation and intake write first checks the service-only, read-only `core_platform_version()` RPC and requires exactly `4`; readiness is never cached. Missing/older schemas fail with `SCHEMA_MISMATCH` (intake: `schema_mismatch`) before legacy approval RPCs or uploads. GET/startup makes no model calls. The atomic `core_snapshot` omits unused run/decision audit snapshots and raw provider responses from its JSON; those remain stored in Postgres. Public reviews also omit raw provider responses in local mode, preserving structured answers and financial/duplicate evidence.

Use SQL-editor/database-owner access to apply the reviewed migration in one transaction; the application's service-role REST credentials are not a DDL connection. With an independently configured connection, the equivalent command from `reconciliation/` is `psql "$SIFT_DATABASE_URL" --single-transaction --set=ON_ERROR_STOP=1 --file=supabase/migrations/202609200002_platform.sql`. First confirm the base migration exists and the platform migration has not already been applied. Do not rerun this non-idempotent migration; a database with an earlier platform revision requires a reviewed forward migration. After the platform prerequisite, apply the reviewed `202609200003_investigations.sql`, then `202609200004_communications.sql`, each once in a transaction. Version 4 adds service-only decision messages and the durable outbox; it does not queue historical decisions. Check `select core_platform_version();` returns `4`, retained claim/history counts, and the private bucket before restarting the app.

Hash backfill is the explicit server helper `backfillReceiptHashes` in `src/lib/core/receipts.ts`, called with the configured core and intake store:

```sh
node --env-file=.env.local --conditions=react-server --import tsx -e 'const {getCore}=require("./src/lib/core/runtime.ts"); const {getStore}=require("./src/lib/intake/store.ts"); const {backfillReceiptHashes}=require("./src/lib/core/receipts.ts"); backfillReceiptHashes(getCore(),getStore()).then(console.log).catch(e=>{console.error(e.code || "BACKFILL_FAILED");process.exitCode=1;});'
```

Review the target database and private bucket before shared invocation. See the handoff for the actual shared-target backfill result. It reads original bytes, computes SHA-256, skips existing hashes, leaves confirmed absent originals null, and reports `hashed`/`unavailable`. Authentication, missing-bucket and transient failures stop the backfill; rerunning safely skips already stored hashes. It does not alter bytes or parsed fields and makes no model calls. New evidence can invalidate assessments and dependent rules, so refresh and recheck afterward. Do not generate replacement originals to fill missing hashes or use `seed:receipts` as a backfill.

Prefer retaining additive tables and audit history during recovery. Do not roll the guarded API back to unsafe v1 approval/alias behavior. If deployment fails, keep mutations unavailable while fixing the migration/application pairing. Retain private objects after uncertain uploads; inspect committed metadata before explicit cleanup. For local recovery, preserve a copy of the whole demo directory, including `core-state.json`, receipt metadata, and `.bin` originals. Allow abandoned leases to expire, then refresh and retry the same claim; do not duplicate the claim as recovery.

## Verification and remaining delivery work

Use Node 24 from `reconciliation/`:

```sh
node --version
npm run typecheck
npm test
node --conditions=react-server --import tsx --test src/lib/core/tests/approval-regression.test.ts src/lib/core/tests/platform.test.ts src/lib/core/tests/platform-routes.test.ts src/lib/core/tests/database.test.mjs
```

Current investigation-platform verification on Node 24.11.1: 130/130 application tests (including 7 SQL tests), 25/25 intelligence tests, 23/23 investigation-pack checks, 25/25 browser tests, TypeScript checking, and production build passed against integrated upstream `e9d5b97`. See [the handoff](INVESTIGATION_HANDOFF.md) for exact commands, endpoint examples, and outstanding deployment dependencies. PGlite exercises local SQL transactions with test Supabase roles/storage; it does not prove remote deployment.

Historical verification for the preceding alias/platform delivery: `npm run typecheck` passed; `npm test` passed 100/100, including four PGlite transaction tests; `npm run test:intelligence` passed 13/13. The focused platform/SQL run passed 14/14. No live providers or shared database were used. The npm test runner required permission for tsx's local IPC socket; the direct `node --import tsx` commands also work without that socket.

Historical integration verification (before investigation-platform changes): production build, 100 application tests, 13 intelligence tests and 25 browser tests passed on the integrated delivery. The subsequent schema/readiness fixes passed 13 focused offline tests and TypeScript checking. Outstanding: shared migration and reviewed hash backfill; team hands-on acceptance; authorized paid live verification budget; Devin's independent held-out evaluation. PRs #3 and #5 remain held pending their benchmark and consistency fixes. The obsolete `scripts/check-jev.ts --workflow` path now exits before any provider call; use the reviewed rule workflow instead. The default single-request Jev smoke test is unchanged. These checks do not establish live model accuracy.

## OFFLINE SIMULATED response excerpts

Captured September 20, 2026 from an isolated temporary FileStore, `SimulatedJev`, demo extraction, and C's real rule-suite implementation. The temporary directory was removed afterward. UUIDs and results below are actual outputs; fields/rows are omitted only for readability. Fixture success is not live model accuracy or held-out evaluation.

GET reviews after assessing the source claim (one of five rows shown):

```json
{
  "contract_version": 2,
  "snapshot_token": "5a2d6b7d588479b44ffaf3ede4b70ad504b8ff5d9979002162e002a8f5291a40",
  "knowledge_revision": 0,
  "capabilities": {
    "rule_learning": true,
    "extraction_retry": true,
    "export": true,
    "custom_checks": true,
    "duplicate_links": true,
    "knowledge_revisions": true
  },
  "coverage": {
    "complete": true,
    "returned": 5,
    "total": 5
  },
  "submissions": [
    {
      "id": "10000000-0000-4000-8000-000000000003",
      "review_revision": 1,
      "assessment_status": "needs_review",
      "decision_status": "pending",
      "assessment_knowledge_revision": 0,
      "processing_status": "idle",
      "receipt": {
        "id": "20000000-0000-4000-8000-000000000003",
        "extraction_status": "succeeded",
        "extraction_provenance": "simulated fixture"
      }
    }
  ]
}
```

Proposal after explicitly approving the source with a note:

```json
{
  "rule": {
    "id": "519747ca-e9f3-4928-89a6-91cb6f7275cf",
    "version": 1,
    "state": "draft",
    "source_submission_id": "10000000-0000-4000-8000-000000000003",
    "source_correction_id": "39682390-1d55-40e3-84b8-56f66bedc17c",
    "payload": {
      "observed_vendor": "SYN HBR 042",
      "canonical_vendor": "Synthetic Harbor Hotel",
      "scope": {
        "category": "hotel",
        "currency": "USD"
      }
    },
    "created_at": "2026-09-20T05:31:25.204Z",
    "latest_test": null,
    "latest_test_error": null
  },
  "knowledge_revision": 0
}
```

Test response:

```json
{
  "rule_id": "519747ca-e9f3-4928-89a6-91cb6f7275cf",
  "rule_version": 1,
  "knowledge_revision": 0,
  "suite_version": "alias-v1",
  "mode": "simulated",
  "tested_at": "2026-09-20T05:31:25.212Z",
  "passed": true,
  "improved_case_ids": [
    "valid_a",
    "valid_b"
  ],
  "regressed_case_ids": [],
  "reasons": [],
  "before": {
    "total": 10,
    "correct": 8,
    "false_matches": 0,
    "needs_review": 6
  },
  "after": {
    "total": 10,
    "correct": 10,
    "false_matches": 0,
    "needs_review": 4
  }
}
```

Activation response excerpt:

```json
{
  "rule": {
    "id": "519747ca-e9f3-4928-89a6-91cb6f7275cf",
    "version": 2,
    "state": "active"
  },
  "knowledge_revision": 1
}
```

Retry response for another pending claim:

```json
{
  "row": {
    "id": "10000000-0000-4000-8000-000000000001",
    "review_revision": 1,
    "assessment_status": null,
    "decision_status": "pending",
    "assessment_knowledge_revision": null,
    "processing_status": "idle",
    "receipt": {
      "id": "20000000-0000-4000-8000-000000000001",
      "extraction_status": "succeeded",
      "extraction_provenance": "simulated fixture"
    }
  }
}
```


## Reviewer decision emails

Release 1 adds persisted, editable approval/rejection drafts and `decision-and-send`, which commits the existing guarded human correction and its frozen outbox message together. Default `RECONCILIATION_EMAIL_MODE=preview` saves a preview and makes no Resend call; `disabled` retains decision-only controls. The key alone does not enable sending. Live delivery requires a private synthetic reviewer environment and an exact recipient allowlist.

Approval uses a deterministic template. Rejection optionally uses one bounded Azure drafting call when `RECONCILIATION_EMAIL_DRAFT_MODE=live`; selected public check descriptions and an explicitly applicant-facing reason are the only narrative input. Internal reviewer notes are saved only in correction history. Generated text is editable and has visible fallback errors. Drafts bind source revisions and mode; confirmation rechecks those bindings and the existing financial/duplicate guards.

The separate `npm run email:worker` process acquires durable leases and sends frozen payloads with stable Resend keys. It records provider acceptance without claiming inbox delivery. A saved decision survives delivery failure; retries operate on the same message and never create another correction. Later decisions cancel obsolete unsent messages and respect active send leases. Confirmation request IDs let clients recover interrupted responses without creating another decision.

Migration 004 and application readiness version 4 must roll out together. No migration, live email, or model call was performed as part of this implementation. See [Resend setup and rollout](../../../docs/resend-setup.md) for configuration and worker operation. Request-information/resumption and webhook delivery tracking remain later phases.
