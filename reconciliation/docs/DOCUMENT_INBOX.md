# Document inbox demo

The `/import` page accepts up to 12 synthetic PDFs/PNGs/JPGs, at most 8 MiB each. Email chains must be exported as PDFs. It reads two files at a time, classifies them, suggests links, and creates ordinary Sift claims only after the reviewer confirms the documents and request details.

## Run the isolated demonstration

Use Node 22.18+ (verified with Node 24.19). From `reconciliation/`:

```sh
NEXT_DIST_DIR=.next-inbox npm run demo -- --showcase --audit-ready --port 3017
```

Open `http://127.0.0.1:3017/import` and select **Try sample paperwork**. This downloads six fictional PDFs and uploads them through the normal inbox API. In this demo command, extraction is **simulated, exact-byte authored fixtures**, not OCR. Files with different contents fail visibly rather than inventing extracted facts. Filenames do not drive matching.

The pack contains:

- Ava's $180 hotel receipt and matching booking reference; a separate email requests $190. Both documents are suggested for Ava's case. Confirm it and open the saved claim: ordinary checks flag the $10 discrepancy.
- Two distinct $120 Maple Rail receipts for Ben on the same date. His email lacks a receipt/reference identifier, so it stays unassigned with two possible matches. Choose the intended receipt, then select **Refresh fields from linked request** before confirming.

Drafts without an explicit request do not copy the receipt total into the requested amount. The reviewer must enter it. Conflicting request fields remain blank. Confirmation acknowledgements reset when fields or grouping change. A document can be promoted/demoted if classification needs correction.

## What is reused

Live extraction uses the existing Azure/OpenAI Responses configuration and one schema-constrained call per upload. Matching is deterministic: exact normalized reference/receipt identity, or traveler + merchant + purchase date + amount/currency. Traveler + merchant + date without a matching amount/reference produces only a possible match for manual confirmation. Equal candidates remain unresolved; conflicting identity/reference/currency prevents automatic suggestion. Amount discrepancies are retained as warnings and evidence, not erased by matching.

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

Use only an isolated synthetic demo server for browser tests. These tests upload additional claims; they never reset a store. Backend coverage includes exact source bytes, private permissions, saved supporting evidence, amount mismatch, ambiguous matching, repeated confirmation, partial failure reservation, invalid files/origin, and provider failure. Browser tests cover grouping, correcting ambiguity, confirmation, ordinary review, and mobile overflow.

An optional **paid** live smoke check makes three synthetic extraction calls without writing claims or connecting to the database:

```sh
node --env-file=.env.local --conditions=react-server --import tsx scripts/check-inbox-live.ts
```

The live check reports actual model/latency and fails if receipt/request amounts or source linking are wrong. Simulated checks do not establish live extraction quality.

## Verification recorded September 20, 2026

Node 24.19.0: 17 focused backend/intake checks passed, two Chrome browser tests passed (desktop workflow and 390px mobile), TypeScript and production build passed. Tests use private temporary stores; shared live claims were not changed.

A first three-file Azure `gpt-5.6-luna` extraction run read amounts correctly but did not link the email. One diagnostic email call recovered the reference, demonstrating model variability. After clarifying subject/quoted-reference extraction and adding a conservative manual-match fallback, the three-file smoke check passed: booking 2,008 ms, receipt 2,391 ms, email 3,185 ms. These are observed individual call times for three fictional one-page PDFs, not a throughput or accuracy benchmark. Seven paid extraction calls were made in total; no live claim/import or Supabase write was performed. The browser demo remains explicitly simulated.
