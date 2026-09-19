# Module 1 handoff — intake

Branch: `codex/reconciliation-intake`

Implementation commit: `23329a8a88b76d802982c6174ed675672a349271` (this handoff follows in a documentation commit).

Base contract: `1ed6e3e`, `RECONCILIATION_CONTRACT.md`. No push, merge, or changes to the existing browser prototype. No Module 2/3 owned files modified.

## Delivered files and behavior

- `reconciliation/package.json`, lockfile, TypeScript/Next/PostCSS setup, generated Next agent guidance, root layout/styles and root redirect: shared scaffold.
- `reconciliation/src/app/submit/**`: responsive synthetic-only form, dollars-to-integer-cents conversion, progress/errors, extraction failure explanation, saved receipt link. No automatic reconciliation.
- `reconciliation/src/app/api/submissions/route.ts`: server-side same-origin checks, bounded multipart input, exact one file, MIME/signature validation, persistence-before-extraction, contract response.
- `reconciliation/src/app/api/receipts/[id]/route.ts`: private receipt byte streaming, UUID and synthetic storage namespace validation, no-cache/content-sniffing protection. Deliberately unauthenticated synthetic-demo scope.
- `reconciliation/src/lib/intake/**`: local persistent demo adapter, Supabase live adapter, OpenAI Responses structured extraction, Zod output validation, failure persistence and actual call accounting.
- `reconciliation/src/lib/intake/fixtures/synthetic-train.pdf`: fictional PDF for upload testing.
- `reconciliation/README.md`, `.env.example`: run instructions and operating limits.

Live extraction accepts PDF, PNG, JPG and preserves the exact parsed-fields shape from the frozen contract. Unknown fields remain null. PDF is passed as inline `input_file`; images as inline `input_image`. The extraction prompt receives no user-entered claim values or original filename. OpenAI response model and available input/output tokens are persisted once per attempt, without retries or invented cost. Invalid output, refusal, incomplete response, missing key, and provider failure produce failed extraction with the original receipt retained. Missing key and simulated extraction create no provider call record.

## Dependencies and run commands

Pinned: Next 16.3.5; React/React DOM 19.3.0; Supabase JS 2.116.0; Zod 4.6.5; Tailwind/PostCSS 4.3.3; server-only 0.0.1. Development: TypeScript 5.9.3, tsx 4.21.0, pinned types. OpenAI uses native fetch; no OpenAI SDK needed. `npm ci` was installed and build-tested with Node 25.9.0; use Node >=22.

```sh
cd reconciliation
npm ci
cp .env.example .env.local
npm run dev
```

Visit `/submit`. The example selects local simulated mode explicitly. The receipt fixture can be uploaded with Alex Demo / alex@example.com / USD 123.45 / train / New York. Simulated extraction returns all fields unknown and says so in the UI; it is not a clean-claim fixture for Module 2.

## Environment variable names

- `RECONCILIATION_SYNTHETIC_ONLY=true` — mandatory gate for file operations.
- `RECONCILIATION_INTAKE_MODE=demo|live` — mandatory explicit choice; no silent fallback.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — live server-only storage/database client.
- `SUPABASE_RECEIPTS_BUCKET` — private bucket; defaults to `receipts`.
- `OPENAI_API_KEY` — live server-only extraction key.
- `OPENAI_EXTRACTION_MODEL` — defaults to `gpt-4.1-mini`.
- `RECONCILIATION_APP_ORIGIN` — optional exact canonical origin; defaults to request URL origin. Example uses http://localhost:3000; change if testing another port.
- `RECONCILIATION_INTAKE_DEMO_DIR` — optional private local persistent directory; defaults to ignored `.intake-demo/`.

No real credentials or local environment files were read or committed.

## Verification completed

- `npm test`: 10 passing tests. Multipart/origin/file validation, body cap without Content-Length, exact one receipt, strict parsed fields, dates and money, persisted failure and original bytes, successful structured request and exact usage, invalid structured response, refusals/incomplete/network/HTTP failures, no-key behavior, simulated nulls, and failure when usage cannot be saved.
- `npm run build`: passed, including TypeScript and route generation; no build warnings after scoping runtime filesystem tracing.
- `npm run typecheck`: passed.
- HTTP smoke against running app: successful upload 201, stored receipt 200 with byte-for-byte PDF equality and private/no-store headers, cross-origin submission 403, invalid UUID 400, missing receipt 404.
- Browser: filled and submitted the synthetic PDF, observed saved/pending confirmation and simulated-extraction label, checked desktop and 390px mobile layout.
- `git diff --cached --check`: passed. PDF fixture marked binary via scoped `.gitattributes`.

## Module integration requirements and limitations

1. Merge scaffold first, then Module 2, then Module 3 as agreed. Module 2 owns migrations/contracts; intake declares a structurally matching local subset so it builds independently. Consolidating types later is optional integration work.
2. Live mode expects Module 2 tables `submissions`, `receipts`, `model_calls` exactly as contracted. Inserts supply UUIDs/timestamps and nullable run/receipt relationships. Create a **private** `receipts` bucket; intake fails closed if public. Storage object names are `synthetic/{submission_id}/{receipt_id}` without filename extensions; MIME type is stored separately.
3. Module 2 reports that seeded receipt paths match `synthetic/{submission_id}/{receipt_id}`. The corresponding fixture files must still be materialized: metadata alone does not make a receipt viewable. For LocalStore, provide the matching `{receipt_id}.receipt.json` and `{receipt_id}.bin` in its private directory; for live storage, upload the bytes at the contracted object path. Files using other live storage paths are not served. No generic storage-path endpoint exists.
4. Local intake demo uses per-record JSON and private binary files, independent of Module 2's demo adapter. Module 2's coordination handoff reports that `src/lib/core/runtime.ts` exports server-only `importDemoIntakeRecord(submission, receipt)`, an idempotent metadata import that preserves core decisions/status. After combining branches, the integrator must call it after durable intake creation and after durable extraction finish, passing the latest submission/receipt records. Receipt bytes remain in LocalStore. The integrator must also rehydrate persisted `{submission_id}.submission.json` and `{receipt_id}.receipt.json` pairs on startup, before serving core reviews/reconciliation, so existing intake survives an app restart. Core's singleton survives hot reload only; it does not survive process restart or synchronize multiple workers. This bridge imports intake metadata, not durable core decisions/corrections. Multi-worker operation requires a shared persistent store, such as the live Supabase path. This isolated branch does not import unavailable core code, implement the bridge, or merge branches; until integration, local intake submissions do not automatically appear in Module 2/3 demo views.
5. Live Supabase/OpenAI connectivity and real model extraction quality are unverified without credentials. Provider request construction/error handling were verified with mocks. The live adapters are implemented, not placeholders.
6. Supabase storage/database creation uses compensating cleanup, not a cross-service transaction. A crash can leave an orphan object/pending row. A process killed during extraction can leave `pending`; core must send missing extraction to review. No background queue/retry or idempotency was added.
7. On database failure, usage cannot be guaranteed durable. Intake reports failure rather than claiming successful evidence. Costs remain null because no pricing assumptions were introduced.
8. Hosting must support an 8 MiB receipt plus 64 KiB multipart overhead and a 60-second extraction call (route duration hint 90 seconds). Local adapter requires writable durable disk; use live mode for serverless deployment. No authentication/rate-limiting/payment capability is included in the synthetic MVP.
9. Current `npm test` targets intake tests only; integrator should extend the test script to include Module 2/3 tests after merging. Add any requested additional module dependencies through the scaffold owner/integration step, then regenerate the lockfile.
