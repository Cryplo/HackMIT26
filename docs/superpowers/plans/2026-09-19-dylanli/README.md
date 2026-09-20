# Dylan branch upgrade — agent handoffs

This packet replaces the greenfield implementation instructions in `docs/reimbursements-v1/` for work on Dylan's existing application. It is a plan and frozen contract, not an implemented upgrade.

## Send these instructions

Give each agent access to this **entire directory** in the repository, then send its individual prompt below. No earlier conversation is required. Each brief points to the same context, API specification and TypeScript contract.

| Agent | Send | Suggested development tool |
| --- | --- | --- |
| A | [agent-1-frontend.md](agent-1-frontend.md) | Cursor or your preferred coding agent |
| B | [agent-2-platform.md](agent-2-platform.md) | Devin |
| C | [agent-3-intelligence.md](agent-3-intelligence.md) | Codex |
| Devin benchmark | [Reproducible 50-case benchmark](../2026-09-19-sift-benchmark.md) | Devin |

The separate benchmark brief and [Sift testing guide](../../../SIFT_TESTING.md) are prepared instructions only. No Devin benchmark task has been dispatched and no benchmark runner has been implemented by this handoff. C retains its ten-case rule activation safety evaluator and intelligence tests; Devin exclusively owns `reconciliation/evals/**`, including generator, CLI seed, benchmark/report and browser tests. B retains backend scripts, stores, schema and metrics persistence. Benchmark checks use real existing APIs and report missing behavior; do not change production code solely to fake passing tests.

Copy-paste launch message, substituting the appropriate agent file:

> Implement `docs/superpowers/plans/2026-09-19-dylanli/agent-1-frontend.md`. Read its referenced context and contracts first. Work only within its ownership boundaries. Other agents are implementing the other modules independently and cannot communicate with you. Preserve their work and the frozen interfaces. Begin by checking the baseline and reporting any discrepancy, then complete your assigned tasks and verification.

## Integration owner: do this once before dispatch

The fourth teammate owns this short preparation and the eventual integration. These steps are not three separate setup tasks for the agents.

1. Start from `Cryplo/HackMIT26` commit `97ac7ec8d72f845e257d9822665645c1c7311c35` on current `main`, or a reviewed descendant. This commit was originally reviewed on `dylanli`; that remote branch was subsequently removed. Do not reset newer teammate work. If using a descendant, first check that the files/interfaces cited here still match.
2. Use this committed packet from the repository; do not substitute a private copy from another chat. Keep all implementation work inside the existing `reconciliation/` app; preserve the root browser prototype. Publishing these instructions does not perform the app setup in steps 3–7.
3. Use Node `24.11.1`, npm `11.6.2` (the versions used for this review); commit `.nvmrc` and the `packageManager` setting in the app. Run `npm ci` from `reconciliation/`.
4. Copy this packet's `contracts.ts` **unchanged** to `reconciliation/src/lib/review-contracts.ts`. Leave legacy `src/lib/contracts.ts` in place. B can extend its internal persistence types; everyone imports v2 API/intelligence types from the new frozen file.
5. Before frontend dispatch only: Follow [the visual contract's one-time shadcn setup](ramp-ui.md): Radix + Nova, Tailwind CSS variables, neutral base and Lucide. Generate only its listed components. Review and commit generated components/config, `src/lib/utils.ts` and the lockfile once. A owns generated components after this step and applies the visual contract's theme. Do not scaffold another Next app, upgrade Next/React, or add TanStack, Motion, an ORM, an agent framework, or another test framework preemptively. B/C need not wait for shadcn or UI work.
6. Preserve the existing package scripts: `test:intelligence` = `node --conditions=react-server --import tsx --test src/lib/intelligence/*.test.ts`; `eval:heldout` = `node --env-file-if-exists=.env.local --conditions=react-server --import tsx evals/run-heldout.ts`. The intelligence tests belong to C; the `eval:heldout` implementation belongs exclusively to Devin under `evals/**`. Do not add or change package scripts for this handoff. Ignore `evals/results/`, local data, secrets, test artifacts and screenshots of submissions.
7. Commit the common backend baseline after steps 3, 4 and 6. B/C can then branch and start independently (suggested names: `feat/review-platform`, `feat/review-intelligence`). A branches after the integration owner completes and commits shadcn step 5 (suggested name: `feat/review-ui`). Each person/agent uses its own clone or worktree and `npm ci`. Do not share an uncommitted working directory across machines.

Only the integration owner changes `src/lib/review-contracts.ts`, package/lock/TypeScript files, `.nvmrc`, `.gitignore` and this packet after dispatch. An agent must not silently modify a seam to get its own build to pass.

## Shared files

- [Context, decisions, ownership, and sponsor intent](context.md)
- [Exact API behavior and integration rules](api.md)
- [Frozen TypeScript DTOs and intelligence interface](contracts.ts)
- [Ramp-style visual contract, official screenshot references, tokens and shadcn setup](ramp-ui.md)
- [Devin benchmark handoff](../2026-09-19-sift-benchmark.md)
- [Sift testing guide](../../../SIFT_TESTING.md)

The contract defines final v2 behavior. It is fine for A to build against explicitly labeled fixtures while B/C are incomplete. Live provider failures must never switch to fixtures automatically.

## Minimum merge gates

1. A: build and browser tests with its explicit preview client; no dependency on B's running server.
2. B: real local-store and PGlite transaction/route tests with an injected `IntelligencePort` fake; no dependency on C's unfinished implementation.
3. C: extraction/search/tool-loop/evaluation tests with fake HTTP/tools and assessor; no dependency on B's database.
4. Merge C, B, then A. B's `runtime.ts` composes real providers, including C's `intelligence` export. Run the existing tests, `test:intelligence`, TypeScript, production build and browser tests. No fake port remains in live composition.
5. Rehearse the full synthetic flow with real providers configured: upload → extract → reconcile/investigate → human decision → propose/test/activate alias → reconcile unseen claims. Record actual before/after outcomes and protected counterexamples.

Keep the first end-to-end slice working before completing polish/search. A usable integrated result outranks isolated feature completion.

## Accounts and multiple computers

No provider keys are needed for independent unit tests and explicit UI preview. Live extraction/investigation use `OPENAI_API_KEY`; Jev uses the existing `TYPESAFE_API_KEY` (or existing gateway configuration); full-live storage/retrieval uses the branch's Supabase and Elasticsearch variables. B adds `RECONCILIATION_INVESTIGATION_MODE=simulated|live` and `OPENAI_INVESTIGATOR_MODEL=gpt-4.1-mini` to `.env.example`. The model default is a baseline, not a speed/quality claim; C verifies the configured model supports the required API features.

The existing `npm run demo` intentionally clears provider credentials and forces simulation. `npm run demo:jev` only makes Jev live; it does not establish live OpenAI extraction. Use the app README's explicit mixed/full-live setup to test real documents. Never commit `.env.local`, receipts from real people, service keys or provider responses containing secrets.

GitHub shares source code, migrations, fixtures and locked dependencies. It does not share each laptop's `.env.local` or `.intake-demo` database. Use separate local demo data for parallel development; use one dedicated Supabase demo project only when shared records are needed. Apply B's new migration once to that project. Never point an agent at real finance data.

Devin needs GitHub access and its own Node/npm/environment setup. Codex and Cursor likewise need their own clone and credentials if performing live calls. An account login or a teammate's shell environment does not transfer keys to another machine.

## What this packet intentionally cuts

No new SQLite backend, separate worker, generic workflow builder, payments, bank feeds, currency conversion, product UI CSV import/export, general club-spending policy, or second reconciliation type. Benchmark CSV result artifacts under `evals/results/` are allowed. Synchronous bounded requests are acceptable for this demo; surface timeouts and allow explicit retries. Keep the existing synthetic-only restriction and demo deployment limits.
