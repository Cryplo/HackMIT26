# Investigation development pack (offline)

Twenty synthetic claims with real documents, evaluator-only labels, and focused safety checks
against the production assessment path. This is **development and demo material**: it is not
independent accuracy evidence, and no label here is authoritative until a human has reviewed it.
No provider call is made by anything in this directory.

This pack is `devin-demo20-v1`, separate from the locally prepared `demo20-v1` pack. Its fixture
identities, policy assumptions and labels differ; review records and sign-offs do not transfer.
This pack keeps receipt-only claimant identity and labels itinerary resolution as conditional on
a separately reviewed policy change.

## What exists

| File | What it is |
| --- | --- |
| `documents.ts` | Deterministic PDF writer: receipts, payment confirmations, booking confirmations, itineraries. |
| `pack.ts` | The 20 cases: claim inputs, printed facts, documents, evaluator labels and dependencies. |
| `write.ts` | Separates inputs from labels, hashes documents and JSON, writes the review packet, and verifies manifest-bound human review records. |
| `harness.ts` | Runs `CoreService` over an isolated in-memory snapshot built from the pack. |
| `budget.ts` | Proposed provider-call ceiling and a ledger requiring explicit reservation before each future live request. |
| `cli.ts` | `generate`, `budget`, `review-status`. |
| `pack.test.ts`, `guards.test.ts` | 23 focused checks (below). |
| `../results/investigation/devin-demo20-20260927/` | Suggested output for seed 20260927, including `review.html`. `evals/results/` is gitignored; the command below generates it deterministically for this version. |

## Cases

10 straightforward valid claims; 2 unfamiliar hotel/USD merchants whose booking confirmation
carries the shared booking reference; 2 similar-looking but genuinely distinct train purchases;
2 duplicates of earlier purchases, each submitted as a *different* document (a payment
confirmation) after its original; 2 flight receipts with no traveler name plus an itinerary that
names the claimant; 1 genuinely incomplete receipt; 1 bus claim over the policy cap.

Case IDs (`clm-xxxxxx`) and filenames are derived from the seed and reveal neither cohort nor
expected answer, and no document contains evaluator language. Everything the app can see lives in
`inputs.json`; everything that would give the answer away lives in `labels.evaluator-only.json`.

## What the checks cover, and what they found

The 23 focused checks comprise 8 fixture/integrity checks and 15 assessment/guard checks. The
latter use the real `CoreService`, deterministic checks, retrieval and an explicit simulated Jev
fixture over an isolated `MemoryStore`. Printed original-receipt facts stand in for extraction.

Money and duplicates: overclaim, underclaim, wrong currency and cap excess are mandatory
failures; the two similar train purchases are not treated as duplicates; a duplicate's different
document still fails the duplicate check and `APPROVAL_BLOCKED` prevents a second payment for a
purchase already approved. A request for twice the original receipt total is blocked. The
harness does not load supporting documents, so these checks do **not** test double-summing in
the unimplemented supporting-document assessment path.

Evidence and revisions: evidence that changes mid-run makes the run `STALE_RUN` and nothing is
published; a stale approval attempt is `STALE_REVIEW` and records no correction; a knowledge
change after assessment blocks approval until the claim is rechecked.

Learning safety: proposals from pending or rejected source claims are refused, and an untested
alias draft cannot be activated (`STALE_RULE_TEST`). These checks do not exercise successful
alias testing/activation, disabled-rule behavior, or the positive alias lifecycle. The
unfamiliar-merchant cases stay `needs_review` with `merchant: unknown` in this baseline. The hotel/USD
`booking_reference_identity` procedure is **not implemented** (`intelligence.investigate` returns
`INVESTIGATION_UNAVAILABLE` with no steps), so its gates below are `blocked`, not `passed`.

Provider and progress failure: a failing Jev leaves semantic checks unresolved and the claim
`needs_review`; the failure is persisted as a `semantic_evaluation` decision carrying the real
error code, one run makes exactly one provider attempt, re-reading the workspace repeats no work,
a failed extraction stays failed and cannot be approved, and an aborted assessment records
`ABORTED` instead of a result.

With no investigation feature and no activated alias, 5 of the 20 cases are expected to land in
`needs_review`: both unfamiliar-merchant cases, both itinerary-identity cases and the incomplete
case. Four have conditional `expected_after_feature` labels; the genuinely incomplete case stays
unresolved. These are unreviewed development expectations, not measured model accuracy.

## Commands

```bash
cd reconciliation

# focused checks
node --conditions=react-server --import tsx --test evals/investigation/*.test.ts

# generate into a new output path (refuses any existing file or directory)
node --conditions=react-server --import tsx evals/investigation/cli.ts generate --seed 20260927 \
  --out evals/results/investigation/devin-demo20-20260927

# proposed live ceiling
node --conditions=react-server --import tsx evals/investigation/cli.ts budget

# is the pack reviewed yet?
node --conditions=react-server --import tsx evals/investigation/cli.ts review-status \
  --dir evals/results/investigation/devin-demo20-20260927

# unchanged prior comparison findings
node --conditions=react-server --import tsx --test evals/comparison/comparison.test.ts
npm run typecheck
```

## Human review, before anything live

Open `evals/results/investigation/devin-demo20-20260927/review.html`. It shows, for each case, the claim
as submitted, every original and supporting document, the policy assumptions, the expected
assessment and the written reason for it. Record agreement per case in `review.csv`, then write
`review.json` with `pack_version`, real `reviewers`, `reviewed_at`, `minutes_spent`, the three
JSON hashes from `manifest.json`, `corrections` and `open_disagreements`. Also record
`manifest_sha256`: the SHA-256 of the exact `manifest.json` file reviewed, which binds the
document inventory and every document hash. For example, compute it with
`shasum -a 256 evals/results/investigation/devin-demo20-20260927/manifest.json`.

`requireReview()` rechecks the signed manifest, its JSON hashes and every PDF against disk,
matches the document inventory to `inputs.json`, and rejects document traversal or symlink escape.
Missing or changed evidence, a changed manifest, a version mismatch or an open disagreement
invalidates review. Generation never writes `review.json`; temporary test doubles are not human
sign-off. Replacing or rehashing changed material requires fresh human review.

## Proposed provider-call ceiling

50 attempts total and 45 minutes wall clock, per `cli.ts budget`: extraction 8, Jev assessment 6,
investigation planning 6, reassessment 4, procedure test 24 (12 cases before and after for the
fixed `booking-reference-v1` suite), search 2. The future live runner must call `reserve()` before
every request, including retries and failures; that method rejects requests above each count cap.
The ledger is not wired to providers and does not enforce the proposed wall-clock deadline.
Recorded calls can include kind, case, timings, outcome, provider, model, tokens, cost and error;
complete call capture still requires runner integration. No live call may happen until a human
approves the ceiling, an isolated Supabase project exists, and count/deadline enforcement is wired.

See `gates.md` for the gate table and `recording-outline.md` for the walkthrough plan.
