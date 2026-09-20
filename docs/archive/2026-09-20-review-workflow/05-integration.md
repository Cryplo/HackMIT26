> **ARCHIVED — superseded on 2026-09-20.** Historical assignment from commit `9f3d593`; not current implementation instructions. Start with [the active investigation pack](../../next-work/README.md). Relative document links were relocated for this archive.

# Integration owner — finish, prove, and present

Read the pack README and 00-contracts. You coordinate deliveries from three colleagues and Devin; you do not expand the product scope while its core evidence is unfinished.

## Your exclusive files and responsibilities

Own package/lockfile changes, root test configuration, CI/deployment configuration, release notes and this handoff pack. Do not independently refactor an owner's production module. Review and integrate each owner's changes on **main only**. Resolve shared-contract questions in 00 and have B update declarations before consumers depend on them.

Use the existing Node 24 stack and dependencies. No new agent framework, queue, vector database, policy DSL or UI kit is required. Keep the shared synthetic Supabase project and ignored server-side credentials separate from source control. Each colleague's local server needs its own environment configuration even when code is identical.

## Delivery sequence

1. **Contracts and safety:** B delivers additive types and the shared approval guard; C prepares the exact-key Jev fix and scorer consumers; A prepares fixtures/UI behind false capabilities. Review the legacy approval reproduction before and after B's fix.
2. **Learning:** B's persistent rule lifecycle + C's real activation suite/evaluator integrate. Confirm disabled/withdrawn rules and stale tests cannot remain effective. Enable the capability only after an actual API flow works.
3. **Usable review flow:** integrate A's real controls, B's retry/duplicate links/export. Test state after refresh, rule changes, two-tab conflicts, extraction/provider failure and original-document access.
4. **Independent measurement:** Devin generates a review pack offline; two humans check labels; freeze it. Run the budgeted live smoke, baseline, reviewed correction and after phases in an isolated environment. Keep actual errors and regressions in reports.
5. **Release rehearsal:** typecheck, tests, production build, browser checks and human walkthrough all target the submitted commit. Retain raw reports and a short working-flow recording. Only then consider P1 custom checks or another reconciliation workflow.

Deliveries are serialized: an owner reserves a delivery slot, commits only owned paths, fetches current main, integrates upstream without overwriting others, and pushes normally. If another push wins the race, stop and reconcile through this owner; no force-push or secret branch. Never stash/reset another person's uncommitted changes merely to make a build clean. Each teammate can continue independent coding locally while a delivery is integrated.

## Configuration and data checklist

- Azure OpenAI: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`; use the actual deployed OpenAI model, not an assumed public model name. Verify PDF/image extraction on a new synthetic upload before a batch.
- Jev: `AI_GATEWAY_API_KEY`, `JEV_MODEL=typesafe-ai/jev`. Keep direct `TYPESAFE_API_KEY`/`JEV_API_KEY` unset unless deliberately switching channels. Existing Gateway transport is TypeSafe-compatible; no Elasticsearch credentials.
- Supabase: `SUPABASE_URL`, server-side `SUPABASE_SERVICE_ROLE_KEY`, private `SUPABASE_RECEIPTS_BUCKET=receipts`. Validate read access before migrations; record which migration was applied. Never expose the server key through `NEXT_PUBLIC_*`.
- Shared live synthetic app: `RECONCILIATION_SYNTHETIC_ONLY=true`, intake/extraction/reconciliation modes `live`, actual app origin in `RECONCILIATION_APP_ORIGIN`; optional narrative mode remains explicitly configured. Restart after configuration changes. Development-tunnel asset allowlisting does not replace API origin configuration.
- The 20-case rehearsal seed already exists; shared Supabase includes one extra preserved claim. Rehearsal is not the final evaluation. `?preview=1` remains synthetic UI-only. Seeded parsed fields are not a live OCR result.
- Apply only additive, reviewed migrations preserving existing evidence and human history. Test migration/backfill against an isolated copy first. Benchmark in an isolated file-backed store or dedicated synthetic database, never by resetting the shared queue.

Read [04-devin-benchmark.md](04-devin-benchmark.md) for the canonical evaluation workflow; it replaces older conflicting benchmark instructions. Update old navigation/runbooks to point at this pack after their owners finish any in-progress edits. Do not silently include somebody else's dirty documentation in your commit.

## Human acceptance session

Use `/business-demo` without preview. Give the interface to a teammate who did not build it; let them complete these tasks without coaching:

| Task | Required observable result |
| --- | --- |
| Submit a new synthetic receipt | Original remains accessible; actual extraction/mode visible; amounts match the printed document |
| Assess a straightforward claim | Machine Matched, human Pending; approval requires an explicit review action |
| Review an overclaim/cap violation | Clear amount/policy evidence; both UI and alternate API approval paths block it |
| Review duplicate copies | Actual prior document/claim linked; later copies cannot both be approved, including concurrent actions |
| Correct a merchant identity | Source approval remains separate; propose/test/activate affects a different eligible claim only |
| Disable/withdraw learning | Rule stops being used; old assessments show recheck needed; human history survives |
| Retry failed extraction | Same claim/original preserved; stale retry cannot overwrite newer evidence |
| Find and export a selection | Search uncertainty visible; export contains the exact selected snapshot and separate statuses |
| Refresh/restart and stale-tab decision | Stored state persists; conflicting update gives a recoverable message, not silent overwrite |

Approval guards should be tested through HTTP as well as the UI. A hidden button is not authorization. For this private synthetic demo, don't claim real-user authentication, money movement or production deployment readiness.

Record confusing labels, extra clicks and whether reviewers can explain a flag using the visible evidence. Fix those before decorative animation. Respect keyboard focus, visible labels, reduced motion and contrast.

## Evidence and sponsor presentation

For **Maximor**, show a real finance workflow that recognizes a recurring exception, accepts reviewed knowledge, improves on other claims and preserves financial controls. The before/after evidence must come from the frozen benchmark, with unfavorable outcomes retained. Merchant alias learning is external knowledge, not retraining Jev.

For **Cognition**, use Devin's actual testing/recording/playbook workflow: give it a bounded reproducible task, retain a real failure, route the fix to its owner, have Devin verify it, and retain session/commit/recording evidence. Existing history already includes a Devin development-tunnel fix (merged PR #4); verify and cite its actual contribution if used in the presentation. Do not create a fabricated PR, session or bug story. This pack prepares a Devin assignment; it does not dispatch or complete it.

For **Ramp**, demonstrate concrete review friction reduced and useful audit/export output. Time the same kind of review task with and without Sift using fresh equivalent examples; report errors as well as time. A flagged amount is not money saved, recovered, fraud or a completed payment. Confirm the event's full track rules before claiming eligibility.

OpenAI/Azure or Cursor usage alone does not establish sponsor-track compliance. Keep actual build/runtime evidence, and verify any detailed sponsor requirements available at the event. Do not add integrations just to collect logos.

## Suggested short demo

1. Show a messy reimbursement queue and an actual original receipt.
2. Explain one failed check with visible evidence; show another claim blocked for an overclaim/duplicate.
3. Resolve one merchant identity, test and activate the scoped rule.
4. Recheck a different eligible receipt; show the original financial failures still blocked.
5. Show actual measured before/after outcomes and latency/usage with their sample size, then export the reviewed selection.

Use measured numbers only. If a live provider fails, identify the failure and show the clearly labeled recording of the same tested flow. Never substitute the preview 8/10 → 10/10 display as measured evidence.

## Definition of finished for this phase

All five README milestones pass on one identified commit; schema/modes are recorded; the team can personally replay the flow; Devin artifacts are retained; there are no successful fake live paths. Document any remaining optional features as absent. Production auth/organization isolation and new reconciliation workflows are a subsequent scope decision.

After all five gates pass, the user can choose the optional P1 custom checks or the next reconciliation workflow. Custom checks are not a prerequisite for expansion. The strongest later extension is approved reimbursements ↔ payout CSV, which connects evidence to actual payment records; it is not part of this assignment.
