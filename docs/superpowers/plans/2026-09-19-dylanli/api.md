# Frozen v2 API and behavior

All paths are same-origin. Bodies/responses are the types in `contracts.ts`. JSON success bodies are unwrapped; errors are `{ "error": { "code": "...", "message": "..." } }`. Preserve the existing same-origin mutation check, bounded request bodies, server-only secrets and `Cache-Control: no-store`. New routes use the Node runtime.

## Common invariants

- IDs are UUIDs for persisted entities. Money is integer cents, 0 through 2147483647. Dates are valid YYYY-MM-DD. Currency is USD for claims; other receipt currencies remain evidence and fail the currency check.
- Vendor normalization is Unicode NFKC, trim, collapse whitespace and lowercase. Do not remove arbitrary punctuation or use substrings for learned aliases.
- `review_revision` is a persisted positive integer, starting at 1. Increment on run start/completion/failure, extraction change and human decision. Every human mutation supplies its expected revision. Check-and-write must be atomic in both local and Supabase adapters.
- `knowledge_revision` is a persisted nonnegative integer, starting at 0. Increment on rule activation/disable, including automatic disable when a source approval is withdrawn. Proposing/testing a draft does not change active knowledge.
- `snapshot_token` is a stable opaque hash of sorted submission ID/revision pairs and `knowledge_revision`. No current-time/random value is allowed in this hash. Return it even for an empty ledger.
- The assessment reducer examines machine checks only, excluding aggregate `overall_status`: any fail → flagged; otherwise unknown or no checks → needs_review; otherwise matched.
- Keep the compatibility `row.status`: human approved/rejected takes precedence; otherwise assessment flagged/needs_review maps directly; otherwise pending. A displays the separate fields, never this projection.
- Reanalysis never changes `decision_status`. It sets `assessment_knowledge_revision` to the knowledge revision used by its successful assessment. A human decision invalidates any active run. A run may commit only if its captured row/knowledge revisions are still current. Discard stale results and surface a retry message; do not overwrite a newer decision.
- Existing source corrections remain in history. Migrate legacy `vendor_alias` corrections to inactive drafts, never silently active rules. Infer legacy human decisions from actual human correction history, not from the old `status=approved` alone.

## Endpoint table

| Method/path | Request | Success |
| --- | --- | --- |
| GET `/api/reviews` | none | 200 `ReviewsResponse` |
| POST `/api/submissions` | existing multipart fields plus one `file` | existing 201 `{submission_id, receipt_id, extraction_status}` |
| GET `/api/receipts/{id}` | none | original private bytes or existing signed redirect |
| POST `/api/submissions/{id}/retry-extraction` | `{expected_review_revision: number}` | 200 `{row: ReviewRow}` |
| POST `/api/reconcile` | `ReconcileRequest` | 200 `ReconcileResponse` |
| POST `/api/corrections` | `DecisionRequest` | 200 `DecisionResponse` |
| GET `/api/rules` | none | 200 `RulesResponse` |
| POST `/api/rules` | `RuleProposalRequest` | 201 `RuleResponse` |
| POST `/api/rules/{id}/test` | `RuleMutationRequest` | 200 `RuleResponse` with `latest_test` |
| POST `/api/rules/{id}/activate` | `RuleMutationRequest` | 200 `RuleResponse` |
| POST `/api/rules/{id}/disable` | `RuleMutationRequest` | 200 `RuleResponse` |
| POST `/api/search` | `SearchRequest` | 200 `SearchResponse` |

Intake multipart fields remain `attendee_name`, `email`, `amount_requested_minor` as a decimal integer string, `currency=USD`, `category`, `origin_location`, and `file`. The existing upload parser requires the literal field name `file`, not `receipt`. Retain field/file validation and the existing extraction API. There is no bulk import or missing-document creation flow in this version.

Example human decision:

```json
{
  "submission_id": "10000000-0000-4000-8000-000000000003",
  "expected_review_revision": 3,
  "human_verdict": "approved",
  "human_note": "Reviewed the hotel receipt and confirmed this billing descriptor.",
  "correction_type": "decision_override",
  "correction_payload_json": {}
}
```

## Read and reconcile

`GET /api/reviews` returns all rows in descending submitted_at order, ties by ID; this demo supports at most 200 ledger rows. Return `LEDGER_LIMIT`/409 rather than silently dropping records beyond that ceiling. Summary counts describe the full ledger. `approved_amount_minor` sums only human-approved claims. `pending_review_count` counts decision pending. Assessment counts include rows with that assessment, irrespective of human decision.

Receipt metadata includes a same-file SHA-256 computed on upload, not a guessed hash of extracted text. Historical records without bytes retain null; they do not pass an exact-duplicate check merely because hashes are absent. Real uploaded demo receipts must acquire a hash. Never return raw extracted text, service keys or storage paths in list rows.

Reconcile accepts 1–50 unique IDs and keeps the current bounded synchronous batch. Each item succeeds/fails independently; the response preserves request order. Recheck current facts, exact-file duplicates and active aliases. Persist individual successes. Surface provider failure as unknown/needs_review, retain hard failures, and retain human decisions. Keep run history and receipt evidence intact.

Call `intelligence.investigate` only for a successfully extracted claim with unresolved machine checks and no known failing check. Set a 45-second investigation deadline and at most four tool calls. A failed investigator records an `unavailable` result; it cannot erase the deterministic/Jev assessment. Skip expensive investigation for clear matches and known hard failures. Before final save, repeat stale-run checks.

An exact duplicate check considers all other records holding the same document hash and surfaces their IDs. For deterministic triage, the earliest `(submitted_at,id)` record is the original; later copies are flagged. If a different same-hash claim is already approved, flag the current claim irrespective of ordering. At final approval, recheck that no other approved claim shares the hash. This last check is serialized across submissions sharing a hash, not just locked on the current submission row.

`retry-extraction` operates on the retained original only, requires a pending human decision, and rejects active runs. It cannot replace bytes or change the claim. B marks the attempt as running, calls the existing C-owned extraction function, records usage once, and updates fields/error. Clear the previous machine assessment and investigation, increment revisions, then require reconciliation. A failed extraction retains the file and error. This bounded route is not a general document editor.

## Human decisions

Require a 1–2000 character trimmed note and current revision. A rejection may cancel active processing; mark its run superseded so a late completion cannot overwrite the decision. Approval additionally requires no active processing, successful extraction, a completed assessment using current active knowledge, passing deterministic currency/amount/policy/date/cap checks, and no failing or unknown duplicate check. Recheck duplicate approval inside the transaction. An unresolved merchant/name check may be explicitly resolved by the human with their note; this does not change extracted facts or train a rule.

Reject unsafe approval with `APPROVAL_BLOCKED`/409, exact duplicate approval with `DUPLICATE_BLOCKED`/409, stale revision with `STALE_REVIEW`/409 and outdated knowledge with `STALE_ASSESSMENT`/409. A retries only after refreshing/reviewing current data. Never turn a failed request into a displayed approval.

`correction_type=vendor_alias` is no longer accepted at this endpoint; return `USE_RULES_ENDPOINT`/400. Human decisions and future-learning permission are separate actions. A subsequent rejection of a source claim automatically disables its active rules and advances knowledge revision within the same transaction.

## Learning lifecycle

Proposal derives observed vendor/category/currency and source correction ID on the server. The client supplies only canonical vendor (1–200 trimmed characters), source submission and expected revision. Source must be currently human-approved, financial/duplicate checks must pass, and its latest machine merchant check must be unknown. A missing vendor, a currently running/stale assessment, or another unresolved required check blocks proposal with `RULE_INELIGIBLE`/409. Canonical vendor must differ from the normalized observed vendor. Same source correction and normalized alias payload returns the existing draft instead of a duplicate.

A rule is immutable apart from state/version/test report. There is no edit endpoint: disable and propose a new rule. Drafts never affect reconciliation/search evidence. `source_correction_id` is provenance; only active rules with currently valid source approval enter C's Jev evidence. B may adapt these to the legacy `Correction[]` interface internally without changing C's existing Jev signature.

Testing a draft checks expected version, increments rule version and clears any previous report before model work. Capture the resulting version and current knowledge revision. C builds ten labeled examples and evaluates them through B's `AssessExample` callback. **That callback uses the same deterministic, exact-duplicate and Jev assessment path as actual reconciliation, without database mutations or investigation.** It never receives expected labels. In evaluation mode provider/transport/schema failures throw; they must not be swallowed into ordinary unknown assessments and then counted as a completed test. All test model usage is recorded with null run/receipt IDs if no persistent entity applies.

Use a 90-second deadline and at most three concurrent assessments. Save the result only if rule version, active knowledge and source approval are unchanged; otherwise return `STALE_RULE_TEST`/409. Provider errors invalidate the attempted test and return 503; don't manufacture metrics from missing outputs. A failing completed test is a 200 response with `passed=false`, readable reasons and its before/after metrics.

The ten examples are: two new valid alias receipts, overclaim, over-cap, exact duplicate, other category, EUR receipt, missing receipt, missing traveler name, and unrelated merchant. Use new IDs/receipt numbers; preserve true labels outside model inputs. Acceptance requires zero false matches after, at least one valid example improved to matched, no previously correct example regressed, and no reduction in total correct outcomes. `false_matches` means actual matched while expected is not matched. These synthetic tests constrain the rule; they are not a broad accuracy benchmark.

Activation requires draft state/current version, current approved source, and a passing report for exactly that version, current knowledge revision and suite `alias-v1`. The report mode must match the configured assessment mode. A simulated pass cannot activate a rule for live assessment. Activation increments rule and knowledge versions atomically. Missing/failed/stale test returns `TEST_REQUIRED`, `TEST_FAILED` or `STALE_RULE_TEST` (409). Disabling increments versions and preserves history; disabling an already disabled rule with the current version is a no-op.

Do not silently rerun every claim after knowledge changes. A shows “Rules changed — recheck” when assessment_knowledge_revision differs from knowledge_revision and offers explicit reconciliation. Existing human decisions remain visible. Old assessments remain historical evidence, not proof they used the newest rules.

## Investigation seam

B supplies `InvestigationInput`, `InvestigationTools` and `ProviderOptions`. Each tool is scoped to the current claim and returns at most 20 related claims or aliases, existing bounded receipt text and applicable policy. Tools have no caller-chosen record IDs and no network URL argument. C cannot write state.

C selects the tool calls through the model, executes at most four, and returns `InvestigationResult`. Evidence references must be `receipt:<id>`, `policy:<id>`, `claim:<id>`, or `rule:<id>` from tools actually called. C validates returned refs and B validates them again against the supplied records. Steps record the actual tool and a concise observation, not hidden chain-of-thought or fictional progress messages. `propose_alias` is a recommendation, never activation permission.

Live extraction/investigation uses `OPENAI_API_KEY`; investigation model is `OPENAI_INVESTIGATOR_MODEL` or `gpt-4.1-mini`. Preserve `extractReceipt`'s baseline interface and configured model. C handles errors with the existing extraction result shape or, for the new port, an Error carrying a `code` from `IntelligenceErrorCode`. B maps provider errors/timeouts to 503 and unsupported query to 422. No credentials are required merely to import a module.

## Search seam

Query length is 1–300 trimmed characters. Explicit filters are equality filters from `SearchFilters`. Check snapshot_token, apply filters first, project rows into `SearchRow`, then call C with at most 200 rows. If zero rows remain, return a valid empty result without a model call. If data changes during search, return `STALE_SNAPSHOT`/409 rather than combining old matches with new values.

C rejects aggregation, mutation and unavailable-fact queries with `UNSUPPORTED_QUERY`; an amount comparison such as “claims above $200” is a supported row filter. Search batches at most ten rows per Jev request, at most three concurrently, and uses a 45-second overall deadline. Require exactly one judgment per supplied ID. Low-confidence matches below 0.8 become uncertain; missing/invalid rows or a failed batch fail the entire search. Confidence is null in simulation. Provider confidence is not calibrated financial accuracy.

B assembles `matches` and `possible_matches` using its original snapshot, with newest submitted_at first and ID as tie-breaker. Never return no_match rows. A shows possible matches separately, preserves this ordering, and marks displayed results stale when the polled snapshot changes. Search never reconciles, approves or changes a rule.

## Runtime and failures

No automatic fallback from live to simulated. The existing demo launcher forces all new capabilities into simulated mode and clears keys. Mixed mode remains visibly labeled. B exposes all execution labels in `ReviewsResponse`; A displays a compact mode indicator/details popover. C reports actual models and usage; unknown costs/tokens remain null.

B persists and recovers the existing bounded run leases. Do not introduce a background queue in this packet. For requests exceeding the deadline, return a useful failure and permit explicit retry. New cross-cutting errors: invalid body 400, missing record 404, stale/conflicting state 409, unsupported search 422, provider unavailable/timeout 503. Existing intake error codes can remain unchanged; A always displays the server's message.
