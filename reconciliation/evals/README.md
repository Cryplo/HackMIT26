# Sift hold-out benchmark

Implements the measurement described in `docs/superpowers/plans/2026-09-19-sift-benchmark.md`: does one reviewed merchant alias improve assessment of 50 unseen synthetic claims without weakening financial or duplicate checks?

Everything here is evaluator code. It talks to the application only through `POST /api/submissions`, `POST /api/reconcile` and `GET /api/workspace/reviews`, and it never writes to a store, never edits production behaviour, and never uses the answer key to build a request.

## Commands

```bash
npm run eval:heldout                                         # offline: generate the dataset, no network, no provider spend
npm run eval:heldout -- --generate --seed 20260919 --out evals/results/dataset-20260919
npm run eval:heldout -- --seed-rehearsal --live --base-url http://127.0.0.1:3000 --out evals/results/rehearsal-1
npm run eval:heldout -- --live --base-url <origin> --dataset <dir> --review <dir>/review.json --out evals/results/run-1
npm run eval:heldout -- --live --exploratory --base-url <origin> --dataset <dir> --out evals/results/exploratory-1
node --conditions=react-server --import tsx --test evals/benchmark.test.ts
```

The default is generation. Live modes require `--live` plus `--base-url`; generation refuses to overwrite an existing dataset or run directory, and results land in the git-ignored `evals/results/`.

## Dataset

`dataset.ts` is a fixed-seed generator: the same seed reproduces the same claims, the same case IDs and byte-identical PDFs (via the product's own `receiptPdf`, which stamps `SYNTHETIC RECEIPT - NOT VALID FOR PAYMENT`). 50 scored claims:

| cohort | n | expected |
| --- | ---: | --- |
| straightforward valid | 20 | matched (`approved`) |
| valid, unfamiliar merchant descriptor `SYN NRTHWND 77` | 10 | matched |
| financial/policy violations (2 overclaim, 2 over cap, 2 non-USD, 2 outside the policy window) | 8 | flagged |
| later duplicates reusing an earlier original's exact bytes | 6 | flagged |
| incomplete or ambiguous receipts | 6 | needs_review |

Six of the eight violations and four of the six duplicates carry the learned descriptor, so an unsafe alias has a real chance to show itself. A separate `source-01` example and a nine-case rehearsal pack (different descriptor, `SYN STHWND 12`) are generated outside the scored set; no scored receipt shares a hash with them or with a bundled demo sample.

`inputs.json` holds only what is uploaded — the seven multipart fields `attendee_name`, `email`, `amount_requested_minor`, `currency`, `category`, `origin_location`, `file`. Cohorts, expected outcomes, duplicate links and printed fields live only in `expected.json`. `review.html` and `review.csv` are the human review artifacts.

## Human review gate

A live evaluation requires a `review.json` next to the dataset listing real reviewers and the `inputs.json`/`expected.json` SHA-256 hashes they signed off on. Stale hashes, an empty reviewer list, or a seed that no longer reproduces the reviewed inputs abort the run. The expected labels are human truth and are never rewritten to match what the system produced.

## Exploratory mode

`--exploratory` measures a deployment that cannot satisfy the benchmark: it runs without `review.json` and continues past failed preflight gates. Its artifacts record `inputs_sha256: unreviewed`, `review: null`, and a leading limitation stating the numbers are not benchmark accuracy. Use it to characterise a deployment, never to report benchmark results.

One such run against the local demo app (simulated extraction, simulated decisions, demo store) put all 50 cases in `needs_review` with every deterministic and Jev check `unknown`: demo extraction recognises only bundled sample hashes, so freshly generated receipts extract as all-null and the engine fails closed. That is the expected demo-mode behaviour, and it is why the numbers say nothing about assessment quality.

## Current status: offline only

The benchmark has **not** been run. Preflight against the app on this branch (`main` behaviour, local demo deployment) reports the live prerequisites that do not exist yet:

- `GET /api/workspace/reviews` does not report `contract_version` (the brief requires the v2 contract) or per-provider execution modes, so a run could not be honestly labelled live or simulated.
- `GET /api/rules` is not implemented, so a draft alias rule cannot be created, gate-tested or activated. The only learning path today is the legacy `vendor_alias` correction route, which the brief forbids for this experiment.
- The local deployment reports `demo_mode: true`; demo extraction only recognises bundled sample hashes, so freshly generated receipts extract as all-null and every case would land in `needs_review` regardless of merchant learning. A live run needs live extraction and live Jev credentials, which are not provisioned here.

So the runner ships with the preflight that refuses, writes `preflight.json` naming each missing prerequisite, and exits non-zero. Nothing in this directory fabricates results.

## Known v1 divergence to expect when it does run

`overall()` returns `needs_review` whenever any check is `unknown`, and a receipt dated outside the policy window matches no policy row, producing `unknown` rather than `fail`. The two out-of-window violations are therefore expected (by human review) to be `flagged` but will be reported as `needs_review` by today's engine. That is a real finding about the product and is reported as such — the labels are not bent to match it.

## Metrics

`report.ts` is pure: given cases and phase outcomes it produces incorrect matches, violations caught, duplicates caught, valid claims needing investigation, valid claims incorrectly flagged, a 3×3 expected/observed confusion matrix, per-case latency median and p95, model usage by phase, paired improvements and regressions, and a safety verdict. Errors are counted separately and stay in the denominator; unknown usage or cost is printed as `unknown`, never as zero. The safety check fails the run if any of `amount`, `currency`, `policy`, `receipt_date`, `policy_cap` or `duplicate` flips `fail` to `pass` after activation, no matter what happens to headline accuracy.
