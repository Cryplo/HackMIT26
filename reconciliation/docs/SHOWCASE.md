# Fourteen-claim offline showcase

From `reconciliation/`, use Node 24:

```sh
PATH="/Users/jaydenl/.nvm/versions/node/v24.11.1/bin:$PATH" NEXT_DIST_DIR=.next-showcase npm run demo -- --showcase --port 3002
```

The command creates a new private temporary directory and prints its path, then serves the demo at `http://127.0.0.1:3002`. It disables provider and Supabase credentials and explicitly enables simulated investigations and justifications. `--showcase --live-jev` is rejected. It never opens or changes the shared database.

To begin with 14 genuinely unchecked claims and run the audit during the demonstration:

```sh
PATH="/Users/jaydenl/.nvm/versions/node/v24.11.1/bin:$PATH" NEXT_DIST_DIR=.next-audit \
npm run demo -- --showcase --audit-ready --port 3003
```

Open `http://127.0.0.1:3003/overview` and choose **Start audit**. Audit-ready seeds the same 14 receipt PDFs, eight supporting PDFs, cached authored transcriptions, and five policies, with every claim pending and no assessments, decisions, corrections, investigations, or learned rules/procedures. It skips initial reconciliation rather than hiding saved results. The flag requires `--showcase`, cannot be used with `--live-jev`, and explicitly enables simulated investigation plus policy-caps automation, even if inherited automation is disabled. Fresh-directory protections are unchanged.

The audit executes the ordinary checks and stores actual simulated tool steps and decisions; it does not inject outcome labels or call live providers. Audit-ready adds a 1.2-second pause while each simulated evidence tool is running so its persisted activity is visible. Live investigations never receive that pause. The existing cases produce automatic investigations for Morgan's conflicting booking and Riley's receipt-only identity restriction; both remain unresolved. Sam and Taylor's matching bookings are already understood by the baseline evaluator and ordinarily pass without investigation. This mode demonstrates real application execution with simulated intelligence, not live OCR or a guaranteed resolved-investigation example. The table below describes the default assessed showcase and expected results after an audit, not the unchecked starting state.

The simulation reset archives the current private file store beside its directory (`.archive-<id>`) and restores all 14 claims to pending and unchecked, including the 22 original PDFs. It rejects stale snapshots and active checks or uploads. Review and knowledge revisions advance to invalidate old actions; review history and learned rules start empty. Interrupted replacements recover from the archive before the next file-store operation. This simulation reset is restricted to local synthetic storage with no Supabase configuration.

Start at `/overview` for the review desk. Its totals show pending money, approved money, and automatic approvals; the totals are not buttons. The primary review queue contains inconclusive claims needing human judgment. Confirmed failures are a separate red group, and clean passes are approved automatically. Reimbursements shows one status per claim, and **Check unchecked** appears when there are unchecked claims. Select all filtered claims to recheck them. Navigation shares a cached workspace, and completed actions update its rows and counts.

Saving a review advances within the same group, and the final decision closes the review. Errors and cancelled decisions keep the current claim open. A review-session progress bar shows how many claims the reviewer has completed. Visible facts show green passed checks, red failures, and amber unresolved checks, with icons/text as well as color. Receipt metadata and tool-call details remain expandable. Spinners indicate actual active checks, investigations, uploads, and saves.

Approving or rejecting automatically creates the applicant notice. Routine decisions use saved facts with no email editor. Uncertain or custom decisions ask for an **Internal review reason**, saved with the decision and considered for learning; it is never copied into applicant email. Approval notices are generic. Discretionary rejections have a separate collapsed **Applicant message (optional)**, prefilled with neutral wording and editable independently. A blank recipient message uses the standard rejection notice. A short green/red paper-plane confirmation shows **Email simulated**, **Email queued**, or **Email accepted for delivery**, then advances automatically. Delivery problems keep the saved decision visible and direct the reviewer to applicant communication. The demo launcher retains template/preview mode: no real email is sent. Bulk rejections and new policy-based automatic approvals also produce notices, without turning machine approvals into human learning feedback.

**Reject all confirmed failures** records an explicit human rejection for only the displayed confirmed-failure claims, using each saved reason. A supported financial discrepancy or confirmed duplicate is required; a model flag alone, stale evidence, an interrupted check, or an inconclusive result is excluded. The batch verifies current revisions/knowledge before each write, stops on a changed claim or error, and reports partial completion without replaying decisions. Automatic rejection remains off. Inconclusive decisions require a human reason; rejecting a known failure uses its editable suggested reason.

The default flow is receipt upload → parse once → check → investigate useful supporting evidence when needed → approve clean claims within the existing category policy caps. A successful explicit reparse or supporting-document upload also starts checks. Rechecks reuse the saved extraction. Automatic investigation is limited to unresolved merchant/traveler checks with readable supporting evidence and no financial or duplicate blocker. Unchanged evidence does not trigger repeated automatic attempts. Only unresolved exceptions reach the human queue; Sift never automatically rejects a claim.

**Auto-approved** identifies a policy-based decision, **Approved** identifies human approval, **Issue found** identifies a failed check, and **Needs evidence** identifies uncertainty. **Ready for approval** can appear when automation is disabled. Known rejection reasons are editable defaults; accepting one needs no typing. A decision with no clear supported reason, or one that reverses an existing decision, asks for an explanation. These approvals do not send payments.

Each start creates a fresh showcase. To choose a location, set `RECONCILIATION_INTAKE_DEMO_DIR` to a **nonexistent** directory with an existing parent outside `public/`. Existing directories are refused, even when empty. The launcher does not reset existing data; use **Reset demo** in the running app. To resume a previously printed directory, omit `--showcase` and use the existing demo wrapper:

```sh
RECONCILIATION_INTAKE_DEMO_DIR=/private/tmp/your-existing-showcase \
RECONCILIATION_INVESTIGATION_MODE=simulated \
RECONCILIATION_JUSTIFICATION_MODE=simulated \
NEXT_DIST_DIR=.next-showcase \
/Users/jaydenl/.nvm/versions/node/v24.11.1/bin/node scripts/demo.mjs --port 3002
```

The current seed uses fictional merchants Northstar Airlines, Maple Rail, Cedar Bus, and Harbor Reservations. Purchases span September 3–16, 2026; submissions follow on September 18–20 with separate timestamps. Travelers originate in New York, Chicago, Philadelphia, Providence, Seattle, and Washington, with deliberate repeated origins. Flights and transit arrive in Boston; one-night hotel stays are in Boston and Cambridge between September 16 and 20. Hotel receipts record prepaid accommodation, so a purchase or submission can precede checkout.

The PDFs use original vector brand marks, colored headers, structured passenger/guest and route/stay blocks, itemized fare/room charges plus taxes, large totals, and masked card details. Hotel folios, airline receipts, transit tickets, and Drew's alternate payment confirmation have distinct layouts. Booking confirmations and the itinerary are labeled as supporting reservation records, not payment receipts. Every page says **Fictional demo document — not valid for payment**. Layout references were the [eForms hotel invoice](https://eforms.com/invoice-template/hotel/) and [Jotform flight itinerary](https://www.jotform.com/form-templates/upcoming-flight-itinerary); the documents do not copy real merchant receipts or logos.

Hotel booking confirmations identify Harbor Hotel; the different billing name still needs matching purchase evidence. Original IDs now begin `62000000` for receipts and `64000000` for supporting documents, preserving archived PDFs from earlier seeds. Claim (`41000000`) and policy (`43000000`) IDs stay unchanged. Existing stored workspaces keep their previous facts until **Reset demo** archives and reseeds them. The receipt total remains $2,695.00 and requested total $2,705.00.

Riley's and Alex's primary receipts omit their names everywhere, including references and card details; their supporting documents supply the names. Their neutral booking references are `HBR-8F4Q2` and `NS-7Q2M4A`. Morgan's second booking reference intentionally conflicts. Maya's two $89 train purchases share a vendor and purchase date but have distinct receipt numbers and travel dates. Drew's pair shares the exact purchase identity and route; the alternate confirmation has different PDF bytes.

All people, merchants, purchases, references, and documents are fictional. The seed creates real PDF bytes, deterministic SHA-256 hashes, and cached transcriptions returned by the same text calls that draw each PDF. Authored-transcription provenance is saved separately from document text. Itemized charges use integer cents and sum exactly to each printed total. Every original is stored privately and opens through the normal receipt/supporting-document routes. Initial results come from ordinary `CoreService.reconcile` calls using the simulated evaluator: 14 assessments, two automatic investigations, eight automatic approvals, six pending claims, zero human decisions, and zero learned rules/procedures. Investigation and approval results are computed, not injected labels.

| # | Attendee | Case to demonstrate | Starting status |
|---|---|---|---|
| 1 | Avery Rowan | Ordinary $240 flight | Auto-approved |
| 2 | Maya Ellis | Ordinary $89 train; lookalike A, receipt `SHOW-RAIL-201` | Auto-approved |
| 3 | Sam Mercer | $180 hotel billed as `Harbor Reservations`; matching booking `HARBOR-SAM-301` identifies Harbor Hotel | Auto-approved |
| 4 | Taylor Quinn | Later $195 hotel, separate receipt and own matching booking `HARBOR-TAYLOR-302` | Auto-approved |
| 5 | Morgan Blake | One matching hotel confirmation plus a second conflicting reference | Needs evidence after automatic investigation |
| 6 | Casey Reed | Hotel receipt has a reference but no booking confirmation | Needs evidence; no useful supporting document to investigate |
| 7 | Riley Chen | Hotel receipt omits traveler; booking names Riley, but hotel policy requires receipt identity | Needs evidence after automatic investigation |
| 8 | Alex Jordan | Flight receipt omits traveler; matching itinerary names Alex under an explicit policy allowance | Auto-approved |
| 9 | Jamie Park | Requests $190 against a $180 receipt; matching hotel booking cannot repair the amount | Issue found; suggested rejection reason |
| 10 | Cameron Lee | $275 hotel exceeds the $250 cap | Issue found; suggested rejection reason |
| 11 | Drew Santos | First claim for the $310 flight purchase | Auto-approved |
| 12 | Drew Santos | Payment-confirmation PDF for the same purchase as #11; different bytes, same receipt identity | Issue found; duplicate purchase |
| 13 | Maya Ellis | Same vendor/date/$89 as #2, distinct receipt `SHOW-RAIL-202` | Auto-approved; distinct purchase |
| 14 | Jordan Vale | Ordinary $42 bus receipt | Auto-approved |

Claim IDs have the form `41000000-0000-4000-8000-000000000003` (last digits are the case number). Labels in this table are a demonstration guide; they are not injected into documents or model evidence.

## Learning walkthrough

A human review reason can now start learning automatically after the decision is saved. Ordinary review does not require a draft/test/activation sequence or a resolved investigation. Learning saves a narrow evidence check; it does not retrain the model, change reimbursement policy, or send payments. Automatic approvals do not count as human feedback.

The supported automatic pattern is **hotel billing descriptor → hotel identity**, corroborated by that claim's own successfully extracted receipt and booking confirmation. Booking reference, merchant relationship, guest, purchase date, amount, and currency must agree. Mandatory financial, identity, policy, and duplicate checks must still pass. A one-time exception, absent or conflicting evidence, or arbitrary reviewer instruction cannot create a reusable check. A proposed policy change needs confirmation and is not activated automatically.

### Run the human-approval example

The default 14-claim showcase already automatically approves **Sam Mercer** and **Taylor Quinn**. Start a separate private store with automatic claim approval disabled to review Sam manually:

```sh
learning_demo_parent="$(mktemp -d /private/tmp/sift-learning-XXXXXX)"
PATH="/Users/jaydenl/.nvm/versions/node/v24.11.1/bin:$PATH" \
RECONCILIATION_INTAKE_DEMO_DIR="$learning_demo_parent/store" \
RECONCILIATION_AUTOMATION_MODE=disabled NEXT_DIST_DIR=.next-learning \
npm run demo -- --showcase --port 3006
```

Open `http://127.0.0.1:3006/business-demo`. The nonexistent `store` path ensures a new private dataset; this command does not change the default showcase or live database. Do **not** add `--audit-ready`: that flag explicitly reenables policy-caps automation. `RECONCILIATION_AUTOMATION_MODE=disabled` disables core automatic claim approvals; the separate learning job still runs after an explicit human decision.

1. Open **Sam Mercer**, inspect his $180 receipt and matching booking confirmation, and choose **Edit reason** beside the suggested approval reason.
2. Set **Internal review reason** to: **“Harbor Reservations is Harbor Hotel: the booking confirmation matches this receipt’s booking reference, amount and guest.”** Choose **Approve & notify**. The notice is simulated and does not include that internal reason.
3. The approval saves first and the review can advance immediately. Background learning classifies the reason against the stored evidence, derives a scoped check, runs the twelve-case safety test, and activates only a passing, current candidate. Look in the claim or **Learned rules** for **Checking what can be learned**, **Testing saved check**, then **Saved for similar claims**. Brief intermediate states may complete before you see them.
4. Open Sam from **Learned rules** and expand **Learning from this claim** to inspect the actual saved check and its test report. **Turn off check** remains available. Eligible undecided claims are rechecked in the background, prioritizing matching merchants; human decisions are preserved. Taylor's claim must use Taylor's own receipt and booking. With automatic claim approval disabled, a passing recheck does not approve Taylor.
5. A failed job keeps the decision. Expand **Learning could not finish** and choose **Retry learning** after reviewing the current evidence. Retry applies only to the latest failed review feedback and current revision. A stale or changed source must be reviewed again; retry never silently repeats the decision. **No reusable check saved** and **Learning needs confirmation** are honest outcomes, not successful activation.

The separate `?preview=1` UI preview saves notes but does not run automatic learning; it explicitly reports that limitation. Use the private file-store command above for the complete simulated path. The live workflow requires `supabase/migrations/202609200010_feedback_learning.sql`; migration application is a deployment step, not established by this walkthrough. Live classification and activation depend on the actual provider and safety-test results.

Sam and Taylor already pass the simulated baseline. A 12/12-before and 12/12-after report is a passing safety tie, **not reduced errors or improved model accuracy**. The check makes an evidence relationship reusable; never present simulated results as a live benchmark. Morgan's conflicting booking, Casey's missing booking, Riley's receipt-only identity requirement, Jamie's overclaim, Cameron's policy-cap failure, and Drew's duplicate remain protected. Maya's distinct receipt numbers remain distinct purchases.

### Advanced manual procedure workflow

Existing manual controls remain available for an eligible completed **resolved** investigation with a suggested check and a supported human approval: expand **Learning from this claim**, choose **Save check draft**, **Test check**, then **Turn on check** after a current passing report. This is separate from automatic review-feedback learning. The stock seed does not guarantee an eligible investigation candidate: Morgan and Riley remain unresolved, while Sam and Taylor already pass without investigation. Do not inject an investigation outcome or approval to manufacture this advanced example.

Hotel/bus/other identity policy is receipt-only; flight/train policy permits a correctly linked itinerary. USD caps are $500 flight, $250 hotel, $200 train, $100 bus, and $50 other, for September 2026 receipts. Learning cannot override these constraints. See [Review learning](REVIEW_LEARNING.md) for lifecycle and failure behavior.

## One focused offline check

```sh
/Users/jaydenl/.nvm/versions/node/v24.11.1/bin/node --conditions=react-server --import tsx scripts/check-showcase.ts
```

This creates and removes its own temporary store, rejects all network calls, checks original access/hashes, deterministic generation, printed text against cached facts, line-item totals, date/origin diversity, exact requested/receipt sums, financial/duplicate/identity cases, and confirms an existing store cannot be overwritten. To seed without starting a server:

```sh
/Users/jaydenl/.nvm/versions/node/v24.11.1/bin/node --conditions=react-server --import tsx scripts/seed-showcase.ts /private/tmp/new-sift-showcase
```

## Live services

**Current dataset: 80 claims, 80 pre-parsed fictional receipt PDFs, 20 supporting documents.** On September 20 the live workspace was expanded by appending 66 claims, preserving the original 14 claims and all saved evidence/decisions/history. The new records start unchecked; no assessments, investigations, or notices were generated by seeding. The original case table and 14-claim counts above describe the local simulation and the first live cohort. Cached transcription is authored seed evidence, not live OCR.

The Data sources page at `/import` includes a 21-row Forms spreadsheet preview. Select a row to import that response individually; the entire CSV is not treated as a single claim. Browsing or importing a selected row remains separate from enabling sample-source audit.

The added cohort contains 24 flights, 18 train trips, 12 bus trips, and 12 hotel stays. It varies names, dates, origins, merchants, totals, and references, with supported amount/cap issues and matching, missing, or conflicting bookings.

With migration `202609210015_live_demo_baseline_70.sql`, live **Reset demo** restores **70 checked claims and 10 unchecked claims**. Migration 015 is applied to the configured live demo; the new reset still requires separate outcome verification. The 70 checked claims have explicitly **prepared demo history**, calculated offline with the simulated fixture evaluator: 59 approved, seven authored rejection examples, and four inconclusive claims awaiting review. This is not a claim that live Jev or a human reviewer produced those historical outcomes. Every prepared run and decision carries `demo_baseline: true` and provenance; no model usage, investigations, notices, or feedback-learning jobs are invented or triggered during reset. The original 80 receipt PDFs and 20 supporting PDFs stay unchanged. The separate local fourteen-claim simulation is unchanged.

The remaining 10 use ordinary live checking after **Start audit**. Their seed numbers are UUID suffixes on `41000000-0000-4000-8000-`:

| Seed numbers | Scenario |
| --- | --- |
| 1, 2, 13, 14 | Four matched flight, train, and bus candidates |
| 9 | Requested amount differs from the receipt |
| 10 | Hotel policy cap exceeded |
| 12 | Drew's duplicate purchase, with the first purchase already checked |
| 5 | Morgan's conflicting hotel confirmations; investigation candidate |
| 6 | Casey's missing booking; no supporting evidence to investigate |
| 7 | Riley's missing receipt identity under receipt-only policy; investigation candidate |

The selected scenarios give four matched, three flagged, and three inconclusive outcomes for these ten in the offline fixture; only Morgan and Riley qualify for automatic investigation. Live outcomes remain model-dependent. The seven prepared rejections are claims 15, 30, 35, 37, 44, 59, and 68; their reasons begin **Prepared demo decision:**. Claims 36, 47, 69, and 80 are already checked but still need review.

Focused verification, without network calls:

```sh
node --conditions=react-server --import tsx --test src/lib/demo/live-baseline.test.ts
```

This verifies the counts, unchanged PDFs, ten-claim case mix, two investigation candidates, SQL round-trip approval markers, advancing revisions, custom-check archival, and atomic rollback. Applying the migration alone does not reset live data.


The showcase on port 3002 is intentionally simulated. The live app at `http://127.0.0.1:3000` uses Supabase persistence, Azure/OpenAI extraction, Jev assessment, and an Azure investigator with persisted read-tool calls. Intake, extraction, assessment, and investigation are enabled in the live environment; automation uses the policy caps. Applicant email remains template/preview only; decision and policy-approval notices are prepared automatically, held until the reviewer confirms the notification batch.

On September 20, 2026, `supabase/migrations/202609200004_communications.sql` was applied (platform version 4). The private database archive `sift_archive_20260920` preserves the previous 122 claims and their related tables. The verified local backup at `.seed-archives/pre-live-20260920` includes all 122 original receipt files.

The earlier replacement live seed contained 14 fresh claims, 14 receipts, and eight supporting documents. Its cached authored transcriptions are explicitly labeled as such; they are not live OCR results. New uploads use the configured live extraction path. Seed contents and offline checks do not establish a successful end-to-end live rehearsal.

Migration `202609200005_demo_reset.sql` adds the optional live reset without changing existing data or platform version 4. With `RECONCILIATION_ALLOW_DEMO_RESET=true` and synthetic-only mode enabled, **Reset demo** opens a confirmation. Confirming archives active application tables privately in `demo_reset_archives`, then restores the demo in one database transaction and retains original storage objects. Migration 015 restores the prepared 70/10 baseline and also archives and clears custom checks/history. It refuses active processing, pending email delivery, non-demo records, or a changed snapshot. Old decisions, investigations, and learned rules are archived; new prepared history is visibly labeled. Revisions advance so stale review tabs cannot submit old actions. The live reset flag remains required.

Start the live configuration with the existing `.env.local` settings:

```sh
PATH="/Users/jaydenl/.nvm/versions/node/v24.11.1/bin:$PATH" \
NEXT_DIST_DIR=.next-live npm run dev -- --port 3000
```

For a live intake demonstration, use the private files and exact form values in `.seed-archives/live14-20260920/walkthrough/README.md`: first upload Noah Bennett's $264 flight receipt, then add the matching named itinerary to the same pending claim. Select **Itinerary** as the supporting document kind. The flight policy permits linked itinerary identity; ordinary checks may resolve it without a separate investigation. Actual extraction and assessment outcomes remain model-dependent. These documents contain fictional purchase facts, not injected verdicts.

Checking claims and uploading evidence can make live provider requests. Intake remains synthetic-only, and this hackathon app has no authentication or payment execution. Background post-upload work runs within the server request lifecycle and does not survive a server restart; saved claims remain available to recheck.


Automatic notice support uses additive migration `202609200006_automatic_notices.sql`. It was applied to the live demo database on September 20, 2026. Applying it sends no emails and does not backfill historical notices. Human decision plus immutable notice use the existing atomic confirmation transaction; requests and unchanged policy approvals are deduplicated. Migration `202609210016_held_notifications.sql` is applied to the configured demo and changes new notices to held drafts. **Send all notifications** on the main dashboard or reimbursements page opens one batch confirmation. Preview mode generates previews; live mode releases the confirmed batch for delivery and retains the outbox worker for durable retries (`npm run email:worker`). Provider acceptance does not prove inbox delivery.

Migration `202609200007_policy_revision_safeupdate.sql` was applied to the live demo on September 20, 2026. It scopes the policy-revision trigger to the singleton workspace row so Supabase's safeupdate guard permits archive-and-reset. Verified through the live UI: previous results archived and 14 unchecked claims restored.

Migration `202609200008_readable_demo_seed.sql` permits the renamed seed’s new receipt and supporting-document IDs. It changes only the reset function; applying it does not reset any records. Applied to the live demo on September 20, 2026; the next live **Reset demo** loads the renamed seed. Archived PDFs retain their earlier names.

Migration `202609200009_designed_demo_seed.sql` was applied to the live demo on September 20, 2026. It updates the live reset function to accept designed receipt IDs beginning `62000000` and supporting-document IDs beginning `64000000`, while preserving claim/policy IDs and all existing reset safeguards. Applying it did not reset records or change platform version 4. The next **Reset demo** loads the designed originals and varied dates/origins; archived PDFs keep their immutable earlier IDs and bytes.

Migration `202609200010_feedback_learning.sql` was applied to the live demo on September 20, 2026. It persists queued/background learning state and its guarded source/test/activation lifecycle. The live workspace read succeeded afterward with all 14 claims retained; no decisions were changed or provider calls made by the migration. Local synthetic file-store learning does not require a database migration. Its browser rehearsal verified that a human approval created an active tested check and that Taylor's reassessment cited Taylor's own receipt and booking. That simulated rehearsal does not establish live model results.

Migration `202609200011_expanded_live_demo.sql` was applied to the live demo on September 20, 2026. It retains reset safeguards and permits the exact 80-claim seed (20 supporting documents), while remaining compatible with the 14-claim fixture. The live helper now selects 80; local simulation selects 14. Applying the migration did not reset the newly expanded dataset. Live API verification showed 80 claims and an enabled reset capability; all existing claim/evidence/decision/run records were verified unchanged after the append.

Historical September 20 prepared-baseline deployment (the earlier 60/20 split, not verification of the current 70/10 reset): migration `202609210014_live_demo_baseline.sql` is applied. An explicit reset archived the old live workspace and its custom check; direct database and application API reads confirmed 60 checked / 20 unchecked, with 52 prepared approvals, four prepared rejections, four pending reviews, and zero failed runs. The initial response timed out despite committing; no reset was retried. The client timeout is now 90 seconds. Remaining claims have not been live-audited as part of this setup.

September 20 revised baseline: migration `202609210015_live_demo_baseline_70.sql` and an explicit archived reset are applied. The app API confirmed 59 prepared approvals, seven prepared rejections, four pending checked claims, and ten unchecked claims. These ten remain available for the live demonstration; this setup made no provider or email calls.
