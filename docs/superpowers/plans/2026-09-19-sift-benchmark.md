# Sift reproducible benchmark — Devin implementation plan

> Prepared handoff, not an executed benchmark or a dispatched Devin session. Start from `feat/ramp-ui` at `917f25f` or a reviewed descendant containing the Sift UI. Merge the completed B/C integration before live evaluation. Read [shared context](2026-09-19-dylanli/context.md), [API behavior](2026-09-19-dylanli/api.md), [frozen types](2026-09-19-dylanli/contracts.ts), and [human testing guide](../../SIFT_TESTING.md).

**Goal:** Measure whether one reviewed merchant alias improves reimbursement assessment on 50 unseen synthetic claims without weakening financial or duplicate checks.

**Architecture:** Reuse the app's actual upload, reconciliation and rule APIs. Generate receipts and a separate human-reviewed answer key offline. Freeze evidence and reference data for a paired before/after run; produce per-case results and an honest aggregate report. Keep rehearsal data separate from the final evaluation.

**Tech stack:** Existing Node 24.11.1, TypeScript, native fetch/FormData, node:test, Playwright, and `receiptPdf`. No new database, PDF library, evaluation service, or model framework.

## Ownership and current prerequisites

- Devin exclusively owns `reconciliation/evals/**`: generation, seeding CLI, benchmark, metrics, tests, documentation and ignored artifacts. Agent C no longer owns this directory.
- C still owns `src/lib/intelligence/learning.ts` and the ten-case rule activation suite. Those safety checks are not the external 50-case benchmark.
- B owns production APIs, stores, migrations, usage persistence and runtime composition. A owns UI and its existing browser tests. Do not fix a failing benchmark by rewriting their code or relaxing their checks. Report a concrete failing input to the responsible owner.
- The integration owner retains package/lock files and frozen contracts. `eval:heldout` is already declared and points to `evals/run-heldout.ts`; its implementation does not yet exist. `evals/results/` is already ignored.
- `917f25f` has working v1 backend paths plus the new v2 UI/preview. `/api/rules`, v2 reviews and the integrated investigator/search are pending. Reject a live run against v1; never reinterpret `status=approved` as a human decision or implement a second backend under `evals/`.
- Offline generation, answer review and harness tests can start immediately. Live benchmarking additionally needs v2 integration, a reviewed source claim/draft rule, live extraction and Jev credentials, and observable execution modes. If investigation is measured, it must also be live and labeled.
- You are not alone in this repository. Use a separate clone/worktree and branch; preserve other agents' changes. Keep keys, ledgers and provider responses out of commits.

## Deliverable files

| File under `reconciliation/evals/` | Responsibility |
| --- | --- |
| `dataset.ts` | Deterministic synthetic receipt/claim generation; write input and answer files separately |
| `run-heldout.ts` | Existing npm entry point; offline default, explicit seeding/live modes, HTTP orchestration |
| `report.ts` | Pure calculations plus JSON/CSV/Markdown export |
| `benchmark.test.ts` | Small invariant and protocol tests using node:test and mocked HTTP |
| `playwright.config.ts`, `rehearsal.spec.ts` | Integrated browser verification, configured explicitly without editing A's test configuration |
| `README.md` | Exact setup, generation, human-review, seed and evaluation commands |
| `results/<dataset-or-run-id>/` | Ignored receipts, answer keys, review attestations, manifests, raw results, reports and recordings |

Merge small helpers into these files where possible. Do not generate a generic benchmark framework.

## Task 1 — generate reviewable data, with no network calls

- [ ] Reuse `receiptPdf(fields: ParsedReceipt): Buffer` from `src/lib/demo/samples.ts`. Import the existing receipt type; use Node crypto to hash actual PDF bytes. Every document must say it is synthetic and invalid for payment.
- [ ] A fixed seed must generate identical input JSON, receipt bytes and neutral case IDs. Do not depend on current date, random UUID generation or locale for the dataset. The server assigns persisted UUIDs during upload; record that mapping separately.
- [ ] Generate exactly the following **50 scored claims**, plus a separate source/correction example and eight rehearsal cases. Training, rehearsal and C's activation suite are never included in the 50.

| Cohort | Count | Human-reviewed expected assessment, unchanged between phases |
| --- | ---: | --- |
| Straightforward valid claims | 20 | `matched` |
| Valid purchases with an unfamiliar merchant descriptor | 10 | `matched`; lack of knowledge may cause baseline investigation |
| Financial/policy violations | 8 | `flagged` |
| Later duplicate claims | 6 | `flagged` |
| Incomplete/ambiguous claims | 6 | `needs_review` |

- [ ] Make the ten unfamiliar purchases share one proposed exact merchant/category/USD alias, with new travelers, receipt numbers, dates/amounts and receipt hashes compared with the source and activation suite. A learned exact alias cannot generalize to unrelated descriptors; do not promise that it does.
- [ ] The eight violations include two amount mismatches, two over-cap purchases, two non-USD receipts, and two dates outside policy. Include the learned descriptor on financial counterexamples so learning really has an opportunity to make an unsafe mistake. Keep all other evidence valid where possible.
- [ ] Each of the six duplicate claims reuses the **exact receipt bytes** of an earlier original in the 30 valid claims; it does not create six additional scored originals. At least two duplicate groups use the unfamiliar descriptor. Preserve claimant details so the duplicate check is the relevant failure. Store duplicate relationships only in evaluator metadata, not vendor names or uploaded filenames.
- [ ] The six incomplete/ambiguous cases include missing totals, missing printed traveler names and unrelated ambiguous descriptors. Supply a PDF for every case: the upload API requires one file. A missing receipt belongs in C's internal activation suite, not a nonexistent HTTP intake path. Keep unrelated deterministic fields valid so expected `needs_review` is defensible.
- [ ] Use the actual seeded policy caps/date window; freeze their IDs and contents. Keep expected assessments the same before and after. Never relabel a valid unfamiliar claim as `needs_review` merely because that is what the baseline predicts.
- [ ] Write `inputs.json`, numbered PDFs, `expected.json`, and a readable `review.html`/CSV separately. Only neutral IDs, ordinary claim fields and receipt bytes reach the app; never upload cohort names, expected outcomes, source truth, “should fail” filenames or answer-key text. The final runtime request builder must whitelist input fields rather than spreading evaluator objects.
- [ ] Eight rehearsal cases must use different names, amounts, receipt IDs and an independent merchant alias. Cover clean, duplicate, source correction, new alias purchase, overclaim, over-cap, incomplete evidence and out-of-scope alias use. Their answers may be used to debug implementation; the final 50 may not.

**Human gate:** Ask the team to review all 50 claims against the source PDFs and policy before any final model run. Record corrections, reviewer names, review time and reviewed dataset/label SHA-256 values in `review.json`. Do not fabricate their approval. Freeze the files after review. If a label is later discovered to be wrong, preserve the original run, record the correction and invalidate/version that evaluation; don't quietly improve its score.

**Runnable checks:** Repeated generation has identical hashes; scored counts are 20/10/8/6/6; all six duplicate hashes match their originals; no source/rehearsal/activation-suite receipt hash appears in the final set; an upload request contains only the seven documented multipart fields. Run with:

```sh
node --conditions=react-server --import tsx --test evals/benchmark.test.ts
```

## Task 2 — seed safely for humans and the evaluator

- [ ] Default `npm run eval:heldout` generates files only. Explicit `--generate --seed 20260919 --out evals/results/dataset-v1` does the same. Refuse to overwrite a reviewed dataset or previous results.
- [ ] Implement `--seed-rehearsal --live --base-url <origin> --out <new-run-directory>` to upload the separate rehearsal pack through `POST /api/submissions`. Print each case-to-submission mapping, receipt URL and the workspace URL. This is an explicit provider-spending command when extraction is live. Do not silently switch providers or populate parsed fields from the answer key.
- [ ] Generated PDFs are not recognized by today's simulated extractor, which knows only bundled sample hashes. In demo mode they may produce unknown fields. Document that outcome; do not extend the production extractor with answer-key shortcuts to make new seeds pass.
- [ ] Seed the final 50 only as part of an authorized final live run, after `review.json` passes hash validation. Use the exact multipart fields in the frozen API: `attendee_name`, `email`, `amount_requested_minor`, `currency`, `category`, `origin_location`, `file`. Send `Origin` matching the configured server origin.
- [ ] Upload originals before duplicate copies and serialize uploads. Because the API assigns times/UUIDs, read actual rows afterward and verify every original sorts before its copy by `(submitted_at,id)`. If a timestamp tie gives the wrong ordering, mark preparation invalid; don't alter expected labels or pretend array order controls the backend.
- [ ] Work in a dedicated local data directory or dedicated synthetic Supabase project. Never reset a teammate's shared demo, delete unknown rows, or reuse an old half-populated run as a fresh experiment. Save the ID mapping after each successful upload so errors retain evidence. Retrying a POST is not automatically safe: it may create a second claim.
- [ ] Generation/seed commands must leave financial outcomes to the actual application. Seeding is not evidence of successful extraction, reconciliation or learning.

## Task 3 — run the paired experiment through the integrated app

Proposed command to implement, **not currently available**:

```sh
npm run eval:heldout -- --live \
  --dataset evals/results/dataset-v1 \
  --review evals/results/dataset-v1/review.json \
  --base-url http://127.0.0.1:3000 \
  --rule-id <human-reviewed-draft-rule-uuid> \
  --out evals/results/<new-run-id>
```

- [ ] Preflight `contract_version===2`, needed rule routes, provider execution modes, reviewed hashes, policy snapshot, clean evaluation namespace, source approval and draft version/scope. The draft must match the reserved alias in the dataset; no equivalent alias may already be active. Block benchmark mode against `?preview=1`, v1, fake intelligence or simulated extraction/Jev. Label local retrieval separately if using the supported mixed-provider local configuration.
- [ ] A human approves the **separate source example** and creates the draft before baseline. Keep that approval/draft and its supporting evidence present throughout both phases. Do not approve or reject any of the 50 benchmark claims.
- [ ] Upload and extract each final receipt once. Keep the actual extraction output, including errors; do not replace it with expected parsed fields or retry until the model happens to read it correctly. Record per-field extraction discrepancies separately from reconciliation results. Preserve incomplete rows in the denominator.
- [ ] Freeze the case IDs, bytes/hashes, parsed evidence, policies, reference corpus, duplicate links, human decisions, configured models/prompts and row processing order. Include the five preexisting seed rows in the recorded reference snapshot if present, but exclude them from scored claims. Keep retrieval/index configuration fixed.
- [ ] Baseline: reconcile the 50 IDs sequentially, one request per case, in the frozen order. Save returned run IDs, checks, assessment, investigation, errors and timing immediately. Record actual successful snapshots; don't query only the final state after both phases.
- [ ] Test the human-created draft through B's real ten-case test endpoint, supplying current `expected_version`. If it fails or errors, preserve the report and stop before activation. Do not tune the alias or rerun its gate until it passes; report `activation_blocked` with no after-phase metrics.
- [ ] Activate only the passing current draft via B's API. This is the one allowed learning change. Record returned rule/version/knowledge revision and the actual gate report; don't directly edit storage, call the legacy `vendor_alias` correction route or inject a fabricated passing test.
- [ ] After: reconcile the **same 50 persisted IDs** in the same order. Do not reupload, re-extract, reorder duplicates, approve the originals or change reference records. Assert expected knowledge change and otherwise unchanged input evidence/human decisions before each phase. Save outcomes even if learning makes them worse.
- [ ] Verify production assessment consumes fixed receipt/claim/reference facts, not prior evaluation outcomes as new training examples. If runtime retrieval reads changing assessment history, the comparison is confounded: stop or use two isolated copies of the same quiescent local-store snapshot. Copy the whole store with its server stopped, never just `core-state.json`; B owns any required production support. Report the chosen isolation method and hashes.
- [ ] Use monotonic wall timing for each upload/extraction and reconciliation request. OCR happens once in this paired design, so report its cost/time separately. Do not call the shorter after-phase a full upload-to-decision speedup.
- [ ] Read actual usage through an existing supported store/read path or a local read-only collector under `evals/`. Today local core calls are in `core-state.json` and intake calls in `*.usage.json`; Supabase uses `model_calls`. Verify the integrated storage shape before use. Compare call IDs against the pre-phase snapshot to avoid counting old usage twice; include retries and failures. Keep nullable rule-test calls isolated by running no concurrent unrelated work.
- [ ] Separate extraction, before assessment/investigation, rule-test/learning and after assessment/investigation usage. Unknown tokens/costs stay null with an explanation. Cost estimates require a dated price source; do not invent tokens or report unavailable usage as zero. If unavailable, mark usage collection incomplete rather than adding an unreviewed production endpoint.
- [ ] Use bounded HTTP timeouts and report a transport error as an error. Do not drop failed cases or silently convert provider errors into successful evaluations. Emit partial artifacts on interruption; a failed/partial run is not a completed benchmark.

## Task 4 — metrics, invariants and retained evidence

Export `results.json`, `cases.csv` and `report.md`. Include source commit, dataset/labels/policies hashes, provider names/modes/models, retrieval/storage mode, timestamps, case/receipt/run mapping, rule provenance and all known limitations.

| Metric | Definition |
| --- | --- |
| Incorrect matches | Expected `flagged` or `needs_review`, actual `matched`; show count out of all 20 non-match cases |
| Violations caught | Actual `flagged` among the eight financial/policy violations; also list any unsafe match |
| Duplicates caught | Actual `flagged` among the six later duplicate copies |
| Valid cases needing investigation | Actual `needs_review` among the 30 valid cases; show actual investigation invocation separately |
| Valid cases incorrectly flagged | Actual `flagged` among those 30; don't hide these inside a review-reduction claim |
| Learning benefit and regressions | Paired per-case changes, especially the ten unfamiliar purchases; list every worsened result |
| Latency | Per-stage per-case values, median and p95 with sample size; report failures/timeouts separately |
| Model usage | Actual calls/tokens by model and phase, unknown values explicit; no assumed zero cost |

Include a 3×3 expected/observed confusion matrix plus a separate error/missing count, all denominators, and all 50 case rows. A valid case that becomes matched after learning is a measured result, never a hard-coded expectation of the runner. Record human decisions independently; machine matching must not change pending decisions or move money.

Hard regression gates: an alias must never make a failed amount, currency, policy/date/cap or exact-duplicate check pass. Check the actual evidence, not only the overall assessment. Any affected case or unexpected human decision makes safety verification fail even if aggregate accuracy rises. An honestly measured poor benchmark is still a delivered benchmark; do not alter code, thresholds or labels based on final-set performance and rerun under the same evaluation identity. Debug on rehearsal/development cases; a subsequent quality claim needs a new frozen hold-out version and disclosure of earlier runs.

Small required harness tests: identity/order survives both phases; a failed activation gate prevents activation; changed receipts/policies/hashes reject comparison; provider errors remain counted; a stubbed unsafe alias increases incorrect matches and fails the safety report; usage is counted once by ID; exported CSV escapes commas/quotes/newlines. Mock only transport for these checks. Mocked success is not live accuracy evidence.

## Task 5 — Devin and human verification

- [ ] Run the existing Node, TypeScript, build and browser checks; run C's intelligence tests only after its implementation exists. Run your additional node:test file explicitly; don't leave tests undiscovered. Use `npx playwright test --config evals/playwright.config.ts` for your integrated rehearsal checks.
- [ ] After integration, test the real browser flow on **rehearsal data**: upload → original receipt → extraction → assessment/investigation → human source approval → propose/test/activate alias → recheck unseen rehearsal purchase. Also show an overclaim and later duplicate remaining blocked. Refresh/restart to verify persistence; use two tabs to test stale-review conflicts without losing notes.
- [ ] Ask Devin to record the actual browser flow and retain its session, PR, commit, initial failure, fix and test results for Cognition. [Devin documents browser testing and recordings](https://docs.devin.ai/work-with-devin/testing-and-recordings). Use truthful live/simulated labels; a recording of a preview is not provider validation.
- [ ] Team members independently repeat the walkthrough from [SIFT_TESTING.md](../../SIFT_TESTING.md). Have someone who did not write the code operate the UI. Get a teammate to rerun the benchmark from the frozen dataset in a fresh environment; compare input hashes and reported methodology, not an assumption that nondeterministic providers must return identical scores.
- [ ] Preserve every completed or failed run. Keep raw artifacts private/ignored and attach reviewed synthetic reports/recordings to the PR/session for team review. Do not accidentally publish keys, env values or provider authorization headers. No implementation is complete merely because a report contains attractive numbers.

## Delivery and launch prompt

Open a PR from your own branch against the integration branch specified by the team. Do not merge automatically. Include exact commands, completed offline/live gates, human review status, unresolved B/C dependencies, input/report hashes, metrics including regressions, and the browser recording. If blocked on backend integration or credentials, deliver the offline generator/harness and name the missing prerequisites; do not claim a live benchmark.

Copy into Devin when ready to start a session:

> Implement `docs/superpowers/plans/2026-09-19-sift-benchmark.md` in Cryplo/HackMIT26, starting from the latest `feat/ramp-ui` or its integrated descendant. You exclusively own `reconciliation/evals/`; Agent C retains the internal ten-case rule suite. Start with offline generation and tests. Give us the 50-case receipt/answer review pack before final live evaluation. Preserve fixed evidence/order and all unfavorable results. Do not change production APIs, finance checks, UI, contracts or another owner's files to force a pass. Once the real v2 integration and credentials are available, test the app in your browser and send the recording, PR and reproducible reports. Report blocked prerequisites explicitly.
