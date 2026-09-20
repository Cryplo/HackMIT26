> **ARCHIVED — superseded on 2026-09-20.** Historical assignment from commit `9f3d593`; not current implementation instructions. Start with [the active investigation pack](../../next-work/README.md). Relative document links were relocated for this archive.

# 03 — Travel review workspace: colleague A prompt

Implement the organizer and claimant UI in the existing Next/shadcn application. Make each exception understandable, its evidence inspectable, and its next action obvious. Surface useful cross-claim patterns with exact, inspectable counts and amounts.

Read [README.md](README.md), [00-contracts.md](00-contracts.md), [01-platform.md](01-platform.md), [05-integration.md](05-integration.md), and `reconciliation/AGENTS.md` first. The frozen contracts control payloads, limits, and capability semantics. Complete the pack's priorities **1–5 before P1 or other reconciliation types**. Build on existing components; do not restart the app.

## Ownership and starting point

You are not alone: preserve teammates' changes. Work only on main, following the README delivery process. Paths below are relative to `reconciliation/`.

**Own:** `src/components/business/**`, `src/lib/dashboard/**`, `src/app/business-demo/**`, submit `page.tsx`/`submit-form.tsx`, and `tests/ui/**`. Change `globals.css`, `theme.css`, or existing UI primitives only for necessary presentation/accessibility fixes. Request shared browser/build configuration changes from the integration owner.

**Do not edit:** API routes, shared contracts, core/intake/intelligence, DB/schema/migrations, evaluation datasets/harnesses, packages/lockfiles, or another owner's files. Report missing backend capabilities to B. Do not reset shared data or run paid providers for UI development.

Verified current wiring:

- `/`, `/demo`, `/search` redirect to `/business-demo`; `/submit` uses actual intake. Work in `BusinessDashboard`, `ReviewTable`, `ReviewSheet`, `RulesPanel`, and `AppShell`.
- Dashboard APIs: workspace reviews/reconcile/decisions, `/api/search`, and receipt originals. `/api/claim-search` is a separate legacy surface; do not switch contracts.
- `?preview=1` supplies six fictional, isolated claims. API failure must never silently become preview success.
- Existing UI separates assessment, decision, and processing; preserves stale-decision notes; displays originals; and blocks financial failures. Preserve these behaviors.
- Rules/retry work only in preview today; real retry/export/rules endpoints are missing. Current revisions are placeholder zero, duplicate IDs empty, investigation unavailable. Client declarations do not prove implementation.

Preserve the **neutral default shadcn theme**; previous Ramp colors were intentionally removed. Reuse existing table/filter/sheet/dialog/native inputs and dependencies. No model configuration in the default flow, decorative charts, invented savings, fraud labels, or confidence-as-accuracy claims.

## Layout

Keep first rows visible without a KPI wall. One compact insight strip is enough.

```text
Reimbursements                            [New claim] [Export selected]
Needs review | Approved | Rejected | All             [Mode disclosure]
[Shared merchant: N / $X ->] [Rules changed: N / $Y ->]
[Search claims........] [AI search] [Category] [Assessment]
[Active insight/filter x]                         N claims / $X claimed
[] Claimant | Merchant | Claimed | Receipt | Delta | Assessment | Decision | Next
[] ...      | ...      | $...    | $...    | +$... | Flagged    | Pending  | Review
N selected [Recheck selected]                         Updated ...

Claim review sheet                                    [Close]
Assessment: Needs review          Human decision: Pending
[Rules changed. Recheck; human decision is retained.]
Original / Open original | Claimed / receipt / difference
                        | Main issue + concrete next step
                        | Checks, evidence, links to earlier claims
                        | Recorded reviewer decision and note
                        | [Technical evidence] [Advanced questions: P1]
Blocking reason         [Required next action] [Reject] [Approve]
Mobile: Document / Details tabs; footer stays reachable.
```

Give each row one obvious action: processing → “Checking…”; extraction issue → “Review receipt issue”; unassessed/stale → “Recheck needed”; duplicate → “Compare claims”; other exception → “Review issue”; matched/pending → “Review for approval”; decided → “View decision”. Open the relevant sheet section; extraction/recheck requires an explicit button press. A matched assessment never means approved.

## P0 — Build and verify these flows

### 1. Queue and search

- [ ] Retain four human-decision tabs and separate machine assessment/decision labels; ignore legacy `status` for approval. Show claim ID in details and actionable processing errors.
- [ ] Show claimed amount, receipt amount, and `delta_minor = claimed - receipt` only for succeeded extraction, valid integer cents, and equal known currencies. Zero: “Matches”; null: “Unavailable”; mismatched currency: “Currencies differ”, without conversion. Underclaims are mismatches too. Reuse money formatting.
- [ ] Local text filtering is immediate; semantic search runs only on explicit submit with current query/token/supported filters. Separate matches from possible matches and label simulation. No paid calls on typing, polling, focus, or filter changes.
- [ ] Query/category/assessment/decision/insight changes clear semantic results and invalidate in-flight responses. A new snapshot marks previous results stale and offers explicit “Search again”. Open claims from current rows by ID, not stale search objects.
- [ ] Insights use a local ID filter. Clear that filter visibly before a new semantic search; do not invent backend filter fields. Preserve selection by ID, disclose hidden selections or clear them, and cap recheck at 50. Report partial failures and refresh without automatically rerunning successful claims.
- [ ] Existing read-only refresh may continue; prevent overlapping/stale requests and retain open row/note. Refresh must never trigger extraction, reconciliation, investigation, rule tests, or search.

### 2. Evidence, recovery, and decisions

- [ ] Lead with concrete facts: “Claim exceeds receipt by $12.00”, actual policy cap/date evidence, unresolved merchant, and the required next step. Financial results come from checks/integer arithmetic, never generated narrative. Keep originals accessible through extraction, PDF/image rendering, and investigation failures.
- [ ] Show extraction provenance from the actual receipt/decision evidence supplied by B, including fixture/simulated or live extraction when recorded. A global execution banner does not prove how this uploaded or historical receipt was extracted; absent provenance stays unknown. Do not invent required response fields.
- [ ] With `duplicate_links`, make every `duplicate_submission_ids` entry open its **actual confirmed prior claim**, decision, amount, and original, with a way back. Show unloaded IDs honestly. These are corroborated prior links, not model candidates; same merchant/date/amount is insufficient. Label uncertain candidate evidence separately.
- [ ] With `extraction_retry`, call `POST /api/submissions/:id/retry-extraction` using `expected_review_revision`. Only pending claims with no active operation qualify. Retain the saved claim/original/history; never POST a replacement submission. After extraction, explicitly offer recheck. Preserve errors and disable repeat actions during work.
- [ ] `/submit` retains integer-cent parsing, MIME/8 MB validation, labels, and progress. Saved-but-failed extraction shows the saved ID, original, and same-claim recovery. A `?claim=` workspace link may open a loaded ID; handle missing IDs without inventing a detail API.
- [ ] Approval requires succeeded extraction, current completed assessment, no running operation, passing currency/amount/policy/date/cap/duplicate checks, current revision, and nonblank note. Missing checks do not pass. Preserve server-authoritative rejection and duplicate protection; eligible merchant/name ambiguity may be resolved only by an explicit human decision, without changing the machine check or teaching a rule.
- [ ] On stale writes, preserve the note, refresh evidence, and require a new deliberate decision. Do not optimistically claim success. With `knowledge_revisions`, an older assessment gets “Rules changed — recheck”; unassessed is different. Rechecks retain human decisions/notes. Show only returned history; never fabricate an audit timeline. Approval records reimbursement authorization; no payment is sent.

### 3. Insights with auditable formulas

Require complete prefilter source data: `coverage.complete === true`, `returned === submissions.length`, `total === returned`, and unique IDs. Missing/inconsistent coverage means unavailable, not zero. Cache that complete response separately from filtered/AI-result rows. Missing capability booleans mean false.

For each set `S`: `ids = unique(S.map(r => r.id))`, `count = ids.length`, `claimed_minor = sum(amount_requested_minor for ids)` separately per currency, with safe-integer checks. Every insight opens exactly those rows with matching count/cents and a removable filter. Recompute membership and totals together on snapshot change. Never call these amounts savings, loss, fraud, or prevented payment.

| Insight | Exact formula and action |
| --- | --- |
| Shared unresolved merchant | Requires `knowledge_revisions`. Pending, idle, successfully extracted, completed current assessment; nonblank observed vendor; receipt currency equals claim USD. Merchant unknown; amount/currency/receipt_date/policy/policy_cap/duplicate/name present and passing; no other failed/unknown mandatory check. Exclude human/overall-summary checks. Group by B's canonical vendor normalization (currently trim, lowercase, collapse whitespace), category, currency; no fuzzy matching or additional Unicode normalization unless B adopts it. Show groups of ≥2 distinct IDs: “N otherwise checked claims share this unresolved merchant — $X claimed.” Open their evidence; do not promise a rule will approve them. |
| Rules changed | Requires `knowledge_revisions`. Pending rows with completed assessment/run and integer `assessment_knowledge_revision < knowledge_revision`. Null is unknown, not zero. Show “N pending claims use older rules — $X claimed.” Open exact IDs for explicit selection/recheck. Approved/rejected stale rows may appear in a separate scope; exclude their amounts from the pending total. |
| Later duplicate review | Requires `duplicate_links`. Distinct pending later rows with nonempty confirmed-prior IDs. Sum each later row once, even with several links; **exclude originals and their amounts**. No graph expansion or candidate inference. Show “N pending later claims reuse earlier receipt evidence — $X claimed.” Drill into later rows and prior evidence. Label claimed amount in duplicate review, not excess exposure. Ship only after real links exist. |

Needed fields: claim ID/amount/currency/category; three statuses; latest run/assessment knowledge revision; extraction status and parsed vendor/currency/amount; check method/field/verdict; duplicate IDs; response snapshot/knowledge/capabilities/coverage. Optional custom questions do not enter mandatory-check eligibility.

Leave one focused helper test for grouping, missing checks, scope/currency separation, null/stale revisions, and duplicate deduplication. Example: eligible hotel/USD claims `" SYN HBR042 "` and `"syn hbr042"` at 12,300 and 14,800 cents yield two IDs/27,100 cents; a flagged claim or different category contributes nothing to that group.

### 4. Real learning and export

- [ ] Gate controls using frozen `capabilities` (`rule_learning`, `extraction_retry`, `export`, `custom_checks`, `duplicate_links`, `knowledge_revisions`); missing means false. Do not poll absent endpoints. Update preview fixtures with explicit capabilities/coverage and frozen response shapes, keeping simulation visibly separate from backend availability.
- [ ] Wire eligible approved source → draft → explicit real test → current passed report → activate → explicit recheck. Respect rule versions, knowledge, source validity, and test freshness. Show observed/canonical vendor, category/USD scope, source link, regressions/reasons, and report provenance. Canonical name is 1–120 trimmed characters. Editing requires disable/new draft, not a new edit API.
- [ ] Frozen rule-test response is `RuleTestReport`, unlike the current client's `RuleResponse` assumption: align the dashboard seam and refetch rules for authoritative version/state. Failed/stale/unavailable tests cannot activate. Source rejection/disable is reflected from server state; no automatic approval/recheck. Preview's 8/10 → 10/10 is scripted, not measured accuracy.
- [ ] After an incomplete/failed test, refetch rules: `latest_test` is null and optional `latest_test_error` supplies the sanitized failure message. Keep activation disabled; a previous passing report retained in history cannot restore eligibility. Verify this state survives refresh.
- [ ] Export explicitly selected IDs through `POST /api/workspace/export` with `{snapshot_token, submission_ids}`; 1–1000 unique IDs. “Select shown” may populate selection; possible AI matches require explicit selection. Capture token/IDs together. Keep recheck's separate 50-item limit clear.
- [ ] Handle successful CSV separately from JSON-only `api<T>`, download the response, then release the object URL. On `409 STALE_SNAPSHOT`, create no file; refresh and require another explicit export. Parse JSON failures; no client-side CSV substitute or silent changed-snapshot retry. Unknown values remain unknown. Unavailable export is disabled with a reason.
- [ ] No benchmark metrics API exists. Do not invent live 50-case charts, conflate activation cases with held-out results, or present probability as calibrated accuracy.

## P1 — Advanced custom questions, only after all five priorities pass

With `custom_checks`, place an advanced panel inside receipt review. Mandatory checks remain locked. Configuration is workspace-scoped under the frozen API: explain that saving affects subsequent assessments; do not promise attachment-only persistence. Explicitly recheck the current claim to evaluate its receipt, without inventing a run endpoint.

Use `GET/POST /api/checks`, `PATCH /api/checks/:id`, `expected_version`, and body `enabled`; no enable/disable endpoints. Maximum **five enabled** `custom_` keys; immutable field key; `kind: jev`, `severity: review`. Use only choice questions with pass/fail/unknown criteria and the exact lengths/validation in `00-contracts`. Show configuration errors/stale versions. No model selector, arbitrary code, or raw provider settings.

Custom fail/unknown/low confidence requests review; custom pass cannot approve or weaken mandatory checks. Present real answers/evidence/provenance and stale configuration status; retain human history. Missing capability stays unavailable; simulated answers remain explicitly unknown fixtures.

## States, accessibility, and acceptance

Loading must not show zero totals/all-clear. Empty workspace offers New claim; empty filters offer Clear filters. First API failure shows retry without fixtures; refresh failure retains last snapshot/note and labels it. Search failure is an error, not zero matches. Uncertain mutation outcome triggers refresh, not an automatic repeat write. Receipt failures retain originals. Missing capabilities explain unavailable actions while normal review stays usable.

Preserve keyboard row actions, focus trapping/Escape/return, accessible names/status announcements, non-color status labels, 44 px mobile targets, contained table overflow, reachable sheet footer, and reduced motion.

Extend existing preview/client/UI tests for:

- Same-ID extraction retry, originals, exact delta, financial/duplicate blockers, missing checks, and stale-note preservation.
- Real linked-claim navigation; human decisions surviving recheck; insight exact IDs/count/cents and unavailable coverage.
- Explicit-only search, filter changes clearing stale results, delayed responses ignored, and possible-match separation.
- Capability-gated rule lifecycle; failed/stale activation; exact snapshot/selection export and no file on conflict.
- Loading/empty/error states; keyboard/mobile focus; reduced motion. P1 separately proves locked checks and review-only outcomes.

Run from `reconciliation/`:

```bash
npm run typecheck
NODE_OPTIONS=--conditions=react-server npx tsx --test src/lib/dashboard/tests/*.test.ts
npm run test:browser -- src/lib/dashboard/tests/dashboard.spec.ts tests/ui
npm run build
```

Use the existing isolated, paid-provider-disabled browser demo and route mocks for undelivered capabilities; do not target a shared/live `DASHBOARD_BASE_URL`. Leave helper tests in the discovered dashboard test directory. Deliver exact results, synthetic desktop/mobile screenshots, owned diff, and named backend blockers. Distinguish actual API verification from mocks/preview. Live persistence/rehearsal belongs to the integration owner; preview success does not complete learning/retry/export integration.
