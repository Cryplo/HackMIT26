# Benchmark corroboration after upstream update

Production moved from `c9e87bd4440c17b82d8e52ed7487b86909fddc1a` to `59ee979598534b2483b1049150a21a135e05d175`. The same frozen 50-PDF dataset and price assumptions were retained. Benchmark source hashes are in `manifest.json`; production sources were unchanged throughout the live run. The benchmark implementation and this compact findings bundle are published together.

## Incoming changes relevant to these results

- `overall()` now gives a known failure precedence over unknown evidence and requires every mandatory check to pass before matching.
- Production confirms duplicates from equal PDF hashes or corroborated receipt identity. Actual receipt hashes are now passed to production and the direct-AI baseline. The baseline computes its own verdict from those hashes.
- The new `createAssessExample` interface delegates to the same `CoreService.assess` used by the application and exposes errors separately. The benchmark now uses it.
- Jev response validation is stricter and its instructions reinforce that receipt text is untrusted. Merchant thresholds remain confidence 0.70 and chosen-answer probability 0.85.
- Scoped reviewer rules now have persisted proposal/test/activation/disable controls. Approval safety, extraction retry, export, and live readiness also changed. Those application workflows are outside this isolated cost experiment. No active aliases were supplied.

## Corroboration

Offline replay of the old extraction and Jev answers through current production improved correct verdicts **30/50 → 38/50**. Five policy violations and three duplicate cases changed from needs_review to flagged. No new API calls, costs or timings were assigned to replay; the original provider failure remained a failure. See [replay.json](replay.json) for the before/after verdict of each case.

The fresh live run completed **150/150 calls with zero errors**. Comparison with the old run includes changed prompts, input evidence, token use, and uncontrolled provider/cache variation; it is not a controlled attribution of timing changes to one commit. It yielded:

| Metric | Sift | Direct PDF-to-verdict AI |
| --- | ---: | ---: |
| Correct assessments | 39/50 | 47/50 |
| Correct valid matches | 19/30 | 29/30 |
| Policy violations flagged | 8/8 | 6/8 |
| Duplicates flagged | 6/6 | 6/6 |
| Unsafe matches | 0/20 | 0/20 |
| Receipt-to-verdict median | 2.287 s | 2.542 s |
| Receipt-to-verdict p95 | 4.944 s | 4.999 s |
| Total serial processing time | 130.57 s | 143.75 s |
| Estimated model cost, 50 receipts | $0.018259 | $0.072608 |

Observed estimated model cost was **74.9% lower**, and total serial processing time **9.2% lower**. These figures replace the earlier run for describing the current code. They do not establish equal quality or human-time savings. The [full report](report.md) has stage breakdowns and exact pricing assumptions.

All 11 valid Sift cases sent to review had an unknown merchant check. Ten were unfamiliar synthetic merchants; their true identities may not be inferable from the supplied evidence, and no reviewer alias was provided. The remaining familiar case had merchant confidence 0.69 and pass probability 0.79, below both unchanged thresholds. The new code resolves known failures and duplicates but does not resolve this evidence/confidence issue.

## Presentation limits and validation

Labels remain unreviewed and Sift valid-match yield is lower than the baseline, so the equivalent-quality savings headline remains blocked. Costs assume Azure Luna short-context Global Standard in West US 3 plus Jev's listed regular Gateway rate; actual deployment tier and billed spend are not verified. No Ramp, human review, live database, upload, UI, narration, or learning activation timing is included.

Validation: 11 benchmark tests + 106 application tests + 13 learning tests passed; TypeScript type checking passed. No production files were edited for this benchmark.

## Published evidence

- [Full report](report.md), [machine-readable summary](summary.json), and [per-receipt measurements](cases.csv).
- [Results](results.json) preserve all timing, usage references and outcomes, plus compact Sift check evidence. [Provider calls](calls.jsonl) preserve measured tokens and timing.
- [Manifest](manifest.json) records production commit, implementation hashes, prompts, data hashes, rates and budget. [Provenance](provenance.json) records original artifact hashes and the diagnostic fields omitted from this compact export.
- [Offline replay](replay.json) records all original and updated verdicts. Raw PDF files and repeated diagnostic snapshots remain in the local ignored output directory. The [runner instructions](../../README.md) reproduce the synthetic dataset and explain fresh live runs.

These are exploratory measurements with unreviewed labels, published as findings rather than a validated presentation claim.
