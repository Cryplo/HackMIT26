# Sift versus all-AI: cost and time

Status: **completed**. 14/14 selected cases; 14 in full dataset. Labels: **UNREVIEWED — exploratory only**.
Commit: f929a6c321082abe04d9ec2034b40db851d1794a. Started: 2026-09-20T12:11:01.362Z. Baseline deployment/model: gpt-5.6-luna.

**Recheck run.** Source run: /home/ubuntu/repos/HackMIT26/reconciliation/evals/results/showcase-run (commit f929a6c321082abe04d9ec2034b40db851d1794a). Sift reused each case's saved extraction and reran code/Jev only (Sift extraction latency and cost are 0 by design here, not measured as 0). Direct-AI reread every PDF with its source-run history. One scoped alias was active for both arms: "Harbor Reservations" → Harbor Hotel (hotel, USD). This models a policy or knowledge change applied to already-extracted claims.

Sift runs actual PDF extraction followed by production CoreService/code/Jev with isolated memory storage. The direct-AI baseline independently reads each PDF, extracts fields and returns all checks/verdict in ONE call. Each arm accumulates its own prior extracted receipts in the same original order; baseline receives all its prior receipts and Sift uses production candidate filtering. Neither arm sees expected labels or the other arm’s extractions. No Ramp system was tested.
Serial concurrency 1; alternating whole-pipeline order; no discarded warmups. Sift total is extraction + reconciliation; direct-AI total is its single PDF-to-verdict call. Timings exclude upload/network-to-app/database/UI/human time. Sift reconciliation includes local candidate retrieval. These are not hosted application throughput measurements.

| Metric | Sift: code + Jev | Direct PDF-to-verdict AI |
| --- | ---: | ---: |
| Attempts | 14 | 14 |
| Errors (retained) | 0 | 0 |
| Correct assessments | 12/14 | 9/14 |
| Correct valid matches | 3/5 | 4/5 |
| Unsafe matches | 0/9 | 4/9 |
| Cases requiring exception handling | 11 | 6 |
| Reconciliation / direct-AI call median / p95 (ms) | 343.45 / 499.24 (n=14) | 3243.69 / 6026.75 (n=14) |
| Receipt-to-verdict median / p95 (ms) | 343.45 / 499.24 (n=14) | 3243.69 / 6026.75 (n=14) |
| Successful receipt-to-verdict median (ms) | 343.45 (n=14) | 3243.69 (n=14) |
| Provider attempts, including extraction | 14 | 14 |
| Input / output tokens | 26486 / 1512 | 44147 / 3896 |
| Price coverage | 14/14 calls | 14/14 calls |
| Known cost subtotal (not total) | $0.001112 | $0.015710 |
| Estimated model cost, full total | $0.001112 | $0.015710 |
| Estimated model cost / attempted receipt | $0.000079 | $0.001122 |
| Estimated model cost / correct valid match | $0.000371 | $0.003927 |

Paired successful cases: 14; median per-pair receipt-to-verdict time difference (AI minus Sift): 2928.96 ms.
Actual experiment: 28 provider attempts, $0.016822 estimated cost. Each actual call is counted once here. Billed dollars are not measured.

Successfully processed, fully priced pairs ONLY (n=14): mean Sift cost $0.000079 per receipt; direct-AI $0.001122. Cost difference 92.92%. This excludes failed/unpriced pairs and must not be described as total-run savings. Success means a valid response, not a correct verdict.

Input tokens per call, first → last successful case: Sift Jev 1792 → 1760; direct-AI 1675 → 6224. Growth reflects each arm's own accumulated history in this run, not a general scaling law.

Observed serial processing-time difference: 90.75%. Observed estimated-cost difference: 92.92%. Positive means Sift used less; negative means more. These descriptive comparisons do not establish equal decision quality.

**Presentation claim gate:** BLOCKED. Require a complete, reviewed full dataset, no errors, zero Sift unsafe matches, and no worse observed correctness or valid-match yield than the baseline. Raw results remain above.
Eligible cost reduction: N/A. Eligible modeled serial processing-time reduction: N/A. Negative values mean Sift was worse. Missing prices never become zero cost.

### Cohort breakdown

| Cohort | Cases | Sift | Direct PDF-to-verdict AI |
| --- | ---: | --- | --- |
| valid | 5 | 3/5 correct, 0 unsafe, 0 errors | 4/5 correct, 0 unsafe, 0 errors |
| corroboration | 4 | 4/4 correct, 0 unsafe, 0 errors | 0/4 correct, 4 unsafe, 0 errors |
| incomplete | 2 | 2/2 correct, 0 unsafe, 0 errors | 2/2 correct, 0 unsafe, 0 errors |
| violation | 2 | 2/2 correct, 0 unsafe, 0 errors | 2/2 correct, 0 unsafe, 0 errors |
| duplicate | 1 | 1/1 correct, 0 unsafe, 0 errors | 1/1 correct, 0 unsafe, 0 errors |

An unsafe outcome is a `matched` verdict on a case whose expected label is not approvable. Adversarial cases are all non-approvable by construction.

### Provider stage breakdown

| Stage | Attempts | Median ms | p95 ms | Estimated model cost |
| --- | ---: | ---: | ---: | ---: |
| Sift extraction | 0 | N/A | N/A | N/A |
| Sift Jev | 14 | 341.39 | 491.50 | $0.001112 |
| Direct PDF-to-verdict AI | 14 | 3242.64 | 6025.58 | $0.015710 |

Per-call provider round-trip timings; Sift code/retrieval overhead is included in the reconciliation timing above. These stage costs sum to the actual experiment, not one pipeline.

### Price assumptions

- azure-openai / gpt-5.6-luna → gpt-5.6-luna: ASSUMED GPT-5.6 Luna short context Global Standard; actual deployment tier unverified; ASSUMED westus3. USD per million: input 0.2, output 1.2, cached 0.02, cache write 0.25 (included_in_input). [Source](https://prices.azure.com/api/retail/prices?$filter=contains%28meterName%2C%20%275.6%20luna%20ShortCo%27%29%20and%20contains%28meterName%2C%20%27Std%20Gl%27%29%20and%20armRegionName%20eq%20%27westus3%27%20and%20currencyCode%20eq%20%27USD%27), checked 2026-09-20.
- vercel-typesafe / typesafe-ai/jev → typesafe-ai/jev: Gateway public models API listed rate; excludes temporary free promotion; Gateway. USD per million: input 0.041999999999999996, output 0, cached 0.041999999999999996, cache write unspecified (unspecified). [Source](https://ai-gateway.vercel.sh/v1/models), checked 2026-09-20.

### Human time and money

All current Sift claims still require human approval. Matched cases are not assumed to need zero human time. Labor savings below, if supplied, are a scenario using explicit assumptions, not observed reviewer savings or competitor measurements.
Not supplied; no human time or labor-dollar savings claimed.

### Limitations

- Production createAssessExample/CoreService/LiveJev run with isolated MemoryStore; database, HTTP intake/upload, narration and UI performance are excluded.
- Recheck: Sift reuses the source run's saved extraction (no extraction call) and reruns code/Jev. Direct-AI rereads the original PDF with the same prior-receipt history it had in the source run. Extraction failures in the source run stay failures here.
- One human-confirmed scoped vendor alias is active for both arms: Sift through production rule state, direct-AI through active_aliases in its input. Aliases clarify merchant identity only.
- No learning activation, competitor execution, or observed human timing is included. This does not replace the separately planned learning benchmark.
- No deliberate warmup is discarded. Provider cache state is uncontrolled; returned usage is retained where available.
- Price estimates exclude hosting, storage, development agents, tax and reviewer labor. Deployment names require explicit SKU/region/model mappings. Pricing file is preserved with the run.
- Provider failures and malformed outputs remain errors; retry attempts count. Unknown token/cache breakdowns suppress affected cost totals.
- This run uses fail-first aggregation and production confirmed-duplicate detection. The baseline receives the same byte hashes and instructions. Jev thresholds remain .70/.85.
- A small synthetic run does not establish production accuracy, statistical equivalence, or Ramp savings.
