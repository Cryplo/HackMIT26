# Module 2 handoff — reconciliation core

Branch: `codex/reconciliation-core`.

Implementation commit: `c293a5645d84573a0d10b1c1bcbfa4e64930bb4d`. This handoff follows as a separate documentation commit; integrate both. Base/frozen contract: `1ed6e3e`.

No push or merge. Existing browser prototype untouched. No shared manifest, lockfile, layout, intake or dashboard files modified. Intake `9a7434f` and dashboard `a17646e` were inspected read-only for compatibility.

## Delivered

- `reconciliation/src/lib/contracts.ts`: exact shared receipt, submission, decision, correction, usage, review and API types.
- `reconciliation/src/lib/core/**`: deterministic checks, runtime validation, Jev and Elasticsearch live/simulated adapters, bounded orchestration, Supabase REST and memory storage, intake metadata import seam, five synthetic fixtures, tests, detailed operations README and search-index provisioning script/mapping.
- `reconciliation/src/app/api/reconcile/route.ts`: validated same-origin batch API, 1–50 IDs, concurrency three, five-minute route hint and bounded request time budget.
- `reconciliation/src/app/api/corrections/route.ts`: validated same-origin human overrides and scoped aliases.
- `reconciliation/src/app/api/reviews/route.ts`: latest completed decisions plus newest applicable human override, exact summary contract, no-store and explicit demo mode.
- `reconciliation/supabase/migrations/202609190001_reimbursement_core.sql`: all seven tables, indexes, RLS, service-only grants, private receipt bucket, transactional RPCs and run lease recovery.
- `reconciliation/supabase/seed.sql`: synthetic clean, duplicate, ambiguous hotel merchant, related hotel and outside-category flight counterexample.

Money/date/cap/currency checks run in code. Missing or ambiguous policy and incomplete receipt evidence cannot approve. Jev evaluates independent merchant, attendee-name and duplicate questions with explicit unknown options. Its result cannot bypass deterministic failure. Candidate receipt records and applicable correction records are supplied as evidence, not only search scores. Alias scope is exact vendor/category/USD; one-time overrides never enter reusable retrieval. Conflicting aliases remain unknown even if a model emits pass.

Corrections lock the same submission as run publication, invalidate active runs, preserve original decisions, append a human result and publish status atomically. A late run cannot overwrite reviewer action. Usage records count actual Jev API attempts once, preserve available token counts, and leave unavailable cost null. Simulated evaluations create no fake usage rows or displayed probabilities/confidence.

`probability` is **P(pass)**, i.e. probability the specific check is true, matching Module 3's label. Selected choice is in `answer_json.value`; provider confidence and full probability distribution are separately preserved. Evidence explicitly records this probability meaning.

## Verification

**18 tests passed**: 15 portable core tests, 2 actual SQL/PGlite transaction tests, 1 API-handler smoke test. Strict TypeScript 5.9.3 checking passed. Staged whitespace/diff checks passed.

Coverage includes:

- Full clean/duplicate/ambiguity/correction/related-claim/counterexample sequence and correct summary totals.
- Alias scope isolation across vendor/category/currency; conflicting aliases; no cap, date, amount or currency bypass.
- One-time override does not teach future claims or survive rerun.
- Missing names/amounts, invalid dates, failed extraction, absent/ambiguous policies and unavailable retrieval fail closed.
- Confident all-pass provider cannot approve missing evidence, conflicting aliases or cap violations.
- Duplicate active run rejection, in-flight correction winning over orchestration, SQL invalid batch rollback, stale publication rejection, original decision preservation, newest human result selection.
- Jev wire request/response/usage and Elasticsearch indexing/query/evidence behavior with mocked HTTP responses.
- Same-origin/body validation, route response/error contracts and idempotent metadata import.
- SQL private bucket and anonymous table/RPC access denial.

The SQL harness uses PGlite with synthetic Supabase roles/storage schema; only the unsupported `create extension pgcrypto` statement is omitted because PGlite already supplies UUID generation. This verifies PostgreSQL schema/functions, not remote Supabase connectivity or network concurrency across actual connections. The route test invokes actual handlers with simulated providers; no full combined Next app was built in this isolated module.

Jev integration was verified against official TypeSafe documentation on September 19, 2026: [quickstart](https://docs.typesafe.ai/introduction/quickstart), [Choice](https://docs.typesafe.ai/primitives/choice), [confidence](https://docs.typesafe.ai/confidence). Direct endpoint is `https://api.typesafe.ai/v1/systemone`; model defaults to `jev-latest`. Elasticsearch bulk/search contracts were checked against official Elastic API documentation. **No live provider/Supabase/Elasticsearch credentials were inspected or used; live connectivity and model quality remain unverified.**

## Dependencies and environment

Runtime adds **no provider SDK dependency**: native fetch/Web APIs and Module 1's existing `server-only@0.0.1`. Module 1 already has TypeScript/tsx. Optional SQL-test dependency: `@electric-sql/pglite@0.3.10`; install only in a temporary harness or add during integration. The isolated harness used tsx 4.20.6, TypeScript 5.9.3 and @types/node 22.18.6 with Node 25.9.0. No repository dependency files were created.

Environment names (no secret values):

- `SUPABASE_URL` (fallback `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`.
- `TYPESAFE_API_KEY` (fallback `JEV_API_KEY`), `JEV_MODEL`.
- `ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY`, optional `ELASTICSEARCH_INDEX`.
- `RECONCILIATION_MODE=live|simulated`, `RECONCILIATION_APP_ORIGIN`.
- `RECONCILIATION_SYNTHETIC_ONLY=true` for the optional local intake import seam.

Live mode requires all service configurations and does not silently simulate failures. Unset mode explicitly reports simulated adapters through `demo_mode`, decision evidence and model labels when credentials are absent. `simulated` forces Jev/search simulation but still uses Supabase if configured. Partial storage/search credentials fail configuration validation.

Apply migration and seed to a dedicated Supabase project. Run `node src/lib/core/provision-search.mjs` from `reconciliation/` once with Elasticsearch env to provision a new index with the supplied mappings. The migration creates private bucket `receipts`; a custom Module 1 bucket requires separate provisioning.

Test commands and detailed adapter behavior are in `reconciliation/src/lib/core/README.md`. Integration should add the core tests to the scaffold's test script; no package edit was made here. API-handler tests need `NODE_OPTIONS=--conditions=react-server` so the actual server-only package permits Node imports.

## Explicit integration gaps and recommended bridge

1. **The combined local upload-to-dashboard workflow is not complete.** Module 1 `LocalStore` persists `.intake-demo/*.submission.json`, `*.receipt.json` and private `*.bin` files; core memory storage starts with its own seeded records. Live Supabase is the already-compatible shared path. Module 1 demo extraction intentionally produces unknown fields, so even after bridging, such uploads must need review.
2. Stable server-only seam: `importDemoIntakeRecord(submission, receipt)` from `src/lib/core/runtime.ts`. Integration should call it **after** successful durable `LocalStore.create` and `LocalStore.finish`, and rehydrate matching metadata JSON pairs at process startup before serving core endpoints. It accepts the structural Module 1 Claim/Receipt types; no direct MemoryStore.state mutation is required. It preserves current review state on identical imports, enforces one receipt, rejects edited claim values, and requires review when extraction changes. An import conflicting with an active run must be retried.
3. **Receipt bytes stay with Module 1.** The seam never accepts/serves bytes. Seed paths now match `synthetic/{submission_id}/{receipt_id}`, but the seed includes no binary receipt objects/files. Seed receipt links therefore return 404 until integration materializes synthetic files. Uploaded files remain served by Module 1's private endpoint.
4. `globalThis` preserves in-memory state across module hot reload within one process. Process restart loses core decisions/corrections/runs; workers do not share memory. Metadata replay restores claims only. Use common Supabase for durable correction learning or add explicit durable demo persistence during integration.
5. Core and dashboard fixture preview have different fictional names/IDs/categories; dashboard API mode consumes the real core records and is compatible. The standalone preview remains read-only illustration. No dashboard edits are needed for API payload shape or probability meaning.
6. Supabase snapshots load the small demo dataset; ES syncs the corpus with refresh before search. Corpus is bounded at 1000 records and at most 100 matches per search; overflow/incomplete search requires review. This is intentionally not a production-scale index pipeline. Database usage cannot be guaranteed durable while the database is unavailable.
7. Batch budget may leave IDs unstarted; their results explicitly return pending with a retry explanation. Hosting must support the 300-second route hint. No authentication, payments, background queue, blind rerun auditor or real financial data support was added.

Merge scaffold first, then both Module 2 commits, then Module 3, and complete the narrow local-store bridge or select shared Supabase. No module task IDs besides the parent task ID were available in this task.
