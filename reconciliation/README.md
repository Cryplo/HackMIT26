# Sift: reimbursement review

Sift is the current Next.js application for synthetic HackMIT reimbursement claims: receipt intake, policy checks, Jev assessment and search, supporting evidence, investigations, human decisions, applicant notices, and narrowly scoped learning from review reasons. Start a fresh chat with [Project context](../docs/PROJECT_CONTEXT.md), then use this guide for setup. Older plans and handoffs may describe already-delivered work as pending.

**Synthetic data only. There is no authentication or payment execution.** Approval records a reimbursement decision, not a payment. Keep receipts private and credentials server-side.

## Run the current showcase

Use Node **>=22.18.0** and npm. From `reconciliation/`:

```sh
npm ci
NEXT_DIST_DIR=.next-showcase npm run demo -- --showcase --audit-ready --port 3002
```

Open **http://127.0.0.1:3002/overview** and choose **Start audit**. Use the exact hostname: mutations enforce the configured origin.

This creates a fresh private temporary store containing **14 unchecked claims, 14 receipt PDFs, eight supporting PDFs, and five policies**. The command prints its store path, strips live credentials, simulates extraction/assessment/investigation, and keeps email in template/preview mode. It does not access Supabase or call providers. `--audit-ready` requires `--showcase` and explicitly enables policy-caps automation.

The audit runs the ordinary application workflow and persists simulated checks and investigation steps. Expected results are eight automatic approvals and six pending claims; Morgan and Riley receive automatic investigations that remain unresolved. Supporting evidence already lets Sam and Taylor pass the baseline. These are simulated outcomes, not live-model guarantees.

For the same showcase with assessments already saved:

```sh
NEXT_DIST_DIR=.next-showcase npm run demo -- --showcase --port 3002
```

Each invocation creates a new temporary store. To choose its location, set `RECONCILIATION_INTAKE_DEMO_DIR` to a **nonexistent private directory with an existing parent**; seeding refuses an existing directory. Use different ports and `NEXT_DIST_DIR` values for simultaneous servers. The in-app local **Reset demo** archives the current store and restores 14 unchecked claims, subject to active-work and stale-snapshot safeguards.

See [Showcase](docs/SHOWCASE.md) for the case-by-case walkthrough. Seed PDFs are real private files, but their cached transcriptions are **authored fixtures, not OCR results**. Simulated uploads recognize exact bundled PDF bytes by hash; arbitrary files keep unknown extracted fields and require review. Form values never replace receipt evidence.

## Import loose paperwork

The integrated `/import` **Data sources** page accepts loose synthetic receipts, bookings, and PDF/CSV/TXT/readable EML exports. Inspect original sources alongside extracted fields, review suggested links, and explicitly confirm draft request details into ordinary claims. Forms samples use spreadsheet previews, Gmail samples use email-thread previews, and Dropbox samples display original PDFs/images. Connection controls are mockups; there is no real account connection or synchronization.

**Source audit is a separate opt-in.** With `RECONCILIATION_SOURCE_AUDIT` unset or `false`, Start audit uses the workspace’s existing unchecked claims; browsing Data sources does not import sample requests. Keep that default for the 80-claim live rehearsal. To demonstrate source ingestion, run `npm run demo:inbox -- --port 3017` in a new empty isolated store. That launcher sets `RECONCILIATION_SOURCE_AUDIT=true` with synthetic-only mode. Start audit then reads eleven mixed PDF/PNG/EML/CSV sample files, groups complete unambiguous requests, and checks them; held inputs and the same saved extractions remain inspectable on Data sources. Manual **Read all sample inputs** remains available separately. Neither path erases financial discrepancies or invents missing request details.

Supabase text-source confirmation requires migration `202609210013_inbox_text_evidence.sql` and corresponding MIME permissions on the private evidence bucket. This migration is applied to the configured synthetic demo; apply it separately for other deployments. Reset retains separate server-local inbox staging; removed claims make prior confirmations stale. See [Document inbox](docs/DOCUMENT_INBOX.md) for storage, pause/resume, explicit live-extraction options, and single-server limits.

## Pages and workflow

| Page | Purpose |
| --- | --- |
| `/overview` | Audit progress, automatic approvals, and human exception review |
| `/business-demo` | Reimbursements, filters, Jev search, evidence review, export, and the Learned rules view |
| `/investigations` | Persisted investigation runs and read-tool activity |
| `/submit` | New synthetic claim and receipt intake |
| `/import` | Data sources: source previews, loose paperwork, suggested links, and explicitly confirmed claims |

`/` redirects to `/overview`; `/search` and `/demo` redirect to `/business-demo`. `?preview=1` on workspace pages is a separate UI fixture mode; it does not exercise the persisted backend or automatic learning. Use the private-store showcase for a complete simulated workflow.

Checks enforce amount, currency, date, policy caps, identity, and duplicate constraints. Clean claims can be approved automatically under `RECONCILIATION_AUTOMATION_MODE=policy-caps`; `disabled` leaves approval to reviewers. Eligible uncertainty with useful supporting evidence can trigger an investigation. Missing evidence and unresolved checks remain visible for review. Supporting uploads and extraction retry are implemented, and human decisions survive reassessment.

The workspace Checks view lists every local and Jev-backed check and lets reviewers author up to 12 custom Jev questions (`/api/checks`), optionally scoped to a category. Active custom checks return calibrated pass/fail/needs-review verdicts, join the required set for `matched`, and can never override a failed financial or duplicate check. Changing the check configuration bumps `knowledge_revision` and marks in-flight assessments for recheck; in simulated mode custom checks honestly return needs-review.

Decisions and policy approvals create saved applicant notices. Email defaults to **preview**, so no message is sent. Internal review reasons stay separate from applicant text; approval notices are generic, and discretionary rejections have a separate optional applicant message. Provider acceptance in live email mode is not proof of inbox delivery.

## Learning from review reasons

A human decision saves first; background learning then classifies its internal reason, derives a supported evidence check, tests twelve fixed safety cases, and activates only a current passing candidate. Failed learning does not reverse the decision. The UI exposes status, source evidence, test reports, disabling a check, and retrying eligible failures.

The supported automatic pattern is **hotel billing descriptor → hotel identity**, corroborated by each claim's own receipt and booking confirmation: reference, guest, purchase date, amount, and currency must agree. Financial, identity, policy, and duplicate checks remain mandatory. One-time exceptions and policy changes do not become automatic rules. This saves evidence-check logic; it does **not train or fine-tune a model**.

For a fresh human-approval example, start a separate showcase with automatic approvals disabled:

```sh
RECONCILIATION_AUTOMATION_MODE=disabled NEXT_DIST_DIR=.next-learning \
  npm run demo -- --showcase --port 3006
```

Do not add `--audit-ready`, which reenables automation. Review Sam Mercer, choose **Edit reason**, and explain that Harbor Reservations identifies Harbor Hotel because his booking and receipt agree. Approve and inspect the saved learning result. Taylor must use Taylor's own evidence. Automatic approvals are not human feedback, and the simulated baseline already passes these claims: a passing before/after tie does not demonstrate improved accuracy. See [Review learning](docs/REVIEW_LEARNING.md) for the complete workflow and separate advanced manual investigation-check path.

## Live setup

The live demo contains **80 claims with pre-parsed fictional receipts and 20 supporting documents**. The earlier expansion appended 66 unchecked claims while preserving the original 14 records. The new live-reset baseline is designed to restore **60 prepared checked claims plus 20 unchecked claims**, rather than starting the entire ledger unchecked. It requires `202609210014_live_demo_baseline.sql` (applied to the configured demo) and an explicit guarded reset. The reset also archives and clears custom checks so each run begins with the same configuration.

The prepared 60 are **52 approved, four rejected, and four inconclusive**, verified through a PostgreSQL reset and projection. These are clearly marked authored demo history, not live assessments, actual reviewer decisions, investigations, or sent notices. Cached receipt and supporting-document transcriptions are also authored fixtures, not OCR results.

The remaining 20 are selected to exercise **11 clean, six failed-check, and three inconclusive scenarios**. Morgan Blake and Riley Chen are two automatic-investigation candidates. These are scenario targets: the actual live model may produce different results, and investigation only runs when its evidence and safety conditions hold. With source audit disabled, **Start audit** checks the 20 unchecked claims; it does not rerun the prepared 60 or import sample requests. Failed checks are not saved rejections. The existing local 14-claim simulation and its reset remain unchanged.

Use a dedicated synthetic-only Supabase project. Existing configured projects should retain their records: inspect migration history and apply only missing migrations in order. **Do not reset or reseed an existing live database as a setup step.** Migrations add schema/functions; applying the reset migrations does not itself reset claims.

Apply all files in [supabase/migrations](supabase/migrations), in this order:

1. `202609190001_reimbursement_core.sql`
2. `202609200002_platform.sql`
3. `202609200003_investigations.sql`
4. `202609200004_communications.sql`
5. `202609200005_demo_reset.sql`
6. `202609200006_automatic_notices.sql`
7. `202609200007_policy_revision_safeupdate.sql`
8. `202609200008_readable_demo_seed.sql`
9. `202609200009_designed_demo_seed.sql`
10. `202609200010_feedback_learning.sql`
11. `202609200011_expanded_live_demo.sql`
12. `202609210011_custom_checks.sql`
13. `202609210012_safeupdate_platform_state.sql`
14. `202609210013_inbox_text_evidence.sql` — text-source supporting evidence and private-bucket MIME permissions.
15. `202609210014_live_demo_baseline.sql` — prepared 60-checked/20-unchecked live-reset baseline.

The app requires platform version 4, introduced by migration 004; later migrations still matter even though they do not increment that version. Migrations create service-only tables/RPCs and a private receipt bucket. On a **new, empty** demo project only, `supabase/seed.sql` plus `npm run seed:receipts` provides the legacy five-claim seed, not the curated fourteen-claim showcase. Seeded parsed fields do not verify live extraction; upload a new synthetic file through `/submit` for that.

Copy `.env.example` to `.env.local` only if the local file does not already exist. Configure these values there, preserving any existing settings:

| Setting | Live configuration |
| --- | --- |
| `RECONCILIATION_SYNTHETIC_ONLY` | `true` |
| `RECONCILIATION_INTAKE_MODE`, `RECONCILIATION_EXTRACTION_MODE`, `RECONCILIATION_MODE` | All `live` |
| `RECONCILIATION_APP_ORIGIN` | Exact opened URL, e.g. `http://127.0.0.1:3000` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Dedicated project credentials; keep service key server-side |
| `SUPABASE_RECEIPTS_BUCKET` | `receipts` by default; must be private |
| `AI_GATEWAY_API_KEY` **or** `TYPESAFE_API_KEY` | One Jev provider; `JEV_MODEL=typesafe-ai/jev` for Gateway or `jev-latest` for direct TypeSafe |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` | All three together; HTTPS resource root or `/openai/v1` endpoint |
| `OPENAI_API_KEY`, `OPENAI_EXTRACTION_MODEL` | Alternative to Azure for extraction; model defaults to `gpt-4.1-mini` |
| `RECONCILIATION_INVESTIGATION_MODE` | `live` requires complete Azure settings plus live Supabase/intake/Jev; otherwise `disabled` |
| `RECONCILIATION_JUSTIFICATION_MODE` | `simulated` for deterministic explanations; opt into `live` with Azure or OpenAI (`JUSTIFICATION_MODEL` overrides the direct OpenAI default) |
| `RECONCILIATION_AUTOMATION_MODE` | `policy-caps` or `disabled` |
| `RECONCILIATION_EMAIL_MODE`, `RECONCILIATION_EMAIL_DRAFT_MODE` | Keep `preview` and `template` for unsent notices |
| `RECONCILIATION_SOURCE_AUDIT` | Keep unset or `false` for the 80-claim live audit; set `true` only for an explicitly intended synthetic sample-source audit |
| `RECONCILIATION_INBOX_DIR` | Optional private server-local staging path; multiple replicas require shared staging |
| `RECONCILIATION_ALLOW_DEMO_RESET` | Keep `false` unless explicitly preparing an archive-and-reset rehearsal |

Start normally so Next.js reads `.env.local`:

```sh
NEXT_DIST_DIR=.next-live npm run dev -- --hostname 127.0.0.1 --port 3000
```

Live assessments require Supabase; simulation requires isolated local storage. Missing or inconsistent configuration fails explicitly, and provider failure never silently substitutes a simulated assessment. Direct OpenAI supports extraction and optional explanations; live investigations require Azure. Restart after changing environment settings. No Elasticsearch service is required: retrieval scans authoritative stored records. For tunnels, `RECONCILIATION_DEV_ORIGINS` lists allowed asset hostnames without schemes or ports; configure the mutation origin separately.

Live email is a separate opt-in using `RESEND_API_KEY`, `RECONCILIATION_EMAIL_FROM`, optional `RECONCILIATION_EMAIL_REPLY_TO`, exact `RECONCILIATION_EMAIL_ALLOWED_RECIPIENTS`, and a private reviewer environment. Hosted environments need actual access protection before setting `RECONCILIATION_EMAIL_PRIVATE_REVIEWER=true`; that flag provides no authentication. Automatic notices can attempt delivery immediately in live mode; `npm run email:worker` handles durable outbox retries. See [email setup](docs/resend-setup.md) for provider configuration and delivery operation. Public applicant links and delivery webhooks remain unimplemented.

## Legacy commands and previews

- `npm run demo` uses the original five-claim local seed in `.intake-demo/` (or the configured private directory), not the curated showcase. Existing data persists across restarts.
- `npm run demo:reset -- --confirm`, with the server stopped, archives that local directory; a plain demo restart recreates the five-claim seed. It does not reset Supabase or reproduce the showcase's fourteen-claim reset.
- `npm run demo:jev` remains a legacy script but currently cannot supply a working live workspace: it removes Supabase credentials while the runtime requires Supabase for live assessments. Use the full live setup above.
- UI `?preview=1`, private-store simulation, and live services are distinct execution paths. None proves results in either of the others.

## Architecture and checks

- [src/app](src/app): pages and API routes; [src/components/business](src/components/business): review UI; [src/lib/dashboard](src/lib/dashboard): workspace cache, audit session, and projections for the client.
- [src/lib/core/runtime.ts](src/lib/core/runtime.ts): mode/provider wiring; [service.ts](src/lib/core/service.ts): assessment orchestration; [store.ts](src/lib/core/store.ts) and [file-store.ts](src/lib/core/file-store.ts): Supabase and local persistence.
- [src/lib/inbox](src/lib/inbox) and `/api/inbox`: private source staging, extraction/linking, explicit confirmation, and separately enabled source audit.
- [src/lib/intake](src/lib/intake): validation, private originals, extraction, and supporting uploads; [src/lib/providers/responses.ts](src/lib/providers/responses.ts): Azure/OpenAI configuration.
- [src/lib/intelligence](src/lib/intelligence): intelligence implementations; [src/lib/core/feedback-learning.ts](src/lib/core/feedback-learning.ts): review learning; core investigation, procedure, and rule modules persist their guarded lifecycles.
- [src/lib/email](src/lib/email) and core communication modules: immutable notices and delivery; [src/lib/demo/showcase.ts](src/lib/demo/showcase.ts): curated seed; [src/lib/review-contracts.ts](src/lib/review-contracts.ts): workspace API contracts.

One focused offline showcase check (temporary store, network calls rejected):

```sh
node --conditions=react-server --import tsx scripts/check-showcase.ts
```

For application changes, available checks are `npm test`, `npm run test:intelligence`, `npm run build`, `npm run typecheck`, and `npm run test:browser`. Browser tests require Google Chrome and normally start an isolated server on port 3100 with temporary data; `DASHBOARD_BASE_URL` targets an existing fresh synthetic server instead. `npm run check:jev` makes a paid live provider call; `-- --workflow` exercises the legacy correction smoke workflow, not the current showcase or learning rehearsal. SQL tests use PGlite; mocked/offline tests and migration application do not establish successful live provider behavior.

## Current boundaries

USD only; one PDF/PNG/JPEG receipt up to 8 MiB and at most eight supporting documents per pending claim. The curated policies cover September 2026 with caps of $500 flight, $250 hotel, $200 train, $100 bus, and $50 other. Hotel/bus/other require receipt identity; flight/train permit a correctly linked itinerary. Policy editing is not a public UI feature.

The ledger and candidate scan are bounded to 1,000 claims and fail rather than truncate evidence. Local persistence uses private atomic snapshots and a cross-process lock on one machine. Upload follow-up checks and learning run within the server lifecycle, so a restart can interrupt work; saved claims and visible failure/retry states remain available. Deployment needs durable private storage, suitable upload/request limits, authentication/authorization, and reliable background work before real users.

Explanations summarize saved evidence and checks; they are not model reasoning traces or an independent audit. Fixed safety tests and synthetic walkthroughs do not establish general accuracy, measured savings, or a successful live-model rehearsal.
