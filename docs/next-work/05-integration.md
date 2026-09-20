# Human and integration owner — setup, review, and demo

Read [README](README.md), [00-contracts](00-contracts.md), and each owner's handoff. This is the 4–8 hour investigation build plan, not evidence of a deployed feature. Earlier instructions are retained in [the archived pack](../archive/2026-09-20-review-workflow/README.md).

Current source already delivers guarded approval, scoped alias learning, extraction retry, export, and knowledge revisions. Investigation currently returns `INVESTIGATION_UNAVAILABLE`; supporting-document APIs, the procedure extension, investigation switch, and migration below are proposed work. Remote schema, current row counts, credentials, and provider budgets have not been inspected by this planning pass.

## Human checklist: do now

1. Assign **A** the review/Investigations UI, **B** contracts/backend/database, **C** investigator/Jev/procedure, and the **fourth teammate** integration, evidence review, timing, and pitch. Send each their assignment; B delivers additive contracts first.
2. Allocate an isolated synthetic target: local FileStore for simulation, or a dedicated synthetic Supabase project for live application work. Give the database owner SQL-editor access or a separate PostgreSQL connection. Identify the person who can review/apply migrations and preserve backups.
3. Hand server secrets to that owner through the team's secure secret channel, then install them locally in ignored `.env.local`. Do not paste values into prompts, Git, recordings, client variables, or handoff notes. Each clone needs its own configuration.
4. Agree a provider-call ceiling and spending ceiling before any paid call, including document extraction, Jev reassessment, procedure tests, and optional narration. Name the budget owner and target. A six-tool investigation limit is not a six-provider-call budget. The proposed 12-case `booking-reference-v1` before/after test alone requires 24 scorer attempts; reserve actual model fanout as well. No budget means offline work continues.
5. Decide the accepted identity evidence and applicable policy with B/C. The one procedure establishes merchant identity through a booking reference matching the receipt. An itinerary may establish claimant identity only when an explicit applicable policy permits it; otherwise leave that question unresolved. Never loosen identity checks globally.
6. **You start Devin:** copy the work prompt from [04-devin-benchmark](04-devin-benchmark.md) into your Devin session after assigning its isolated target and scope. Begin its offline demo20 preparation and verification work; this document does not dispatch Devin or authorize a full live benchmark.
7. Review all **20 actual synthetic receipt PDFs**, their supporting documents, policies, and evaluator-only labels before freezing demo20. Have another teammate cross-check identity, amounts, purchase relationships, and the violation. Record reviewers, amendments, and hashes; keep labels outside provider inputs and production evidence.
8. Reserve a personal UI walkthrough and three-minute rehearsal. Later, inspect the first supported correction, approve that claim with a note, review the procedure proposal, inspect its versioned test, then explicitly activate it. Approval alone does not teach a procedure; procedure application never approves or pays a claim.

These are target/access, evidence-policy, budget, and actual review/activation gates. Owners can implement, run offline checks, and integrate within their assigned scope without asking permission at every step.

## Dependency schedule and handoffs

| Window | Work and exit evidence |
| --- | --- |
| First 30 minutes | B freezes additive DTOs, routes, revision semantics, and migration requirements. Human assigns target/policy/budget; Devin starts offline documents. A/C prepare against frozen contracts. |
| Next 1–2 hours | B implements documents, progress persistence, guarded reassessment, and stores; C implements Azure tools and procedure; A builds server-driven views. Handoffs include owned files, exact commands/results, gaps, and contract changes. |
| Next 45–90 minutes | Integrate one slice: receipt + booking → persisted tool steps → evidence-backed reassessment → ready for human approval. Verify failures and unresolved questions before adding breadth. |
| Next 1–2 hours | Complete source approval → reviewed proposal → test → activation → different fresh claim. Keep missing/conflicting evidence and financial counterexamples blocked. Human checks demo20 and the UI. |
| Final 45–90 minutes | Run focused integration checks and one typecheck/build, then the explicitly budgeted live slice if authorized. Record actual results, rehearse, and preserve a labeled fallback recording. |

Adapt the clock to 4–8 hours by reducing polish and optional work. P0 is supporting documents for **one purchase**, one bounded investigator, persisted progress, and one reviewed procedure. Only after P0 acceptance may the team add distinct same-category USD purchases with explicit eligible amounts. No custom-check editor, unrestricted allocations, or summing booking/folio/payment documents for the same stay.

Use separate clones, all on **main**. Reserve serialized delivery slots: scoped normal commit, fetch main, merge upstream changes, resolve conflicts with the relevant owner, then normal push. No branches/worktrees, force-push, reset, or stashing another person's edits. Preserve unrelated local files and existing tests.

Integration alone owns `package.json`, lockfiles, global test/build/CI configuration, and shared setup changes. Other owners request the exact delta before touching them. Reuse the installed stack; no Elasticsearch, agent framework, queue, or new UI kit is needed.

## Commands supported today

From your existing repository clone:

```sh
cd reconciliation
nvm use 24.11.1
node --version
```

`.nvmrc` pins Node **24.11.1**. If that version is not installed, use `nvm install 24.11.1` first. Use existing dependencies when they match the lockfile; run `npm ci` for a new clone or changed lockfile. Coordinate dependency changes with integration.

### Offline, explicitly simulated workspace

Create an isolated directory once and retain its path for restart checks:

```sh
export RECONCILIATION_INTAKE_DEMO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sift-demo20.XXXXXX")"
RECONCILIATION_JUSTIFICATION_MODE=simulated npm run demo -- --port 3000
```

Open `http://127.0.0.1:3000/business-demo` and `/submit`. The demo command sets simulated core/demo intake/demo extraction, strips provider/Supabase credentials, and fixes the origin to `http://127.0.0.1:3000`. The explicit justification setting avoids inheriting a live narration flag. Keep the directory outside `public/`; preserve it and its private originals after the run.

A new FileStore currently initializes the existing five-claim fixture, **not demo20**. Use the reviewed demo20 loader only after delivery, against a fresh isolated target, recording every reference row. Do not substitute canned extraction for new PDFs and call it live. `?preview=1` is a separate simulated UI; it is not integration proof.

Use `npm run demo` for offline simulation. The existing `demo:jev` wrapper removes Supabase credentials and cannot satisfy the current live-core requirement; use the explicit live setup below instead. Do not run reset/seed commands on shared data.

### Live synthetic application

After selecting the isolated project, place these **non-secret settings** in ignored `reconciliation/.env.local`:

```dotenv
RECONCILIATION_SYNTHETIC_ONLY=true
RECONCILIATION_MODE=live
RECONCILIATION_INTAKE_MODE=live
RECONCILIATION_EXTRACTION_MODE=live
RECONCILIATION_JUSTIFICATION_MODE=simulated
RECONCILIATION_APP_ORIGIN=http://127.0.0.1:3000
SUPABASE_RECEIPTS_BUCKET=receipts
JEV_MODEL=typesafe-ai/jev
```

Add the actual `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, and `AI_GATEWAY_API_KEY` securely. Keep `TYPESAFE_API_KEY` and `JEV_API_KEY` unset in both the shell and env file: either direct key overrides Gateway. Intake requires `SUPABASE_URL`, even though core also recognizes `NEXT_PUBLIC_SUPABASE_URL`; never put a service key in a `NEXT_PUBLIC_*` variable.

Azure requires all three settings; the endpoint must be the HTTPS resource root or `/openai/v1` URL. The adapter derives `/openai/v1/responses`; the deployment is the actual Azure deployment name. Confirm supported PDF extraction/tool calling with its owner before the budgeted slice. No live probe is implied by setup.

Current live core requires **Supabase plus live Jev**; FileStore is exclusively simulated. This synthetic application is not a production-ready service for real financial data. Set the origin to the exact URL the browser uses, including scheme/host/port; `localhost` and `127.0.0.1` differ. A tunnel needs its exact origin. Restart after changing env values.

After completing the schema steps, start with:

```sh
npm run dev -- --hostname 127.0.0.1 --port 3000
```

In another terminal, check the current read-only workspace route:

```sh
curl --fail-with-body http://127.0.0.1:3000/api/workspace/reviews
```

GET/startup validation makes no model calls. Check complete coverage, persisted statuses, actual capabilities, and provenance. Upload/retry, reconcile, search, rule tests, and opted-in narration can spend credits; wait for the agreed budget before invoking them. Do not treat configured Azure as proof that historical extraction was live.

## Database owner: inspect before applying anything

Use Supabase SQL editor or an independently configured `psql "$SIFT_DATABASE_URL"` connection. The service-role REST key is **not** a DDL connection. Record project identity, deployed app commit, and a reviewed database/private-object backup location before changes; do not copy credentials into the record.

First run these read-only checks in the selected database:

```sql
select current_database(),
       to_regclass('supabase_migrations.schema_migrations') as migration_ledger,
       to_regclass('public.submissions') as base_table,
       to_regclass('public.platform_state') as platform_table,
       to_regprocedure('public.core_platform_version()') as version_rpc;
select id, name, public from storage.buckets where id = 'receipts';
```

Use the configured bucket ID if different. Require the bucket to exist and `public = false`. If the ledger exists, inspect it; SQL-editor installations may not be in the CLI ledger, so missing ledger entries alone do not prove a migration is absent:

```sql
select version from supabase_migrations.schema_migrations order by version;
```

Only if the version RPC exists, run `select public.core_platform_version();`. Once the base tables are confirmed, capture counts before changes:

```sql
select 'submissions' as table_name, count(*) from public.submissions
union all select 'receipts', count(*) from public.receipts
union all select 'reconciliation_runs', count(*) from public.reconciliation_runs
union all select 'decisions', count(*) from public.decisions
union all select 'corrections', count(*) from public.corrections
union all select 'policy_rules', count(*) from public.policy_rules
union all select 'model_calls', count(*) from public.model_calls;
```

If platform tables exist, also record counts of `merchant_rules`, `rule_history`, `rule_tests`, and `extraction_history`, and receipt hashes/provenance. Reconcile ledger, actual tables/RPC definitions, and prior deployment notes with B. Record the **actual** state; the old rehearsal's 21 rows are historical, not a promised current count.

1. If the base is genuinely absent in a fresh allocated project, have B review/apply `supabase/migrations/202609190001_reimbursement_core.sql` once first. Do not run `seed.sql` or rehearsal seeds over shared data.
2. If the base is installed and the platform migration is genuinely absent, apply the reviewed file once, in one transaction. This existing migration is **non-idempotent**:

```sh
psql "$SIFT_DATABASE_URL" --single-transaction --set=ON_ERROR_STOP=1 --file=supabase/migrations/202609200002_platform.sql
```

3. Existing current app + platform schema must return version **2**. If objects are partial, conflicting, or already installed, stop blind migration replay; B supplies a reviewed forward repair. Do not use a reset or unsafe legacy approval API as recovery.
4. Compare retained IDs, counts, original hashes/evidence, decisions, and history against the backup/preflight. Count equality alone does not prove preservation. Confirm private object access and service-only grants before reopening mutations.

### Original-receipt hash backfill: existing command

After reviewing the target/private bucket and matching app/schema, run from `reconciliation/` using the correct `.env.local`:

```sh
node --env-file=.env.local --conditions=react-server --import tsx -e 'const {getCore}=require("./src/lib/core/runtime.ts"); const {getStore}=require("./src/lib/intake/store.ts"); const {backfillReceiptHashes}=require("./src/lib/core/receipts.ts"); backfillReceiptHashes(getCore(),getStore()).then(console.log).catch(e=>{console.error(e.code || "BACKFILL_FAILED");process.exitCode=1;});'
```

This helper makes no model calls: it reads private originals, skips existing hashes, writes SHA-256, and reports `hashed`/`unavailable`. Confirmed absent originals remain null; auth/bucket/transient failures stop the run. It preserves bytes/parsed fields and is safe to resume. Never generate replacement originals or use `seed:receipts` as backfill. Hash changes can invalidate assessments/dependent rules; refresh and recheck, preserving human history.

## Conditional investigation rollout — only after B/C deliver

The following are proposed, not supported by today's app:

- `RECONCILIATION_INVESTIGATION_MODE=disabled|simulated|live`, default **disabled**. Simulated is for isolated FileStore only; live reuses the existing Azure endpoint/key/deployment through the extended Responses helper. Today that helper accepts extraction/justification only. Keep live narration off unless separately budgeted.
- B's `supabase/migrations/202609200003_investigations.sql`: supporting documents, persisted investigation steps/run extensions, and versioned procedure metadata. B must deliver/review it and its preservation checks before it is applied.
- New supporting-document, investigation/progress, and procedure routes in [00-contracts](00-contracts.md). Follow B's delivered payloads and capability checks; do not invoke illustrative endpoints against old code or display success for unavailable routes.

On an isolated copy, verify the new migration and matching application together, including the updated local demo store. Then the DB owner coordinates the reviewed rollout with mutations paused; after migration the app and `core_platform_version()` must **both require/report 3**. The current version-2 app rejects version 3. Do not independently change one side, edit an already-applied migration, or start the old app against the new schema.

Only once the proposed file exists and passes review, the DDL command will be:

```sh
psql "$SIFT_DATABASE_URL" --single-transaction --set=ON_ERROR_STOP=1 --file=supabase/migrations/202609200003_investigations.sql
```

Re-run the version/count/hash/private-bucket checks and record actual deployed state. Retain additive history on failure and keep affected mutations unavailable while B fixes the pairing; never roll back to unsafe legacy behavior. Preserve the whole local demo directory for offline recovery.

Enable the chosen investigation mode and restart only after this pairing works. For offline rehearsal, explicitly set the delivered `RECONCILIATION_INVESTIGATION_MODE=simulated`; for the authorized live slice, set it to `live` in the live configuration. Leave it `disabled` otherwise.

Confirm at most **3 Azure planning requests, 6 tool executions, 1 final core reassessment, and 90 seconds** covering investigation plus reassessment, with actual calls/failures recorded. No fourth synthesis request or implicit retry. The request awaits bounded completion while polling reads persisted progress; no unreliable fire-and-forget promise, fabricated activity, or hidden reasoning transcript. After execution starts, inspect the returned saved run: a failed run is not success merely because the HTTP response returned a run. Early validation/configuration failures still use structured errors.

## Evidence, verification, and acceptance

Demo20 is separate from old rehearsal/benchmark data: **10 straightforward valid + 8 across linked-booking merchant identity, similar distinct purchases, duplicate purchase across documents, and itinerary claimant identity + 1 incomplete + 1 clear violation**. Documents must contain actual clues. New supporting uploads allow PDF/PNG/JPEG, at most eight per claim and 8 MiB each. Never put expected labels, fixture outcomes, or answer-key relationships into extracted evidence; frozen human review is not a model input.

The procedure test is the fixed 12-case `booking-reference-v1` suite, separate from demo20 and the approved source. Require completed paired attempts, correct procedure use on a different valid case, zero unsafe after-matches, no regressions, and no lower correct count. It need not invent a correctness gain when investigation already resolves the baseline. Preserve the existing `alias-v1` gate; measure saved work in the actual first/later-claim flow separately.

Use owner-focused checks for financial/duplicate protection, evidence/knowledge revisions, stale procedure tests, conflicting/absent evidence, deadline/provider failure, and persisted progress. Retain existing tests; use local fault injection rather than exhausting live quota. Integration runs these once on the integrated commit after focused checks pass:

```sh
npm run typecheck
npm run build
```

Run a relevant existing test file with `node --conditions=react-server --import tsx --test PATH_TO_TEST`, or `npm run test:intelligence` for C's changes; replace the path with the delivered file. Do not repeatedly run broad suites without a changed failure/risk. Record command, commit, mode, result, and remaining gaps. This runbook itself has not executed implementation checks.

Personally test the integrated UI without preview: inspect actual document links; follow a current action to saved steps/outcome; refresh while active; verify keyboard focus/reduced motion; approve the supported source with a note; review/test/activate its procedure; use a fresh eligible claim; leave the incomplete question visible; attempt the financial violation and confirm blocked approval. A hidden button alone is not a backend guard.

Use one authorized live vertical slice within the explicit budget; account for extraction, planning, reassessment, tests, and failures. Retain actual calls, model/channel, elapsed times, tokens, and errors. Unknown costs remain **null**, never zero. Do not automatically run a full 50-case comparison or a live batch of demo20. Any later independent accuracy claim needs fresh reviewed cases.

## Three-minute demonstration

| Time | What to show and say |
| --- | --- |
| 0:00–0:25 | Open the actual queue and receipt + booking. State whether this is **live**, **offline simulated**, or a **recording**, and identify the run/commit. Explain the missing merchant identity. |
| 0:25–1:05 | Run the bounded investigation or play its labeled recording. Show persisted current action/tool steps, evidence links, changed check, and final finding. A resolved assessment is ready for approval, still human Pending. |
| 1:05–1:45 | Reviewer inspects the source, approves with a note, reviews the proposed booking-reference procedure, inspects the versioned test, and explicitly activates. If the test would exceed time/budget, show the labeled recorded test and actual stored report. |
| 1:45–2:20 | Open a different fresh claim with the required matching evidence. Show the active procedure and actual work performed; claim “less work” only when recorded calls/steps/timing support it. Human approval stays separate. |
| 2:20–2:45 | Open the incomplete case and its precise unresolved question. Then open the clear financial violation: it remains flagged and cannot be approved despite the procedure. |
| 2:45–3:00 | Show saved evidence/history and honest results. Close with the remaining limitation, not a fabricated savings total or payment. |

If a provider fails, show the failure and switch explicitly to the labeled recording. Never replace it with preview success. For Maximor, demonstrate a reviewed reusable finance procedure with preserved controls; for Cognition, cite actual Devin session/artifacts/contributions; for Ramp, show useful review evidence without claiming an unmeasured competitor advantage.

Preserve [the existing comparison](../../reconciliation/evals/comparison/findings/2026-09-20/report.md): **39/50 Sift vs 47/50 direct AI**, valid matches **19/30 vs 29/30**, estimated costs approximately **$0.0183 vs $0.0726**. Labels are unreviewed and prices assumed. Lower estimated cost came with lower valid-match yield. This is no equal-quality savings claim, isolated proof of Jev's contribution, measured human-time saving, or Ramp comparison.

## Done checklist

- [ ] One identified integrated commit; actual schema version, target, mode, origin, counts, and backup record agree. Originals, hashes, evidence, decisions, and old benchmark artifacts are preserved.
- [ ] Supporting evidence and investigation steps survive refresh/restart; failure/deadline is visible; restart recovery does not duplicate the claim or overwrite newer evidence.
- [ ] Old evidence/knowledge revisions cannot publish stale assessments or activate stale tests; evidence changes/withdrawn sources invalidate dependent learning. Two-tab conflicts recover by refresh, not replay.
- [ ] First supported claim is explicitly approved with a note; procedure is separately reviewed/tested/activated; a different eligible claim uses it; absent/conflicting evidence and financial violations remain blocked.
- [ ] Human decisions survive reassessment; no auto-approval/payment; unresolved questions show the next human action. Focused backend checks and the personal UI walkthrough support these claims.
- [ ] Demo20 documents/labels are human-reviewed and separated; actual calls/timing/failures are retained; simulation/recordings and unknown costs are labeled honestly.
- [ ] Team personally rehearsed the three-minute flow; remaining failures and `not_run` checks are documented. Optional P1 did not displace P0 acceptance.
