# 04 — Devin: prepare evidence, verify the investigation, record the demo

Prepared against `main` at `9f3d593`, 2026-09-20. **This is a work prompt, not a dispatched Devin session or a passing report.** No session link exists for this assignment. Read [README](README.md), [00-contracts](00-contracts.md), and [05-integration](05-integration.md) first.

The next 4–8 hours prioritize a **20-claim development/demo pack, focused safety checks, and one budgeted live vertical slice**. Start offline now; do not wait for every feature. The previous broad 50-case campaign is not a recurring mandate. The team tests the UI themselves; your independent reproductions and recording complement that work.

## Ownership and source of truth

Own only `reconciliation/evals/**`, excluding immutable existing comparison/findings outputs. Put new work under `evals/investigation/` and fresh run artifacts under `evals/results/investigation/`. Do not alter old `evals/comparison/findings/2026-09-20/**` or overwrite prior result directories.

You are not alone. Use a separate clone on `main`; no branch/worktree, force-push, automatic push, shared-data reset, or production fixes. Integration serializes delivery. Record starting/delivered SHAs and your exact scoped diff; request the integration slot and follow README's sequence.

Production/UI/API/contracts/schema/packages/scripts and others' tests are outside your ownership unless explicitly reassigned. Reuse Node 24, TypeScript, native fetch/FormData/crypto, installed Playwright, and existing synthetic PDF helpers where they preserve the required clues. No new dependency or substitute Sift scorer.

Read current code before adapting checks:

- `reconciliation/AGENTS.md`, `src/lib/core/README.md`, `src/lib/review-contracts.ts`.
- `src/lib/intelligence/index.ts`, `src/lib/core/evaluation.ts`, and current route handlers.
- `evals/comparison/README.md`, `evals/comparison/findings/2026-09-20/README.md`, and its `report.md`.
- The new B/C/A assignments in this pack and their delivered commits, rather than archived feature assumptions.

Current main already has guarded approvals, persisted scoped alias lifecycle, retry/export, and the comparison runner. Investigation currently returns unavailable. Supporting-document, persisted investigation, and procedure APIs below are proposed until their owners deliver them. `package.json` contains `eval:heldout`, but `evals/run-heldout.ts` is absent at this starting point; a script name is not a runnable benchmark.

## Preserve what the existing experiment actually found

The published isolated experiment reports Sift **39/50** correct versus direct PDF-to-Azure-model **47/50**; valid matches **19/30 versus 29/30**, policy violations flagged **8/8 versus 6/8**, duplicates flagged **6/6 in both**, and zero unsafe matches in both. Median receipt-to-verdict was **2.287s versus 2.542s**; estimated 50-case model cost **$0.0183 versus $0.0726**.

All valid Sift exceptions had an unknown merchant check; ten unfamiliar merchants lacked corroborating identity evidence. Labels remain unreviewed and costs use deployment/rate assumptions. This was an isolated pipeline comparison, excluding live database/upload/UI, human time, Ramp, and learning. Do not claim equivalent-quality savings, Jev-only attribution for the entire difference, or that this new demo erases the unfavorable result.

The new pack is development/demo material used to build the feature, **not independent accuracy evidence**. Any later independent claim requires a separate fresh, reviewed held-out pack untouched by tuning or activation tests. Do not relabel the 20 development cases as held-out.

## Timing and dependencies

| Stage | Start condition | Deliverable and boundary |
| --- | --- | --- |
| Offline preparation — now | This prompt and current source | Synthetic documents, separated labels, policy/evidence review packet, mock contract checks, recording outline, proposed call budget. No model calls or shared DB access. |
| Incremental verification | Each endpoint/adapter is delivered | Verify its commit and run focused offline/local checks immediately. Missing siblings are named blockers, not a reason to idle. |
| One live vertical slice | Isolated Supabase is ready; real Azure planner is implemented; fixtures/policies have human sign-off; explicit counted model budget is approved | Exercise source evidence → investigation → human approval → procedure test/activation → later reuse → blocked bad case. Stop at budget/time cap. |
| Independent recording and retest | Integrated delivered commit and available UI | Record real behavior, file minimal reproductions, retest owner fixes, and update evidence. Do not repeatedly rerun broad suites. |

If the live gates are unavailable, finish the offline pack and checks, record an explicitly simulated fallback if useful, and report the exact blocker. Never invent sign-off, credentials, a model budget, successful execution, or a Devin session link.

## 1. Build the separate 20-case development pack

Create actual readable synthetic PDFs/images and structured claim inputs. Expected answers/policy interpretation live in a separate evaluator-only file; the application and models receive only claim facts, policy, and genuine document contents.

| Cohort | Claims | Evidence to include |
| --- | ---: | --- |
| Straightforward valid | 10 | Familiar merchant, matching claimant, exact eligible amount/currency/date, distinct purchases. |
| Unfamiliar merchant with linked booking | 2 | Receipt billing descriptor + booking confirmation carrying the same explicit reference and merchant identity; use a hotel/USD source/later pair with the same descriptor/canonical identity for the single procedure. |
| Similar-looking distinct purchases | 2 | Similar merchant/date/amount but different purchase/reference facts supporting two real eligible purchases. |
| Duplicate purchase across different documents | 2 | Different document bytes/types describing a purchase already represented by an earlier claim; shared corroborating purchase identity, not filename inference. |
| Claimant identity supported by itinerary | 2 | Receipt + itinerary with an explicit reference/name link permitted by the applicable reviewed policy. |
| Genuinely incomplete | 1 | Essential evidence truly absent; no hidden answer seeded as supporting evidence. |
| Clear policy violation | 1 | Unambiguous cap/date/category violation that remains blocked after investigation/learning. |
| **Total** | **20** | **10 straightforward + 8 evidence cases + 1 incomplete + 1 violation.** |

- [ ] Use two distinct later duplicate claims pointing to earlier purchases already represented among the 20; original claims precede duplicates. Keep purchase/document/claim links explicit in evaluator metadata.
- [ ] Generate real clue text inside documents: booking references, merchant legal/trading names, traveler names, dates, amounts, and purchase identifiers as applicable. `receiptPdf` alone may need an eval-owned wrapper/helper for supporting text; inspect rendered output.
- [ ] Use neutral randomized IDs and filenames, with no `valid`, `duplicate`, `violation`, expected verdict, or cohort hint visible to models. Randomization must preserve required original-before-duplicate ordering.
- [ ] Keep expected labels, cohort names, and evaluation rationale outside uploads, extraction prompts, tool responses, filenames, and app-visible metadata. A clue describes a transaction, not “approve this claim.”
- [ ] Preserve P0's one primary receipt/one purchase/exact USD amount model. Multiple documents for one stay never become several summed purchases. Unsupported allocations stay unsupported.
- [ ] Record input/document/label/policy hashes, generator seed/version, scenario dependencies, expected checks/outcome, and why available evidence supports each label.
- [ ] Give the fourth teammate a readable review packet containing every original, linked supporting document, policy, and expected answer/rationale. They review labels/policies, help refine synthetic evidence, and prepare pitch language.
- [ ] Record actual reviewer identity/date and accepted hashes; unresolved label disagreements remain open. If evidence/policy changes, revise hashes and get the changed material reviewed again. Automated agreement is not human sign-off.

You may prepare/run explicitly simulated local cases before sign-off, but label them unreviewed development fixtures. Human review gates the live demonstration and any reported interpretation of expected outcomes.

## 2. Verify each delivered contract before the full flow

Consume frozen `00-contracts`; do not invent production routes or implement them in the harness.

| Surface | Focused observation |
| --- | --- |
| `GET/POST /api/submissions/:id/supporting-documents` | Multipart `file,kind,expected_review_revision`; pending claim, eight documents max, 8 MiB each; private persistence, visible extraction failure and stale-write rejection. |
| `GET /api/submissions/:id/supporting-documents/:documentId` | Correct private original bytes after refresh; no public bucket or leaked storage credentials. |
| `POST /api/submissions/:id/investigate` | `{expected_review_revision}`; awaited `{run,row}` including persisted failed runs; early invalid/unavailable errors use the error envelope; no detached “queued” success. |
| `GET /api/investigations`, `GET /api/investigations/:runId` | Claim-filtered list `{runs,coverage}` while POST is pending; detail `{run}`; persisted actual steps survive reload; reads never trigger providers. |
| `GET/POST /api/procedures` | Proposal `{run_id,expected_review_revision}` requires a current human-approved source; separate from existing alias APIs. |
| `POST /api/procedures/:id/test`, `/activate`, `/disable` | `{expected_procedure_version}`; test proof/version/source/knowledge freshness; explicit human activation. |

Public run evidence must include run/claim IDs, status `running/completed/failed/superseded`, nullable outcome before a result, headline/summary/unresolved question, findings with evidence references, `before_assessment`/`after_assessment`, nullable `proposed_learning`, actual `InvestigationRunStep` records/timestamps, mode/model, and errors. Failed/superseded runs retain null outcome/after-assessment. Check optional `ReviewRow.latest_investigation` separately from compatible legacy `investigation`; new capability booleans absent means unavailable. Validate evidence refs against stored run records. `completed` does not mean approved; a resolved eligible claim is ready for human approval.

Capture delivered commit + request/response + persisted revision/step evidence. Mocks demonstrate contract handling only; mark actual API and live-provider verification separately. Do not infer implementation from TypeScript declarations or screenshots.

## 3. Leave a few focused runnable safety checks

Use the production assessment/API paths with injected offline doubles or isolated storage. No parallel toy verdict engine. Group related risks into a small number of checks under your eval ownership; retain existing tests without making every old suite a recurring task.

- [ ] **Money and duplicates:** overclaim/underclaim, wrong currency or cap violation stays blocked; similar distinct purchases do not become duplicates from surface similarity; different documents for one purchase cannot authorize a second payment; supporting documents are never double-summed.
- [ ] **Evidence/revisions:** new or changed evidence invalidates affected assessment/test proof; stale approval/investigation/procedure requests cannot publish; changed evidence or knowledge during work yields truthful superseded/conflict state instead of overwriting a newer result.
- [ ] **Learning safety:** only the hotel/USD `booking_reference_identity` merchant procedure is supported; require human source approval, real versioned test, then human activation. Missing/conflicting reference evidence prevents reuse; failure/stale proof/source withdrawal prevents activation/reuse; alias behavior remains compatible. C’s fixed 12-case `booking-reference-v1` suite stays separate from these 20 cases and `alias-v1`; its gate requires correct application with no safety/correctness regression, not a fabricated accuracy gain.
- [ ] **Provider/progress failure:** planner/tool/reassessment failure is visible and never becomes fixture success or correct ambiguity; persisted real steps survive refresh; no fabricated steps, repeated start on refresh, or approval side effect.

The bounded investigator starts with three planning rounds, at most six tool calls, one final reassessment, and a 90,000 ms deadline covering investigation plus reassessment, as frozen in 00. Verify actual limits/failures with offline doubles first. Tool calls are not the same as paid provider calls; activation tests may fan out substantially.

Current runnable offline reference check, from `reconciliation/`:

```sh
node --conditions=react-server --import tsx --test evals/comparison/comparison.test.ts
```

Run it only if comparison-helper compatibility is relevant; preserve the existing comparison source/artifacts. Proposed new checks may use `node --conditions=react-server --import tsx --test evals/investigation/*.test.ts` **after those files exist**. Provide exact preparation/check/recording commands you actually implement. Do not advertise `npm run eval:heldout` as ready or edit `package.json` to make it so.

## 4. Agree the live scope and count every call

Before any paid execution, propose the smallest slice and its **maximum provider fanout**, based on the delivered implementation: initial/supporting extraction, Azure planner rounds, final reassessment/Jev, source/later/bad-case assessments, and every before/after activation-test call. Include optional narration if enabled; prefer keeping optional work off.

The integration owner approves a concrete call ceiling and any time/cost cap; this prompt supplies no invented number. Reserve/count each request before transmission, including retries and failed attempts. Stop starting work at the cap/deadline; no unbounded reruns or silent budget increases. A new paid retest needs remaining explicit budget.

Log run/case/phase, delivered commit, mode, provider/requested model/returned model, call ID, latency, usage when returned, failures, and procedure-test attribution. Null usage/cost stays unknown. Count extraction, planner, Jev, and activation calls once each, even on failure; tools that only read stored data do not masquerade as paid model calls.

Use a dedicated isolated Supabase project/store with reviewed migration state and private synthetic documents. B/integration owns migration application and backfill. Never seed/reset the shared rehearsal DB, expose credentials, or create human approvals in advance to force the story.

## 5. Record one truthful full flow and return failures to owners

Prepare a short recording, roughly 2–4 minutes if the actual bounded run permits:

1. Identify the delivered commit, live/simulated mode, and synthetic development pack. Open an unfamiliar merchant claim and its receipt/booking clues.
2. Start one real investigation; show persisted actual tools, findings/evidence, before/after checks, elapsed time, and any remaining uncertainty. Refresh once to prove persistence.
3. Have a real teammate review and approve the supported source with a note. Record that supervised human action; the harness must not invent approval or reviewer identity.
4. Propose the booking-reference procedure, run its real test, show proof, and have the human explicitly activate it. Preserve the distinct approval and activation actions.
5. Show a later eligible claim using the saved procedure, its evidence and actual recorded work. Say “less work” only if observed calls/steps support that comparison; matched still awaits human approval.
6. Show the violation/duplicate remaining blocked and the genuinely incomplete case retaining a specific question. End with the next reviewer action.

Keep a fallback recording clearly labeled **recording**, with its commit/date/mode. If it is simulated, say so throughout; do not pass replay for a live run. Preserve failures in evidence even if the presentation excerpt is shorter. No staged tool transcript or fake counters.

For each defect, send the integration owner a reproduction with commit, fixture/hash, exact action/request, expected versus observed result, sanitized logs, and recording timestamp. Route persistence/API/revision issues to B, planner/Jev/procedure logic to C, and rendering/polling/accessibility issues to A. A human triages priority; the owner fixes it; Devin retests that delivered fix. Do not silently patch production or rerun everything.

## Handoff and gate evidence

Use `passed`, `failed`, `blocked`, or `not_run` for each gate. Every result names commit, mode, command/action, evidence path, and blocker/owner where relevant. Missing execution is never a pass.

| Gate | Status | Required evidence |
| --- | --- | --- |
| 20-case pack + human label/policy review | `not_run` initially | Counts, documents, hashes, actual sign-off or named unresolved review |
| Financial/duplicate/revision guards | `not_run` initially | Focused runnable checks and failures retained |
| Real investigation + refresh persistence | `not_run` initially | Delivered commit, API/step records, provider/progress failure check |
| Reviewed procedure + later safe reuse | `not_run` initially | Source human action, test/version proof, activation, positive and negative evidence |
| Budgeted live vertical slice | `not_run` initially | Approved ceiling, all counted calls, actual usage/errors, isolated DB identity |
| Team UI rehearsal + independent recording | `not_run` initially | Named human rehearsal evidence, recording mode/commit/timestamps, fallback label |

Deliver the scoped diff; exact runnable commands; fixture/review manifests; concise report; call/timing log; reproduction list; recording index; and the gate table. Keep large/raw artifacts in fresh ignored run directories and link reviewed sanitized evidence. Strip secrets, authorization headers, signed URLs, and evaluator labels from shared demo material.

## Pasteable kickoff

> Work from current main on Sift's `docs/next-work/04-devin-benchmark.md` after reading README and 00-contracts. Own only reconciliation/evals/** and preserve existing comparison/findings outputs. Start offline now: prepare the separate 20-case development pack with actual supporting documents, evaluator-only labels, human review packet, focused guard checks, recording outline, and proposed maximum provider fanout. Validate individual endpoints as B/C/A deliver them. Run one live vertical slice only after isolated Supabase, the implemented Azure planner, signed-off fixtures/policies, and an explicit counted model budget are available. Record the delivered commit and all calls/failures; return reproductions to B/C/A through human triage, then retest owner fixes. Record supervised human source approval and procedure activation; never invent sign-off. No production edits, broad recurring benchmark campaign, paid calls before budget approval, automatic push, or shared-data reset. Return passed/failed/blocked/not_run gates with evidence and a clearly labeled fallback recording.
