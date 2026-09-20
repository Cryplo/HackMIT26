# Investigation platform handoff — September 20, 2026

Implemented B's P0 platform work and integrated upstream `main` through `e9d5b97`, following `00-contracts.md` and `01-platform.md`. The backend schema is deployed; full live product behavior has not been validated. Remote migration and hash-backfill deployment results are recorded below. No paid model call, policy permission change, or new benchmark was performed. The published 39/50 versus 47/50 comparison is unchanged.

## Implemented boundaries

- Shared additions live in `review-contracts.ts`; public `contract_version` remains 2. Existing alias DTOs, `alias-v1`, and `ReviewRow.investigation` remain compatible. New persisted results use `ReviewRow.latest_investigation` and `InvestigationRun`.
- `intake/supporting-*` and the supporting-document routes persist private originals, extracted evidence, failures, and actual usage. Upload takes the claim lease before storage/extraction, checks the revision, rejects duplicate bytes and a ninth document, and invalidates dependent assessments/knowledge. One original receipt remains the sole payable purchase.
- `core/investigations.ts` acquires one lease, persists actual tool progress, validates references, and performs one authoritative final assessment. It retains failed/superseded diagnostics without overwriting the previous valid assessment or approving a claim.
- `core/procedures.ts` and `procedure-state.ts` implement server-derived proposals, observed test proof, explicit activation/disable, and source invalidation. SQL and FileStore retain audit history. Procedure scope is hotel/USD merchant identity supported by matching explicit booking references, never a blanket alias.
- `core/evidence.ts`, `service.ts`, and `retrieval.ts` share deterministic evidence handling between reconciliation, investigation, and evaluation. Financial and duplicate checks remain mandatory. Identity defaults to receipt-only; linked itinerary identity requires an explicit applicable policy.
- `202609200003_investigations.sql` extends the platform forward and advances readiness to 3. Both intake and core refuse older schemas before writes.

Other changed paths are shared contracts, provider configuration, runtime/projections/workspace, HTTP validation, store adapters, and focused core/intake tests. No UI, package/dependency, benchmark, or production intelligence implementation was changed. `intelligence/learning.test.ts` only adds the required fifth read-tool stub to its compatibility fixture. The pre-existing generated `next-env.d.ts` change is unrelated.

## C integration

`IntelligencePort.investigate(input, tools, options)` retains three arguments. The five tools take no arguments: `read_receipt`, `read_supporting_documents`, `find_related_claims`, `read_policy`, and `read_active_aliases`. Core binds them to stored evidence and owns writes, assessment, and outcome. Returned findings must reference evidence actually supplied by those tools. A proposed procedure is re-derived from stored receipt/booking evidence.

```ts
createAssessProcedureExample(
  core: CoreService,
  observe?: (result: EvaluationObservation) => void
): AssessProcedureExample

type AssessProcedureExample = (
  facts: ProcedureFacts,
  aliases: ActiveAlias[],
  procedures: ResolutionProcedure[],
  signal: AbortSignal
) => Promise<Assessment>;
```

`ProcedureFacts` extends the existing evaluation facts with `supporting_documents: SupportingDocument[]`. The scorer uses only those supplied facts and the real `CoreService.assess`; it does not read production claims or write decisions/runs. It records actual provider usage and observations, and rejects provider failures. `createAssessExample(core, observe?)` retains its existing signature.

The shared `Evidence` type now declares these optional additions, so C can consume them without a parallel type. The semantic adapter receives `semanticState.evidence` with `receipt_text`, `supporting_documents`, `policies`, `procedure_matches`, and `identity_evidence_refs`. Core enforces 12,000 original-text characters and 24,000 total supporting-text characters. Excess evidence raises `EVIDENCE_LIMIT`, without truncation. Original booking references must have explicit booking/reservation/trip labels in the stored text; receipt numbers do not substitute for them.

Upstream `e9d5b97` supplies the internal bounded Azure planner and propagates the optional fourth Jev `AbortSignal` into the transport. Remaining C work is public investigate wiring, explicit simulation, the production twelve-case `booking-reference-v1` suite, and `build_procedure_suite`/`evaluate_procedure`. A mocked integration test now runs that actual planner with persisted core tools and one final reassessment; this is not live accuracy evidence. Planning must enforce three requests before sending them; Core records actual usage and rejects excess results. Core supplies the 65-second planner / 25-second assessment signals under a 90-second deadline and enforces six actual read-tool executions. C must await started work and honor cancellation. The default runtime conservatively keeps investigation unavailable until the complete procedure port is installed; adding methods alone is not evidence that live cancellation works. Enable the mode only after integrated verification.

The additive optional `ProcedureEvaluationInput.get_observations()` returns defensive copies of actual check observations accumulated by the scorer, including phase/case IDs. C can inspect real procedure application and protected-check preservation while retaining the existing assessment-only scorer return type. Core independently validates the final report. Do not treat scorer input procedure IDs as proof of application.

Procedure test validation requires 24 observed assessments, truthful metrics, an independent supported positive with actual procedure evidence, no unsafe matches, no protected-check regressions, and no decrease in correct results. Live tests require actual consistent model usage. Stored proof binds source correction/evidence/review, procedure version, knowledge, suite hash, configured provider identity/mode, and observed models. Provider identity now includes the Jev transport; older live proof may require retesting.

[Supported and conflicting examples](examples/procedure-scorer.simulated.json) contain typed facts and actual shared-scorer output: supported booking yields `matched`; a conflicting reference yields `needs_review`. These use mock Jev, make zero live calls, and do not establish model accuracy. Backend twelve-case fixtures are boundary tests, not a replacement for C's production suite.

## A integration and endpoint examples

Use optional capabilities as false when absent. Render `latest_investigation` for the new run; do not reinterpret the legacy investigation DTO. POST investigation is awaited and returns `{run,row}` including truthful execution failures. After interrupted transport, poll persisted GET state instead of replaying a paid POST. Human approval and procedure activation are separate actions.

[Captured offline HTTP responses](examples/investigation-api.simulated.json) cover every new endpoint: supporting-document list/upload/private-original read; investigation POST/list/detail; procedure list/proposal/test/activate/disable. Binary originals are represented by response metadata and byte count. Private paths and credentials are omitted. The full route test generates these from temporary FileStore state with mock providers.

## Database state and deployment

**Deployment update:** the supplied session-pooler connection authenticated successfully over TLS. SQL inspection confirmed only the original schema was installed: no platform tables, readiness function, or migration-history table existed. Migrations `202609200002_platform.sql` and `202609200003_investigations.sql` were applied together in one transaction on September 20, 2026. SQL readiness is now 3. All retained counts were verified unchanged: 122 submissions, 122 receipts, 913 decisions, 0 corrections, 129 runs, 247 model calls, and 5 policies. Nine historical running runs were all over five minutes old; none was recently active. No reseed or historical run deletion was performed.

All five new investigation/procedure tables have RLS enabled with no public/anon/authenticated table grants; the receipt bucket remains private. PostgREST schema reload was requested. The restarted local app returned HTTP 200 for workspace reviews (complete coverage of 122 claims), investigation list, and procedure list. Supporting-document capability is available; investigation/procedure execution remains disabled pending C integration. SQL migration-history storage was absent and was not fabricated; record these applied files before adopting a migration runner.

The original-byte hash backfill completed: **122 hashed, 0 unavailable**. All 122 stored originals were read successfully. The helper updated evidence revisions; previous assessments need reassessment before new approvals. No model requests were made during migration/backfill, and paid reassessment was not started.

Applied file SHA-256 values:

- `202609200002_platform.sql`: `27135a84bd02967a5500dd326a305cc9e0f9b654089eaf78dd7ee1a8d6aec124`
- `202609200003_investigations.sql`: `4bb0231e956405d77615c678f031b9c0279f5be446a11a1b0e9b5f2d32afd764`

The following inspection notes describe the earlier pre-deployment state. The commands are retained for reference; **do not replay the migrations on this target**.

Read-only inspection used the supplied service-role credentials against project `pqjqsqkzmddgrhjverof`. Observed counts were 122 submissions, 122 receipts, 913 decisions, 0 corrections, and 129 reconciliation runs. The `receipts` bucket reports `public: false`. The readiness RPC returned HTTP 404; platform/procedure/supporting-document tables were not exposed through REST. This does not prove the SQL objects are absent. At that earlier point, migration history and null receipt-hash counts were unverified and no `SIFT_DATABASE_URL` was configured. Those SQL inspection/application and backfill steps are now complete as recorded above.

The local environment file contains the supplied configuration, is ignored by Git, and has owner-only permissions. Service-role REST credentials are not a PostgreSQL DDL connection. The database owner can use the SQL editor or configure `SIFT_DATABASE_URL` securely. From `reconciliation/`, first inspect:

```sh
psql "$SIFT_DATABASE_URL" --set=ON_ERROR_STOP=1 --command="select to_regclass('public.submissions'), to_regclass('public.platform_state'), to_regclass('supabase_migrations.schema_migrations'), to_regprocedure('public.core_platform_version()');"
```

Read migration history and readiness only if the corresponding objects exist. Record deployed columns/functions, retained counts, and private bucket state; if the receipt `sha256` column exists, record its null count. REST absence is insufficient to choose a migration. Apply missing prerequisites once, only after confirming their objects are absent. Never replay `202609200002_platform.sql` against an existing platform schema or reseed shared claims.

After prerequisite inspection/review, apply the forward migration once:

```sh
psql "$SIFT_DATABASE_URL" --single-transaction --set=ON_ERROR_STOP=1 --file=supabase/migrations/202609200003_investigations.sql
psql "$SIFT_DATABASE_URL" --set=ON_ERROR_STOP=1 --command="select core_platform_version();"
```

Expected readiness is 3. Verify retained counts/history and private originals before restarting the matching app version. Coordinate migration and application rollout: older code requiring version 2 cannot operate against version 3. On failure, keep mutations unavailable and repair the forward schema/application pairing while retaining data.

Only after readiness and target verification, perform the existing original-byte backfill:

```sh
node --env-file=.env.local --conditions=react-server --import tsx -e 'const {getCore}=require("./src/lib/core/runtime.ts"); const {getStore}=require("./src/lib/intake/store.ts"); const {backfillReceiptHashes}=require("./src/lib/core/receipts.ts"); backfillReceiptHashes(getCore(),getStore()).then(console.log).catch(e=>{console.error(e.code || "BACKFILL_FAILED");process.exitCode=1;});'
```

It reads originals, skips existing hashes, preserves unavailable originals as null, and can invalidate assessments/knowledge. Report actual counts/errors and refresh/reassess affected rows. Do not use `seed:receipts` or generate replacement bytes. A budgeted live model slice still requires the coordinated isolated target and the completed C adapter; none has been run here.

## Verification

On Node 24.11.1, after the final implementation changes:

```sh
npm test
npm run test:intelligence
npm run typecheck
node --conditions=react-server --import tsx --test evals/investigation/pack.test.ts evals/investigation/guards.test.ts
npm run test:browser
NEXT_DIST_DIR=.next-buildcheck npm run build
```

Results: 130/130 application tests, including 7/7 local SQL tests; 25/25 intelligence tests; 23/23 investigation-pack checks; 25/25 Playwright browser tests; TypeScript checking and production build passed. The SQL tests apply all three migrations to PGlite with test Supabase roles/storage. They cover retained approvals/history, duplicate and cap guards, source invalidation, procedure lifecycle, actual investigation progress, and atomic stale publication. FileStore tests cover restart durability and private ownership. These are offline results, not remote deployment or live-model validation. These checks integrate the current upstream code. Full product acceptance still requires A/C completion and the separate budgeted live demonstration.
