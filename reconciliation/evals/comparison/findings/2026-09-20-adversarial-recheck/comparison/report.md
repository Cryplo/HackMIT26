# Sift versus all-AI: cost and time

Status: **completed**. 60/60 selected cases; 60 in full dataset. Labels: **UNREVIEWED — exploratory only**.
Commit: d03015932f5b2b55c845b3b821d96893ae9e8699. Started: 2026-09-20T11:35:18.032Z. Baseline deployment/model: gpt-5.6-luna.

Sift runs actual PDF extraction followed by production CoreService/code/Jev with isolated memory storage. The direct-AI baseline independently reads each PDF, extracts fields and returns all checks/verdict in ONE call. Each arm accumulates its own prior extracted receipts in the same original order; baseline receives all its prior receipts and Sift uses production candidate filtering. Neither arm sees expected labels or the other arm’s extractions. No Ramp system was tested.
Serial concurrency 1; alternating whole-pipeline order; no discarded warmups. Sift total is extraction + reconciliation; direct-AI total is its single PDF-to-verdict call. Timings exclude upload/network-to-app/database/UI/human time. Sift reconciliation includes local candidate retrieval. These are not hosted application throughput measurements.

| Metric | Sift: code + Jev | Direct PDF-to-verdict AI |
| --- | ---: | ---: |
| Attempts | 60 | 60 |
| Errors (retained) | 0 | 0 |
| Correct assessments | 25/60 | 51/60 |
| Correct valid matches | 0/30 | 28/30 |
| Unsafe matches | 0/30 | 1/30 |
| Cases requiring exception handling | 60 | 31 |
| Reconciliation / direct-AI call median / p95 (ms) | 326.78 / 496.00 (n=60) | 3003.81 / 6374.12 (n=60) |
| Receipt-to-verdict median / p95 (ms) | 2442.19 / 3935.94 (n=60) | 3003.81 / 6374.12 (n=60) |
| Successful receipt-to-verdict median (ms) | 2442.19 (n=60) | 3003.81 (n=60) |
| Provider attempts, including extraction | 120 | 60 |
| Input / output tokens | 117577 / 17221 | 328437 / 14123 |
| Price coverage | 120/120 calls | 60/60 calls |
| Known cost subtotal (not total) | $0.020814 | $0.099048 |
| Estimated model cost, full total | $0.020814 | $0.099048 |
| Estimated model cost / attempted receipt | $0.000347 | $0.001651 |
| Estimated model cost / correct valid match | N/A | $0.003537 |

Paired successful cases: 60; median per-pair receipt-to-verdict time difference (AI minus Sift): 604.51 ms.
Actual experiment: 180 provider attempts, $0.119862 estimated cost. Each actual call is counted once here. Billed dollars are not measured.

Successfully processed, fully priced pairs ONLY (n=60): mean Sift cost $0.000347 per receipt; direct-AI $0.001651. Cost difference 78.99%. This excludes failed/unpriced pairs and must not be described as total-run savings. Success means a valid response, not a correct verdict.

Input tokens per call, first → last successful case: Sift Jev 1626 → 1622; direct-AI 1473 → 9447. Growth reflects each arm's own accumulated history in this run, not a general scaling law.

Observed serial processing-time difference: 26.18%. Observed estimated-cost difference: 78.99%. Positive means Sift used less; negative means more. These descriptive comparisons do not establish equal decision quality.

**Presentation claim gate:** BLOCKED. Require a complete, reviewed full dataset, no errors, zero Sift unsafe matches, and no worse observed correctness or valid-match yield than the baseline. Raw results remain above.
Eligible cost reduction: N/A. Eligible modeled serial processing-time reduction: N/A. Negative values mean Sift was worse. Missing prices never become zero cost.

### Cohort breakdown

| Cohort | Cases | Sift | Direct PDF-to-verdict AI |
| --- | ---: | --- | --- |
| valid | 20 | 0/20 correct, 0 unsafe, 0 errors | 19/20 correct, 0 unsafe, 0 errors |
| unfamiliar | 10 | 0/10 correct, 0 unsafe, 0 errors | 9/10 correct, 0 unsafe, 0 errors |
| violation | 8 | 8/8 correct, 0 unsafe, 0 errors | 6/8 correct, 0 unsafe, 0 errors |
| incomplete | 6 | 6/6 correct, 0 unsafe, 0 errors | 6/6 correct, 0 unsafe, 0 errors |
| duplicate | 6 | 6/6 correct, 0 unsafe, 0 errors | 6/6 correct, 0 unsafe, 0 errors |
| adversarial | 10 | 5/10 correct, 0 unsafe, 0 errors | 5/10 correct, 1 unsafe, 0 errors |

An unsafe outcome is a `matched` verdict on a case whose expected label is not approvable. Adversarial cases are all non-approvable by construction.

### Provider stage breakdown

| Stage | Attempts | Median ms | p95 ms | Estimated model cost |
| --- | ---: | ---: | ---: | ---: |
| Sift extraction | 60 | 2109.64 | 3621.19 | $0.016669 |
| Sift Jev | 60 | 325.54 | 494.87 | $0.004144 |
| Direct PDF-to-verdict AI | 60 | 3002.57 | 6373.17 | $0.099048 |

Per-call provider round-trip timings; Sift code/retrieval overhead is included in the reconciliation timing above. These stage costs sum to the actual experiment, not one pipeline.

### Price assumptions

- azure-openai / gpt-5.6-luna → gpt-5.6-luna: ASSUMED GPT-5.6 Luna short context Global Standard; actual deployment tier unverified; ASSUMED westus3. USD per million: input 0.2, output 1.2, cached 0.02, cache write 0.25 (included_in_input). [Source](https://prices.azure.com/api/retail/prices?$filter=contains%28meterName%2C%20%275.6%20luna%20ShortCo%27%29%20and%20contains%28meterName%2C%20%27Std%20Gl%27%29%20and%20armRegionName%20eq%20%27westus3%27%20and%20currencyCode%20eq%20%27USD%27), checked 2026-09-20.
- vercel-typesafe / typesafe-ai/jev → typesafe-ai/jev: Gateway public models API listed rate; excludes temporary free promotion; Gateway. USD per million: input 0.041999999999999996, output 0, cached 0.041999999999999996, cache write unspecified (unspecified). [Source](https://ai-gateway.vercel.sh/v1/models), checked 2026-09-20.

### Human time and money

All current Sift claims still require human approval. Matched cases are not assumed to need zero human time. Labor savings below, if supplied, are a scenario using explicit assumptions, not observed reviewer savings or competitor measurements.
Not supplied; no human time or labor-dollar savings claimed.

### Limitations

- Production createAssessExample/CoreService/LiveJev run with isolated MemoryStore; database, HTTP intake/upload, narration and UI performance are excluded.
- Sift extracts then runs code/Jev. Direct-AI reads the original PDF and returns its own extracted fields and verdict in one call. Each arm uses its own accumulated historical extractions; an earlier extraction failure can affect later duplicate evidence.
- No active aliases are supplied to either arm. Unfamiliar-merchant cases may legitimately need evidence unavailable in extracted fields.
- No learning activation, competitor execution, or observed human timing is included. This does not replace the separately planned learning benchmark.
- No deliberate warmup is discarded. Provider cache state is uncontrolled; returned usage is retained where available.
- Price estimates exclude hosting, storage, development agents, tax and reviewer labor. Deployment names require explicit SKU/region/model mappings. Pricing file is preserved with the run.
- Provider failures and malformed outputs remain errors; retry attempts count. Unknown token/cache breakdowns suppress affected cost totals.
- This run uses fail-first aggregation and production confirmed-duplicate detection. The baseline receives the same byte hashes and instructions. Jev thresholds remain .70/.85.
- A small synthetic run does not establish production accuracy, statistical equivalence, or Ramp savings.
