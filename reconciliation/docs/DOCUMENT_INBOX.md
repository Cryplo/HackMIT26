# Document inbox demo

The `/import` Data sources page accepts up to 12 synthetic PDFs/PNGs/JPGs (8 MiB each) and UTF-8 CSV/TXT/EML exports (100 KB each). The picker accepts any file selection; unsupported formats fail visibly. It reads two files at a time, classifies them, suggests links, and supports manual confirmation into ordinary Sift claims. In the isolated source-audit demo, **Start audit** also reads the sample originals and automatically queues complete, unambiguous requests before checking them.

## Run the isolated demonstration

Use Node 22.18+ (verified with Node 24.19). From `reconciliation/`:

```sh
npm run demo:inbox -- --port 3017
```

Open `http://127.0.0.1:3017/overview` and choose **Start audit**. The launcher enables `RECONCILIATION_SOURCE_AUDIT=true`, creates a fresh private empty claim store, strips provider/database credentials, and leaves existing stores untouched. Start audit reads eleven fictional PDF/PNG/EML/CSV files (ten unique originals), links their evidence, queues complete requests, and runs the ordinary claim checks. No manual parse/confirm step is needed for clear matches. **Stop after active checks** also pauses intake after the current file; reloading and starting again resumes saved progress without rereading successful files.

The graph shows observed reading and claim handoff. **Inspect inputs and connections** opens the same saved extractions on Data sources, including held documents and original links. The page also supports separate manual uploads. The completion dialog distinguishes checked claims from source inputs that still need a connection or details.

Default extraction is **simulated, exact-byte authored fixtures**, not OCR. Files with different contents fail visibly rather than inventing extracted facts. Filenames do not drive matching. Use the explicit live launcher below for actual AI extraction.

The pack contains:

- Ava's $180 hotel receipt and matching booking reference; a separate email and a CSV form response request $190. These three supporting sources are suggested for Ava's case. Start audit creates this case and ordinary checks flag the $10 discrepancy.
- Two distinct $120 Maple Rail receipts for Ben on the same date. His email lacks a receipt/reference identifier, so it stays unassigned with two possible matches. Choose the intended receipt, expand the case, then select **Refresh from linked request** before confirming. **Prepare clarification** drafts a source-grounded question naming both receipt numbers; copying it sends nothing.

- Maya’s photographed PNG bus receipt and real `.eml` request email export produce a complete $42 case. A renamed copy of the same PNG is counted once, with no second extraction call.
- An unrelated event agenda remains unlinked; it is never discarded or forced into a claim.

The results put original source files beside compact receipt cases. Expand a case for the linked evidence, match reasons, and request-versus-receipt comparison. Request forms and manual assignment controls are collapsed until needed. “Ready to confirm” describes intake completeness, not payment approval.

Drafts without an explicit request do not copy the receipt total into the requested amount. The reviewer must enter it. Conflicting request fields remain blank. Confirmation acknowledgements reset when fields or grouping change. A document can be promoted/demoted if classification needs correction.

## What is reused

Live extraction uses the existing Azure/OpenAI Responses configuration and one schema-constrained call per unique upload (browser SHA-256 suppresses exact copies before extraction). Matching is deterministic: exact normalized reference/receipt identity, or traveler + merchant + purchase date + amount/currency. Traveler + merchant + date without a matching amount/reference produces only a possible match for manual confirmation. Equal candidates remain unresolved; conflicting identity/reference/currency prevents automatic suggestion. Amount discrepancies are retained as warnings and evidence, not erased by matching.

The server saves extraction and original bytes before confirmation. Confirmation reads this authoritative cache, validates form inputs, attaches originals through existing storage, and finishes receipt extraction only after supporting documents have saved. Financial, identity, policy, duplicate, and human-decision checks remain the ordinary Sift checks. No model call is repeated during confirmation. Successful identical confirmation retries return the same claim; partial saves block blind repeat imports and identify the affected claim.

## Deliberate demo limits

- No Dropbox/Gmail/Forms account connection, mailbox sync, ZIP/Office parsing, or multi-expense splitting. CSV should contain one response; EML supports readable text exports, not MIME attachment decoding. Each document should describe one purchase/request; ambiguous fields remain unknown.
- The inbox is private server-local staging under the system temp directory (override `RECONCILIATION_INBOX_DIR` with a private absolute path). Claim storage still uses the existing local/Supabase configuration. Multiple replicas/serverless instances need shared staging before this feature can be used there.
- The source audit saves one batch on disk and restores its inputs and successful confirmations on Data sources. Unsaved manual grouping/form edits and separately uploaded files are still browser-session state; keep that tab open. There is no general inbox history or automatic cleanup. This is synthetic data only.
- Source ingestion advances one file per request and uses an exclusive filesystem lock. This keeps the hackathon flow resumable without adding a job queue. A killed server can leave the batch locked; restart the isolated launcher for a new store instead of deleting reservations. Failed batches require inspection, not blind automatic replay.
- Start a fresh launcher process to replay the source demo. The ordinary Reset demo control is hidden in this mode because it seeds the separate 14-claim showcase. Source audit is opt-in and does not change ordinary workspace audit inputs.
- Exclusive per-document reservations prevent double confirmation without a global lock. A process killed mid-confirmation leaves that specific attempt reserved for inspection; unrelated imports can continue. A caught partial save marks the primary receipt failed when storage is available. A partial import is not silently retried or reported as success.
- Extraction classification and facts can be wrong. Confirm against original source links. This app still has no production authentication or payment execution.
- Staged call usage remains with each staged document; confirmation transfers usage to the existing claim audit. There is no aggregate billing dashboard for abandoned uploads.

## Checks

```sh
npm run test:inbox
node --conditions=react-server --import tsx --test src/lib/intake/intake.test.ts src/lib/intake/supporting-documents.test.ts
DASHBOARD_BASE_URL=http://127.0.0.1:3017 npx playwright test tests/ui/source-audit.spec.ts
# Use another fresh isolated server for the separate manual-import suite:
DASHBOARD_BASE_URL=http://127.0.0.1:3018 npx playwright test tests/ui/inbox.spec.ts
npm run typecheck
npm run build
```

Use only an isolated synthetic demo server for browser tests. These tests upload additional claims; they never reset a store. Backend coverage includes exact source bytes, private permissions, saved supporting evidence, amount mismatch, ambiguous matching, repeated confirmation, partial failure reservation, invalid files/origin, and provider failure. Browser tests cover dashboard entry, mixed sources, ten calls for eleven files, clarification copy, grouping, correcting ambiguity, confirmation acknowledgement invalidation, ordinary review, loaded PNG evidence, and mobile overflow.

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

The complete opt-in live suite makes fourteen extraction calls: ten mixed originals, two newly authored PDFs, and two CSV/EML reads. Use `--grep "CSV and email"` for only the two text-source reads. It saves synthetic claims locally and tests the ordinary simulated review handoff; it does not validate live financial assessment. Live labels and failures remain visible. Run once against a fresh server to avoid repeat-upload duplicate assessments. Restarting the launcher creates a new isolated store; do not use the dashboard’s general **Reset demo**, which seeds the separate 14-claim showcase.

## Demo data-source routes

The top overview source panel has been removed. `/import` is the source-connection page: Google Forms, Gmail, and Dropbox cards use service icons and open connection mockups. A single sample-workspace note makes clear that accounts are not connected. The sample browser presents a form response, email exports, folder PDFs, and a receipt image beside extraction output. **Parse this input** and **Read all sample inputs** run the real inbox API; the extracted-fields panel displays the actual returned provider and latency, or an explicit authored-simulation label. Preview associations use byte hashes rather than filenames. **Read remaining inputs** works after a single-file read.

The overview graph now contains incoming source cards instead of a second source section. Browser-local activity records uploads, parsing, failures, and saved sources; storage events update another overview tab on the same origin. Source-to-Waiting animation follows a successful case save, with no fabricated model stages. This is a bounded recent-activity view (24 items, one hour), not connector sync or durable audit history. It contains filenames/statuses only. A timed-out reading is shown as needing attention. Confirmation can advance a case through Waiting quickly because review starts automatically.

The extractor remains Azure/OpenAI because the existing Jev adapter consumes already-parsed claim evidence for merchant, identity, and duplicate decisions. Text formats use Responses `input_text`; PDFs and photos retain the existing file/image path. Matching is still deterministic.

## Two-minute judge walkthrough

1. Start at **Data sources**: “After an event, the evidence arrives as scans, bookings, and forwarded conversations.” Open the source page and browse the form, email, and folder samples before reading them.
2. Run the batch. Point out ten unique documents and one repeated attachment. The filenames are irrelevant; content connects the evidence.
3. Open Ava: the email asks for $190, the receipt supports $180, and the booking reference connects the sources. Show both original links. Confirm it and open the saved review to show the preserved discrepancy.
4. Open Maya: a photographed receipt and request email become a complete $42 claim with no form typing. Confirm it to the existing policy review.
5. Show Ben: two plausible receipts, no invented answer. **Prepare clarification** turns the unresolved connection into a concrete, unsent follow-up.
6. Close: “Scattered files become evidence-backed cases, visible exceptions, and the next question to ask.”

This demonstrates the Dropbox brief’s digital-chaos-to-action theme; there is no Dropbox connection. Email inputs can be exported PDFs or readable EML files; there is no mailbox sync. See the [sponsor brief](https://docs.google.com/document/d/1JxZA0eiX2iWj_-B5xtCo59FylUDlv3I35n5n8W0aIVs/edit?tab=t.0).

## Verification recorded September 20, 2026

Node 24.19.0: 19 focused backend/intake checks passed, two simulated Chrome browser tests passed (desktop workflow and 390px mobile), two opt-in live extraction browser tests passed, and TypeScript and production build passed. Production file tracing includes all ten fixture assets/manifest. Tests use private temporary stores; shared live claims were not changed.

A first three-file Azure `gpt-5.6-luna` extraction run read amounts correctly but did not link the email. One diagnostic email call recovered the reference, demonstrating model variability. After clarifying subject/quoted-reference extraction and adding a conservative manual-match fallback, the three-file smoke check passed: booking 2,008 ms, receipt 2,391 ms, email 3,185 ms. These are observed individual call times for three fictional one-page PDFs, not a throughput or accuracy benchmark. Seven paid extraction calls were made in total; no live claim/import or Supabase write was performed. That initial browser demo was explicitly simulated.

The visual second pass made 20 paid Azure `gpt-5.6-luna` calls: nine mixed originals twice and two newly authored PDFs once. The first mixed run completed all extraction and both claim saves, then hit a test-only exact-text locator error; the corrected mixed test passed. The nine-file batches took 15.4 and 18.0 seconds wall time (two reads concurrently); individual reads took 1.85–5.08 seconds. The new Nora receipt/email pair took 1.95 and 3.45 seconds, matched by content, and preserved $57 requested versus $55 paid. The corrected browser test verified the PNG case, the $10 discrepancy, ambiguous email abstention, duplicate suppression, and ordinary local claim saves. Review remained simulated and no shared database was written. The unrelated agenda was classified as `other` in one run and `itinerary` in another, but remained unlinked; classifications are model output, not a fixed accuracy guarantee.

Data-source visual refinement: connector geometry check, desktop/mobile browser flow, TypeScript, and production build passed. No additional paid extraction calls were needed for this presentation change.

Source-explorer pass: 20 focused inbox/intake checks, connector geometry, three desktop/mobile/cross-tab browser tests, TypeScript, and production build passed. The incremental browser check reads a form first, then a receipt, and verifies that the earlier request links automatically without erasing manual assignments or edited drafts. Three paid Azure calls were made: the initial CSV check exposed an incorrectly copied request amount in the receipt-total field; after clarifying the extraction instruction in both directions, the CSV and unseen EML tests passed at 2,233 ms and 2,691 ms. This verifies those two reads, not general extraction accuracy. Existing PDF/image live results above remain dated evidence; the full live suite was not rerun for this pass.


## Start-audit verification, September 20

Twelve focused backend/session/supporting-evidence checks and two final simulated browser checks passed (including ordinary workspaces with source audit disabled), including mixed-format intake, exact-copy suppression, queue-before-audit ordering, ambiguous holds, preserved $190/$180 amounts, idempotent replay, and recovery of manually confirmed cases. TypeScript and the production build passed.

The new `tests/ui/source-audit.spec.ts` passed against a fresh **live-extraction / simulated-review** server in **37.2 seconds** including browser setup, pause, reload, resume, and inspection. Ten Azure `gpt-5.6-luna` extractions took 2.002–3.922 seconds each. The run produced two claims: Ava flagged/pending and Maya matched/automatically approved under simulated review. Four source inputs remained held; the duplicate PNG incurred no second extraction. The browser verified the persisted EML and CSV fields, no duplicate imports on replay, and mobile overflow. These results establish this synthetic sample run, not general OCR accuracy or live financial-assessment quality.

Run that browser check only against a fresh isolated launcher. With `--live-extraction`, it spends ten extraction calls; without the flag it uses authored fixtures. Real source account connections remain mockups.
