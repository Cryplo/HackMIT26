# Sift hold-out benchmark — run live-exploratory-2

Source commit cc2108a59fcd5d80a83f79291062f4a20b422cd3; dataset evals/results/dataset-20260921 (inputs unreviewed, labels unreviewed).
Providers: extraction live Jev, decisions live Jev, retrieval Supabase candidate scan, storage Supabase.
Human review: NOT PERFORMED — this run is not a validated benchmark.
Rule: none. Isolation: not established.

### Baseline

| Metric | Value |
| --- | --- |
| Incorrect matches (expected flagged/needs_review, observed matched) | 0 / 20 |
| Violations caught | 2 / 8 |
| Duplicates caught | 3 / 6 |
| Valid cases needing investigation | 29 / 30 |
| Valid cases incorrectly flagged | 1 / 30 |
| Cases with errors (kept in denominators) | 0 / 50 |
| Latency median / p95 (n=50) | 1309.334291 ms / 6480.670289 ms |
| Unsafe matches | none |

| expected \ observed | matched | flagged | needs_review |
| --- | ---: | ---: | ---: |
| approved | 0 | 1 | 29 |
| flagged | 0 | 5 | 9 |
| needs_review | 0 | 0 | 6 |

### After learning

Not run.


### Learning

Only one phase was executed.

### Safety

No hard check flipped fail to pass.

### Model usage

| Phase | Model | Calls | Input tokens | Output tokens | Estimated cost |
| --- | --- | ---: | ---: | ---: | ---: |
| — | — | 0 | unknown | unknown | unknown |

### Limitations

- EXPLORATORY RUN: unreviewed dataset against a deployment that fails benchmark preflight. These numbers describe this deployment only and are not benchmark accuracy.
- Reviews API reports contract_version=absent; the benchmark requires the v2 contract.
- GET /api/rules returned HTTP 404; a draft rule cannot be tested or activated.
- Rule activation and the after phase were not executed by this runner.

### Non-passing checks across the 50 cases

| Check | Verdict | Count |
| --- | --- | ---: |
| `amount` | fail | 2 |
| `amount` | unknown | 2 |
| `currency` | fail | 2 |
| `duplicate` | fail | 15 |
| `duplicate` | unknown | 32 |
| `merchant` | unknown | 21 |
| `name` | unknown | 2 |
| `policy` | unknown | 3 |
| `policy_cap` | fail | 2 |
| `receipt_date` | fail | 2 |
| `receipt_date` | unknown | 1 |
| `semantic_evaluation` | unknown | 3 |

`duplicate` and `merchant` unknowns are the confidence gate (<0.70 confidence or <0.85 on the
chosen option), not provider outages: the live project still holds claims from an earlier run, so
duplicate evidence is not isolated. Per-case outcomes are in
`2026-09-20-live-exploratory-cases.csv`.

Reproduce:

```
npm run eval:heldout -- --generate --seed 20260921 --out evals/results/dataset-20260921
npm run eval:heldout -- --live --exploratory --seed 20260921 \
  --base-url http://127.0.0.1:3100 --dataset evals/results/dataset-20260921 \
  --out evals/results/live-exploratory-2
```
