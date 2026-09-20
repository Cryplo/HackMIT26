# Gate table

Status vocabulary: `passed`, `failed`, `blocked`, `not_run`. Missing execution is never a pass.
Scope: `devin-demo20-v1`, offline preparation only. Mode: `simulated` unless stated.
Record the delivered commit with each execution report; this table does not establish live behavior.

| # | Gate | Status | Mode | Command or action | Evidence | Blocker / owner |
| --- | --- | --- | --- | --- | --- | --- |
| 1a | 20-case fixture pack, documents, label separation and review-integrity checks | passed | simulated | `node --conditions=react-server --import tsx --test evals/investigation/pack.test.ts` | 8 fixture checks; temporary generated packs and tamper regressions | — |
| 1b | Human review of the pack's labels and policy assumptions | not_run | n/a | Open `review.html`, fill `review.csv`, write `review.json` including `manifest_sha256`, then `cli.ts review-status` | Actual human sign-off absent | Needs named human reviewers — team |
| 2a | Primary-receipt financial, duplicate and revision guards; rejection and failure checks | passed | simulated | `node --conditions=react-server --import tsx --test evals/investigation/guards.test.ts` | 15 focused checks; printed primary facts supplied as an extraction double | — |
| 2b | Supporting-document double-summing protection | blocked | n/a | Not tested by the receipt-only harness | No supporting documents reach its assessment snapshot | Supporting-document path not implemented — backend owner |
| 3 | Real investigation with persisted steps surviving refresh | blocked | n/a | Same suite, `the booking-reference procedure is not installed` check | `intelligence.investigate` returns `INVESTIGATION_UNAVAILABLE`, no steps | Investigation feature not implemented — backend owner |
| 4 | Reviewed procedure plus later safe reuse (`booking_reference_identity`, hotel/USD) | blocked | n/a | Fixed `booking-reference-v1` suite | Procedure surface does not exist at this commit | Depends on gate 3 — backend owner |
| 5 | Budgeted live vertical slice within the approved ceiling | not_run | live | `cli.ts budget`; future live runner must reserve every provider attempt and enforce deadline | Proposal only: 50 attempts / 45 minutes; ledger not connected to providers or wall-clock enforcement | Needs runner integration, isolated Supabase, approved ceiling, and gate 1b |
| 6 | Team UI rehearsal plus independent recording | not_run | n/a | `recording-outline.md` | — | Depends on gates 1b and 5 — team |

Notes that must not be rounded up:

- Gate 2a covers only the named guards in an isolated store with an offline Jev fixture.
  It does not test supporting-document summing, successful alias activation, disabled-rule
  application or positive procedure reuse. It says nothing about live provider accuracy.
- Gates 3 and 4 are `blocked`, not `failed`: the feature they test has not been built, and the
  checks assert its absence rather than simulating its success.
- No gate here establishes independent accuracy, even after human review and a live run. This
  remains development material; independent claims require a separate fresh reviewed held-out pack.
- This fixture version has different cases, policies and labels from local `demo20-v1`;
  neither its review record nor its accepted hashes transfer here.
