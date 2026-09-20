# Shared context — every agent reads this

## Product and user

We are four technical HackMIT teammates building an event travel reimbursement review desk. An attendee submits a reimbursement claim plus one receipt. A finance reviewer checks that the receipt supports the claim and that the expense fits the event's policy. The system extracts evidence, checks deterministic financial rules, uses Jev for ambiguous structured judgments, investigates unresolved cases, and learns narrowly scoped merchant aliases from reviewed corrections.

The visible experience should follow [the Ramp-style visual contract](ramp-ui.md): compact work queue, obvious exceptions, original receipt beside claimed/extracted values, and clear human actions. It includes actual product screenshot references, shadcn Radix/Nova setup and concrete theme/layout choices. Product name: Sift. Keep this branding consistent across the interface and documentation.

Primary demo story: a strange hotel billing descriptor causes an exception. The agent inspects relevant evidence and explains the unresolved merchant. A human reviews it, approves the supported claim and proposes a merchant alias. The system tests the candidate on valid and adversarial examples, activates it only if it improves results without regressions, and handles new receipts for that merchant with less human intervention. Overclaims and duplicate receipts remain flagged.

## Existing baseline

Repository `Cryplo/HackMIT26`, reviewed SHA `97ac7ec8d72f845e257d9822665645c1c7311c35`, now on `main` (originally reviewed on the subsequently removed `dylanli` branch). Application root: `reconciliation/`. Existing pages: `/business-demo`, `/submit`, `/demo`. Existing APIs: `/api/reviews`, `/api/submissions`, `/api/receipts/[id]`, `/api/reconcile`, `/api/corrections`. Next 16.3.5, React 19.3.0, TypeScript, Tailwind 4, Zod, Supabase, PGlite, node:test/tsx, Playwright.

Read `reconciliation/AGENTS.md` and relevant bundled Next documentation before changing Next APIs. Reuse current code and native fetch. The baseline's 30 core/intake/SQL tests, five browser tests, typecheck and production build passed in review. Live providers were not reverified during that review. Preserve useful test coverage, updating expectations only for the deliberate v2 semantics below.

## Decisions already made

- Keep the backend and current route paths. Add small modules/endpoints for the missing features. Do not rebuild to match the older greenfield packet.
- Travel only: flight, hotel, train, bus, other; USD; one PDF/PNG/JPG per claim; current 8 MiB limit. Requested and receipt totals must match exactly in integer cents. Partial reimbursement and line-item allocation are outside this version.
- Keep current policy caps/date windows as seeded data. Preserve nulls for unknown receipt values. A printed traveler/guest name remains evidence used by the travel checks.
- Separate **assessment** (`matched`, `flagged`, `needs_review`, or null) from **human decision** (`pending`, `approved`, `rejected`). No model approves or pays anything. An approval means authorized for reimbursement, not money transferred.
- Known failure takes precedence over unknown: fail → flagged; otherwise unknown or no checks → needs_review; otherwise matched. Exclude human decisions and the aggregate `overall_status` row from this reducer.
- Human decisions survive reanalysis. Concurrent reviewer actions use an integer revision. Stale requests return 409. Exact duplicate approval is checked transactionally.
- Learning is an immutable exact vendor/category/currency alias with draft/test/activate/disable states. Never learn arbitrary code, a broad regex, a fee rule, or a relaxation of money/currency/cap/duplicate checks.
- Keep arithmetic/checks deterministic. Jev handles structured uncertainty and semantic row search. OpenAI handles receipt extraction and bounded investigation. Investigation recommends actions and cites evidence; it does not change receipt facts or human decisions.
- Search is read-only and returns match/no_match/uncertain for bounded structured rows. No general chat, SQL execution, aggregation answers or hidden actions.
- Providers and synthetic mode are explicit. No fabricated live traces, latency, tokens, confidence, receipts, outcomes or savings.

## Ownership (all paths relative to reconciliation/)

| Owner | Exclusive files/responsibility |
| --- | --- |
| A | `src/components/**`; `src/app/globals.css`, `layout.tsx`, `page.tsx`; `src/app/business-demo/**`, `src/app/submit/**`, `src/app/demo/**`; `src/lib/dashboard/**`; `tests/e2e.spec.ts`; new UI tests under `tests/ui/**`; `playwright.config.ts`; `public/ui/**` |
| B | `src/app/api/**`; all `src/lib/core/**` **except `jev.ts`**; all `src/lib/intake/**` **except `extract.ts`**; `supabase/**`; `scripts/**`; `src/lib/demo/**`; all backend stores, schema and metrics persistence; app README and `.env.example`; legacy `src/lib/contracts.ts`; `next.config.ts` only if required |
| C | `src/lib/core/jev.ts`; `src/lib/intake/extract.ts`; new `src/lib/intelligence/**`, including `learning.ts`, ten-case `build_rule_suite`/`evaluate_rule` activation safety and intelligence tests |
| Devin benchmark | Exclusively `evals/**`: 50-case external benchmark fixture generator, CLI seed, benchmark/report runner and browser tests under `evals/**` (not A's `tests/ui/**`) |
| Integration owner | frozen `src/lib/review-contracts.ts`; package/lock/TypeScript config, `.nvmrc`, `.gitignore`, shadcn initialization before handoff, this packet |

You are not alone in the codebase. Do not revert others' edits. Do not change another owner's files. In particular, A cannot implement a second backend in route files; C cannot write the database; B cannot rewrite Jev or receipt extraction. Missing upstream implementations are handled by injected test doubles or explicit preview, not by fake production fallbacks.

The [Devin benchmark brief](../2026-09-19-sift-benchmark.md) is separate from C's ten-case rule activation safety work. It tests real existing APIs and reports missing behavior; no production changes may be made solely to fake passing tests. The brief is prepared only: no Devin task has been dispatched and no benchmark runner has been implemented by this handoff.

## Fixed cross-agent seams

`contracts.ts` is copied to `src/lib/review-contracts.ts` before branching. A imports its DTOs. B validates them at HTTP boundaries and produces them. C implements its `IntelligencePort` and exports `intelligence` from `src/lib/intelligence/index.ts`.

C must preserve the baseline exports and existing call sites of `extractReceipt`, `LiveJev`, `SimulatedJev`, `questions` and `validateAnswers`, which B code/tests consume. One planned backward-compatible extension is `Jev.evaluate(state, runId, log, signal?: AbortSignal)`: C adds the optional fourth argument to the interface/live implementation, and B forwards its outer deadline there. Existing three-argument calls still work. B is free to refactor its own internals, but only the live composition file imports C's new runtime export; service tests inject the frozen port. Shared types are type-only imports so builds/tests need no keys at import time.

`api.md` defines status transitions, payloads, errors, limits, source-of-truth ownership and rule activation gates. It takes precedence over legacy API examples for v2. Unknown fields are rejected for new mutation bodies.

## Sponsor intent

- **Maximor:** a financial workflow that identifies failures, chooses evidence to investigate, remembers reviewed corrections and measurably improves on unseen examples. Fixed OCR/checks with a decorative activity feed is insufficient for our intended pitch.
- **Cognition:** B should use Devin for substantive regression-driven platform work; the separate benchmark handoff can optionally contribute development evidence once implemented and verified. Keep session/PR links, the initial failing reproducer, the implementation and actual verification. Prepared instructions alone are not implementation evidence. Use its documented audit/fix/verify workflow if available in your account; do not make the product depend on a Devin runtime API.
- **OpenAI:** use live OpenAI extraction/investigation and Codex for C's development. Keep concrete evidence of both. Do not imply editor use alone supplies runtime API use.
- **Ramp:** make review faster and expose preventable duplicate/overclaimed reimbursements. Report measured demo effort and outcomes, not invented customer savings.
- **Dropbox/Long Lake:** useful secondary positioning around organizing messy evidence and showing a skeptic a useful outcome. Existing Elasticsearch may support an Elastic entry if actually used and demonstrated.
- Cursor remains a suitable tool for A. Do not add unrelated Grok/space features to chase SpaceXAI.

This is the strategy established by the earlier sponsor review, not a fresh ruling on eligibility or prize stacking. The fourth teammate checks submission rules and collects evidence. These tasks do not require sponsor APIs beyond the actual providers already specified.

## Definition of done

Each agent reports its branch/commit, changed files, checks actually run, provider calls live versus simulated, missing credentials and known limits. The final integrated demo must show a real uploaded synthetic receipt, an original document preview, an evidence-backed exception, a preserved human decision, a passing rule test, improvement on unseen receipts, and protected bad cases. Multiple people can develop through GitHub; production state and secrets are not Git artifacts.
