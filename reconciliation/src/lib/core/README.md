# Module 2: synthetic reimbursement core

Server entry point: `runtime.ts`. Portable orchestration: `service.ts`. Shared types: `../contracts.ts`.

This is an unauthenticated **synthetic-data-only** reimbursement demo, not payment software. Keep service credentials on the server. Do not upload real travel documents or financial information.

## Configuration

- `SUPABASE_URL` (also accepts `NEXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY`: common persistent database. Partial configuration is an error.
- `TYPESAFE_API_KEY` (or `JEV_API_KEY`), `JEV_MODEL` (default `jev-latest`): Jev direct HTTP integration.
- `ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY`, `ELASTICSEARCH_INDEX` (default `reimbursement-demo`): mandatory live retrieval. Partial configuration is an error.
- `RECONCILIATION_MODE=live|simulated`: `live` requires all three services. `simulated` forces fixture Jev/search adapters but still uses Supabase if configured. When unset, each missing provider uses its explicitly labeled simulated adapter; `GET /api/reviews` reports `demo_mode:true` if any adapter is simulated or storage is in memory. Configured provider failures never fall back to simulation.
- `RECONCILIATION_APP_ORIGIN`: exact mutation origin; defaults to request URL origin.
- `RECONCILIATION_SYNTHETIC_ONLY=true`: required for the optional demo intake import seam, matching Module 1's gate.

Apply `supabase/migrations/202609190001_reimbursement_core.sql` to a dedicated Supabase project, then `supabase/seed.sql`. The migration expects Supabase's standard `anon`, `authenticated`, `service_role` and `storage.buckets`. It creates a private `receipts` bucket. No browser database grants are added.

Before first live search, run `node src/lib/core/provision-search.mjs` from `reconciliation/` with the Elasticsearch server env set. Use a new dedicated index; the script deliberately does not replace existing indexes. `elasticsearch-index.json` defines exact keyword/date/numeric fields. Bulk sync uses `refresh=wait_for`. Returned IDs are rehydrated from authoritative Postgres records; ES source text and scores never substitute for candidate evidence. Current and future submissions are excluded, with UUID ordering breaking identical submission timestamps. Scoped aliases use exact normalized vendor/category/currency matching. Corpus is capped at 1000 records, results at 100 per search; incomplete/truncated search requires review.

## Demo sequence

The five fixed UUIDs exported by `fixtures.ts` end in `001` through `005`:

1. Reconcile all five: clean flight approved; duplicate flagged; ambiguous hotel, related hotel and flight counterexample need review.
2. Correct `...003` with `vendor_alias`, approved, and payload `{ "observed_vendor":"SYN HBR 042", "canonical_vendor":"Synthetic Harbor Hotel", "scope":{"category":"hotel","currency":"USD"} }` plus a human note.
3. Reconcile `...004` and `...005`: related hotel now approved; flight still needs review. Amount mismatch, policy cap, missing evidence and date/currency failures remain independent checks.
4. A `decision_override` uses `{}` as payload. It never enters reusable correction retrieval and expires when that claim is reconciled again.

Simulated semantic decisions identify `simulated-fixture-v1`, set scalar probability/confidence null, and contain `simulated:true` in evidence. They create no model-call usage rows. Live decisions expose `probability = P(pass)` (probability the check is true), separate provider `confidence`, selected choice in `answer_json.value`, and the complete provider response/distribution in evidence. The default gates are selected-choice probability >= .85 and confidence >= .7; these are conservative demo thresholds, not calibrated benchmark claims.

Unknown receipt fields remain null. Failed/missing extraction and any unknown check require review. Deterministic money, date, cap and policy checks cannot be overridden by Jev. Missing names cannot become automatic mismatch or automatic approval. Conflicting alias identities require review even if a model emits a confident pass.

## Atomicity and operating limits

`core_begin_run` locks the submission and prevents duplicate active runs. A five-minute lease recovers abandoned work. `core_finish_run` validates and saves the decision batch, marks completion, and publishes submission status/latest run in one transaction. Corrections take the same row lock, invalidate active runs, save a human decision and correction, and publish status atomically. Late completion/failure cannot overwrite human action. Original decisions remain stored; reviews expose the latest completed run and only its newest applicable human override.

Batches accept 1–50 distinct UUIDs, run at concurrency three, and stop launching new work after 180 seconds; unstarted results return `pending` with a retry explanation. The route duration hint is 300 seconds. Jev is bounded at 25 seconds; storage/search calls at 15 seconds. A provider API attempt produces one usage record, with unavailable tokens/costs null. A usage write failure prevents automatic approval but cannot guarantee durable usage when the database itself is unavailable. No automatic retries incur hidden calls.

The database snapshot and ES refresh are intentionally simple small-demo implementations. Use a queue, pagination and incremental indexing before larger deployment. Full authentication, payments, rate limiting, background retries and blind rerun auditors are outside the frozen scope.

## Intake integration seam

`importDemoIntakeRecord(submission, receipt)` is exported from `runtime.ts`, marked server-only, and accepts the structural Module 1 `Claim`/`Receipt` types. It requires memory storage and the synthetic-only gate. It is idempotent, enforces a single receipt, rejects changed claim values, preserves core decisions/status on unchanged imports, and marks changed extraction as requiring review. Retry imports that conflict with an active run.

The integration step should call it after Module 1 `LocalStore.create` and `LocalStore.finish` successfully persist metadata. Also rehydrate each `.submission.json` with its `.receipt.json` on process startup before serving reviews/reconcile. Do not pass file bytes into core; Module 1 remains responsible for private binary storage and `/api/receipts/[id]`. No existing intake file is modified or automatically scanned by this module.

The `globalThis` singleton preserves core state across ordinary module hot reloads in the same process. Process restart loses in-memory corrections/runs/decisions; separate workers do not share it. Metadata rehydration restores uploaded claims, not historical correction learning. Use shared Supabase for durable cross-module behavior. Seed receipt paths match `synthetic/{submission_id}/{receipt_id}`, but the seed includes metadata only: original fixture files must be materialized by integration or receipt links return 404.

## Tests

No runtime SDK dependencies: native `fetch`, Web Request/Response, and the scaffold's `server-only@0.0.1`. TypeScript 5.9.3 / Node >=22. Tests were run with isolated `tsx@4.20.6`, `@types/node@22.18.6`, and optional `@electric-sql/pglite@0.3.10`. Module 1 already supplies tsx 4.21.0, TypeScript and server-only; no manifest changes are required for runtime.

From `reconciliation/` after integration:

```sh
npx tsx --test src/lib/core/tests/core.test.ts
NODE_OPTIONS=--conditions=react-server npx tsx --test src/lib/core/tests/routes.test.ts
node --test src/lib/core/tests/database.test.mjs
```

The database test resolves `@electric-sql/pglite`, or accepts `CORE_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js` for an isolated installation. It creates mocked Supabase roles/storage bucket schema, runs the exact migration (only removing unsupported `create extension pgcrypto`, since UUID generation is built in), and verifies transaction behavior. It is not a remote Supabase connectivity test. Route tests use actual handlers with simulated providers; Jev and Elasticsearch wire tests use mocked HTTP responses. No live credentials were inspected or used.

Official integration references checked September 19, 2026:
- https://docs.typesafe.ai/introduction/quickstart
- https://docs.typesafe.ai/primitives/choice
- https://docs.typesafe.ai/confidence
- https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-bulk
- https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-search
