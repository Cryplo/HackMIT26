# Receipt-to-verdict cost and time comparison

This comparison answers: **On the same synthetic receipts, how much model processing time and estimated model cost does Sift use compared with one general-purpose AI call that reads the PDF and makes the verdict?** A win is a hypothesis, not a required result. A one-call baseline may beat a two-call pipeline; retain that result.

This is a standalone addition under `evals/comparison/`. It does not merge PR #3, replace the learning benchmark, mutate Supabase, change decision thresholds, or write reviewer rules. It invokes the **production** `createAssessExample` interface, `CoreService`, `DatabaseRetrieval`, `LiveJev`, and `extractReceipt` with a fresh isolated `MemoryStore`. It never implements a second Sift scorer.

Published exploratory results: [September 20, 2026 findings and evidence](findings/2026-09-20/README.md); [adversarial cohort and recheck run](findings/2026-09-20-adversarial-recheck/README.md) (also documents a Jev merchant-prompt regression that sends every valid case to review on current `main`).

## The two arms

| Stage | Sift | Direct AI baseline |
| --- | --- | --- |
| Input | Original PDF and submitted claim | The same original PDF and submitted claim |
| Extraction | Actual existing Azure/OpenAI extraction | Baseline model extracts within its single request |
| Financial checks | Existing deterministic code | Baseline model evaluates currency, amount, dates, policy and cap |
| Merchant/name/duplicates | Existing Jev questions and thresholds | Baseline model evaluates all three |
| Prior receipts | This arm's own earlier extractions, filtered by production retrieval | This arm's own earlier extractions, supplied as a complete prior list |
| Output | Recorded machine assessment and checks | Structured extracted fields, machine assessment and checks |

Each arm accumulates its own history, so Sift extraction output never helps the baseline. All prior originals precede their duplicate copies. The baseline checks prior records itself; Sift retains its normal candidate filtering. The baseline prompt matches current Sift policy and aggregation semantics; it gets no expected labels/cohorts, external tools, hidden answers or human corrections. Unknown evidence is allowed. A failed earlier baseline call marks its historical evidence incomplete on subsequent calls.

As of `59ee979`, Sift gives `fail` precedence over `unknown` and confirms duplicate PDFs by SHA-256 or corroborated receipt identity. The adapter supplies actual file hashes; both arms receive hashes of current and prior files. The baseline evaluates those hashes itself. Both arms follow the current aggregation rule. Historical runs retain their original unknown-first policy metadata. The harness reports what they actually return, including mistakes. Sift provider failures are errors, not successful `needs_review` predictions. No fuzzy human-approval interpretation is applied to an assessment.

The 50-case deterministic generator is reused from PR #3 at `ea4637bd3dea6cfdd39e04a13a7da5d8185b775b`; its helpers remain local here to avoid interfering with that open PR. Cohorts: 20 familiar valid, 10 unfamiliar valid, 8 violations, 6 incomplete and 6 exact later duplicates. Unfamiliar merchant labels may describe truth unavailable to either model; review those carefully. No alias is pre-taught. The ten-case alias activation suite and before/after learning remain separate work.

`--prepare --adversarial` appends a 10-case **adversarial cohort** (`case-51`…`case-60`) after the 50 base cases, so the base cases, their bytes and their order are identical to the default dataset while the dataset hash differs. It contains lookalike merchants that share a familiar prefix but cannot supply the category (airline cafe, hotel gift shop, station parking), a familiar receipt claimed under the wrong category, the unfamiliar train descriptor claimed as lodging (so a train-scoped alias must not vouch for it), a traveler sharing only the attendee's first name, a planted "reviewer note" inside the merchant text plus a $1 overclaim, transposed digits, one cent over the hotel cap, and a receipt dated the day before the policy window. None is approvable; a `matched` verdict on any of them is an unsafe match. Reports include a per-cohort breakdown.

## Run

From `reconciliation/`, use Node 24.11.1 (`.nvmrc`). No additional packages are required.

```sh
node --conditions=react-server --import tsx evals/comparison/cli.ts --prepare \
  --out evals/results/comparison-data --seed 20260921

# A bounded, explicitly exploratory live smoke test. Up to 9 calls.
node --env-file=.env.local --conditions=react-server --import tsx evals/comparison/cli.ts \
  --live --dataset evals/results/comparison-data --out evals/results/comparison-smoke \
  --baseline-model YOUR_AZURE_DEPLOYMENT_OR_OPENAI_MODEL \
  --max-model-calls 9 --limit 3 --exploratory

# Full reviewed run. Up to 150 calls with current production transport.
node --env-file=.env.local --conditions=react-server --import tsx evals/comparison/cli.ts \
  --live --dataset evals/results/comparison-data --out evals/results/comparison-full \
  --baseline-model YOUR_AZURE_DEPLOYMENT_OR_OPENAI_MODEL \
  --max-model-calls 150 --review evals/results/comparison-data/review.json \
  --prices evals/results/comparison-data/prices.json
```

`--prepare` is network-free. Every output directory must be new. The live command requires an explicit baseline model/deployment and model-call ceiling. Credentials follow existing `responsesConfig`: complete Azure settings take precedence; otherwise OpenAI. Jev follows production direct-key/Gateway precedence. Neither `.env.local` nor credentials are copied into artifacts.

Two humans should review `review.html`, each PDF and `policies.json`, then fill `review.template.json` as `review.json` with their names, date, minutes, and matching input/label/policy hashes. Resolve changes by preparing a new dataset/version; stale hashes are rejected. `--exploratory` allows engineering runs without this review but suppresses presentation savings headlines. `--limit` selects the first N cases (a familiar-valid smoke subset), not a representative accuracy sample.

All pipeline runs are serial, alternating which entire arm runs first per case. No warmup is silently discarded. Real provider caching may occur; usage records preserve returned cached tokens. Every network attempt reserves budget before transmission, including retries introduced by future production updates. The only harness retry is one bounded retry per arm per case when the provider answered HTTP 429, after a 20s pause; the failed attempt stays in `calls.jsonl` and stage counts, and the run's limitations record how many retries happened. SIGINT/SIGTERM stops starting new stages; in-flight calls settle under existing 25s Jev / 60s Azure timeouts. A 401/403 ends the run after that case. Partial data is saved after every stage. Exit 2 means invalid configuration, incomplete execution or case errors; exit 0 means execution completed, **not** that Sift won or a presentation claim passed.

## What is measured

- Raw extraction, reconciliation and direct-AI latency per case; receipt-to-verdict median, p95 and sample size; paired differences; serial processing total. Includes actual model round trips and local checks/retrieval, excludes app HTTP/upload, database, UI and human time. It is not a deployment/load benchmark.
- Actual provider/model, attempts, input/output tokens, cached-input tokens when returned, HTTP status, request ID and failure. Reasoning tokens are already included in output usage and are not added again. Missing usage remains null.
- Correct assessments, valid-match yield, unsafe matches, exception handling and errors. All attempted cases remain in denominators. Counts accompany time/cost metrics.
- Dated **rate-card estimated** model cost, price coverage, cost per attempt, cost per correct valid match, and actual experiment cost. This is not invoice/billed cost.

`report.md`, `summary.json`, `cases.csv`, `calls.jsonl`, `results.json` and `manifest.json` are generated automatically. Each case also has Sift frozen facts and the baseline's input/output evidence. `manifest.json` captures source hashes, commit, exact prompts, model choices, rate cards, policy/input hashes, budgets and configuration. Generated artifacts live under ignored `evals/results/`.

Both latency and cost savings headlines require a complete reviewed 50-case run, no execution errors, zero unsafe Sift matches, and Sift correctness/valid-match yield no worse than baseline on that sample. Cost headlines also require complete pricing/usage coverage. This prevents an instant failure or “send everything to review” strategy from winning. This gate is not a statistical equivalence test. Negative savings stay negative. Raw measurements remain available when the headline gate fails.

## Corroborate after a production update

Fetch and integrate upstream before running or publishing results. The current runner uses the same `core.assess` path as the application via `createAssessExample`, including error observations. Its local adapter only translates frozen facts; it does not implement verdict logic. No active alias rules are supplied in this comparison.

To isolate deterministic changes from model variation, replay the original saved extraction and Jev answers with the current engine:

```sh
node --conditions=react-server --import tsx evals/comparison/replay.ts \
  --source evals/results/comparison-full --dataset evals/results/comparison-data \
  --out evals/results/comparison-replay
```

Replay verifies frozen facts and PDF hashes, blocks network calls, and preserves recorded provider failures. It reports changed verdicts only: historical costs and latency remain historical. Follow replay with a fresh live comparison on the same dataset to measure changed prompts, provider latency, token usage, and cost. Every run records its source version and file hashes.

### Recheck after a rule or knowledge change

A recheck measures what each arm must spend to re-decide already-submitted claims when a policy or a reviewer-confirmed alias changes. Sift keeps its extraction and reruns code/Jev; a direct PDF-to-verdict baseline has no separable extraction, so it rereads every PDF.

```sh
node --env-file=.env.local --conditions=react-server --import tsx evals/comparison/cli.ts \
  --live --dataset evals/results/comparison-data --out evals/results/comparison-recheck \
  --baseline-model YOUR_AZURE_DEPLOYMENT_OR_OPENAI_MODEL \
  --max-model-calls 100 --exploratory --recheck evals/results/comparison-full --learned-alias
```

`--recheck SOURCE_RUN` requires a completed direct-PDF source run on the same frozen dataset that covers every selected case and is not itself a recheck. Per case, Sift loads the source run's `*.sift-facts.json` (re-hashed against the recorded `facts_sha256`, and its receipt hash checked against the current PDF), then runs the production `createAssessExample` path with live Jev; no extraction call is made and extraction latency/cost are recorded as 0 **by design, not as a measurement**. The baseline loads its own source `*.ai-input.json` (PDF hash re-verified), reuses that run's prior-receipt history and completeness flag, and makes one live PDF-to-verdict call. Budget is two calls per case. `--learned-alias` supplies the same scoped alias (`SYN NRTHWND 77` → Synthetic Rail, train/USD) to Sift as an `ActiveAlias` and to the baseline as `active_aliases` in its request; aliases clarify merchant identity only. Reports name the source run and commit, whether an alias was active, and first-to-last input-token growth for Jev and the baseline. Recheck runs are never presentation-eligible on their own; they are a decision-layer cost/time measurement.

## Pricing

Create `prices.json` as an array of explicit mappings, one for every observed provider + requested deployment + returned model. Example **shape only** (replace every placeholder and rate):

```json
[
  {
    "provider": "azure-openai",
    "requested_model": "YOUR_DEPLOYMENT",
    "returned_model": "EXACT_MODEL_FROM_calls.jsonl",
    "sku": "VERIFIED_METER_SKU",
    "region": "VERIFIED_REGION_OR_GLOBAL_TIER",
    "source_url": "https://azure.microsoft.com/en-us/pricing/details/azure-openai/",
    "checked_at": "2026-09-20",
    "input_usd_per_million": null,
    "output_usd_per_million": null,
    "cached_input_usd_per_million": null,
    "cache_write_usd_per_million": null,
    "cache_write_accounting": "included_in_input"
  }
]
```

Replace the null placeholders with verified nonnegative numeric rates; the validator rejects nulls. An empty rate card is the default and produces unknown cost, not free usage. Unknown cache breakdowns also suppress cost when cached/uncached rates differ. Nonzero cache-write tokens require an explicit cache-write rate and accounting rule. For OpenAI Responses the documented write rate replaces the uncached input rate for those tokens (`included_in_input`); verify the deployed provider's meter. A deployment name alone does not establish Azure SKU/region. Keep dated promotional and regular Jev rates separate; temporary free access is not permanent architectural savings. No unverified numeric rate is bundled.

Reprice saved usage without any network calls, preserving the original run:

```sh
node --conditions=react-server --import tsx evals/comparison/reprice.ts \
  --run evals/results/comparison-full --prices evals/results/comparison-data/prices.json \
  --out evals/results/comparison-full-priced
```

The repriced report includes a hash and path to its original evidence. This also lets you compare regular versus promotional prices without rerunning providers.

`prices.global-standard.example.json` contains public rates checked September 20, 2026, with the user's authorized pricing assumption: Azure Luna **Global Standard, short context, West US 3** (input $0.20/M, output $1.20/M, cache reads $0.02/M, cache writes $0.25/M). This is not a verified description of the actual deployment. Jev uses the public Gateway models API rate of $0.042/M input and $0 output, rather than the model page's temporary free promotion. Exact source query URLs are in the file; missing usage still prevents full cost coverage even with this card. You may use it via `--prices evals/comparison/prices.global-standard.example.json`.

Official sources checked during implementation: [Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [prompt cache accounting](https://developers.openai.com/api/docs/guides/prompt-caching), [Jev Gateway listing](https://vercel.com/ai-gateway/models/jev), [Gateway machine-readable rates](https://ai-gateway.vercel.sh/v1/models), [Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/azure-openai/). Verify the deployed SKU and current rates before quoting actual billing. Source URLs and checked dates are retained in the actual run's rate card.

## Presentation

Use two side-by-side pipeline descriptions, then a table showing receipt count, model/version, median/p95 latency, estimated cost per receipt, valid-match yield, unsafe matches and review rate. Add dataset/date and pricing assumptions in the footnote. Show the stage breakdown to explain where any difference comes from.

Suggested claim **only after measured results support it**: “On 50 reviewed synthetic receipts, Sift used X% less model cost and Y% less receipt-processing time than [exact model] directly reading and judging each PDF, with [counts] valid matches and [counts] unsafe matches.”

Do not say “X% cheaper than Ramp,” “hours of staff time saved,” or “fraud dollars recovered.” No competitor or human workflow is timed here. Current Sift still requires human approval for matched claims. Optional `--labor FILE` takes `manual_seconds_per_claim`, `matched_seconds_per_claim`, `exception_seconds_per_claim`, `hourly_usd` and `source`; it produces a separately labeled assumption-based scenario, never measured labor savings. No labor scenario is enabled by default.

## Verify

```sh
node --conditions=react-server --import tsx --test evals/comparison/comparison.test.ts
npm run typecheck
```

Tests include mocked end-to-end provider calls through the actual Sift engine, no network during preparation, independent baseline input/history, budget exhaustion, failures, token/cache accounting, missing prices, unsafe/incomplete headline rejection and human-time assumptions. These establish harness behavior, not live model accuracy. Existing production and package files remain unchanged.
