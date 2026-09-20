# Agent B — platform, financial correctness and learning implementation plan

> Execute independently. Read this directory's `README.md`, `context.md`, `api.md`, and `contracts.ts` first. No previous chat context is required. A is building the UI and C the intelligence provider; they cannot coordinate with you during their work. Use the frozen seams.

**Goal:** Upgrade Dylan's working reimbursement backend so assessments, human decisions, exact duplicates and tested learning behave correctly and remain auditable.

**Architecture:** Preserve the existing Next route paths, Supabase/private receipt storage and persistent local demo store. Add a forward migration and focused service changes. Inject the frozen `IntelligencePort` for tests; `runtime.ts` wires C's real export after integration.

**Tech stack:** Existing TypeScript, Zod, native fetch, Supabase SQL/RPCs, local atomic file storage, node:test and PGlite. No replacement database, ORM, agent framework or worker service.

## Global constraints and ownership

Work in `reconciliation/` from the common baseline described in README. Own `src/app/api/**`; `src/lib/core/**` except `jev.ts`; `src/lib/intake/**` except `extract.ts`; `supabase/**`; `scripts/**`; `src/lib/demo/**`; app README, `.env.example`, legacy `src/lib/contracts.ts`; `next.config.ts` only if needed.

Do not edit A's components/pages/browser tests, C's two provider files or new intelligence module, frozen `review-contracts.ts`, package/lock/config files owned by the integrator. You are not alone in the codebase; preserve other builders' changes. Read app AGENTS.md and relevant bundled Next docs before route changes.

Keep the existing Jev and extraction signatures. The only production file importing C's new `intelligence` runtime export is your live composition in `src/lib/core/runtime.ts`. Your core services consume an injected `IntelligencePort`; tests import services with a fake port. Do not add a fake implementation to production to make an incomplete merge build.

## Task 1 — reproduce gaps and migrate status safely

**Files:** core checks/service/store/file-store/types/validation; new SQL migration `supabase/migrations/202609190002_review_v2.sql`; core/SQL tests.

**Consumes:** frozen assessment, decision and revision semantics from api.md.

**Produces:** separate persisted assessment/human decision, correct projection, consistent local/Supabase behavior.

- [ ] Add a regression using real core checks: claim and receipt both $600, flight cap $500, missing receipt name. Expected assessment is flagged, with both cap failure and name uncertainty retained.
- [ ] Add a regression that an all-pass machine run leaves human decision pending; after human approval, reanalysis preserves approved. Do not merely rename the displayed legacy status.
- [ ] Add assessment status, human decision, assessment knowledge revision, review revision, processing error/lease fields and receipt SHA storage as needed. Extend your legacy internal types; v2 wire DTOs remain unchanged.
- [ ] Migrate human decisions from actual human corrections, not old machine-produced approved values. Preserve historical runs/checks. Convert old vendor aliases into inactive drafts. Add local snapshot upgrade logic with the same semantics. Do not edit/reapply the old migration as if databases were empty.
- [ ] Make the reducer prioritize fail over unknown, excluding human/overall records; empty evidence is needs_review. Derive the compatibility status exactly as specified.
- [ ] `GET /api/reviews` returns the complete v2 response with stable snapshot token, execution modes, rule revision and bounded ledger. Update core seed fixtures and tests for the new intentional semantics.

Small assertion targets:

```ts
assert.equal(row.assessment_status, 'flagged');
assert.equal(row.decision_status, 'pending');
assert.equal(row.status, 'flagged');
// After human approval of an eligible source, recheck cannot revoke the human decision.
assert.equal(afterRecheck.decision_status, 'approved');
```

Use actual service calls for these rows; do not assert against hand-written fixture constants.

## Task 2 — revision guards, duplicate approval and extraction retry

**Files:** intake service/store/schema/http; core store/file-store/service; corrections/reconcile/submission/receipt routes; forward migration and tests.

**Consumes:** `DecisionRequest`, existing multipart upload, retained receipt bytes, C's unchanged `extractReceipt`.

**Produces:** durable revision-checked actions and original-byte duplicate protection.

- [ ] Compute SHA-256 once from validated original upload bytes with Node crypto. Preserve original storage protections. Backfill known local/synthetic receipt bytes when available; retain null where the original cannot be recovered rather than inventing a hash.
- [ ] Before assessment, find exact duplicates across the store independently of Jev/Elasticsearch. Apply the original/later-copy rule in api.md and return related IDs for A. Keep fuzzy duplicate evidence as a separate Jev input.
- [ ] Make human writes atomically compare expected revision and save the correction/history/new decision. Preserve active-run invalidation. Replaying a stale revision returns 409 and does not add another correction.
- [ ] Enforce approval prerequisites and serialize final duplicate approval across the same hash. A SQL row lock on only the current claim is insufficient: use a transaction-level lock keyed by receipt hash or an equivalent database constraint. Local file storage already has a cross-process lock; reuse it. Do not delegate this to the UI or model.
- [ ] Add `/api/submissions/[id]/retry-extraction` with the exact body/response and pending-only guard. Retain original bytes; bound provider work; clear stale assessment and increment revision. On failure keep the receipt/error and allow another explicit retry.
- [ ] Test two simultaneous approvals of claims sharing one hash: at most one may commit. Test stale review, financial failure approval, failed extraction and a late run completion following human action in both relevant adapters.

## Task 3 — investigation and dry-run assessment seam

**Files:** `src/lib/core/service.ts`, optional focused `assessment.ts`, `runtime.ts`, route helpers and service tests.

**Consumes:** C's `IntelligencePort`; current `LiveJev`/`SimulatedJev`; read-only evidence.

**Produces:** persisted real investigation results and an `AssessExample` callback for learning tests.

- [ ] Factor the existing financial + Jev check path into one reusable assessment operation. Production reconciliation and rule evaluation must call the same operation. Map the legacy all-pass status to matched at this boundary. No duplicate standalone evaluator with looser money checks.
- [ ] Implement `AssessExample` exactly: receives only `facts`, supplied `ActiveAlias[]`, and AbortSignal; returns assessment. No expected labels, writes, new human decision or investigator invocation. Forward cancellation through C's backward-compatible optional fourth argument to `Jev.evaluate(state, runId, log, signal)`. In evaluation, provider failures throw rather than becoming counted unknowns. Bounded snapshot facts must carry exact duplicate IDs; provider usage is still recorded honestly with appropriate nullable IDs.
- [ ] Supply scoped investigation tools for the current receipt, applicable policies, at most 20 related claims and active rules. Invoke C only for unresolved/no-fail cases after successful extraction. Persist returned trace after validating evidence refs and current revisions.
- [ ] Runtime constructs the real C port lazily. Unit tests inject a literal fake port matching the interface. Missing live keys return clear errors when invoked, not during import/build.
- [ ] Add a fake investigator test that reads two tools and returns valid refs; preserve its actual steps. Reject a nonexistent evidence reference. A timeout must leave the claim under review and retain existing check results.

## Task 4 — proposal, real test, activation and disable

**Files:** new `src/lib/core/rules.ts` if useful; stores/SQL; `/api/rules` and dynamic child routes; retrieval; learning integration tests.

**Consumes:** rule DTOs and C's `build_rule_suite`/`evaluate_rule`; your real `AssessExample`.

**Produces:** complete rule lifecycle, with local/Supabase parity.

- [ ] Separate `/api/corrections` from alias learning. Reject old vendor_alias mutation bodies with USE_RULES_ENDPOINT. Save a proposal only from an eligible currently approved source and server-derived observed scope.
- [ ] Persist immutable alias payload, source correction, version/state and latest test. Drafts and disabled rules never enter Jev evidence. Adapt active rules to legacy `Correction[]` only at your retrieval boundary; never broaden the category/currency match.
- [ ] Test endpoint increments rule version, clears previous report, captures active knowledge, then calls C with its ten-case suite and your assessor. Propagate timeout/invalid-provider errors. Persist only a still-current report and return it to A.
- [ ] Activation transaction checks source approval, candidate version, test pass, matching knowledge revision, evaluator suite and live/simulated mode. Update knowledge/version together. Disable preserves history. Withdrawing source approval disables its active rules within the same transaction.
- [ ] Add regressions for rejected-source proposal, draft not used, activation without test, failed test, stale test, different category scope, disabling and source rejection. Repeat the original dangerous case: a rejected claim must not install active learning merely by saving a correction.

Concrete failure expectations:

```ts
assert.equal(response.status, 409);
assert.equal((await response.json()).error.code, 'TEST_REQUIRED');
assert.equal((await store.snapshot()).knowledge_revision, beforeKnowledge);
```

Implement against actual stores/routes; fake only model calls. Include a real-assessor test showing a proposed alias cannot make an overclaim or exact duplicate matched.

## Task 5 — expose Jev search and finish operations

**Files:** `/api/search/route.ts`, service projection/helper, runtime/config and README.

- [ ] Verify snapshot, apply explicit filters, project at most 200 rows into `SearchRow`, and invoke `intelligence.search` with a 45-second deadline. Require exactly one result per ID. Recheck snapshot before returning original rows grouped as matches/possible matches. Fail the whole search if coverage/provider results are incomplete.
- [ ] Keep provider/extraction/reconciliation modes accurate. Add investigation environment variables from README to `.env.example`. Update the demo launcher to force new features to simulated mode and clear keys; live mode must never silently fall back.
- [ ] Update documentation for the v2 migration, shared versus per-laptop data, simulator limits, mixed/live launch paths, preserved approvals and evidence. Keep synthetic-only limits explicit. No real payment integration or new deployment architecture.
- [ ] Keep checks that protect existing upload/receipt privacy and source-origin behavior. No need to rewrite working native-fetch clients or the existing Supabase adapter.

## Devin evidence and delivery

Use Devin for actual audit → reproduce → fix → verify work. Save its real session link and PR/commit diff plus the initial failing case, passing regression and browser verification after integration. If Dynamic Workflows are available in the account, use that supported workflow; otherwise the same concrete task in a normal session is sufficient. Do not invent session evidence or install a Devin runtime dependency.

Independent gate: `npm test` exercises your store/routes and injected intelligence fake. Run PGlite migration/transaction checks. A full production build is an integration gate once C's real export is merged; report the dependency instead of adding a production stub. After merge, run build/typecheck plus the browser upload/review/learning flow with A.

Finish with changed files, migration instructions, exact commands/results, persistent-state behavior, live services actually exercised, missing keys and remaining risks. Do not push secrets or local demo ledgers.
