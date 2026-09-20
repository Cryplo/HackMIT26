# Devin work prompt: benchmark, verify and record Sift

**Prepared 2026-09-20; implementation assignment, not a dispatched session or passing report.** Read [README.md](README.md) and [00-contracts.md](00-contracts.md) first. They are canonical for ownership, API payloads, guards and revisions; older [testing notes](../SIFT_TESTING.md) and [benchmark proposals](../superpowers/plans/2026-09-19-sift-benchmark.md) are background. Inspect current `main`; planned endpoints are not proof of implementation.

Deliver a reproducible benchmark, integration verification and complete recorded demo across five milestones: **safe approval; real scoped learning; measured results; understandable review/retry/export; independent human and Devin replay**. Label every gate `passed`, `failed`, `blocked` or `not_run`, with commit, mode, command and evidence. Preserve unfavorable results. P1 review-only custom checks need separate coverage; exclude them from the 50-case headline. Autonomous investigation is not P0.

## Ownership and delivery

Own only **`reconciliation/evals/**`**: fixtures, separate expected labels, runner/reporting, your `node:test` and Playwright configuration/specs, replay instructions and evidence. Reuse Node 24, TypeScript, native fetch/FormData/crypto, installed Playwright and `receiptPdf`. No dependencies, substitute engine or changes to production/UI/DB/contracts/packages/scripts/other owners' tests. C owns the ten-case activation suite. The existing `eval:heldout` script points to your missing `evals/run-heldout.ts`.

You are not alone. Use a separate clone on `main`; no branches/worktrees, force-push or unrelated edits. Request the integration owner's serialized delivery slot; follow README's commit/fetch/integration sequence, never push automatically. Record starting/delivered SHAs and scoped diff/hash. A PR link is evidence only if one actually exists.

For production defects, return the smallest reproduction, expected/actual behavior, failing HTTP/log evidence, commit and recommended smallest owner fix. Continue independent harness work; retest the returned owner patch. Production implementation by Devin requires **explicit ownership reassignment first**. Retain the diagnose → human review → owner fix → Devin verification history and distinguish authorship.

## Starting state and isolation

The [seed guide](../../reconciliation/scripts/SEED_REHEARSAL.md) records **20 rehearsal claims already seeded, 21 shared claims total** including one preserved upload. Parsed fields are `SIMULATED/FIXTURE`; the six preview examples are another dataset. Never reseed/reset shared storage, overwrite decisions or count rehearsal/preview results as unseen accuracy. The guide's legacy alias instructions are superseded: `POST /api/corrections` must reject `vendor_alias` with **410 LEGACY_ALIAS_DISABLED**, not activate learning.

Prefer fresh isolated local file storage. Record all reference rows, including automatically initialized samples. Use a separate synthetic Supabase project only when allocated. Benchmark snapshots are read-only; never restore over a person's newer decision. `npm run demo` simulates providers and cannot establish live accuracy.

Follow canonical setup with Azure **OpenAI** extraction and Gateway Jev (`JEV_MODEL=typesafe-ai/jev`); no non-OpenAI Azure deployment or silent substitution. Verify actual deployment/model/channel, PDF support and secret presence without printing values; direct Jev keys can override Gateway. Local storage's `demo_mode` is not provider provenance. Elasticsearch is unnecessary. Missing capabilities, null assessment/unavailable required scoring and provider failures stay blocked/error/unknown, never simulated success.

Preflight all six capability flags (`rule_learning`, `extraction_retry`, `export`, `custom_checks`, `duplicate_links`, `knowledge_revisions`), treating absence as false. Require complete `coverage` for whole-snapshot measurements. Optional investigation may truthfully remain unavailable. Start offline while backend dependencies are incomplete.

## A. Offline fixtures and review gate

Suggested small files: `dataset.ts`, `run-heldout.ts`, `report.ts`, `benchmark.test.ts`, `http-safety.test.ts`, `playwright.config.ts`, `rehearsal.spec.ts`, `README.md`. Outputs belong in ignored `evals/results/`.

Generate deterministic, visibly synthetic PDFs, `inputs.json`, evaluator-only `expected.json` and readable review sheets. Fixed seed means identical bytes/hashes. Neutral IDs/filenames reveal no labels. Whitelist intake's seven fields: `attendee_name`, `email`, `amount_requested_minor`, `currency`, `category`, `origin_location`, `file`. Never send expected answers/cohorts or answer-key duplicate relationships in model inputs, production records or UI. Production-derived hash/corroborated duplicate evidence is allowed: derive `facts.exact_duplicate_ids` through shared production logic from actual frozen evidence/reference order, never from expected labels.

Exactly **50 scored claims**:

| Cohort | Count | Expected assessment |
| --- | ---: | --- |
| Straightforward valid | 20 | matched |
| Valid unfamiliar merchant | 10 | matched |
| Financial/policy violations | 8 | flagged |
| Later duplicates | 6 | flagged |
| Incomplete/ambiguous | 6 | needs_review |

- Ten unfamiliar purchases share one exact hotel/USD alias, with new traveler/receipt/date/amount identities versus the separate source correction and C's fixed ten activation cases. Source, activation, rehearsal and three smoke receipts are disjoint from the final set.
- Eight violations: two amount mismatches, two over-cap, two non-USD, two outside policy dates. Include the learned descriptor on counterexamples; use frozen actual policy caps/window and exact-cap/one-cent-over boundaries.
- Six later copies reuse exact PDF bytes of earlier originals among the 30 valid claims; at least two groups use the unfamiliar descriptor. Preserve claim facts and order; include a renamed file. No additional scored originals.
- Include distinct valid purchases sharing merchant/date/amount but different receipt numbers. Ambiguous cases include missing totals/travelers and unrelated descriptors; every case has a PDF. Unknown is not zero.

Keep printed-field truth separate from assessment labels. Freeze normalization rules for minor-unit amount/currency/date/receipt number and merchant/name accuracy; count invented missing values and extraction errors.

**Human gate:** Two teammates review all 50 PDFs/policies/labels, resolve disagreements and cross-check financial/duplicate cases. Save reviewers/time/amendments and input/PDF/label/policy SHA-256 hashes in `review.json`; freeze before final predictions. Never invent sign-off or relabel valid unfamiliar claims to match baseline predictions. Later label changes invalidate/version the evaluation; retain prior runs.

Implement this exact CLI contract from `reconciliation/`; these commands are proposals, not existing functionality:

```sh
npm run eval:heldout -- --prepare --seed 20260920 --out evals/results/dataset-v1
npm run eval:heldout -- --live --phase smoke --dataset evals/results/dataset-v1 --base-url http://127.0.0.1:3000 --out evals/results/smoke-v1 --max-model-calls=12
npm run eval:heldout -- --live --phase baseline --dataset evals/results/dataset-v1 --review evals/results/dataset-v1/review.json --rule-id RULE_UUID --base-url http://127.0.0.1:3000 --out evals/results/baseline-v1 --max-model-calls=200
npm run eval:heldout -- --live --phase after --baseline evals/results/baseline-v1 --base-url http://127.0.0.1:3000 --out evals/results/after-v1 --max-model-calls=150
# Save the actual rehearsal reviews response as rehearsal-snapshot.json first.
npm run eval:heldout -- --prepare --kind search --snapshot evals/results/rehearsal-snapshot.json --seed 20260920 --out evals/results/search-v1
npm run eval:heldout -- --live --phase search --dataset evals/results/search-v1 --review evals/results/search-v1/review.json --base-url http://127.0.0.1:3000 --out evals/results/search-run-v1 --max-model-calls=40
```

No arguments means offline preparation with the shown seed/destination; never overwrite an existing output. `--prepare` is network-free and mutually exclusive with `--live`. Reject unknown flags, missing phase arguments and nonpositive budgets. `RULE_UUID` is the human-reviewed draft. After-phase inherits frozen metadata from `--baseline`. Live requires an explicitly isolated target and matching Origin. Exit 0 means completed/passing; document separate nonzero failed/blocked/interrupted exits and always retain partial artifacts.

Budgets are ceilings, not promised sufficiency. Before each phase print configuration, bounded HTTP timeout and planned worst-case provider attempts, including retries, search batches and activation tests. Reserve fanout before each action. If fanout/usage cannot support a hard cap, emit `blocked_budget` and request owner instrumentation; HTTP requests are not model calls. No automatic ambiguous POST retries, extra probes or model comparisons. Check saved mappings first: retrying intake can create another claim.

## B. Smoke and HTTP safety

Send three distinct clean/unfamiliar/violation smoke PDFs through real intake, Azure extraction and workspace reconciliation. Record bytes, parsed fields, checks, usage and still-pending decisions. This may precede final-label review. Test independently available components while learning is blocked; fixture parsing and preview's 8/10 → 10/10 never count as live evidence.

Read existing core `{core,routes,workspace,integration,database,claim-search}.test.*`, intake and dashboard tests; add only missing checks under `evals/`. Current legacy tests demonstrate direct alias learning, not new safety compliance. After B's guard patch, verify **real HTTP** requests against an isolated app process:

- Reproduce the legacy cap-failure approval bypass through `/api/corrections`; assert the same guarded result as workspace decisions, required revision, no unsafe write, and exact 410 rejection of legacy aliases. Cover canonical mandatory guard failures and legitimate note-based merchant/name ambiguity resolution.
- Concurrent duplicate approvals, including separate service instances, cannot both succeed. Stale decisions/publication/tests, source withdrawal and disable obey canonical atomic revisions. Recheck never rewrites human decisions. Test all rule transitions through real endpoints with server-bound reports, not caller-authored proof.
- Retry uses canonical `{expected_review_revision}` on the same original, only while decision is pending and no operation active. Stale/concurrent attempts fail; timeouts/429/malformed responses preserve evidence history and visible failures. Inject faults through existing test seams, not live quota exhaustion.
- Export uses canonical `{snapshot_token,submission_ids}`, exact column order/download headers, 1–1000 unique IDs, stale/foreign-ID rejection, selected possible matches only, empty unknown amounts, quoting and formula safety. Coverage and snapshot tokens must include relevant knowledge/config revisions.
- Confirmed duplicate links require canonical evidence; possible candidates remain distinct. Exercise renamed copies, purchase lookalikes, folio subtotal/tax/total and ambiguous refunds without claiming perceptual detection/refund accounting. Receipt/vendor instructions cannot mutate decisions/rules.
- Refresh/restart preserves notes, rules, decisions and receipt hashes. Search failure/malformed IDs/failed batch is explicit; empty corpus makes zero calls and stale/over-limit requests do not silently truncate.

Simulated fault tests prove software behavior only. Keep failing-before/passing-after evidence; production owners update obsolete tests. Do not weaken expected safety to preserve old behavior.

## C. Frozen paired benchmark through the real scorer

Use B's **`createAssessExample(core, observe?)`** from `src/lib/core/evaluation.ts`: the real financial/duplicate/Jev engine operating only on supplied facts, reference claims and active aliases. It must not load unrelated state or write claims/runs/decisions/corrections. The one-argument factory and returned `AssessExample` callback remain compatible for C. Devin supplies the optional observer and saves every `EvaluationObservation`: submission/alias IDs, nullable assessment, actual checks, already-logged `model_calls` with stable IDs, latency and error code, attributed to its own run/phase. Use these observations for protected-check regressions and actual usage; never invent diagnostics from `Assessment` alone or duplicate provider logs. Usage has null run IDs rather than invalid foreign keys. The runner and app use the same isolated provider/store configuration. Missing scorer/observations block dependent metrics; never implement a substitute. Respect AbortSignal and documented in-flight cancellation limits.

1. Human approves the separate source with a note and proposes the scoped draft before baseline; approval alone does not teach. Verify no equivalent alias is active. Do not approve/reject the 50 cases.
2. Upload/extract the 50 once, serially, originals before copies. Save mappings and errors immediately; verify persisted `(submitted_at,id)` ordering. Freeze actual bytes/parsed facts, policies, full reference corpus/order, human decisions and models/prompts. Never substitute expected extraction or retry until it improves.
3. Baseline scores those frozen cases in order via `createAssessExample`, saving every response/check/error immediately. Explicit supplied reference facts prevent prior assessment outcomes contaminating later inputs. Read-only snapshots never restore state or overwrite decisions.
4. Through `/api/rules/:id/test` then `/activate`, test/activate the reviewed draft with `{expected_rule_version}` and canonical freshness checks. Failed/errored/stale activation stops after-phase. Preserve failure; no final-set tuning or repeated attempts to select a pass.
5. Score identical facts/reference order again with only reviewed active-alias knowledge changed. Verify unchanged human decisions and input hashes. Report all 50 attempts, errors and paired changes. HTTP/UI rehearsal separately verifies that persisted reconciliation consumes the same production logic.

Any protected-check regression or changed human decision fails safety regardless of aggregate improvement. Debug on rehearsal data; final-set-driven fixes require a new frozen evaluation version and disclosure. Do not reset shared state or copy partial stores to manufacture comparability.

## D. Search and honest measurement

Freeze/review search labels from the **actual complete review projection**, not facts absent from model input. Twelve queries: hotel claims; paraphrase; greater-than amount; at-least amount; hotels above amount; requested versus receipt amount; matched-but-pending; human-approved; missing total; approve all hotels; total spend; event attendance. Last three reject unsupported mutation/aggregation/facts. Call actual `/api/search`; compare persistent state before/after excluding usage. Keep this report separate from the 50.

Report all rows, a 3×3 confusion matrix plus errors/missing, and denominators: extraction accuracy/inventions; 30 valid matches/reviews/false flags; unsafe matches among 20 non-match cases; eight violations/six duplicates caught; paired regressions including individual protected checks. Search reports precision/recall, uncertainty, wrong confident matches, coverage and unsupported queries; empty denominators are N/A, failures are not correct empty results.

Retain raw stage/end-to-end latencies, median/p95/sample size, failures, cold/warm state and concurrency. Extraction happens once; after-phase time is not upload-to-decision speedup. Collect actual calls/tokens/retries by provider/channel/model/phase, deduplicated by usage ID, with unrelated work excluded. Missing tokens/request IDs/internal timings stay null. Never estimate tokens from text length or double-count reasoning tokens.

Separate billed cost, dated official model/region price estimates and unknown cost/coverage. Azure deployment names are not pricing SKUs; credits are not zero service cost, and shared account changes are not run attribution. Separate Devin usage and excluded hosting/storage. Cost-per-attempt/correct-valid-match/search needs explicit denominators. Observed reviewer time is separate from model latency; flagged dollars are not recovered savings or fraud.

Harness checks cover deterministic/disjoint fixtures, counts/duplicates/order, no label leakage, production-derived duplicate facts, frozen-artifact protection, activation/freshness failure, unchanged decisions, one observation per attempt including errors, unsafe-alias detection from actual checks, unique usage IDs, budgets and CSV escaping. Mock transport only for protocol tests.

## E. Human replay, recording and delivery

Run against the delivered commit:

```sh
nvm use
npm ci
npm test
npm run typecheck
npm run build
npm run test:browser
node --conditions=react-server --import tsx --test --test-concurrency=1 evals/*.test.ts
npx playwright test --config evals/playwright.config.ts
```

Run `npm run test:intelligence` after C delivers it; missing implementation is blocked. Existing browser checks use simulated demo/preview. Configure Chrome and your separate Playwright config for isolated integrated rehearsal; live retries require budget. Historical passing counts do not establish current results.

A teammate unfamiliar with implementation replays without coaching: inspect receipts/duplicates, clear statuses/errors, keyboard/focus, retained notes, retry/export and persistence. Report polish defects to A and retest fixes. For time-saved claims, use two equivalent four-case packs and two operators in opposite manual/Sift order, same policy/evidence and hidden answers; retain individual times/errors/corrections and disclose sample size.

Explicitly ask Devin to test and send an annotated recording; official docs support requests during a session. Preserve a **complete walkthrough**: upload → extraction/evidence → assessment → source approval/note → propose/test/activate → unseen rehearsal purchase → protected violation/duplicate → pending-versus-approved search → retry/export → restart. Add two short learning and safety/search clips; retain originals and mark editing/speed changes. Missing recording remains blocked. [Official testing/recording documentation](https://docs.devin.ai/work-with-devin/testing-and-recordings)

Derive replay instructions in `evals/README.md` from the actual run. This prompt can become a team playbook after owner request; do not create external playbooks/extra sessions unasked. [Official playbook documentation](https://docs.devin.ai/product-guides/using-playbooks) was checked 2026-09-20. Preserve actual contribution evidence for **Best Use of Devin** without promising eligibility/outcome or additional prize categories.

Each ignored run directory contains `manifest.json`, `review.json`, `results.json`, `cases.csv`, `search.csv`, `calls.jsonl`, `timings.csv`, `report.md`, and `evidence/index.md` plus originals/logs/repros. Record hashes, commands/budgets/modes, revisions, all failures, review sign-off and claim → case/run → recording timestamp/log → commit/diff → Devin session/authorship. Export reviewed synthetic attachments before links expire; inspect for secrets/headers/signed URLs and keep answer keys/raw diagnostics out of the shared demo.

Deliver the scoped diff, gate table, reproducible commands, frozen review pack, reports and recordings through the integration slot. A teammate reruns the frozen experiment in a fresh isolated environment; retain both results rather than choosing the better one. If blocked, deliver independent completed work with exact missing requirements; do not claim all five milestones passed.
