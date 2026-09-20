# Build Sift's investigation and reviewed learning workflow

Prepared 2026-09-20 against `main` at `9f3d593`. **This is the active build assignment, not a claim that the new features are implemented.** It replaces the [previous instruction pack](../archive/2026-09-20-review-workflow/README.md). Older files under `docs/superpowers/plans/` and `docs/SIFT_TESTING.md` are historical background; their scope, setup and implementation-state assertions do not override this pack. Existing uncommitted edits to those older documents are preserved.

## What we are making

Sift already extracts receipts, checks reimbursements, separates machine assessment from human approval, and supports reviewed merchant aliases. We are adding a way to investigate an unclear claim using actual supporting evidence, show the work, and remember one reviewed procedure for later claims.

Example: a hotel receipt has an unfamiliar merchant descriptor. The investigator reads a booking confirmation, finds the same booking reference, and returns the evidence. The existing assessment engine checks it and reruns financial/duplicate safeguards. A supported claim becomes **ready for approval**. A human approves it, reviews a proposed booking-reference procedure, runs its safety test, and activates it. A later eligible claim can reuse that procedure while a duplicate or policy violation remains blocked. Missing/conflicting evidence still needs human input.

There are two different agents: **Sift's investigator runs inside the product; Devin helps develop and independently verify the product.** Approval is not learning; learning is not payment authorization. The new procedure is saved, versioned instructions and matching requirements, not model retraining.

## Read and assign

Everyone reads this file and [00-contracts.md](00-contracts.md), then only their assignment. B publishes the additive TypeScript declarations before implementation against the new interfaces. The planned contracts below are not implemented APIs yet.

| Owner | Assignment | Deliverable |
| --- | --- | --- |
| B — backend/database | [01-platform.md](01-platform.md) | Documents, persistence, guarded reassessment, API contracts, migration and backfill |
| C — intelligence | [02-intelligence.md](02-intelligence.md) | Bounded Azure investigator, richer Jev evidence, procedure activation suite |
| A — frontend | [03-workspace.md](03-workspace.md) | Investigations page, actual run progress, evidence/results, review controls |
| Devin — independent verification | [04-devin-benchmark.md](04-devin-benchmark.md) | Synthetic evidence pack, focused integration checks, reproductions, recordings; filename retained for existing links |
| Fourth teammate / integration owner / human reviewer | [05-integration.md](05-integration.md) | Access, delivery coordination, evidence review, human decisions, hands-on UI test, demo and pitch |

Each person can use an agent within their scope. You are not alone in this codebase: preserve others' edits. One database owner; one owner for shared contracts. Each assignment specifies its write allowlist; an ownership change must be explicit.

## Current baseline: inspect source before editing

Read these first:

- [Core behavior and setup](../../reconciliation/src/lib/core/README.md), [public contracts](../../reconciliation/src/lib/review-contracts.ts), [intelligence implementation](../../reconciliation/src/lib/intelligence/index.ts).
- [Benchmark findings](../../reconciliation/evals/comparison/findings/2026-09-20/README.md) and [full report](../../reconciliation/evals/comparison/findings/2026-09-20/report.md).
- [App agent instructions](../../reconciliation/AGENTS.md), including installed Next.js documentation before app changes.

At the inspected commit, guarded approvals, versioned alias proposal/test/activation, extraction retry, CSV export, knowledge revisions and the production evaluation seam exist. `investigate` returns unavailable. Supporting-document storage, a real investigation page, persisted tool steps and the booking-reference procedure are new. The original single-receipt model and exact amount equality remain. Remote migration/backfill state is **unknown** until B checks it; source documentation is not proof of deployment.

The 50-case exploratory comparison found Sift **39/50 correct, 19/30 valid matched, 8/8 violations flagged, 6/6 duplicates flagged, zero unsafe matches**; direct PDF-to-model baseline **47/50, 29/30, 6/8, 6/6, zero unsafe matches**. Median receipt-to-verdict was 2.287s versus 2.542s; estimated model cost was $0.0183 versus $0.0726. All 11 valid Sift review cases had unknown merchant checks; ten unfamiliar descriptors lacked corroborating identity evidence. Labels remain unreviewed and cost rates assumed. Preserve those findings. They do not establish equal-quality savings, Jev-only causation, human-time savings, learning gains or Ramp superiority.

## P0 finish line, in order

1. **Evidence and shared interfaces:** B publishes additive declarations, supports multiple documents for one purchase, and persists runs/steps safely in SQL and the local demo store. Preserve the original receipt and all human history.
2. **One complete investigation:** a recoverable uncertainty with relevant available evidence invokes the model-selected tools; bounded execution records real progress/errors; core reassesses once. Resolved means ready for human approval, never automatically approved.
3. **Visible review:** A shows what was found, which check changed, evidence links, remaining questions and the next human action. Unresolved cases go to “Needs your input”; complete passing cases go to “Ready for approval.”
4. **One reviewed procedure:** first supported investigation → human source approval → proposal → versioned safety test → explicit activation → a different claim uses the same evidence requirements with less work. Missing/conflicting evidence prevents application; bad cases remain blocked.
5. **Truthful demonstration:** reviewed 20-claim development pack, focused safety/revision tests, one budgeted live flow, human UI replay, and Devin's recording/evidence on the delivered commit. A recording is labeled; simulation is explicit.

The investigator starts with **three planning rounds, six read-tool calls, one final core reassessment, and a 90-second wall-clock bound** covering investigation plus reassessment. All provider attempts, including failures, count toward the separately agreed live-call budget. Do not hide extra synthesis calls or retries beyond those limits.

## Work waves and handoff gates

| Wave | Build work | Human / Devin work | Exit condition |
| --- | --- | --- | --- |
| 1: first 30 minutes | B publishes 00's declarations and checks migration state; C/A inspect actual code and prepare within ownership | Human assigns owners, supplies secure access, selects isolated target and live budget; Devin prepares evidence offline | Shared interfaces compile, ownership and target recorded |
| 2: next 1–2 hours | B stores evidence/events; C builds investigator; A builds run/results views against typed, explicitly simulated fixtures | Human reviews documents/policies/expected answers; Devin tests each delivered component | One real receipt + booking can be investigated and reassessed |
| 3: next 1–2 hours | Wire guarded procedure lifecycle and application; resolve integration defects | Human reviews first correction/procedure; Devin checks missing/conflicting evidence, violations, duplicates, stale writes | Later claim uses tested knowledge safely, prior decisions unchanged |
| 4: remaining time | Focused owner checks, one integrated typecheck/build, smallest fixes | Human hands-on UI rehearsal; Devin verifies delivered commit and records walkthrough | Demo, setup commands, truthful results and known gaps recorded |

Times are targets; advance on the exit condition. C/A can prepare while B writes persistence, but no independent contract forks. Devin starts offline immediately; live testing waits for the actual endpoints, isolated setup, reviewed evidence and call budget. A missing dependency is blocked, not simulated success.

## Scope and hard boundaries

- Existing Next.js/shadcn, Supabase, Azure OpenAI and Gateway Jev; Node 24.11.1; installed dependencies. No new framework, queue, Elasticsearch, model provider or broad refactor.
- Synthetic private hackathon demo. Keep originals private, secrets server-side and provider configuration in secure local/session secrets.
- USD integer cents, exact original-receipt equality, existing mandatory financial/policy/duplicate checks. Supporting documents add evidence; never sum a booking, folio and payment slip for the same purchase.
- Claimant identity from an itinerary is accepted only under an explicit applicable policy. No global relaxation of name/merchant evidence or confidence thresholds. Record original model choice/probabilities/confidence and the reason for an application `unknown`.
- Server owns assessment and decisions. A model returns findings; a browser renders results. Neither can publish its own approval or fabricate successful activity.
- Preserve existing aliases and their fixed `alias-v1` tests. Add only `booking_reference_identity`; no generic agent/procedure builder, blanket exemptions, custom-check editor or policy editor.
- **P1 only after all P0 gates:** one claim with multiple distinct same-category USD purchases, each validated before summing explicitly allocated eligible amounts. B must first publish the new allocation contract. Shared-receipt splits remain unsupported without policy/ownership evidence and atomic allocation limits. No unrestricted many-to-many matching.

## Git, delivery and testing

Work only on **main**, in separate clones for separate computers/Devin. No branches, worktrees, force-push, shared resets or stashing another person's edits. The integration owner serializes delivery: inspect status; commit only owned paths; fetch current main; merge a reviewed upstream change without rewriting history; run affected checks; push only during the assigned delivery slot. A dirty shared checkout is not permission to discard or include unrelated changes. If normal integration conflicts, resolve within ownership with the integration owner.

The integration owner alone edits package/lockfiles, root test/config files or global styling. Owners request concrete changes. B owns migration execution and shared DTOs. Human/Devin evidence stays separate from production inference inputs.

Each owner leaves small runnable checks for real money, duplicate, stale evidence and learning risks. Retain existing tests. Integration runs typecheck/build once for the combined delivery; repeat only for relevant subsequent changes/failures. Use existing targeted Node/PGlite/Playwright tools, with no new framework. The humans will test the UI. Do not spend the remaining hours repeatedly running broad suites or the old 50-case experiment.

## Copyable kickoff

> Read docs/next-work/README.md and 00-contracts.md on current main, then your assigned owner file. This investigation pack supersedes older handoffs. Stay within ownership, preserve unrelated work and shared data, and deliver the P0 investigation/learning flow with actual evidence. Publish missing dependencies instead of fabricating success. Coordinate shared contracts through B and delivery through the integration owner. Start with the smallest complete flow.

Send Devin the specific kickoff in [04](04-devin-benchmark.md). These files do not dispatch Devin or apply migrations. Start with the human checklist in [05](05-integration.md).
