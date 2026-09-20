# Sift: context for a fresh chat

Updated September 20, 2026, after implementation commit `d030159` on `main`. This is the current orientation document. It describes the checked-in product and dated verification, not a guarantee that a local server is running or a remote database is unchanged. Inspect Git status and the actual runtime before continuing.

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
- **Submit (`/submit`):** upload a claim and original receipt. Successful extraction starts ordinary checks; useful added supporting evidence can trigger reassessment. Rechecks reuse extraction unless explicit reparse is requested.

The user prefers a simple light-green design, meaningful status colors, obvious action buttons, spinners while work is running, and minimal jargon. Summary values remain informational; their headings open expanded claim lists. Audit flow headers also expand, including investigation activity. Do not restore the manual “Sift investigate” button in ordinary review; automatic investigation and the history workspace cover that flow.

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

## Document inbox branch extension

On `feat/document-inbox`, `/import` adds batch intake for loose synthetic receipts, booking PDFs, and CSV/TXT/readable EML exports. Primary **Data sources** navigation opens connection mockups, file drop, and browsable Forms/Gmail/Dropbox samples with side-by-side extracted fields. The overview has source cards inside its flowchart and browser-local upload/parse/confirm activity; there is no separate source panel above it. One extraction per unique file feeds deterministic candidate matching, compact visual cases beside original sources, editable request details, and explicit confirmation into the existing claim/review flow. Exact duplicate attachments are skipped before extraction; unresolved matches can produce an editable unsent clarification draft. Requested amounts stay separate from receipt totals; ambiguous/conflicting requests need a person. No mailbox/Dropbox integration or database migration is included. Server-local staging and browser-memory drafts limit this to one server. In the isolated `demo:inbox` launcher, Start audit now reads the actual PDF/PNG/EML/CSV samples before selecting eligible claims. One persisted batch supports pause/reload/resume, deduplication, auto-queuing of complete unambiguous requests, and held inputs inspectable on Data sources. It preserves financial discrepancies for ordinary checks; no claim is invented from incomplete/ambiguous evidence. The 37.2-second live-extraction browser run produced two checked claims and four held inputs; review was simulated. Twelve focused tests and production build passed. See [document inbox runbook](../reconciliation/docs/DOCUMENT_INBOX.md) for demo, tests, live smoke check, and failure/restart limits.

## What is implemented

**Assessment and approval.** Code checks money, currency, dates, policy limits, and mandatory safeguards. Jev evaluates bounded identity/merchant/duplicate evidence. With `RECONCILIATION_AUTOMATION_MODE=policy-caps`, eligible clean claims are automatically approved under existing caps. Automatic approval is tied to current evidence and knowledge, and never counts as human feedback. Human decisions survive rechecks. Automatic rejection is off: a reviewer can explicitly reject supported failures, including the guarded bulk action.

**Investigation.** The intelligence port, Azure-backed bounded planner, stored read-tool steps, evidence citations, core reassessment, and UI history are integrated. Automatic investigation requires unresolved merchant/name checks, useful successfully extracted supporting evidence, and no financial/duplicate blocker. Unchanged evidence/knowledge does not repeatedly trigger paid attempts, including failed attempts. Missing evidence cannot be invented. Live investigations can still fail; inspect the recorded stage/reason. Old `INVALID_PROVIDER_OUTPUT` records without a stage cannot be diagnosed retroactively.

**Reason-driven learning.** A human decision and private internal reason are saved with a learning job. Review can advance while the job runs. An eligible hotel billing-descriptor/booking-reference relationship can produce a scoped reusable check, run the fixed twelve-case safety suite, and activate only with current source approval, evidence, and passing proof. Other undecided claims are rechecked, matching merchants first. Each claim must supply its own evidence. Human decisions are preserved.

This does **not** learn arbitrary business policies or retrain a model. Rejections, one-time exceptions, absent/conflicting evidence, and unsupported reasons do not automatically generalize. Proposed policy changes report that confirmation is needed; no general policy editor is implemented. Failed learning preserves the decision and has an explicit retry. The older reviewed alias flow and advanced manual investigation procedure flow remain separate.

**Notifications.** Decisions create notices; approval wording is generic. The internal review reason is not copied into applicant email. A separate optional applicant message supports discretionary rejections. The current demo uses template/preview email and shows simulated delivery animation. A live provider/outbox path exists, but a live audit does not imply real email delivery. Provider acceptance is not proof of inbox delivery.

**Responsive data.** The shared workspace client caches snapshots, invalidates after mutations, and polls active work/learning approximately every two seconds and idle visible workspaces less often. Investigation details poll recorded progress. This is HTTP polling, not a WebSocket/token stream. Flow dots represent observed activity; they are not independent proof of a provider call. Short steps may finish between refreshes.

**Reset.** Local and opt-in live reset archive then reseed the curated 14 claims. Live reset is synthetic-only and guards active work, queued delivery, and changed snapshots. It retains original storage objects and advances revisions. Reset is an explicit demo operation, not a routine prerequisite to debugging. Never reset the user's live workspace just to obtain a clean test run.

## Modes and demo facts

| Mode | Data and execution |
| --- | --- |
| `npm run demo -- --showcase --audit-ready --port 3002` | Fresh private local 14-claim store, initially unchecked; simulated models and email. Start audit in the overview. |
| `npm run demo -- --showcase --port 3002` | Fresh local showcase with initial simulated assessments already run. |
| `?preview=1` | Separate browser UI fixture preview. Does not exercise persistence or automatic feedback learning. |
| Live `npm run dev` with configured `.env.local` | Supabase persistence and actual configured extraction/Jev/investigation calls; no silent simulated fallback. Keep email preview unless real sending is explicitly intended. |

Bare `npm run demo` retains a legacy local fixture path; use `--showcase` for the current 14-claim demonstration. `demo:jev` is a legacy launcher currently incompatible with the runtime requirement that live assessment use Supabase; do not recommend it as the live setup.

The curated seed requests **$2,705.00** against **$2,695.00** in receipt totals. Merchants include Northstar Airlines, Maple Rail, Cedar Bus, Harbor Reservations, and Harbor Hotel. Dates, origins, receipt layouts, and booking evidence vary. Every document is fictional and marked not valid for payment. Seeded cached transcriptions are authored fixtures, even in live storage; only a new live upload/reparse exercises the extraction provider.

The simulated baseline yields eight automatic approvals, three inconclusive cases, and three supported issues; it starts with zero human rejections and zero learned procedures. Live results are model-dependent and must not be forced to match those numbers. See the [case table](../reconciliation/docs/SHOWCASE.md) rather than inventing reviewer reasons to clear the queue.

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
| Seed and designed receipts | `src/lib/demo/showcase.ts`, `showcase-documents.ts`, `scripts/seed-showcase.ts`, `scripts/check-showcase.ts` |
| Design tokens | `src/app/theme.css`, component CSS modules; existing shadcn/Radix controls |

Read the caller and shared helper before fixing a symptom. In particular, do not implement another independent count calculation or decision path to patch one page.

Semantic search sends each filtered claim to Jev independently in parallel (up to 100), returning match/no-match without an intent gate or confidence cutoff. It runs on explicit submission, not every keystroke. Rate-limit/provider errors remain visible.

## Verification and remaining work

These are **dated observations**, not current service guarantees:

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

> We are working on Sift in `HackMIT26/reconciliation`. Read `AGENTS.md`, `docs/PROJECT_CONTEXT.md`, `reconciliation/AGENTS.md`, and `reconciliation/README.md`, then inspect Git status. This is the integrated 14-claim audit/investigation/review-learning app, not the old browser prototype. Preserve unrelated edits and live data. Distinguish persisted live results, simulated fixtures, and unverified claims. Keep the UI simple and use focused verification. My next task is: [describe the task].
