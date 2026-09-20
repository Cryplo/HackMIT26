# Agent A — reimbursement review frontend implementation plan

> Execute this brief as one independent agent. You do not need earlier conversation or another agent's responses. Read `README.md`, `context.md`, `api.md`, `contracts.ts` and [ramp-ui.md](ramp-ui.md) in this directory first. They are part of this instruction set. The visual contract defines the UI, including actual Ramp reference screenshots you must inspect. Do not use the older greenfield packet.

**Goal:** Transform the existing Fieldnotes interface into a compact, polished finance review desk with an understandable receipt-review and learning flow.

**Architecture:** Keep the existing Next app, same-origin routes and working fetch/mutation patterns. Use the frozen v2 DTOs and shadcn primitives. Implement a clearly labeled preview client so you can finish/test without B's backend.

**Tech stack:** Existing Next/React/TypeScript/Tailwind, baseline-generated shadcn Radix/Nova components, Lucide and Playwright. Follow the visual contract's tokens and density; optional official shadcn skill helps with composition. No new backend or animation framework.

## Global constraints and ownership

Application root is `reconciliation/`. Baseline is Dylan's `97ac7ec` plus the integration owner's committed contract/shadcn setup. Confirm `src/lib/review-contracts.ts` exists and matches the packet; if not, report the missing baseline instead of inventing a contract. Read `AGENTS.md` and the relevant bundled Next docs.

Own only: `src/components/**`; app layout/globals/root page; `src/app/business-demo/**`, `src/app/submit/**`, `src/app/demo/**`; `src/lib/dashboard/**`; `tests/e2e.spec.ts`, `tests/ui/**`; `playwright.config.ts`; `public/ui/**`. Do not edit route handlers, provider code, SQL, shared contracts, package/lock files or another builder's files. You are not alone in the codebase; preserve others' changes.

Reuse useful logic in `BusinessDashboard.tsx`: request ordering, preserving the last good response, polling and preventing duplicate submissions. Replace its composition and bespoke visual treatment. Replace mirrored dashboard types with imports/re-exports of the frozen v2 DTOs.

## Task 1 — client and explicit preview

**Files:** modify `src/lib/dashboard/types.ts`, `helpers.ts`, `fixtures.ts`; create `src/lib/dashboard/client.ts` and `preview.ts` only if needed.

**Consumes:** API payloads in `api.md`; v2 `ReviewsResponse`, `DecisionRequest`, rule/search DTOs.

**Produces:** one client used by the dashboard in live API mode or explicitly selected `?preview=1` mode.

- [ ] Implement methods for reviews, reconcile, decision, rules, proposal, test, activate, disable, search and retry extraction using the exact endpoints. JSON errors preserve their server message/code. Include the latest revision in writes. Do not send browser API keys.
- [ ] Preview mode is an in-memory fixture client with a visible “Preview — synthetic data” badge. It resets on reload. Never switch to it because a real request failed. The normal URL uses the API.
- [ ] Use six rows: matched/pending; overclaim/flagged; ambiguous merchant/needs_review; manually approved merchant exception; rejected duplicate; failed extraction. Attach bundled synthetic receipt URLs where available. Include a draft and a disabled rule. Simulated test/search results must be labeled and must obey the contract, not pretend to measure real AI quality.
- [ ] Preview writes increment row/rule revisions, reject stale versions, preserve human decisions on simulated recheck, and forbid duplicate approval. Keep this limited to visible demo interactions; do not reimplement the backend.
- [ ] If the API does not return `contract_version: 2`, display “The review API needs the v2 upgrade” with an explicit preview link. Do not guess how to reinterpret legacy auto-approved statuses.

**Independent check:** render all six cases with the backend unavailable in explicit preview. At the normal URL, an API failure must remain an error.

## Task 2 — redesign the work queue

**Files:** modify `src/components/business/BusinessDashboard.tsx`, its styles, `src/app/globals.css`, layout and dashboard page. Reasonable component split: `ReviewTable.tsx`, `ReviewSheet.tsx`, `RulesPanel.tsx`; do not create a component per label.

**Consumes:** `ReviewsResponse` and the client from Task 1.

**Produces:** the primary reviewer workflow at `/business-demo`.

- [ ] Build a compact sidebar with functional Reimbursements and Learned rules navigation (the latter can select a panel on the same page). Keep Fieldnotes branding small. Do not add dead Accounts/Analytics/Settings links.
- [ ] Top bar: “Reimbursements”, one brief context line, New claim action. Use compact status tabs/counts and a toolbar with text search, category and decision filters. Default to pending human decisions; offer All. Do not show giant KPI cards, editorial hero text, numbered sections or decorative counters.
- [ ] Table columns: claimant, merchant, requested amount, receipt amount, assessment, human decision, row action. Put origin/date and full check detail in the sheet. Use tabular numbers, null as an em dash, clear text badges and restrained borders. Keep first rows above the fold at 1440×900.
- [ ] Support selecting up to 50 rows and Recheck selected. Preserve selection by ID, clear IDs no longer present, and refresh when a batch finishes. Poll every three seconds while mounted; preserve the open row by ID and avoid stale requests overwriting newer results.
- [ ] Apply `ramp-ui.md`: 208px sidebar, 28px heading, 36px desktop controls, 56px rows, white surfaces, neutral borders and a restrained lime primary action. Merge its tokens into shadcn's generated theme and remove conflicting legacy styles. Use accessible primitives and reduced-motion-aware CSS transitions.
- [ ] Make 390px screens usable with a compact row list or deliberately scrollable table plus a full-width detail sheet. Do not hide the decision/assessment without an alternative way to reach it.

**Independent browser check:** screenshot desktop and mobile; keyboard-open a row; verify the queue is reachable without scrolling through marketing content and that the page does not overflow horizontally outside an intentionally scrollable table.

## Task 3 — review evidence and make a decision

**Files:** `ReviewSheet.tsx`, dashboard client; restyle existing submit form/page without changing its wire payload.

**Consumes:** `ReviewRow`, receipt route, `DecisionRequest`/`DecisionResponse`, extraction retry route.

**Produces:** an accessible sheet with the original evidence and auditable human actions.

- [ ] Click a row or its keyboard-accessible open control to open the review Sheet specified in `ramp-ui.md`: up to 960px on wide desktops, with document and evidence side by side; full width with Document/Details tabs below 1200px. Show person, claim amount, both statuses and an “Open original” fallback. Use `/api/receipts/{receipt.id}`; never invent a public bucket URL.
- [ ] Show claimed versus extracted amount, merchant, date and traveler evidence. Make failures concrete: “Claim exceeds receipt by $12.00”, “Same receipt appears in Alex's claim”, “Merchant needs confirmation.” Show investigation summary/tool observations when present; raw provider JSON and uncalibrated probabilities belong behind a secondary disclosure.
- [ ] Provide Approve and Reject with a required reason. Use `expected_review_revision`; send only `decision_override` and an empty correction payload. Reflect the returned row after success. On STALE_REVIEW/STALE_ASSESSMENT, refresh and explain that the reviewer must inspect the updated record. Never blindly retry approval.
- [ ] Keep obvious blocked approvals disabled with a readable reason, while treating the server as authoritative. Decisions survive Recheck. A new flagged assessment beside a previous approval must display both, not silently erase one.
- [ ] Display extraction failure with retained document and Retry extraction action; show its running state and next Recheck action. Do not provide arbitrary receipt field editing in this version.
- [ ] Show “Rules changed — recheck” when the row's assessment knowledge revision is stale. Put the provider/synthetic disclosure in a small visible badge/details view.

**Example Playwright assertions** (write against your real markup/client; preview has no provider calls):

```ts
await page.goto('/business-demo?preview=1');
await page.getByRole('row').filter({ hasText: 'Sam Example' }).click();
await expect(page.getByRole('dialog')).toBeVisible();
await expect(page.getByRole('button', { name: 'Open original' })).toBeVisible();
await page.getByRole('button', { name: 'Approve', exact: true }).click();
await page.getByLabel('Decision reason').fill('Verified the original hotel receipt.');
await page.getByRole('button', { name: 'Confirm approval' }).click();
await expect(page.getByRole('dialog')).toContainText('Approved');
```

Also test a stale response and a failed decision request. Preserve entered notes after a failure.

## Task 4 — make learning understandable

**Files:** `RulesPanel.tsx`, review sheet and client.

**Consumes:** all rule endpoints and `MerchantRule.latest_test`; exact activation gates remain server-owned.

- [ ] On an eligible approved merchant exception, show “Remember this merchant name.” Prefill observed vendor from the receipt; ask for canonical name. Explain the exact category/currency scope. Submit to `/api/rules`; never teach by posting vendor_alias to corrections.
- [ ] Show Draft → Test rule → Activate flow. Present actual before/after counts, false matches and rejection reasons from the server. Show live versus simulated test mode.
- [ ] Enable Activate only for a passing current report; handle server TEST_REQUIRED/TEST_FAILED/STALE_RULE_TEST even if the button had been enabled. Store returned versions after every response.
- [ ] List active/draft/disabled rules, source claim, scope and last test. Disable preserves history. After activation, offer “Recheck related claims” using existing reconciliation with explicit selected IDs; do not recolor claims locally as if they were recomputed.

**Check:** passing and failed test fixtures, changed rule version, activation without valid test rejected, and disabling an active rule. No fabricated success toast on a failed call.

## Task 5 — search and final integration

- [ ] Keep ordinary text filtering immediately responsive. Add a distinct semantic-search submit action that runs on Enter, not each keystroke. Send the current server snapshot token and explicit filters. Display matches and “Possible matches” separately; preserve server order.
- [ ] If polling returns a changed snapshot, keep old results visibly marked stale and offer Search again. Unsupported aggregation/mutation queries get the server explanation. No empty-success state when the provider failed.
- [ ] Update `/demo` to explain the actual v2 sequence and synthetic/live limits; avoid hard-coded claims that every live run produces a particular percentage improvement. Keep `/submit` polished and clear about extraction failures.
- [ ] Update existing browser tests for the new hierarchy/statuses and add the critical stale-decision/rule activation flow. Remove tests whose only purpose was asserting decorative old section headings; retain error/state behavior coverage.

## Verification and delivery

Before B/C merge: `npm run build`, `npm run typecheck`, and Playwright tests that explicitly use your preview client or route mocks. The old integrated e2e may require B's v2 backend; identify that dependency rather than patching B's routes. After integration, the fourth teammate runs the full browser suite against real local APIs with simulated providers, then the configured live walkthrough.

Do not install additional packages or change the shared contract. Complete the screenshot and keyboard acceptance checks in `ramp-ui.md`. Finish with changed files, actual desktop/mobile screenshots, commands/results, remaining integration dependencies and a concise handoff. Your job ends with a working reviewer interface, not a static screenshot.
