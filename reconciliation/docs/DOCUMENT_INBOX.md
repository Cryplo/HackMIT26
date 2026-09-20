# Document inbox demo

The `/import` page accepts up to 12 synthetic PDFs/PNGs/JPGs, at most 8 MiB each. Email chains must be exported as PDFs. It reads two files at a time, classifies them, suggests links, and creates ordinary Sift claims only after the reviewer confirms the documents and request details.

## Run the isolated demonstration

Use Node 22.18+ (verified with Node 24.19). From `reconciliation/`:

```sh
npm run demo:inbox -- --port 3017
```

Open `http://127.0.0.1:3017/overview`, choose **Import paperwork** in the dashboard’s **Paperwork sources** panel, and select **Try sample paperwork**. The launcher creates a fresh private empty claim store, strips provider/database credentials, and leaves existing stores untouched. The sample button downloads ten fictional files (nine unique originals) and uploads them through the normal inbox API. In this demo command, extraction is **simulated, exact-byte authored fixtures**, not OCR. Files with different contents fail visibly rather than inventing extracted facts. Filenames do not drive matching.

The pack contains:

- Ava's $180 hotel receipt and matching booking reference; a separate email requests $190. Both documents are suggested for Ava's case. Confirm it and open the saved claim: ordinary checks flag the $10 discrepancy.
- Two distinct $120 Maple Rail receipts for Ben on the same date. His email lacks a receipt/reference identifier, so it stays unassigned with two possible matches. Choose the intended receipt, expand the case, then select **Refresh from linked request** before confirming. **Prepare clarification** drafts a source-grounded question naming both receipt numbers; copying it sends nothing.

- Maya’s photographed PNG bus receipt and request email produce a complete $42 case. A renamed copy of the same PNG is counted once, with no second extraction call.
- An unrelated event agenda remains unlinked; it is never discarded or forced into a claim.

The results put original source files beside compact receipt cases. Expand a case for the linked evidence, match reasons, and request-versus-receipt comparison. Request forms and manual assignment controls are collapsed until needed. “Ready to confirm” describes intake completeness, not payment approval.

Drafts without an explicit request do not copy the receipt total into the requested amount. The reviewer must enter it. Conflicting request fields remain blank. Confirmation acknowledgements reset when fields or grouping change. A document can be promoted/demoted if classification needs correction.

## What is reused

Live extraction uses the existing Azure/OpenAI Responses configuration and one schema-constrained call per unique upload (browser SHA-256 suppresses exact copies before extraction). Matching is deterministic: exact normalized reference/receipt identity, or traveler + merchant + purchase date + amount/currency. Traveler + merchant + date without a matching amount/reference produces only a possible match for manual confirmation. Equal candidates remain unresolved; conflicting identity/reference/currency prevents automatic suggestion. Amount discrepancies are retained as warnings and evidence, not erased by matching.

The server saves extraction and original bytes before confirmation. Confirmation reads this authoritative cache, validates form inputs, attaches originals through existing storage, and finishes receipt extraction only after supporting documents have saved. Financial, identity, policy, duplicate, and human-decision checks remain the ordinary Sift checks. No model call is repeated during confirmation. Successful identical confirmation retries return the same claim; partial saves block blind repeat imports and identify the affected claim.

## Deliberate demo limits

- No Dropbox/Gmail connector, mailbox sync, raw `.eml`, ZIP, or multi-expense splitting. A PDF should describe one purchase/request; ambiguous fields remain unknown.
- The inbox is private server-local staging under the system temp directory (override `RECONCILIATION_INBOX_DIR` with a private absolute path). Claim storage still uses the existing local/Supabase configuration. Multiple replicas/serverless instances need shared staging before this feature can be used there.
- Keep the import tab open. Unsaved grouping/form edits are browser memory; originals/extraction are on disk, but there is no inbox history/recovery UI or automatic cleanup. This is synthetic data only.
- Exclusive per-document reservations prevent double confirmation without a global lock. A process killed mid-confirmation leaves that specific attempt reserved for inspection; unrelated imports can continue. A caught partial save marks the primary receipt failed when storage is available. A partial import is not silently retried or reported as success.
- Extraction classification and facts can be wrong. Confirm against original source links. This app still has no production authentication or payment execution.
- Staged call usage remains with each staged document; confirmation transfers usage to the existing claim audit. There is no aggregate billing dashboard for abandoned uploads.

## Checks

```sh
npm run test:inbox
node --conditions=react-server --import tsx --test src/lib/intake/intake.test.ts src/lib/intake/supporting-documents.test.ts
DASHBOARD_BASE_URL=http://127.0.0.1:3017 npx playwright test tests/ui/inbox.spec.ts
npm run typecheck
npm run build
```

Use only an isolated synthetic demo server for browser tests. These tests upload additional claims; they never reset a store. Backend coverage includes exact source bytes, private permissions, saved supporting evidence, amount mismatch, ambiguous matching, repeated confirmation, partial failure reservation, invalid files/origin, and provider failure. Browser tests cover dashboard entry, mixed sources, nine calls for ten files, clarification copy, grouping, correcting ambiguity, confirmation acknowledgement invalidation, ordinary review, loaded PNG evidence, and mobile overflow.

An optional **paid** live smoke check makes three synthetic extraction calls without writing claims or connecting to the database:

```sh
node --env-file=.env.local --conditions=react-server --import tsx scripts/check-inbox-live.ts
```

The live check reports actual model/latency and fails if receipt/request amounts or source linking are wrong. Simulated checks do not establish live extraction quality.

For a **paid live reading / simulated review** browser rehearsal, start a separate empty isolated server with extraction credentials loaded from your existing environment:

```sh
NEXT_DIST_DIR=.next-paperwork-live node --env-file=.env.local --conditions=react-server --import tsx scripts/inbox-demo.ts --port 3021 --live-extraction
INBOX_LIVE_SMOKE=1 DASHBOARD_BASE_URL=http://127.0.0.1:3021 npx playwright test tests/ui/inbox-live.spec.ts
```

This makes eleven extraction calls: nine mixed sample originals, then two newly authored documents outside the fixture pack. It saves synthetic claims locally and tests the ordinary simulated review handoff; it does not validate live financial assessment. Live labels and failures remain visible. Run once against a fresh server to avoid repeat-upload duplicate assessments. Restarting the launcher creates a new isolated store; do not use the dashboard’s general **Reset demo**, which seeds the separate 14-claim showcase.

## Two-minute judge walkthrough

1. Start at **Paperwork sources**: “After an event, the evidence arrives as scans, bookings, and forwarded conversations.” Open import and show the original sample files.
2. Run the batch. Point out nine unique documents and one repeated attachment. The filenames are irrelevant; content connects the evidence.
3. Open Ava: the email asks for $190, the receipt supports $180, and the booking reference connects the sources. Show both original links. Confirm it and open the saved review to show the preserved discrepancy.
4. Open Maya: a photographed receipt and request email become a complete $42 claim with no form typing. Confirm it to the existing policy review.
5. Show Ben: two plausible receipts, no invented answer. **Prepare clarification** turns the unresolved connection into a concrete, unsent follow-up.
6. Close: “Scattered files become evidence-backed cases, visible exceptions, and the next question to ask.”

This demonstrates the Dropbox brief’s digital-chaos-to-action theme; there is no Dropbox connection. Email inputs are PDFs exported from email, not mailbox sync. See the [sponsor brief](https://docs.google.com/document/d/1JxZA0eiX2iWj_-B5xtCo59FylUDlv3I35n5n8W0aIVs/edit?tab=t.0).

## Verification recorded September 20, 2026

Node 24.19.0: 19 focused backend/intake checks passed, two simulated Chrome browser tests passed (desktop workflow and 390px mobile), two opt-in live extraction browser tests passed, and TypeScript and production build passed. Production file tracing includes all ten fixture assets/manifest. Tests use private temporary stores; shared live claims were not changed.

A first three-file Azure `gpt-5.6-luna` extraction run read amounts correctly but did not link the email. One diagnostic email call recovered the reference, demonstrating model variability. After clarifying subject/quoted-reference extraction and adding a conservative manual-match fallback, the three-file smoke check passed: booking 2,008 ms, receipt 2,391 ms, email 3,185 ms. These are observed individual call times for three fictional one-page PDFs, not a throughput or accuracy benchmark. Seven paid extraction calls were made in total; no live claim/import or Supabase write was performed. That initial browser demo was explicitly simulated.

The visual second pass made 20 paid Azure `gpt-5.6-luna` calls: nine mixed originals twice and two newly authored PDFs once. The first mixed run completed all extraction and both claim saves, then hit a test-only exact-text locator error; the corrected mixed test passed. The nine-file batches took 15.4 and 18.0 seconds wall time (two reads concurrently); individual reads took 1.85–5.08 seconds. The new Nora receipt/email pair took 1.95 and 3.45 seconds, matched by content, and preserved $57 requested versus $55 paid. The corrected browser test verified the PNG case, the $10 discrepancy, ambiguous email abstention, duplicate suppression, and ordinary local claim saves. Review remained simulated and no shared database was written. The unrelated agenda was classified as `other` in one run and `itinerary` in another, but remained unlinked; classifications are model output, not a fixed accuracy guarantee.
