# Sift: context for a fresh chat

Updated September 20, 2026, for the integrated Data sources and prepared live-reset baseline work. Earlier verification below records implementation commit `d030159`; it does not establish the current merge or deployment state. This is the current orientation document. It describes the checked-in product and dated verification, not a guarantee that a local server is running or a remote database is unchanged. Inspect Git status and the actual runtime before continuing.

## Read this first

Sift is a HackMIT 2026 reimbursement-review demo motivated by Maximor’s finance workflow. The aim is to save reviewer time: automate supported checks and approvals, investigate useful evidence automatically, and ask a human only where a decision or follow-up remains. Present the decisive facts clearly; do not turn every claim into a form full of explanations.

The product lives in `reconciliation/`, a Next.js/React/TypeScript app with Supabase or private local-file persistence. The Python browser/voice agent elsewhere in the repository is an earlier project, not Sift’s investigator. Devin is an external development/testing collaborator; Sift’s investigator runs inside the app.

Read next:

1. [App README](../reconciliation/README.md) for commands and configuration.
2. [Showcase](../reconciliation/docs/SHOWCASE.md) for the 14 cases, reset, and demonstrations.
3. [Review learning](../reconciliation/docs/REVIEW_LEARNING.md) for feedback behavior and its limits.
4. [Repository guidance](../AGENTS.md) and [app guidance](../reconciliation/AGENTS.md) before editing.

Older `MODULE_*_HANDOFF.md`, `docs/next-work/`, and `docs/superpowers/plans/` documents record earlier designs and ownership. Their claims that investigation is unavailable, the backend is pending, or every approval needs manual rule activation are historical. Current source and this guide take precedence for implementation status; do not discard still-relevant safety requirements.

## The intended user experience

- **Audit overview (`/overview`):** compact counts and amounts for unchecked, approved, needs review, and rejected, with clickable headings that expand each group into a detail dialog; one obvious start-audit action; connected flow with fixed-height lists and progress animations. Running investigations appear first; completed work is condensed.
- **Reimbursements (`/business-demo`):** all claims, a primary semantic-search field (press Enter or Search), category/result filters, bulk checks, selection/export, original evidence, and access to review. Learned rules are a view within this workspace, not a separate `/rules` route.
- **Human review:** centered evidence view, amber for uncertainty, green approval, red rejection/failure; highlight the actual mismatch or missing evidence. Successful decisions advance to the next eligible claim. Completion offers review when actions remain, or the table when they do not. Technical detail and tool histories belong in collapsed sections.
- **Investigations (`/investigations`):** persisted runs, concise findings, linked documents, and expandable recorded read-tool history. An investigator is not a web-browsing agent and its trace is not hidden model reasoning.
- **Data sources (`/import`):** preview Forms/Gmail/Dropbox samples, upload loose synthetic paperwork, inspect extracted fields and suggested links, and explicitly confirm requests. Connections are mockups, not account integrations. Reading sample sources as part of Start audit is a separate opt-in.
- **Submit (`/submit`):** upload a claim and original receipt. Successful extraction starts ordinary checks; useful added supporting evidence can trigger reassessment. Rechecks reuse extraction unless explicit reparse is requested.

The user now prefers Ramp-inspired compact components with a black-and-white base: white cards, neutral-gray chrome, charcoal text, fine borders, and restrained corners. Use black primary actions, yellow review/inconclusive highlights, green passed/approved states, and red failures/rejections, spinners while work is running, and minimal jargon. Shared colors and radii live in `src/app/theme.css`; do not restore broad sage backgrounds. Summary values remain informational; their headings open expanded claim lists. Audit flow headers also expand, including investigation activity. Do not restore the manual “Sift investigate” button in ordinary review; automatic investigation and the history workspace cover that flow.

The generated Sift logo is served from `reconciliation/public/sift-logo.png` through the shared `SiftLogo` component in desktop/mobile navigation and the submission header. CSS frames the original transparent artwork. This replacement passed TypeScript checking; browser visual verification remains outstanding.

## Statuses: keep these separate

| Concept | Meaning |
| --- | --- |
| Unchecked / checking | No finished current assessment, or work is running. |
| Passed / matched | Machine checks passed. With automation disabled this can still await approval. |
| Flagged / issue found | A check found a problem. This is not a saved rejection. |
| Inconclusive | Evidence does not resolve the question; a human may need more evidence or a reasoned decision. |
| Check/investigation failed | Processing did not finish. This is not evidence of an invalid claim. |
| Approved / rejected | A current saved decision, including eligible policy-based automatic approval. No payment is executed. |
| Needs review (overview) | Pending claims with completed concerns or failed processing. Broader than the inconclusive-only queue. |

`auditBucket`, `humanActions`, and the queue filter define the displayed groups. The dashboard and flow must use the same saved decision semantics. A queue progress denominator counts that queue/session, not every pending claim. Explain the subset instead of pretending different counts are equivalent.

## Integrated document inbox and source audit

The Data sources work from `feat/document-inbox` is integrated at `/import`. It supports loose synthetic receipts, booking PDFs, and CSV/TXT/readable EML exports. Primary **Data sources** navigation opens connection mockups, file drop, and browsable Forms/Gmail/Dropbox samples with side-by-side extracted fields. Forms use a 21-row spreadsheet preview, Gmail uses an email-thread layout, and Dropbox displays original PDFs/images. Select a spreadsheet row to import that response; the full CSV is not passed to intake as one claim. These are source previews, not connected accounts or mailbox/Dropbox synchronization.

The overview includes source cards inside its flowchart and observed upload/parse/confirm activity. One extraction per unique file feeds deterministic candidate matching, editable request details, original-source comparison, and explicit confirmation into the existing claim/review flow. Exact duplicate attachments are skipped before extraction. Unresolved matches can produce an editable unsent clarification draft. Requested amounts remain separate from receipt totals; conflicting or ambiguous requests require a person. Staging is private and server-local; unsaved manual edits remain in browser memory, so multiple servers need shared staging before use.

**Source audit is separately enabled** with `RECONCILIATION_SOURCE_AUDIT=true` and `RECONCILIATION_SYNTHETIC_ONLY=true`. Keep it off for the ordinary live 80-claim rehearsal: Start audit should select the existing unchecked claims, not import additional sample requests. Opening source previews or `/import` does not enable source audit. The isolated `npm run demo:inbox -- --port 3017` launcher enables it in a new empty private store. There, Start audit reads eleven mixed PDF/PNG/EML/CSV samples before selecting eligible claims; one persisted batch supports pause/reload/resume, deduplication, automatic queuing of complete unambiguous requests, and held inputs inspectable on Data sources. Financial discrepancies are preserved for ordinary checks; incomplete evidence never invents a claim.

Supabase confirmation of CSV/TXT/EML evidence requires `202609210013_inbox_text_evidence.sql`, including the allowed MIME types in the private evidence bucket. It does not reset claims or connect external accounts. Migrations `202609210013_inbox_text_evidence.sql` and `202609210014_live_demo_baseline.sql` were applied to the configured synthetic Supabase demo on September 20. Migration `202609210015_live_demo_baseline_70.sql` is also applied and defines the current 70/10 reset; the resulting reset was confirmed through the application API. Other deployments must apply them separately. Reset retains separate inbox staging: stale confirmations/source batches must be reviewed rather than replayed against removed claims. See [document inbox runbook](../reconciliation/docs/DOCUMENT_INBOX.md) for the isolated demo and failure/restart limits.

Earlier branch verification included twelve focused tests and a passing production build, plus a 37.2-second live-extraction browser run with two checked claims and four held inputs; review was simulated. These dated observations do not establish the merged live assessment outcomes or migration state.

## What is implemented

**Assessment and approval.** Code checks money, currency, dates, policy limits, and mandatory safeguards. Jev evaluates bounded identity/merchant/duplicate evidence. With `RECONCILIATION_AUTOMATION_MODE=policy-caps`, eligible clean claims are automatically approved under existing caps. Automatic approval is tied to current evidence and knowledge, and never counts as human feedback. Human decisions survive rechecks. Automatic rejection is off: a reviewer can explicitly reject supported failures, including the guarded bulk action.

**Investigation.** The intelligence port, Azure-backed bounded planner, stored read-tool steps, evidence citations, core reassessment, and UI history are integrated. Automatic investigation requires unresolved merchant/name checks, useful successfully extracted supporting evidence, and no financial/duplicate blocker. Unchanged evidence/knowledge does not repeatedly trigger paid attempts, including failed attempts. Missing evidence cannot be invented. Live investigations can still fail; inspect the recorded stage/reason. Old `INVALID_PROVIDER_OUTPUT` records without a stage cannot be diagnosed retroactively.

The planner now restricts its structured output to exact typed citation IDs actually observed through read tools, while retaining server-side validation. This addresses `PLANNING:UNOBSERVED_CITATION`; the historical offending pair was not saved. Failed investigations remain failed in storage but show **Needs review** and an **Open claim** action, with diagnostics collapsed under **Technical details**. This is a human-review fallback, never fabricated success. Existing failed runs are not rewritten or automatically replayed.

September 20 verification: 26 focused investigator tests, TypeScript, and one route-mocked browser fallback test passed. One explicitly authorized live planner verification on Ada Iverson's synthetic receipt/booking completed in two provider requests, reading all five tools and returning five validated findings plus a learning proposal. Actual usage was recorded; her decision and original failed investigation were not changed. This verifies the fixed planner against one live case, not end-to-end reassessment/learning or error-free behavior across the dataset.

**Reason-driven learning.** A human decision and private internal reason are saved with a learning job. Review can advance while the job runs. An eligible hotel billing-descriptor/booking-reference relationship can produce a scoped reusable check, run the fixed twelve-case safety suite, and activate only with current source approval, evidence, and passing proof. Other undecided claims are rechecked, matching merchants first. Each claim must supply its own evidence. Human decisions are preserved.

This does **not** learn arbitrary business policies or retrain a model. Rejections, one-time exceptions, absent/conflicting evidence, and unsupported reasons do not automatically generalize. Proposed policy changes report that confirmation is needed; no general policy editor is implemented. Failed learning preserves the decision and has an explicit retry. The older reviewed alias flow and advanced manual investigation procedure flow remain separate.

**Notifications.** Decisions save held notices; approval wording is generic. **Send all notifications** on the overview and reimbursements pages confirms the current batch once before releasing it. New decisions and policy approvals never dispatch automatically. Migration `202609210016_held_notifications.sql` is applied to the configured live demo. The shared batch also includes eligible failed/uncertain delivery retries, preserving the same provider idempotency key and attempt limits. The internal review reason is not copied into applicant email. A separate optional applicant message supports discretionary rejections. The current demo uses template/preview email. **Email history** beside the batch action on both main pages shows previously previewed or released notices, recipients, subjects, timestamps, full saved text, and actual delivery status. Held drafts appear in the pending batch, not sent history. Previewed messages explicitly say no email was sent. A live provider/outbox path exists, but a live audit does not imply real email delivery. Provider acceptance is not proof of inbox delivery.

**Responsive data.** The shared workspace client caches snapshots, invalidates after mutations, and polls active work/learning approximately every two seconds and idle visible workspaces less often. Investigation details poll recorded progress. This is HTTP polling, not a WebSocket/token stream. Flow dots represent observed activity; they are not independent proof of a provider call. Short steps may finish between refreshes.

**Reset.** Local reset archives then restores 14 unchecked claims. The opt-in live reset restores an 80-claim baseline with 70 prepared checked claims and 10 unchecked claims (migration `202609210015_live_demo_baseline_70.sql`). It archives and clears custom checks as well as the prior claim history. Prepared history is explicitly authored demo data, not live provider/reviewer activity. Live reset is synthetic-only and guards active work, queued delivery, and changed snapshots. It retains original storage objects and advances revisions. Reset is an explicit demo operation, not a routine prerequisite to debugging. Never reset the user's live workspace just to obtain a clean test run.

## Modes and demo facts

The live demo was expanded to **80 claims / 80 parsed receipts / 20 supporting documents** on September 20, 2026. That earlier expansion preserved the original 14 records and appended 66 unchecked claims with cached authored transcriptions, without model calls or notices. The local showcase remains 14 claims.

The current live-reset baseline restores **70 prepared checked claims and 10 unchecked claims**. The 70 authored history examples are **59 approved, seven rejected, and four inconclusive claims needing review**. The application API verified this split after the requested reset; the earlier 60/20 observations below remain historical. Their saved checks and decision records are marked as prepared demo history: no live provider, real reviewer, investigation, or email action generated them. Seeded receipt/supporting transcriptions remain authored fixtures, not live OCR.

The 10 unchecked claims (seed numbers **1, 2, 5, 6, 7, 9, 10, 12, 13, 14**) are selected for **four matched, three flagged, and three inconclusive scenarios**, including **Morgan Blake and Riley Chen** as two automatic-investigation candidates. These are authored scenario targets, not guaranteed live-model results or saved rejections. Start audit evaluates those 10 through the normal configured live checks; investigation depends on actual unresolved checks, useful evidence, and safety eligibility. The four already-inconclusive prepared claims are checked history, not unchecked audit inputs.

Migration `202609200011_expanded_live_demo.sql` previously enabled the 80-claim reset. Migration `202609210014_live_demo_baseline.sql` introduced the earlier 60/20 baseline. The current 70/10 reset uses `202609210015_live_demo_baseline_70.sql`, while text-source imports use `202609210013_inbox_text_evidence.sql`; these migrations are applied to this demo. Applying either migration does not itself reset the workspace. Only an explicit, guarded reset replaces current records with the new baseline.

| Mode | Data and execution |
| --- | --- |
| `npm run demo -- --showcase --audit-ready --port 3002` | Fresh private local 14-claim store, initially unchecked; simulated models and email. Start audit in the overview. |
| `npm run demo -- --showcase --port 3002` | Fresh local showcase with initial simulated assessments already run. |
| `?preview=1` | Separate browser UI fixture preview. Does not exercise persistence or automatic feedback learning. |
| Live `npm run dev` with configured `.env.local` | Supabase persistence and actual configured extraction/Jev/investigation calls; no silent simulated fallback. Keep email preview unless real sending is explicitly intended. |

Bare `npm run demo` retains a legacy local fixture path; use `--showcase` for the current 14-claim demonstration. `demo:jev` is a legacy launcher currently incompatible with the runtime requirement that live assessment use Supabase; do not recommend it as the live setup.

The local 14-claim curated seed requests **$2,705.00** against **$2,695.00** in receipt totals. Merchants include Northstar Airlines, Maple Rail, Cedar Bus, Harbor Reservations, and Harbor Hotel. Dates, origins, receipt layouts, and booking evidence vary. Every document is fictional and marked not valid for payment. Seeded cached transcriptions are authored fixtures, even in live storage; only a new live upload/reparse exercises the extraction provider.

The local 14-claim simulated baseline yields eight automatic approvals, three inconclusive cases, and three supported issues; it starts with zero human rejections and zero learned procedures. Live results are model-dependent and must not be forced to match those numbers. See the [case table](../reconciliation/docs/SHOWCASE.md) rather than inventing reviewer reasons to clear the queue.

**Learning demo caveat:** Sam and Taylor already pass the simulated baseline. To show a new human reason creating a check, use the separate automation-disabled private-store walkthrough in the showcase guide. Do not pass `--audit-ready`, which reenables automatic approvals. A 12/12 before and after result is a safety tie, not demonstrated accuracy improvement or reduced reviewer workload.

## Code map

Paths below are relative to `reconciliation/`.

| Area | Main files |
| --- | --- |
| Public types and API shape | `src/lib/review-contracts.ts`, `src/lib/contracts.ts`, `src/app/api/` |
| Runtime/provider modes | `src/lib/core/runtime.ts`, `.env.example`, `src/lib/providers/responses.ts` |
| Assessment, guarded decisions | `src/lib/core/service.ts`, `checks.ts`, `safety.ts`, `automation.ts` |
| SQL/local persistence | `src/lib/core/store.ts`, `file-store.ts`, `supabase/migrations/` |
| Investigator | `src/lib/core/investigations.ts`, `src/lib/intelligence/investigate-port.ts`, `investigation.ts`, `investigation-errors.ts` |
| Feedback learning | `src/lib/core/feedback-learning*.ts`, `procedure-state.ts`, `procedures.ts`, `src/lib/intelligence/procedures.ts` |
| Reviewer notes / email | `src/lib/core/applicant-message.ts`, `email-actions.ts`, `communications-state.ts`, `src/lib/email/` |
| Shared UI data and categories | `src/lib/dashboard/client.ts`, `workspace-store.ts`, `human-actions.ts`, `audit-session.ts` |
| Overview, flow, review | `src/components/business/HumanDashboard.tsx`, `AuditFlow.tsx`, `ReviewSheet.tsx`, `ClaimEvidence.tsx` |
| Investigations / rules UI | `InvestigationsWorkspace.tsx`, `InvestigationRunView.tsx`, `ProcedurePanel.tsx`, `RulesPanel.tsx` in the same component directory |
| Seed and designed receipts | `src/lib/demo/showcase.ts`, `showcase-documents.ts`, `live-baseline.ts`, `scripts/seed-showcase.ts`, `scripts/check-showcase.ts` |
| Data sources and source audit | `src/app/import/`, `src/app/api/inbox/`, `src/lib/inbox/`, `scripts/inbox-demo.ts` |
| Design tokens | `src/app/theme.css`, component CSS modules; existing shadcn/Radix controls |

Read the caller and shared helper before fixing a symptom. In particular, do not implement another independent count calculation or decision path to patch one page.

Semantic search sends each filtered claim to Jev independently in parallel (up to 100), returning match/no-match without an intent gate or confidence cutoff. It runs on explicit submission, not every keystroke. Explicit HTTP 429 responses in search and reconciliation retry up to three times, respecting Retry-After seconds/dates or using exponential backoff with jitter. Retries share the existing request deadline, honor cancellation, and log each attempt (unreported usage stays null). Exhausted rate limits and other provider errors remain visible; search never returns a partial match set.

## Verification and remaining work

These are **dated observations**, not current service guarantees:

- September 20 notification change: migration 016 applied without sending mail. Ten focused notification tests, two browser-preview state tests, baseline SQL checks, and TypeScript passed. A route-mocked browser check verified exactly one confirmation and batch request, preview completion, and the updated pending count; the Data sources browser check passed on desktop/mobile. Live read-only API checks retained 80 claims / ten unchecked / seven prepared rejections and reported preview mode with zero pending notices. No live provider calls or emails were used for verification.

- September 20 revised baseline: migration 015 applied and the requested reset archived the previous workspace. The application API confirmed 80 claims: 70 checked (59 prepared approvals, seven prepared rejections, four needing review), with ten unchecked. The first attempt returned an unconfirmed failure and database inspection showed unchanged records; the subsequent explicit reset against the same archived snapshot returned success. No AI or email calls were made. Focused baseline SQL and 21-row spreadsheet checks passed.

- Historical September 20 inbox/baseline integration (the earlier 60/20 reset): migrations 013 and 014 applied; the requested live reset archived the previous workspace (including its custom check). The write committed after the client lost confirmation; a subsequent direct database read and app API verified 80 claims, 60 checked, 20 unchecked, 52 approved, four rejected, four needing review, and zero failures/investigations. No provider or email calls occurred. Reset now allows 90 seconds for its response, without retrying uncertain writes. TypeScript, focused inbox/audit/geometry tests, and baseline SQL round-trip tests passed; desktop source-row layout was checked. The remaining 20 were left unchecked for the user’s demo.

- `d030159` was pushed to `origin/main`. Its exact staged tree passed TypeScript checking and five focused feedback-learning/SQL tests. Earlier focused checks and a simulated browser rehearsal covered reason saving, tested activation, separate applicant wording, and Taylor citing Taylor’s own documents.
- The configured demo Supabase received migrations through `202609200010_feedback_learning.sql` on September 20. A subsequent workspace read retained all 14 claims. Migration execution did not trigger model calls or a reset. A fresh deployment must independently apply the ordered migrations; platform version 4 alone does not establish that all additive migrations were applied.
- The older 122-claim dataset was archived privately. `.seed-archives/`, database archives, credentials, generated originals, and local demo stores are not repository documentation and should not be committed.
- Live investigator failures were observed earlier. Structured diagnostics and output normalization were improved, but the latest feedback-learning work has **not** had a complete live model rehearsal. A successful simulated run or database read is not proof of live model quality.

Recommended next work, if requested:

1. Rehearse the current live flow with a controlled synthetic claim: inspect saved evidence, actual tool calls, result, human decision, learning outcome, and a later claim’s own evidence. Record the exact commit/configuration and honest failure stage. Avoid repeated blind retries or reseeding.
2. Have the human/Devin exercise the UI, cross-page counts, reloads, retries, queue completion, and slow providers. Keep routine code checks focused; the user does not want repeated broad suites during feature work.
3. Before claiming learning gains, use independently reviewed cases and measure before/after quality and workload. Existing benchmark artifacts under `evals/` are separate work; read their caveats. Never turn simulated chart values into measured customer savings.
4. Production work remains: authentication/authorization, abuse and retention controls, durable background execution, broader evaluation, and operational delivery handling. Request-lifecycle background work can be interrupted by a restart; saved status/leases make failure visible, but there is no durable automatic job runner for every workflow.

At this handoff, unrelated pitch/benchmark changes and locally generated Next files remained uncommitted. Run `git status` before editing. Preserve those changes; do not stage the whole repository, stash others’ work, rewrite history, or assume they are part of your task. Do not change environment keys, model deployments, or live data based only on this document.

## Copy into a new chat

> We are working on Sift in `HackMIT26/reconciliation`. Read `AGENTS.md`, `docs/PROJECT_CONTEXT.md`, `reconciliation/AGENTS.md`, and `reconciliation/README.md`, then inspect Git status. This is the integrated audit/investigation/review-learning and Data sources app, with a local 14-claim simulation and an 80-claim live demo. The live reset restores 70 explicitly authored checked records and 10 unchecked claims; migrations 013–016 are applied to the configured demo, but inspect current state before changing it. It is not the old browser prototype. Preserve unrelated edits and live data. Distinguish persisted live results, simulated fixtures, and unverified claims. Keep the UI simple and use focused verification. My next task is: [describe the task].

### Prepared learned-rule example

Migration `202609210017_prepared_demo_rule.sql` adds a service-only, idempotent seed helper and restores one inactive merchant-rule example after live demo resets: Harbor Reservations → Harbor Hotel, hotel/USD, linked to Sam Mercer. Learned rules labels it **Prepared example · Inactive**. It records no human approval, test results, activation, or provider use; it leaves knowledge revision and current decisions unchanged. This is a demonstration of a possible rule, not evidence of completed learning. Actual feedback learning still requires source approval and passing evidence checks.

The migration and explicit seed were applied September 20. Before/after live snapshots differed only in `rules`; the application API returned the labeled inactive example. Focused offline reset checks preserved the 70/10 baseline. No live provider or email calls were made for this seed.

### Saved live-reset baseline

Live reset uses `core_reset_saved_demo` to restore an immutable `live-80-v1` baseline held in a service-only Supabase table. Apply migration 018 and run `npm run demo:prepare-live-reset` once; preparation verifies the 100 private original PDFs and saves synthetic data without resetting the active audit. Reset retains existing archive, synthetic-only, busy-work and stale-snapshot checks, rebases review/knowledge revisions, and restores the inactive rule. The old path measured 15.4 seconds for serial document downloads and rebuilt/uploaded a 13 MB seed on every click; those operations now happen only during preparation. Original files are retained, not recopied on every reset.

Prepared run evidence now references `baseline_id: live-80-v1` in the immutable saved baseline rather than duplicating the ledger in every run. `liveResetSeed` only compacts explicitly authored, completed demo runs; it never alters actual live investigation/assessment history. The saved seed is about 2.1 MB instead of 13 MB. Saving initially exposed a PostgreSQL statement timeout from rescanning all run evidence for each decision; migration 018 validates run IDs once and reuses that list.

Verification September 20: migration 018 and the optimized save function applied; 100 originals verified and the backup saved in 5.0 seconds, then reused in 0.2 seconds without downloads. Following explicit user approval, the live API reset returned 200 in 13.3 seconds and restored 80 total / 70 checked / 10 unchecked / 59 approved / 7 rejected / 4 checked needing review plus the inactive example. Archive `126b97c8-a2a6-447b-99a8-ef316258337a` retains the prior 82 claims, 84 runs, and eight corrections. The remaining live latency is database archive/restore; isolated SQL timing is not presented as live performance. Focused reset tests and TypeScript checking passed.
