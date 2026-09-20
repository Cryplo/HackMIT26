# Fieldnotes: hackathon reimbursements

Integrated intake, reconciliation, and organizer review. A reviewer can correct a merchant alias and improve a later claim without changing financial rules. **Synthetic data only: no authentication or payments.** Approved means approved for reimbursement, not paid. The older browser prototype remains untouched outside this directory. Integration branch: `codex/reconciliation-integrated`.

## Run now

Node >=22.18, npm, and installed Google Chrome for browser tests. From this directory:

```sh
npm ci
npm run demo
```

Open **http://127.0.0.1:3000/demo** for the walkthrough, **/business-demo** for the organizer, and **/submit** for intake. Use the exact hostname: mutations enforce same origin. For another port: `npm run demo -- --port 3002`.

This command disables live services even when keys exist. Five fictional claims and PDF receipts initialize automatically. Uploads, decisions, runs, and corrections persist in ignored `.intake-demo/`. Local storage uses atomic snapshots and a cross-process lock on one machine; use Supabase for deployment. Interrupted runs expire after five minutes and can then be retried.

### Real Jev using your existing key

```sh
npm run demo:jev
```

Stop the other server first, or pass `-- --port 3002`. This uses `AI_GATEWAY_API_KEY` or `TYPESAFE_API_KEY` from environment/`.env.local`; if absent, it can reuse the browser prototype's key in `../.env`. It does not print or copy keys. Real Jev calls incur provider usage. Extraction still uses sample fixtures, retrieval uses local simulated matching, and storage stays local. The dashboard labels the execution modes. Unknown/low-confidence live results require review; the exact walkthrough numbers describe simulation.

## Three-minute demo

1. Select the five seeded rows and reconcile. In simulation: Alex's first flight passes; the duplicate is flagged; Sam, Taylor, and Jordan need review.
2. Open the duplicate's Evidence and original PDF. Inspect the matching prior purchase.
3. Sam Example → Evidence → Correct & teach → Reusable vendor alias. Choose Approved. Observed merchant: `SYN HBR 042`. Canonical merchant: `Synthetic Harbor Hotel`. Add a note and save. Scope is hotel/USD.
4. Select Taylor and Jordan only; reconcile again. Taylor's hotel passes; Jordan's flight stays under review. For these five simulated rows, approved amount becomes **$615**, review rate falls from **80% to 40%**. This is scoped correction memory, not model fine-tuning or measured customer savings.
5. Download `/api/demo/receipt/train`. Submit Alex Demo, any fictional email, $123.45, Train, New York, and that PDF. Reconcile the new row. Submit the same PDF again to see a duplicate.

Simulated extraction recognizes only **exact bundled PDF bytes** by hash. It does not OCR arbitrary files; unknown uploads retain null fields and require review. Form input never substitutes for receipt evidence. Live OpenAI extracts actual PDF/image content.

To start fresh, stop the app and run:

```sh
npm run demo:reset -- --confirm
npm run demo
```

Reset archives existing local data to `.intake-demo.backup-<timestamp>/`, without deleting it or touching Supabase. For a custom data directory, supply the same `RECONCILIATION_INTAKE_DEMO_DIR` to both commands. A lock left by a crashed process is recovered automatically (dead owner PID, or an unreadable owner older than a minute); a lock held by a live process is never stolen, and a request that loses its lock to recovery fails with `DEMO_BUSY` rather than overwriting the winner's state. An unreadable or incomplete `core-state.json` is reported as `DEMO_CORRUPT` and never reseeded over; an unreadable `*.receipt.json` or `*.submission.json` quarantines that one claim and is logged, leaving the rest of the ledger readable.

## Full live setup: manual credentials required

1. Create a **dedicated demo Supabase project**. Run `supabase/migrations/202609190001_reimbursement_core.sql` once in its SQL editor, then `supabase/seed.sql`. This creates service-only tables/RPCs, a private `receipts` bucket, and fictional records.
2. Create an Elasticsearch deployment and API key with create-index, indexing, and search permissions. Use its HTTPS endpoint, not a Cloud ID, and a dedicated index.
3. Obtain an OpenAI key with access to a PDF/vision Responses model. Default is `gpt-4.1-mini`.
4. Copy `.env.example` to `.env.local`. Set all three modes to `live`. Fill Supabase, OpenAI, Elasticsearch, and one Jev provider's credentials. Gateway uses `JEV_MODEL=typesafe-ai/jev`; direct TypeSafe uses `jev-latest`. Never commit keys or expose them to browser code.
5. Set `RECONCILIATION_APP_ORIGIN` to the exact URL you open, then:

```sh
npm run search:setup
npm run seed:receipts
npm run check:jev
npm run dev -- --hostname 127.0.0.1
```

`search:setup` creates the index once and will not replace an existing index. `seed:receipts` uploads five fictional PDFs after SQL seeding, overwriting only their fixed synthetic storage objects. `check:jev` makes one live call; `npm run check:jev -- --workflow` runs seven calls covering the correction loop. Seed parsed fields are fixtures: upload a **new file through the form** to verify OpenAI extraction.

Live mode fails closed on missing configuration and never silently simulates provider failure. Restart after changing environment settings.

Optional local live extraction: keep intake mode `demo`, set extraction mode `live`, configure `OPENAI_API_KEY`, and use `npm run dev`, not `npm run demo` (which forces simulation). Keep reconciliation mode `simulated` for simulated checks, or leave it unset with a Jev key for live decisions and local retrieval. Inspect the dashboard execution label.

## Test

```sh
npm test
npm run build
npm run typecheck
npm run test:browser
```

Browser tests start an isolated app on port 3100 and use fresh temporary data, without modifying your demo ledger. Google Chrome is required; if missing, run `npx playwright install chrome`. `DASHBOARD_BASE_URL` selects an external test server, which must have a fresh synthetic dataset. Tests cover real upload/API/storage/review integration using simulated providers, failed requests, and desktop/mobile layouts.

SQL tests exercise PostgreSQL functions under PGlite with a minimal Supabase harness. Provider contract tests mock HTTP. Actual Gateway Jev workflow evidence is in `docs/live-jev-smoke.json`; this is a small smoke test, **not an accuracy/cost benchmark**. OpenAI, remote Supabase, and Elasticsearch still need live verification after configuration.

## Boundaries and useful next work

- USD, one PDF/PNG/JPG per claim, 8 MiB maximum, exact amount matching. Demo window: September 1–30, 2026. Caps: flight $500, hotel $250, train $200, bus $100, other $50. Policy editing currently requires database/local-state changes.
- Code enforces amounts, dates, and caps. Jev judges merchant/category compatibility, attendee identity, and duplicate evidence. Code combines independent checks. Missing fields and uncertainty require review. Thresholds are conservative starting values, not calibrated on representative data.
- Reusable aliases are scoped to observed vendor/category/currency. One-time overrides teach nothing. Explicitly rerunning a manually resolved claim creates a new machine outcome; old decisions remain stored. Related claims need a rerun to use a correction.
- Usage is logged once per call; unknown costs stay null. Highest-value next sponsor feature: a fair labeled Jev-versus-LLM benchmark with measured latency/cost and decision quality, plus visible usage reporting.
- Dashboard shows current decisions and the applicable human override. A historical run comparison/export, extraction edit/retry controls, and policy editor would improve usability. Rationale is an evidence-based template, not a claim to expose model reasoning.
- Elasticsearch retrieval is bounded to a small demo corpus (1000 records), not production incremental indexing. Evaluate varied receipts and near-duplicates before broad quality claims.
- Before real users: authentication/authorization, retention controls, upload abuse limits, and background jobs/retries. No payments, DOCX, currency conversion, or independent auditor.
- Hosting must support private durable storage, 8 MiB uploads, extraction requests up to 90 seconds, and reconciliation batches up to 300 seconds. Some serverless platforms need direct storage uploads and background workers. No deployment has been performed.
