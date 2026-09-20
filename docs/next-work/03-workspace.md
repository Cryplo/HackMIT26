# 03 — Investigation workspace: colleague A assignment

Prepared against `main` at `9f3d593`, 2026-09-20. This is an implementation assignment; the investigation/document/procedure additions below are **proposed, not delivered**. Keep the current review workspace and add a real `/investigations` page.

Read [README](README.md), [00-contracts](00-contracts.md), [01-platform](01-platform.md), [02-intelligence](02-intelligence.md), and `reconciliation/AGENTS.md` first. Inspect current source rather than treating archived instructions as current behavior. B owns shared DTOs; use the frozen additive declarations when delivered.

## Ownership and starting point

You are not alone. Preserve teammates' edits, work only on `main`, and follow the README's serialized delivery process. Paths here are relative to `reconciliation/`.

**Own:** `src/components/business/**`, `src/lib/dashboard/**`, `src/app/business-demo/**`, new `src/app/investigations/**`, and your browser tests under `tests/ui/**`. Keep new styles in owned component CSS modules.

**Do not edit:** API routes, `src/lib/review-contracts.ts`, core/intake/intelligence, migrations, evaluation packs, `/submit`, global styles, shared UI primitives, packages/lockfiles, or shared build/test configuration. Request a concrete change from its owner when necessary. No shared-data resets or paid providers for UI development.

Current source already supplies:

- `BusinessDashboard`, `ReviewTable`, `ReviewSheet`, `RulesPanel`, and `AppShell`; the neutral shadcn theme and scoped CSS remain the base.
- `src/lib/dashboard/client.ts` and `ui-contracts.ts` separate API access from explicit preview fixtures; `types.ts` re-exports shared DTOs.
- Real review/decision/reconcile, alias proposal/test/activate/disable, same-claim extraction retry, original links, snapshot export, and explicit semantic search wiring.
- A separate `?preview=1` simulation. API failure never silently becomes preview success.
- A legacy investigation summary in the review sheet. `src/lib/intelligence/index.ts` currently returns `INVESTIGATION_UNAVAILABLE`; no investigation, supporting-document, or procedure routes exist at this starting commit.

Retain existing behavior and tests. The archived review-workflow pack is background, not a mandate to rebuild shipped features. Do not add decorative KPIs, provider settings, a new UI library, fake savings, or an accuracy dashboard.

## Delivery order

1. Extend the owned client seam and explicit simulated fixtures against `00-contracts`; build the page and result states without pretending the backend exists.
2. Add evidence upload/list/open and explicit investigation controls to the existing claim sheet.
3. Connect persisted run polling, returned findings, and human actions when B/C deliver their seams.
4. Add the single procedure's propose → test → human activate flow; preserve existing alias controls separately.
5. Verify the focused flows below and hand off exact remaining API blockers and demo entry points.

## Frozen inputs and routes

Do not introduce a second wire-contract model or invent a metrics endpoint. Consume `00-contracts` for complete fields, limits, errors, and envelopes. Gate new controls on `WorkspaceCapabilities.supporting_documents`, `.investigations`, and `.resolution_procedures`; missing means false.

| Operation | Contract to consume |
| --- | --- |
| Start investigation | `POST /api/submissions/:id/investigate` with `{expected_review_revision}`; awaited bounded response `{run,row}` |
| Read saved runs | `GET /api/investigations?claim_id=<id>` (claim filter optional) → `{runs,coverage}`; `GET /api/investigations/:runId` → `{run}` |
| List/add supporting evidence | `GET/POST /api/submissions/:id/supporting-documents`; POST multipart `file`, `kind`, `expected_review_revision` |
| Open supporting original | `GET /api/submissions/:id/supporting-documents/:documentId`; private bytes, not a public storage URL |
| List/propose procedure | `GET/POST /api/procedures`; proposal `{run_id,expected_review_revision}` |
| Test/activate/disable procedure | `POST /api/procedures/:id/test`, `/activate`, `/disable`; `{expected_procedure_version}` |

`InvestigationRun` contains `run_id`, `claim_id`, `status` (`running/completed/failed/superseded`), `outcome` (`resolved/discrepancy_found/needs_human`, null before a result), `headline`, `summary`, `unresolved_question`, findings with `evidence_refs`, `before_assessment`, nullable `after_assessment` and `proposed_learning`, `InvestigationRunStep[]` steps, timestamps, mode/model, and error. Failed/superseded runs keep `outcome:null` and no successful after-assessment. Read server fields; do not infer outcome from elapsed time or HTTP success.

Use the additive `ReviewRow.latest_investigation` for the new run DTO. Keep legacy `ReviewRow.investigation` rendering compatible; do not feed the new shape to that renderer or coerce legacy unavailable entries into successful runs. Missing capability or unavailable route stays visibly unavailable. Request B's declarations instead of editing shared contracts.

## 1. Evidence in the existing claim sheet

- [ ] Keep the primary receipt and its private original link. Add a supporting-documents section showing kind, document ID/type, extraction status/provenance, and an accessible open-original action. Do not invent a filename field absent from the DTO.
- [ ] Use the native file input and existing button/label primitives. Accept documented PDF/PNG/JPEG types, at most 8 MiB per file and eight supporting documents per claim; use the documented `DocumentKind` values and pending-claim eligibility. Submit multipart data with the captured decimal review revision; do not set a JSON content type on FormData.
- [ ] A saved upload is not an extracted or validated purchase. Show pending/failed extraction and server errors truthfully; retain the stored document and original when returned after failure.
- [ ] Refresh authoritative evidence and review state after a write. Evidence changes can invalidate assessments and learning tests; show stale/recheck-needed state and preserve reviewer notes.
- [ ] On a revision conflict, keep local notes, refresh, and require another deliberate action. On an uncertain network outcome, read current state before offering retry; never silently resubmit a file or investigation.
- [ ] Distinguish “documents for this purchase” from “additional purchases.” P0 retains one primary receipt, one purchase, USD, and exact amount equality. Never sum booking + folio + payment slip or offer unsupported split/allocation controls.
- [ ] An explicit “Investigate” action uses current server eligibility and revision. Disable conflicting actions while the operation runs; no investigation on page load, file selection, focus, polling, or filter changes.

A user can inspect evidence and review manually when investigation is unavailable. Missing documents stay missing; the browser must not fabricate booking references, traveler identities, or merchant mappings.

## 2. Investigations page and actual progress

Add `/investigations` to desktop/mobile navigation without replacing the reimbursements table or existing learned-alias view. Link each run to its actual claim; a missing/unloaded claim gets a truthful state. Keep a selected run addressable, for example by `?run=<run_id>`.

```text
Investigations                                    [Refresh]
Claim / merchant       Run status       Outcome       Started
Selected run: actual action / elapsed / mode
Recorded tool steps, in persisted order
Finding → affected check → evidence links
Before / after assessment · remaining question · next action
```

- [ ] Initial load reads saved runs. Poll read-only server state roughly once per second only while a known run is active or an explicit start request is pending. The start POST remains awaited; do not depend on a queued response or background promise.
- [ ] While POST is pending, list polling discovers the persisted active run; identify it using server claim/run data. Use the optional `claim_id` list filter during this pending POST. Before its first event, say “Starting investigation…” without inventing a tool call.
- [ ] Avoid overlapping requests; abort/ignore obsolete reads when selection changes or the component unmounts. Stop polling once relevant runs are terminal; pause while hidden and refresh on return. A failed read keeps the last snapshot and an error, with bounded retry or explicit refresh.
- [ ] Refresh/reopen recovers actual saved steps and terminal state. Reopening never starts another investigation. Use persisted sequence/timestamps and stable step identifiers from the contract; do not append duplicates each poll.
- [ ] Show current action from actual step data. Elapsed time uses persisted start/finish timestamps; a client clock may animate elapsed time but cannot invent progress percentages or completion.
- [ ] Display actual calls to `read_receipt`, `read_supporting_documents`, `find_related_claims`, `read_policy`, and `read_active_aliases` only when recorded. Never stage a timer-driven sequence, a hidden-reasoning transcript, or fake “thinking” messages.
- [ ] `failed` shows the sanitized provider/operation error and recovery action even when returned in an HTTP-success `{run,row}` response. Early invalid/unavailable/stale starts use the error envelope; a transport interruption triggers saved-state reads, not another POST. `superseded` explains that changed evidence/knowledge prevented this result becoming current. Neither is rendered as resolved.
- [ ] Show mode/model from the run. “Simulated fixture” and “Recorded run” are explicit; a live environment banner does not prove a historical run or document used live models.

The list and page are operational views, not model telemetry dumps. Keep raw provider payloads, secrets, storage paths, and signed URLs out of rendered diagnostics.

## 3. Findings and the next human action

Each result card answers: what was found, which check changed, what evidence supports it, what remains uncertain, and what the reviewer should do. Link `evidence_refs` to actual receipt/supporting originals or related claims; unresolved references remain labeled unavailable.

| Result | Reviewer-facing behavior |
| --- | --- |
| `resolved` | Show server before/after checks and “Ready for approval” only when the returned current row is eligible; approval is a separate human action. |
| `discrepancy_found` | Show the financial/policy/duplicate issue and source evidence; preserve the server's blocked/flagged state. |
| `needs_human` | Show the specific unresolved question under “Needs your input,” with request-document or review action as supported. |
| No completed outcome | Show running, failed, or superseded status; never manufacture a result from missing fields. |

- [ ] Refresh or install the returned authoritative `{row}` after investigation. The UI never flips checks, sets `matched`, clears a discrepancy, or treats prose as permission to approve.
- [ ] Preserve separate assessment, human decision, and processing labels. A matched claim is ready for human approval, never already approved. Retain the explicit confirmation, reviewer note, and server revision checks.
- [ ] Known financial failures remain visible despite other unknowns. Missing/conflicting evidence never produces an all-clear card. Confidence/probability is evidence metadata, not measured accuracy.
- [ ] Do not put every completed run in “Needs your input.” Reserve that result treatment for an actual unresolved question; keep discrepancy and ready-for-approval actions distinct.
- [ ] Existing decisions/history survive investigation and recheck. Failed writes retain notes and show errors rather than optimistic approval.

## 4. One reviewed reusable procedure

Support only **`booking_reference_identity`: hotel/USD merchant identity established through a booking reference matching the receipt**, within the exact observed-descriptor/canonical-merchant scope. Existing scoped alias rules remain separate and compatible; this is not a generic rule builder, policy exception, or blanket approval.

- [ ] Show the returned proposal's trigger scope, required evidence, matching fields, and source references. No frontend-authored executable procedure or arbitrary prompt editor.
- [ ] First, a human reviews and approves the supported source claim through the existing decision flow. Then explicitly propose using `{run_id,expected_review_revision}`; proposal is unavailable while source approval is missing or stale.
- [ ] Display persisted draft/version, then run the real versioned test explicitly. Show the `ProcedureTestReport` applied/regressed case IDs, reasons, mode, and test freshness supplied by the server. Its fixed 12-case `booking-reference-v1` suite is separate from the demo pack; do not present it as independent accuracy or require a new accuracy gain.
- [ ] Require a current passing report and a distinct human “Activate” action. After any failed/incomplete test, refresh state; historical passing proof cannot enable activation.
- [ ] Evidence, source-decision, knowledge, or procedure-version changes invalidate obsolete proof. Show the server reason, refresh, and require a new explicit test/action; do not retry a stale activation automatically.
- [ ] A later eligible claim can show the applied procedure and evidence with less recorded work. Missing/conflicting booking evidence prevents reuse; all money, policy, date, identity, and duplicate guards still apply. Itinerary identity support requires explicit applicable policy permission; this procedure establishes only merchant identity.
- [ ] Disable explicitly via the versioned endpoint. Activation/disable never approves or automatically rechecks claims. Keep any deliberate recheck separate and label simulated reports clearly.

## 5. Motion, accessibility, and focused verification

Use existing CSS/shadcn animation utilities for a pulse on the actual active step, a brief completion transition, and transitions when real counts change. Respect `prefers-reduced-motion`/`motion-safe`; reduced motion retains all text/state information. Do not animate fake work to fill latency.

Keep keyboard navigation, visible focus, accessible names, non-color status labels, reachable mobile controls, focus return from dialogs, and polite status announcements. Do not announce elapsed seconds repeatedly. Loading is not zero results; errors are not empty lists.

Extend the owned client/UI tests with a small focused set:

- Persisted running → terminal steps survive refresh, remain ordered/deduplicated, stop polling, and never trigger additional POSTs; delayed responses cannot replace a newer selected run.
- Multipart supporting upload includes kind/revision; stale/failed requests preserve evidence/notes and do not silently repeat. Private evidence links remain usable.
- Resolved, discrepancy, needs-human, failed, superseded, and unavailable states use server results; no result auto-approves or bypasses existing financial/duplicate blockers.
- Procedure source approval → proposal → real-test response → human activation; missing/conflicting evidence, stale version, and failed test disable reuse/activation after refresh.
- Keyboard/mobile flow and reduced motion; simulation/recording labels remain visible.

Runnable current commands from `reconciliation/` (Node 24):

```sh
npm run typecheck
node --conditions=react-server --import tsx --test src/lib/dashboard/tests/*.test.ts
npm run test:browser -- tests/ui/workspace.spec.ts
```

Add one focused spec such as `tests/ui/investigations.spec.ts`; its command becomes runnable only after that file is delivered. Run the focused new spec with the existing browser config. Let integration own the final build/combined checks; do not repeatedly run broad suites without a new failure or change.

Use the existing isolated browser demo with paid providers disabled; unset `DASHBOARD_BASE_URL` rather than pointing tests at shared/live data. Route mocks and preview verify UI behavior only. Report actual backend integration separately.

Deliver the owned diff, exact commands/results, synthetic desktop/mobile screenshots, and a short click path: evidence → real investigation → findings → human source approval → proposal/test/human activation → later claim reuse → blocked bad case. The team will test the UI themselves; Devin supplies independent focused recording/evidence. A missing B/C endpoint is a named integration blocker, not grounds to fabricate completion.
