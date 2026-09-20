# Build and continue Sift

The integrated app is in `reconciliation/` on `main`. Begin with [Project context](docs/PROJECT_CONTEXT.md), then [the app README](reconciliation/README.md). The platform, investigation UI, and feedback-learning implementation are integrated; the old parallel-build packets are historical.

## Start locally

Use Node >=22.18 (verified with 24.11.1):

```sh
cd reconciliation
npm ci
NEXT_DIST_DIR=.next-showcase npm run demo -- --showcase --audit-ready --port 3002
```

Open `http://127.0.0.1:3002/overview` and choose **Start audit**. This is an isolated 14-claim simulated workspace with no provider spending or real email. Use `?preview=1` only for UI fixtures, not for persistence or learning verification. See [Showcase](reconciliation/docs/SHOWCASE.md) for reset and the separate human-feedback learning rehearsal.

For the existing live demo, preserve `.env.local` and the database. Follow [live setup](reconciliation/README.md#live-setup); do not overwrite configuration, replay applied migrations, or reseed as a setup shortcut. Migration application and successful reads do not establish successful live model results.

## Before changing code

1. Inspect `git status` and identify your owned files. Preserve other chats’ pitch, benchmark, and application edits.
2. Read [repository guidance](AGENTS.md), [app guidance](reconciliation/AGENTS.md), and the installed Next.js docs relevant to your change. Use the source contracts in `src/lib/review-contracts.ts` rather than copying an old frozen planning contract.
3. Trace the shared service/helper and its callers. Decisions, review counts, rechecks, learning, and email must remain consistent across pages.
4. Run focused affected checks; use `npm run typecheck` for TypeScript changes. Available broader checks are listed in the app README. Do not repeatedly run broad suites or paid benchmark experiments for a small change.
5. Update current docs for changed behavior, stage only task-owned paths, and coordinate delivery on the shared branch. Never force-push or discard someone else’s changes.

## UI direction

Keep the light-green theme, semantic green approvals/red failures/amber uncertainty, concise evidence, and obvious actions. Summary cards are non-clickable. Technical details and tool traces are collapsible. Review moves to the next eligible claim; completion goes to review only if actions remain.

Theme tokens live in `reconciliation/src/app/theme.css`; layout styles live beside the business components. Reuse installed shadcn/Radix primitives and current shared data helpers. Do not add a second status model to fix one page.

## Historical plans

Earlier designs are archived under `docs/archive/`; they are useful background, not current deployment status. Benchmark work remains separate; inspect its own checked-in findings and any uncommitted work before touching `reconciliation/evals/`.
