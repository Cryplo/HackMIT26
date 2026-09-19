# Synthetic reimbursement intake

Module 1 of the frozen `../RECONCILIATION_CONTRACT.md`. The existing browser prototype is untouched.

## Run locally

Requires Node.js >=22 (verified with 25.9.0).

```sh
cd reconciliation
npm ci
cp .env.example .env.local
npm run dev
```

Open `/submit`. The example config explicitly enables **synthetic-only local demo mode**. Upload `src/lib/intake/fixtures/synthetic-train.pdf` to exercise submission and receipt viewing. Demo extraction is visibly simulated: it returns unknown fields and never invents provider calls, tokens, or costs. Files and contract-shaped JSON records persist in ignored `.intake-demo/` across local restarts. This local store is intake-specific; it does not populate Module 2's demo adapter.

For real extraction of synthetic receipts, set `RECONCILIATION_INTAKE_MODE=live`, configure the server-only variables in `.env.example`, apply Module 2's schema migrations, and create the private Supabase bucket `receipts` (or the configured bucket name). Never use real attendee information. Live and demo modes both require `RECONCILIATION_SYNTHETIC_ONLY=true`. There is deliberately no authentication in this MVP.

`RECONCILIATION_APP_ORIGIN` must match the browser origin exactly, including port; omit it to use the request URL origin. Adjust the example if running on another port. Mutation requests without an Origin header are rejected. A hosting proxy must also allow the desired multipart size; this app permits one file up to 8 MiB and 64 KiB of multipart overhead. Extraction is synchronous, with a 60-second provider timeout and a 90-second route duration hint.

## Implemented routes

- `/` redirects to `/submit`.
- `/submit`: responsive attendee form with exact cents conversion, loading/error/saved states and original receipt link.
- `POST /api/submissions`: contract multipart API; persists pending submission and original file, validates structured extraction, records exact available call usage once, persists extraction failure, returns contract-shaped 201.
- `GET /api/receipts/[id]`: UUID validation, synthetic storage namespace check in live mode, server-side private download and no-cache stream. Receipt IDs are accessible within this deliberately unauthenticated synthetic demo scope; they are not personal authorization tokens.

The request accepts only the frozen contract fields. No automatic reconciliation, payment, or browser integration is performed. HTTP errors use `{error:{code,message}}` without provider messages, secrets, or database internals.

## Verification

```sh
npm test
npm run build
npm run typecheck
```

Tests cover bounded multipart input, exact-one-file handling, origin rejection, file signatures, schema/date/money validation, persisted failure, original byte retrieval, provider refusal/incomplete/error responses, exact token accounting, missing credentials, and usage persistence failure. Provider responses are mocked in automated tests.

## Pinned runtime dependencies

Next.js 16.3.5, React/React DOM 19.3.0, Supabase JS 2.116.0, Zod 4.6.5, Tailwind CSS/PostCSS 4.3.3. All direct versions and transitive resolution are pinned in `package.json` and `package-lock.json`. OpenAI uses native fetch against Responses rather than another SDK dependency.

Structured extraction follows the official [structured output documentation](https://developers.openai.com/api/docs/guides/structured-outputs) and [file input documentation](https://developers.openai.com/api/docs/guides/file-inputs). The model is configurable; default `gpt-4.1-mini`. PDF uses inline `input_file`, PNG/JPG use inline `input_image`; all output is validated again with Zod. Unknown values remain null. No extraction result can itself approve a claim.

## Operational limitations

Live provider/storage connectivity was not exercised without credentials. Storage and two database inserts use compensating cleanup rather than a cross-service transaction; a process crash may leave an orphan upload or pending row. A process termination during extraction may leave extraction pending, which Module 2 must route to review. A database outage while saving usage/final status returns an error or failed extraction; it never reports a successful approval. There is no durable job queue, automatic retry, upload idempotency, rate limiting, or user authentication in this hackathon module. Local demo persistence requires a writable durable filesystem and is not appropriate for serverless hosting. Deploy live mode on a host supporting the upload size and extraction duration.
