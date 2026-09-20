# Gate table

Status vocabulary: `passed`, `failed`, `blocked`, `not_run`. Missing execution is never a pass.
Commit: `HEAD` of this branch (offline scope only). Mode: `simulated` unless stated.

| # | Gate | Status | Mode | Command or action | Evidence | Blocker / owner |
| --- | --- | --- | --- | --- | --- | --- |
| 1a | 20-case pack generated with real documents, neutral IDs, evaluator-only labels, hashes | passed | simulated | `cli.ts generate --seed 20260927` | `evals/results/investigation/demo20-20260927/manifest.json` | — |
| 1b | Human review of the pack's labels and policy assumptions | not_run | n/a | Open `review.html`, fill `review.csv`, write `review.json`, then `cli.ts review-status` | `review.json` (absent) | Needs two named reviewers — team |
| 2 | Financial, duplicate and revision guards | passed | simulated | `node --conditions=react-server --import tsx --test evals/investigation/guards.test.ts` | 15/15 checks pass | — |
| 3 | Real investigation with persisted steps surviving refresh | blocked | n/a | Same suite, `the booking-reference procedure is not installed` check | `intelligence.investigate` returns `INVESTIGATION_UNAVAILABLE`, no steps | Investigation feature not implemented — backend owner |
| 4 | Reviewed procedure plus later safe reuse (`booking_reference_identity`, hotel/USD) | blocked | n/a | Fixed `booking-reference-v1` suite | Procedure surface does not exist at this commit | Depends on gate 3 — backend owner |
| 5 | Budgeted live vertical slice within the approved ceiling | not_run | live | `cli.ts budget`, then a slice run under `CallLedger` | Proposal only: 50 attempts / 45 minutes | Needs an isolated Supabase project, approved ceiling, and gate 1b — user |
| 6 | Team UI rehearsal plus independent recording | not_run | n/a | `recording-outline.md` | — | Depends on gates 1b and 5 — team |

Notes that must not be rounded up:

- Gate 2 passing says the guards hold on this pack in an isolated store with an offline Jev
  fixture. It says nothing about live provider accuracy.
- Gates 3 and 4 are `blocked`, not `failed`: the feature they test has not been built, and the
  checks assert its absence rather than simulating its success.
- No gate here may be reported as accuracy. The pack is development material until gate 1b and
  an isolated live run exist.
