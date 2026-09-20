# Testing Sift together

**Current integration:** `/business-demo` displays stored claims, original receipts, machine assessments, human decisions, and live Jev search. `/submit` handles uploads. `/search` and `/demo` redirect to the workspace.
Run `npm run demo:jev`; try “hotel claims” and “claims above $200”.
Elasticsearch is no longer required: candidate retrieval uses stored receipt fields.
The older handoff below is historical; investigations and tested rule learning remain pending. Human decisions and the real queue are now connected.


This is the team runbook. The [Devin benchmark plan](superpowers/plans/2026-09-19-sift-benchmark.md) is prepared; it has not been dispatched or implemented by this handoff.

## What works now

At `917f25f`, 44 Node tests, 11 browser tests and the production build passed. They verify software behavior with synthetic data/mocked providers; they do not establish live model accuracy.

There are two separate existing datasets:

| Dataset | Open/use | Persistence and meaning |
| --- | --- | --- |
| Six UI examples | `/business-demo?preview=1` | Browser memory; resets on reload; simulated search and rule results, including 8/10 → 10/10 |
| Five backend sample claims and PDFs | `npm run demo`, `/api/reviews`, `/submit` | Stored in ignored `.intake-demo/`; real local intake/storage, simulated providers |

The real queue now adapts stored records through `/api/workspace/reviews`. New uploads appear there. The six-row preview remains isolated for UI tests. Learning/investigation features in the historical handoff remain pending.

On each computer, from `reconciliation/`:

```sh
nvm use
npm ci
npm run demo
```

Open `http://127.0.0.1:3000/business-demo?preview=1` for UI checks and `http://127.0.0.1:3000/submit` for actual local upload/storage checks. The demo command intentionally disables paid providers even if keys exist. It initializes the five backend samples on first core access. Sample receipt download: `http://127.0.0.1:3000/api/demo/receipt/train` (Alex Demo, train, $123.45, New York).

For a fresh rehearsal, stop the server first:

```sh
npm run demo:reset -- --confirm
npm run demo
```

Reset archives the previous local data directory; it does not reset Supabase. If using a custom `RECONCILIATION_INTAKE_DEMO_DIR`, pass the same variable to both commands: the reset script does not load `.env.local`. Never reset another teammate's active session.

## Database decision

**Local development and isolated benchmark: keep the existing file-backed store.** No database account is required. Each computer gets independent state; GitHub shares source, migrations and synthetic fixtures, not live records or secrets.

**Shared hosted demo: use the existing Supabase adapter.** It uses [Postgres](https://supabase.com/docs/guides/database/overview) for claims/checks/decisions/rules and [private file storage](https://supabase.com/docs/guides/storage) for PDFs/images. The repo already contains the v1 SQL migration, seed script, adapter and PDF uploader. B must add/apply the v2 migration before testing v2 behavior. Avoid introducing another database during the hackathon.

Use one dedicated synthetic demo project when all four people need the same queue. Give a final benchmark its own isolated environment so manual rehearsal does not contaminate it. Service-role keys belong in the server environment/Devin secrets, not browser code or Git. The current demo has no real-user authentication: keep it synthetic.

Existing Supabase setup, after creating that project:

1. Apply `reconciliation/supabase/migrations/202609190001_reimbursement_core.sql`, then B's v2 migration when delivered, then `reconciliation/supabase/seed.sql` as appropriate for the integrated schema. Follow B's migration instructions if the seed changes.
2. Set server-side `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_RECEIPTS_BUCKET=receipts`; the receipt bucket must be private.
3. From `reconciliation/`, run `npm run seed:receipts` to upload the five existing synthetic PDF originals. It does not exercise OCR: their parsed fields are already fixtures.
4. Upload a new PDF through `/submit` to test real extraction. Rerunning `seed.sql` uses conflict handling and is **not** a clean database reset.

## Provider setup and honest test labels

| Mode | Requirements and what it proves |
| --- | --- |
| Preview/offline tests | No keys; UI/software behavior only |
| `npm run demo:jev` | One Jev/Gateway key; actual Jev calls, but fixture extraction/local simulated retrieval |
| Local storage with live extraction + Jev | OpenAI key and one Jev key; original document extraction plus real assessment, with local retrieval explicitly labeled |
| Configured full live backend | Supabase + OpenAI + Jev credentials; integrated v2 routes and investigator required for full product demonstration |

For the supported local mixed mode, put provider keys in `.env.local` and start ordinary `npm run dev -- --hostname 127.0.0.1`, **not** `npm run demo`:

```dotenv
RECONCILIATION_SYNTHETIC_ONLY=true
RECONCILIATION_INTAKE_MODE=demo
RECONCILIATION_EXTRACTION_MODE=live
RECONCILIATION_MODE=
RECONCILIATION_JUSTIFICATION_MODE=simulated
RECONCILIATION_APP_ORIGIN=http://127.0.0.1:3000
SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ELASTICSEARCH_URL=
ELASTICSEARCH_API_KEY=
```

Also set `OPENAI_API_KEY` and one of `AI_GATEWAY_API_KEY` or `TYPESAFE_API_KEY` through your own environment. Never paste keys into this guide. Leave `JEV_MODEL` unset to use the existing channel default unless deliberately testing another configuration. B's integrated investigator additionally uses `RECONCILIATION_INVESTIGATION_MODE=live` and `OPENAI_INVESTIGATOR_MODEL`; these are not implemented in the current v1 runtime. Restart after changing modes or directories.

An empty `RECONCILIATION_MODE` currently permits this local configuration. Explicit `RECONCILIATION_MODE=live` requires Supabase and Jev. Read actual execution labels: local storage means `demo_mode` can be true even when extraction/Jev calls are real. Paid calls require real keys on **each** machine, including Devin's environment.

## Three datasets and the review gate

1. **Rehearsal pack:** eight new seeded examples you and Devin can reuse, inspect and debug freely. Existing five/six examples are also available now. The new seed command is Devin's deliverable, not implemented yet.
2. **Activation suite:** C's ten synthetic valid/adversarial cases decide whether a draft alias may activate. Keep this in `src/lib/intelligence/learning.ts`.
3. **Final evaluation:** 50 different cases: 20 straightforward valid, 10 valid unfamiliar merchants, eight violations, six later duplicates, six incomplete/ambiguous cases. This measures generalization beyond the source correction and activation examples.

Before the final run, inspect every final receipt and proposed expected answer. Two teammates can divide the 50, then cross-check disagreements and all financial/duplicate cases. Record reviewers and dataset/answer hashes. The expectation is about the underlying evidence, not whatever the model predicts. Freeze the answer key **before** viewing final predictions. Keep it outside upload/prompt inputs, training corrections and the product UI.

## Manual checks after B/C integration

Use rehearsal data on `/business-demo` without `?preview=1`. Run these yourself even if Devin's tests pass:

| Test | What a person should verify |
| --- | --- |
| Clean upload | Claimed amount and original PDF agree; extraction is real; machine can say Matched while human decision stays Pending |
| Overclaim | Claim exceeds receipt; clear failure evidence; Approve is blocked |
| Duplicate | Upload the identical receipt twice; the later copy is flagged; the two copies cannot both be approved |
| Unfamiliar merchant | Inspect original and investigation; approving the source requires your note and does not activate learning by itself |
| Learn one alias | Propose → run actual safety test → activate; recheck a different valid purchase; existing human decisions survive |
| Protected counterexamples | Recheck overclaim/over-cap/duplicate using the alias; learning never makes them pass |
| Unknown evidence | Missing printed amount/traveler stays unknown; no invented value or automatic approval |
| Stale edit | Open a claim in two tabs; update one, then submit the older form; conflict is clear and the note is retained |
| Persistence | Refresh/restart; actual backend claims, notes and rules persist. Preview resetting is expected |
| Provider outage | In an isolated rehearsal, withhold a required provider configuration; the error is explicit and never replaced by fabricated successful results |

Have a teammate who did not write the interface run the flow without coaching. Capture confusing copy or steps. To claim time saved, time the same operator completing comparable rehearsal claims manually versus using Sift, record the method, and disclose the small sample. Model latency alone is not human time saved; flagged dollars are not proven recovered savings or fraud.

## Automated checks and benchmark execution

Working checks today, from `reconciliation/`:

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
```

Use Node 24 from `.nvmrc`; the browser suite expects installed Chrome. Devin can install/configure Chrome in its own environment without changing production dependencies.

After C merges, also run `npm run test:intelligence`. After Devin implements the runner, `npm run eval:heldout` will generate a review pack offline, with explicitly separate live/seed commands documented in `evals/README.md`. Those two scripts are currently declared but their implementations are missing; do not treat them as passing checks today.

For the paired final benchmark, extract once, freeze inputs and reference data, run the same 50 cases in the same order before/after the reviewed alias, and keep failures in the report. Original/duplicate order is part of the dataset. The benchmark must report incorrect matches, violations/duplicates caught, valid claims needing investigation, regressions, latency and actual provider usage, with JSON/CSV/readable artifacts. Unknown usage stays unknown. No hard-coded improvement or editing unfavorable results.

## What Devin should return and what the team checks

Devin returns its PR/session links, source commit, reviewed dataset hashes, exact commands, all test results, reports (including failed/partial runs), and a recording of the integrated browser flow. [Devin supports asking for browser tests and a recording](https://docs.devin.ai/work-with-devin/testing-and-recordings).

The team reviews expected answers before the final run, manually repeats the rehearsal, reviews the PR, and reruns the frozen experiment once in a fresh environment. Live models can vary; preserve both results rather than selecting the better one. If the benchmark reveals a bug, keep the failing run, fix against development cases, and disclose/version any replacement final evaluation.

These artifacts support the Maximor learning claim and Cognition development/testing evidence. They do not guarantee sponsor eligibility or a prize. Keep the simulated UI 8/10 → 10/10 demonstration clearly separate from measured live results.
