> **ARCHIVED — superseded on 2026-09-20.** Historical assignment from commit `9f3d593`; not current implementation instructions. Start with [the active investigation pack](../../next-work/README.md). Relative document links were relocated for this archive.

# Agent B — complete the platform safely

Read [README](README.md) and [00-contracts](00-contracts.md) first. You own the persisted truth and integration seams. Build on current main; do not restart the application. Your goal is all five P0 milestones, especially approval safety and real learning. You are not alone in this codebase: preserve other owners' work and stay inside this assignment.

## Ownership

You may edit `reconciliation/src/lib/core/**` **except** `core/jev.ts` and C's dedicated `core/tests/jev.test.ts`; `src/lib/intake/**`; `src/lib/contracts.ts`; `src/lib/review-contracts.ts`; `src/app/api/**`; and `supabase/**`. Your tests belong in existing core/intake test locations. You alone maintain adapters between legacy storage contracts and the v2 review response.

Do not edit UI components, dashboard client/fixtures, `src/lib/intelligence/**`, `evals/**`, package/lockfiles, global test configuration, or another owner's scripts. Request integration-owner changes for package commands. The current synthetic rehearsal seed is already working; migrations must preserve its 21 shared claims and history. Credentials stay in `.env.local`; never print them or turn a private bucket public.

## First delivery: contract declarations

Publish the additive capabilities/coverage declarations, evaluation seam and route request/response types from 00 before broad implementation. Keep existing signatures and paths wherever 00 says to reuse them. A can implement against responses; C can implement against `AssessExample` without your database. Make types compile while capabilities remain false for unfinished paths. No fake successful route implementations.

Read current `runtime.ts`, `service.ts`, `workspace.ts`, `checks.ts`, `store.ts`, `file-store.ts`, `retrieval.ts`, intake storage/extraction, API routes and SQL tests. The existing tests establish atomic run publication and guarded workspace decisions; preserve those properties.

## P0.1 — one authoritative approval operation

Reproduce this current inconsistency first in memory and through API tests: claim/receipt $900, cap $500 → machine flags policy cap → workspace approval is blocked → legacy `/api/corrections` currently approves. This is an unrestricted human override bypassing the newer workspace guard, not proof that Jev changed an amount.

Move the common guard into the shared mutation path, not just a route wrapper. Enforce current review/evidence/knowledge revisions, complete financial and duplicate checks, succeeded extraction, a bounded reviewer note and no conflicting operation. Both stores and both HTTP decision entry points use the same operation; do not leave a public legacy store call that still bypasses it. Use 00's compatibility behavior for the legacy endpoint; alias submission never approves anything.

Protect exact duplicate approvals across DIFFERENT claims as well as two tabs of one claim. A per-submission lease alone cannot serialize two approvals for the same receipt. Use the smallest database transaction/locking or uniqueness solution that guarantees the invariant, with the same semantics in local tests. Verify stored current receipt bytes/hash and existing approved claims at commit time. If exact evidence is unavailable, preserve uncertainty; do not infer a duplicate from equal totals alone.

Do not conflate machine assessment with human decision in migrated records. Historical machine `approved` statuses are not human approval evidence. Preserve corrections and explicit reviewer history. Machine rechecks must never overwrite a human approved/rejected state.

Acceptance: invalid financial approval blocked through every exposed route; semantic ambiguity can be explicitly reviewed without weakening money checks; simultaneous same-claim and same-purchase approvals cannot both win; stale notes/decisions fail clearly; valid approval persists after refresh/restart.

## P0.2 — real, persisted rule lifecycle

Implement 00's `/api/rules` endpoints and state transitions. Separate four concepts: source human approval, proposed identity knowledge, evidence from the activation test, and active knowledge supplied to future assessments.

Use migrations and immutable history to persist rule IDs/versions, state, source correction and scope, knowledge revision, test report and its bound inputs. Keep one receipt per claim and USD scope. Treat current legacy aliases as historical/unreviewed until explicitly tested and activated; never grandfather them into active knowledge silently.

Propose only from an approved source with an observed vendor. Derive source vendor/category/currency from stored evidence. Canonical identity is reviewer-supplied, not guessed from an unsupported model claim. Test through C's fixed ten-case suite and `createAssessExample(core)`; store actual results. Activation atomically checks current rule/source/knowledge/model-mode/suite identity and a passing stored report. A client cannot upload `passed:true` to activate.

Disable removes an alias from future evidence and increments knowledge revision. Rejecting or replacing its source invalidates dependent active knowledge and tests in the same transaction. Do not delete audit history. Conflicting active identities for the same normalized descriptor/category/currency cannot both become active.

Make knowledge revision real in local and Supabase stores. Snapshot each run's evidence, active knowledge, check configuration and policy version. Detect concurrent changes before publication; a stale computation must not replace the current result. UI staleness is derived from persisted revisions, not timestamps or a fabricated counter.

### Assessment seam for C and Devin

Implement `src/lib/core/evaluation.ts` exactly as 00 specifies. Factor only the existing computation necessary to make actual reconciliation and evaluation share a path. No alternate “benchmark matcher,” hardcoded expected classifications or reading answer keys.

The scorer uses supplied facts/reference claims and aliases, performs the same mandatory deterministic and semantic checks, and returns `Assessment`. It does not persist claims, runs, corrections or human decisions. Record actual provider usage with evaluation phase identity without violating run foreign keys. B supplies the internal mapping from `ActiveAlias` to evidence expected by the existing Jev interface. Caller cancellation stops new work; failures remain unknown/errors and are never cached as a successful match.

Return a true `IntelligencePort` instance supplied by C at integration time. If its implementation is missing, rule learning capability stays false and the relevant route reports unavailable. Do not activate aliases using a stub evaluator. Autonomous investigation is not a P0 dependency.

Acceptance: a source approval alone changes no active knowledge; a tested scoped alias helps a different valid example; protected examples remain blocked; source rejection/disable invalidates it; stale test activation fails; human decisions survive every recheck; all state survives restart.

## P0.3 — evidence, retry and export

**Receipt identity and duplicates:** compute SHA-256 server-side on upload. Backfill existing private originals idempotently without changing bytes/parsed evidence. Return confirmed prior duplicate IDs and explanation/method; don't publish candidate lists as proven duplicates. Verify receipt-number-plus-merchant/date/amount carefully; conflicting evidence stays possible, not confirmed. The canonical earlier claim remains the source, not an extra duplicate dollar amount.

**Retry:** implement 00's same-claim retry endpoint. Acquire the operation/revision guard before extraction; use the same stored original, preserve old extraction history, and commit only if the guard is still current. Failed extraction retains the original and a useful error. Do not duplicate a claim as the recovery path. Clear/invalidate obsolete machine evidence while keeping human history. P0 retry is allowed only for pending human decisions; reconsideration of an approved claim requires a separate explicit workflow.

**Export:** implement the exact selection/snapshot CSV route in 00. Check snapshot and requested IDs against one authoritative state, serialize only that state, protect text from spreadsheet formulas and retain null money. No model call. Include machine and human statuses separately. Unknown/pending money is not zero, paid money or savings.

**Review response:** set capability flags only for delivered functionality. Return complete coverage for the bounded demo; keep candidate scan limits explicit. If the store exceeds a supported bound, fail or return a clearly incomplete snapshot, not an apparently complete total. The UI uses this to decide whether aggregate insights are meaningful.

Acceptance: identical original available before/after retry; extraction failure recoverable; duplicate link opens the actual prior claim; stale export returns an error rather than the wrong rows; model secrets/raw payloads never enter CSV; selected valid export opens in a spreadsheet with correct integer amounts.

## P0.4 — integration and verification

Use the existing Azure Responses adapter for extraction and Gateway Jev for structured assessments. Do not reintroduce Elasticsearch, switch billing providers, change models to match a tutorial, or use production data. A startup config check must not spend credits. Document which operations actually invoke providers and their failure behavior.

Add focused tests for the above money/concurrency/learning invariants at the shared service, local store and SQL boundary. Use existing PGlite/database tests for transaction behavior; mocks alone do not prove database safety. Add HTTP tests for legacy-route bypass closure and exact payload contracts. Coordinate test discovery with the integration owner; a test file not executed is not a passing check.

Run owner tests plus `npm run typecheck` and `npm test`. Ask the integration owner to run the full build/browser checks after all owners deliver. Devin owns independent held-out data and browser evidence; do not edit its expected labels to make your implementation pass.

## P1 — optional check configuration, only after P0 acceptance

The attached proposal is intentionally narrowed by 00. Mandatory system checks are locked. Support the exact custom-check GET/POST/PATCH contract, immutable versions, protected identifiers, bounded text, maximum five enabled custom questions and stale-save errors. No `eval`, arbitrary code/SQL, arbitrary currency support or editable hard-equality semantics.

Pass only validated enabled questions to C's optional fourth Jev argument; supply bounded extracted text as untrusted evidence. Persist the questions and returned answers with each run. Custom concerns request review; a passing custom check never grants approval. Historical runs retain their old configuration. Configuration changes increment knowledge revision and require explicit recheck.

Policy caps/dates remain read-only in this pack. Do not invent a policy-editing endpoint or a second policy/config table. A future policy editor requires its own agreed contract; it does not block this phase.

## Deliver to integration owner

List actual commit, files, migration order, rollback/recovery procedure, supported capabilities, exact commands/results, provider modes used and remaining gaps. Include one sample real response for reviews, rule proposal/test/activation and retry using synthetic IDs. Note schema/data compatibility with the seed; any backfill is reviewed before applying to shared Supabase. Never claim a migration was applied or a live model tested unless it actually was.
