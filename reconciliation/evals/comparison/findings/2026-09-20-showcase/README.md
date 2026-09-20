# Showcase run: the 14 backend claims (exploratory, demo scale)

The 14 submissions in the Supabase project are the `showcaseFixture()` demo seed: synthetic travellers (`@example.invalid`), synthetic vendors (Northstar Airlines, Maple Rail, Harbor Reservations, Cedar Bus) and PDFs generated from `src/lib/demo/showcase.ts`. `--prepare --showcase` freezes exactly those 14 claims and their original PDF bytes as a benchmark dataset, and [`supabase.json`](supabase.json) records that every frozen PDF's SHA-256 matched the `receipts` row for its submission in the live project (`status: verified`, 14/14, 14 submissions in the backend). The live run then uses the same isolated in-memory storage as every other benchmark run; nothing is written to Supabase.

Labels ([`expected.json`](expected.json)) are the assistant's reading of each case title in the fixture, under the rule that **neither arm receives supporting documents (booking confirmations, itineraries) or learned procedures**. They are unreviewed; the presentation gate stays **blocked**. With 14 cases this is an illustration on the demo data, not a statistic. Production commit `f929a6c`; baseline `gpt-5.6-luna`; Jev via Gateway; rate card `prices.global-standard.example.json` (estimates, not billing).

Two runs, 70 provider attempts, zero errors, about $0.05 of estimated model spend:

1. [`comparison/`](comparison/report.md): standard run (Sift extraction + Jev; direct-AI PDF-to-verdict).
2. [`recheck/`](recheck/report.md): `--recheck --learned-alias` with the showcase alias (`Harbor Reservations` → Harbor Hotel, hotel/USD). Sift reused saved extraction; direct AI reread every PDF.

## Results

| Metric | Sift (comparison) | Direct AI (comparison) | Sift (recheck) | Direct AI (recheck) |
| --- | ---: | ---: | ---: | ---: |
| Provider attempts | 28 | 14 | 14 | 14 |
| Correct assessments | 12/14 | 9/14 | 12/14 | 9/14 |
| Correct valid matches | 3/5 | 5/5 | 3/5 | 4/5 |
| Unsafe matches | 0/9 | 5/9 | 0/9 | 4/9 |
| Receipt-to-verdict median / p95 | 3.42 s / 4.52 s | 3.37 s / 5.62 s | 0.34 s / 0.50 s | 3.24 s / 6.03 s |
| Total serial processing time | 47.9 s | 51.5 s | 4.7 s | 51.2 s |
| Estimated model cost, 14 receipts | $0.0100 | $0.0152 | $0.0011 | $0.0157 |
| Input tokens per call, first → last | Jev 1792 → 1760 | 1649 → 6198 | Jev 1792 → 1760 | 1675 → 6224 |

Observed differences (Sift relative to direct AI): comparison run 34.4% less estimated cost and 7.1% less serial time; recheck 92.9% less cost and 90.8% less time. As in the synthetic runs, recheck Sift is the Jev decision layer only because extraction is reused by design.

## Case by case

| Case | Fixture title | Expected | Sift | Direct AI (comparison / recheck) |
| --- | --- | --- | --- | --- |
| 01 | Ordinary flight | approved | matched | matched / matched |
| 02 | Ordinary train / lookalike A | approved | needs_review | matched / matched |
| 03 | Hotel learning source (descriptor, booking in app) | needs_review | needs_review | **matched / matched** |
| 04 | Later hotel / learned procedure | needs_review | needs_review | **matched / matched** |
| 05 | Conflicting hotel confirmations | needs_review | needs_review | **matched / matched** |
| 06 | Hotel booking missing | needs_review | needs_review | **matched / matched** |
| 07 | Traveler missing / receipt-only policy | needs_review | needs_review | needs_review / needs_review |
| 08 | Policy-authorized itinerary identity (itinerary not supplied) | needs_review | needs_review | needs_review / needs_review |
| 09 | Overclaim: $190.00 requested, $180.00 receipt | flagged | flagged | **matched** / flagged |
| 10 | Hotel cap exceeded | flagged | flagged | flagged / flagged |
| 11 | First claim for a purchase | approved | matched | matched / matched |
| 12 | Same purchase, payment document (duplicate) | flagged | flagged | flagged / flagged |
| 13 | Distinct lookalike train B | approved | needs_review | matched / needs_review |
| 14 | Unassessed bus claim | approved | matched | matched / matched |

- The direct-AI baseline approved every "Harbor Reservations" claim. In the product these are the cases that must wait for a matching booking confirmation, and case 05 has two conflicting confirmations. Sift's merchant check returned `unknown` for all four, which is the designed behaviour discussed in the [adversarial findings](../2026-09-20-adversarial-recheck/README.md).
- The baseline approved a $10 overclaim on the first pass (its own read gave the receipt total as 190.00) and flagged it on the second: single-call verdicts vary between identical runs. Sift's deterministic amount check fails on `19000 != 18000` regardless of the model.
- Sift's two misses are the Maple Rail cases: Jev answered `pass` with probability 0.80 and 0.84 against the 0.85 production threshold, so both went to review. Case 13, which shares traveler, date and amount with case 02, was not treated as a duplicate by either arm.
- The learned alias did not change any Sift verdict: the descriptor cases still lack the booking reference the production procedure requires, so `needs_review` is unchanged and correct under these labels.

## What can be said today

- On the actual demo data, Sift reached 12/14 expected verdicts with 0 unsafe approvals; the direct-AI baseline reached 9/14 with 4–5 unsafe approvals, all of them cases the demo is designed to hold.
- Rechecking the 14 claims after a knowledge change cost Sift $0.0011 and 4.7 s versus $0.0157 and 51 s for the baseline.
- Not claimable: statistical accuracy (n=14, unreviewed labels), billed dollars, human time, anything about Ramp.

Validation: 13 benchmark tests passed (adds a showcase dataset/verification test), `npm run typecheck` passed. Raw evidence per run: `report.md`, `summary.json`, `cases.csv`, `calls.jsonl`, `manifest.json`, compact `results.json`; dataset side: `expected.json`, `dataset-manifest.json`, `supabase.json`.
