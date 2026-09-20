> **ARCHIVED — superseded on 2026-09-20.** Historical assignment from commit `9f3d593`; not current implementation instructions. Start with [the active investigation pack](../../next-work/README.md). Relative document links were relocated for this archive.

# Sift: finish the reimbursement workflow

Prepared against `main` at `a96e057` on 2026-09-20. This is a **work assignment**, not a claim that the planned features exist. This pack supersedes conflicting implementation instructions in the older `2026-09-19-dylanli` handoff and benchmark plan for this next phase. Existing source is the starting point; do not restart the app.

## Give these files to the team

Every builder reads this file and [00-contracts.md](00-contracts.md), then their assignment. They do not need to talk to one another to choose payloads or ownership.

| Owner | Assignment | Responsibility |
| --- | --- | --- |
| Backend colleague — Agent B | [01-platform.md](01-platform.md) | Shared contracts, persistence, approval safety, rule lifecycle, retry, export |
| Intelligence colleague — Agent C | [02-intelligence.md](02-intelligence.md) | Jev adapter correctness, alias activation suite/evaluator, existing semantic search |
| Frontend colleague — Agent A | [03-workspace.md](03-workspace.md) | Clear review workflow, evidence, actionable insights, real learning controls |
| Devin | [04-devin-benchmark.md](04-devin-benchmark.md) | Independent benchmark, integration tests, recordings and reproducible evidence |
| Fourth teammate / integration owner | [05-integration.md](05-integration.md) | Delivery coordination, configuration, human review and final demo |

Pasteable kickoff: “Work on your assigned file in `docs/next-work/`, after reading its README and 00-contracts. Stay within ownership. Deliver the P0 acceptance criteria with actual test results; report missing dependencies rather than simulating success. Work only on main.”

## Finish line, in order

1. Every approval entry point enforces the same financial and duplicate guards. Learning never approves a claim as a side effect.
2. A reviewer can propose a scoped merchant alias, run a real safety test, activate it, improve another eligible claim, and disable it. Changes are versioned and auditable.
3. A reviewed, isolated 50-case benchmark measures before/after results, errors, usage and latency. Devin and humans independently verify the flow.
4. Reviewers can understand an exception, inspect the actual receipt/duplicate, retry extraction, make an explicit decision, and export the exact reviewed selection.
5. The team records and personally rehearses the live flow on the submitted commit, with measured claims and a clearly identified fallback recording.

**P0 means required for those five items. P1 means optional only after all five pass.** P1 is the bounded custom-Jev-check editor inspired by the attached proposal; it must not delay safe learning or evaluation. Other reconciliation types, payment execution, ERP integration, autonomous investigation and a generalized policy language are out of scope.

## Current reality

- Next.js App Router, TypeScript, existing shadcn/Radix components, Tailwind and existing motion utilities. Keep the current neutral theme and central tokens; no new UI library.
- `/business-demo` uses persisted claims; `/submit` uploads receipt evidence. Upload does not currently auto-reconcile. `?preview=1` is a separate simulated UI.
- Supabase database and private receipt bucket work. The shared synthetic project has **21 claims: 20 rehearsal cases plus one preserved upload**. Use [the seed guide](../../../reconciliation/scripts/SEED_REHEARSAL.md). Never reset it to run a benchmark.
- Azure OpenAI handles extraction; Jev uses the existing Vercel AI Gateway TypeSafe-compatible endpoint. Candidate retrieval reads stored fields; Elasticsearch is not required.
- Persistent legacy aliases exist, but `/api/rules` lifecycle endpoints, same-claim extraction retry and CSV export do not. The intelligence directory currently contains search only. The benchmark runner is not implemented.
- Knowledge revision is currently a placeholder `0`; duplicate links and investigation are empty. The browser's 8/10 → 10/10 rule result is simulated.
- A verified legacy inconsistency allows `/api/corrections` to approve a cap failure that `/api/workspace/decisions` blocks. Fix the shared write path before enabling learning in the real UI.
- No real-user authentication or organization isolation exists. P0 is a private, synthetic hackathon demo, not a public service for real financial data. Do not call configurable checks “authenticated-user settings” without implementing authentication separately.

## Parallel work and Git

Use separate local clones on each person's computer, **all on main**. Do not create branches/worktrees or force-push. GitHub shares code; `.env.local` and database contents are separate. Never commit credentials, private receipts, provider payloads or unreviewed benchmark outputs.

Each owner can build against the frozen seams below using explicit test doubles. Those doubles must stay in tests/preview; missing live endpoints must remain visibly unavailable.

Delivery is serialized by the integration owner: B delivers contract declarations first; A and C can prepare against the documented types immediately. Then integrate B/C implementations, A wiring, and Devin verification. Before each owner's delivery, finish their bounded commit, fetch main, and incorporate upstream changes without overwriting another owner. If main diverges, the integration owner resolves it; do not silently rewrite history. Shared `package.json`, lockfiles, `next.config.ts`, CI and root test configuration belong solely to the integration owner. Owners provide exact requested command changes in their handoff.

Do not rename files, broaden scope, or “clean up” somebody else's module. A dependency conflict is a concrete blocker to report, not permission to take its ownership.

## Shared validation

Use Node 24 (`.nvmrc`) and existing dependencies. Read `reconciliation/AGENTS.md` before app changes. Run focused owner tests first; integration runs `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:browser`. The intelligence and held-out commands currently point to missing implementations; enable/use them only once delivered.

Offline tests and preview outcomes establish software behavior, not live model accuracy. Run live provider calls only with the team-agreed call budget and dedicated credentials. A provider failure is a failed/unknown result, never permission to substitute a fixture.
