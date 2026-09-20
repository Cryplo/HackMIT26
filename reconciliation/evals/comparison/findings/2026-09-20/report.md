# Sift versus all-AI: cost and time

Status: **completed**. 50/50 selected cases; 50 in full dataset. Labels: **UNREVIEWED — exploratory only**.
Commit: 59ee979598534b2483b1049150a21a135e05d175. Started: 2026-09-20T06:04:09.393Z. Baseline deployment/model: gpt-5.6-luna.

Sift runs actual PDF extraction followed by production CoreService/code/Jev with isolated memory storage. The direct-AI baseline independently reads each PDF, extracts fields and returns all checks/verdict in ONE call. Each arm accumulates its own prior extracted receipts in the same original order; baseline receives all its prior receipts and Sift uses production candidate filtering. Neither arm sees expected labels or the other arm’s extractions. No Ramp system was tested.
Serial concurrency 1; alternating whole-pipeline order; no discarded warmups. Sift total is extraction + reconciliation; direct-AI total is its single PDF-to-verdict call. Timings exclude upload/network-to-app/database/UI/human time. Sift reconciliation includes local candidate retrieval. These are not hosted application throughput measurements.

| Metric | Sift: code + Jev | Direct PDF-to-verdict AI |
| --- | ---: | ---: |
| Attempts | 50 | 50 |
| Errors (retained) | 0 | 0 |
| Correct assessments | 39/50 | 47/50 |
| Correct valid matches | 19/30 | 29/30 |
| Unsafe matches | 0/20 | 0/20 |
| Cases requiring exception handling | 31 | 21 |
| Reconciliation / direct-AI call median / p95 (ms) | 297.34 / 469.73 (n=50) | 2542.24 / 4999.14 (n=50) |
| Receipt-to-verdict median / p95 (ms) | 2286.72 / 4944.13 (n=50) | 2542.24 / 4999.14 (n=50) |
| Successful receipt-to-verdict median (ms) | 2286.72 (n=50) | 2542.24 (n=50) |
| Provider attempts, including extraction | 100 | 50 |
| Input / output tokens | 115218 / 14511 | 237620 / 11009 |
| Price coverage | 100/100 calls | 50/50 calls |
| Known cost subtotal (not total) | $0.018259 | $0.072608 |
| Estimated model cost, full total | $0.018259 | $0.072608 |
| Estimated model cost / attempted receipt | $0.000365 | $0.001452 |
| Estimated model cost / correct valid match | $0.000961 | $0.002504 |

Paired successful cases: 50; median per-pair receipt-to-verdict time difference (AI minus Sift): 215.15 ms.
Actual experiment: 150 provider attempts, $0.090868 estimated cost. Each actual call is counted once here. Billed dollars are not measured.

Successfully processed, fully priced pairs ONLY (n=50): mean Sift cost $0.000365 per receipt; direct-AI $0.001452. Cost difference 74.85%. This excludes failed/unpriced pairs and must not be described as total-run savings. Success means a valid response, not a correct verdict.

Observed serial processing-time difference: 9.17%. Observed estimated-cost difference: 74.85%. Positive means Sift used less; negative means more. These descriptive comparisons do not establish equal decision quality.

**Presentation claim gate:** BLOCKED. Require a complete, reviewed full dataset, no errors, zero Sift unsafe matches, and no worse observed correctness or valid-match yield than the baseline. Raw results remain above.
Eligible cost reduction: N/A. Eligible modeled serial processing-time reduction: N/A. Negative values mean Sift was worse. Missing prices never become zero cost.

### Provider stage breakdown

| Stage | Attempts | Median ms | p95 ms | Estimated model cost |
| --- | ---: | ---: | ---: | ---: |
| Sift extraction | 50 | 2013.56 | 4563.48 | $0.014081 |
| Sift Jev | 50 | 294.34 | 464.00 | $0.004178 |
| Direct PDF-to-verdict AI | 50 | 2514.40 | 4996.27 | $0.072608 |

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
