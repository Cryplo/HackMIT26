# Decision emails and applicant follow-up — implementation plan

Planning baseline: `main` at `8ae21c0`. This document proposes work; none of the email features below is implemented by this planning task. The user selected Resend. No tests, provider calls, emails, or database changes are part of this planning task. Future implementation should use parallel agents within the ownership boundaries below; do not run tests unless the user requests them.

## Product behavior and scope

Release 1: a reviewer chooses a decision, reviews/edits the applicant message, and confirms **Approve & send** or **Reject & send**. Sift then automatically delivers the saved message. Human approval remains authoritative; model confidence or a machine `matched` assessment cannot trigger a final-decision email. Existing decision-only API behavior remains supported. Historical decisions do not trigger retroactive mail.

Release 2: **Request information** sends a precise request with a secure link. The applicant supplies evidence to the same pending claim. Completion requests one reassessment; recoverable uncertainty can then invoke the teammate's investigator. Missing information is distinct from rejection.

Outside these releases: automatic reimbursement decisions, payments, bulk historical notifications, inbox-reading agents, inbound email attachment parsing, arbitrary recipients/CCs, arbitrary HTML editing, and multi-purchase allocation.

## 1. Configure Resend and delivery modes

For the selected hackathon demo, use Resend's default `onboarding@resend.dev` sender and deliver only to the email associated with the Resend account. No custom domain is needed for that path. Sending to other applicants later requires a verified custom sending domain. Use Resend's HTTPS API with the existing server-side fetch style; an SDK is unnecessary. The account/key walkthrough is in [Resend setup](../../reconciliation/docs/resend-setup.md).

Proposed server-only settings:

```dotenv
RECONCILIATION_EMAIL_MODE=preview
RECONCILIATION_EMAIL_DRAFT_MODE=template
RESEND_API_KEY=
RECONCILIATION_EMAIL_FROM=onboarding@resend.dev
RECONCILIATION_EMAIL_REPLY_TO=
RECONCILIATION_EMAIL_ALLOWED_RECIPIENTS=
RECONCILIATION_PUBLIC_ORIGIN=
RESEND_WEBHOOK_SECRET=
```

- Email mode: `disabled | preview | live`; default preview. A key alone never enables sending. Disabled preserves existing decision-only behavior.
- Draft mode: `template | live`; live reuses the configured Azure Responses endpoint/deployment. Sending and model generation are independent switches.
- Preview saves a visibly labeled preview message and makes no Resend call. It must never display sent/delivered status.
- For the current unauthenticated synthetic demo, live delivery requires an exact server-configured recipient allowlist and a private reviewer environment. Reject non-allowlisted recipients visibly; never silently redirect mail to another inbox. General public live use requires reviewer authentication/authorization before exposing mutation routes.
- Derive `to` from the stored claimant email. The browser cannot supply an arbitrary recipient. Show it read-only before confirmation.
- With the default Resend sender, require exactly one allowed recipient: the configured Resend account email. Create a new synthetic demo claim with that stored email; do not rewrite historical applicants or notify existing synthetic claims. A missing or mismatched recipient blocks delivery with an actionable error.
- Public HTTPS origin is needed only for applicant links/webhooks. Never email a localhost upload URL to an external applicant.
- Keep credentials in ignored environment configuration. No secrets in shared DTOs or browser bundles.

These settings are reserved placeholders until implementation; the current app does not read them. Configuring a key does not implement the composer, outbox, worker, or UI.

```mermaid
sequenceDiagram
    participant R as Reviewer
    participant A as Sift API
    participant D as Database
    participant W as Email worker
    participant E as Resend
    participant I as Own account inbox
    R->>A: Generate draft for intended decision
    A-->>R: Editable applicant message
    R->>A: Confirm decision and final message
    A->>D: Commit guarded decision and immutable outbox message
    A-->>R: Decision saved; email queued
    W->>D: Lease current message
    W->>E: Send with stable idempotency key
    E-->>W: Provider acceptance and message ID
    W->>D: Save provider outcome
    E->>I: Deliver email
```

The diagram describes the planned live path. Preview records the decision/message without queueing delivery. Provider acceptance alone is not evidence of inbox delivery.

## 2. Applicant-facing message composition

Add `src/lib/core/applicant-message.ts`. Extend `src/lib/providers/responses.ts` with an explicit Azure-only `applicant_message` purpose; reuse its transport and model-usage logging conventions. Do not send the current reviewer-facing justification verbatim.

Approval uses a deterministic template: claimant name, claim reference, category, authoritative approved amount, and **approved for reimbursement**. Never claim payment was made or invent a payment date.

Rejection generation takes one explicit, bounded Azure call on opening/generating the draft. No tool loop or investigator rerun. Inputs are the intended rejection, reviewer-selected reason/check IDs, relevant check/policy facts, and an optional deliberately applicant-facing reason. The internal audit note is excluded by default. Do not include other applicants' identities, hidden policy notes, complete raw receipts, or internal model probabilities.

Generate structured `{subject, explanation, next_step, cited_check_ids}`. Validate bounded text and that cited IDs are among the supplied records; server-render the outcome header, claim reference and amount from authoritative data. The model cannot supply recipients, outcome, amount, links, attachments, or HTML. Escape text into a fixed email template and include a plain-text alternative. Keep citations in the reviewer preview; expose only appropriate policy references in the applicant copy.

Generate once per request, not on every edit. Explicit regeneration creates a new draft revision and asks before replacing manual edits. If Azure fails, retain the editable deterministic template with a visible generation error. Store original generated text and final edited text separately. Human edits are attributable; do not claim text validation proves their factual accuracy.

For a discretionary rejection with no failed check, require an explicit applicant-facing reviewer reason; do not fabricate a policy violation. For missing evidence, surface Request information as the appropriate separate action.

## 3. Persistence and transaction boundary

Propose `supabase/migrations/202609200004_communications.sql`; confirm the number remains unused after fetching main before implementation. Do not edit applied migrations 002/003. Match MemoryStore, FileStore, and Supabase behavior. Deploy the additive migration and version-4 readiness gates together after inspection; the current version-3 app must not be left paired with version 4.

Add `claim_messages`:

- Identity: ID, claim ID, nullable correction ID, kind (`approval | rejection | information_request`), draft version, creation/update timestamps, unique confirmation request ID and canonical confirmation-payload hash for replay detection.
- Source binding: review/evidence/knowledge revisions, assessment run ID, selected reason/check IDs, intended verdict. Message edits do not themselves advance financial evidence or knowledge revisions.
- Content: stored recipient, sender/reply-to snapshot, original generated subject/explanation, final edited subject/body, generation model/provenance, created/confirmed actor when available.
- Delivery: `draft | previewed | queued | sending | accepted | failed | delivery_unknown | cancelled`; provider message ID, stable idempotency key, first-attempt time, attempt count, next attempt, lease expiry, sanitized error. Delivery events separately track delivered/bounced/complained; accepted does not prove inbox delivery.
- Constraints: one final-decision message per correction, one stable send key per immutable payload, optimistic draft version checking. Once confirmed, freeze recipients and rendered content. A later corrected notice is a new record.

Add `message_delivery_events` for attempt starts/results and provider events, with unique provider-event IDs. Keep row-level security and service-only table/RPC access. Message history is read-only through reviewer projections; sensitive message content stays out of general claim-list responses.

Add a store command/SQL RPC for **decision and queue**:

1. Look up the idempotent request first; an exact replay returns its existing correction/message even if review revision has since advanced. Same key with different input returns conflict.
2. Lock the claim and message; validate expected review/draft versions and source evidence/knowledge freshness.
3. Reuse existing `core_correct`/approval/duplicate/running-operation protections within this same transaction.
4. Save the human correction, attach the message to that correction, freeze the payload and enqueue it (or mark previewed).
5. Commit together. Do not call `correct()` and then separately insert a message from the route.

The FileStore equivalent performs correction and queue creation under its one file transaction. The existing correction-only route remains compatible. Cancel obsolete unsent notices when a later correction replaces a decision; retain already accepted mail in history. Coordinate a short send lease with decision updates so a new correction cannot race an in-flight provider attempt. Do not hold a SQL transaction open during HTTP delivery.

## 4. Proposed API contracts

Publish additive message DTOs and optional capabilities in `src/lib/review-contracts.ts` before parallel implementation. Preserve `contract_version: 2` and existing decision DTOs.

| Method and endpoint | Input / behavior | Result |
| --- | --- | --- |
| POST `/api/submissions/:id/messages/draft` | `{kind: 'approval'|'rejection', expected_review_revision, reason_check_ids, applicant_reason?}`; derive recipient/facts server-side | `{message, generation_error}` |
| PATCH `/api/messages/:messageId` | `{expected_draft_revision, subject, body}`; only editable drafts | `{message}` |
| POST `/api/submissions/:id/decision-and-send` | `{expected_review_revision, human_verdict, human_note, message_id, expected_draft_revision, request_id}` | `{row, correction_id, message}` after atomic decision/queue commit |
| GET `/api/submissions/:id/messages` | Reviewer-only saved history; no sending or generation | `{messages}` |
| POST `/api/messages/:messageId/retry` | `{expected_message_revision}`; delivery only, no new decision or model call | `{message}` |
| POST `/api/email/events` | Optional signed Resend webhook; deduplicate event IDs | Acknowledgment |

Proposed error codes: `EMAIL_UNAVAILABLE`, `RECIPIENT_NOT_ALLOWED`, `STALE_MESSAGE`, `STALE_REVIEW`, `MESSAGE_ALREADY_CONFIRMED`, `COMMUNICATION_IN_FLIGHT`, `DELIVERY_RECONCILIATION_REQUIRED`; retain existing approval errors. Delivery failures appear in message status after a successful decision transaction. Do not return a generic decision failure that encourages resubmitting a decision already saved.

Optional capabilities: `decision_email_drafts`, `decision_emails`, and later `information_requests`. Expose mode separately; preview availability is not live email capability. Missing capabilities leave the existing decision-only UI functional.

## 5. Durable sending with Resend

Add `src/lib/email/{config,provider,resend,dispatcher}.ts` and a small `scripts/email-worker.ts` process. Use the database as a durable outbox; no external queue framework is required.

- Worker polls due messages, atomically acquires expiring send leases, rechecks that the linked decision is current, then sends the immutable payload. Never send from GET, rendering, polling, model generation, or detached promises after an API response.
- For the local demo, run the worker alongside Next.js using the existing Node 24 runtime. The long-running worker owns its lifecycle; the browser does not need to stay open. Production requires a configured worker host or authenticated scheduled drain.
- Use `sift-message/<message-id>` as the stable Resend idempotency key. Retries use the exact same provider payload/key; use a unique database key as well.
- Proposed bounds: 10-second provider timeout, 30-second send lease, at most three automatic attempts with 30- and 120-second delays. Retry transient errors/429s with the same key; expose permanent failures. Respect provider retry instructions within the attempt budget.
- A lost response is `delivery_unknown`, not proof of failure. Resend documents a 24-hour idempotency retention period. Within that window retry the same key/payload; beyond it, reconcile provider records or require explicit operator resolution rather than blindly issuing a fresh send.
- Persist provider ID and `accepted` only on confirmed provider acceptance. UI can label this “Sent to email provider.” `delivered` requires a verified event. Webhooks are optional for the first local demo; never fabricate delivery/open status without them.
- A failed delivery never reverses a decision. Manual Retry affects the existing message only. An already accepted message cannot be recalled or silently edited.
- Generation and sending are separately logged so the team can distinguish model work from email transport.

## 6. Reviewer interface

Modify `src/components/business/ReviewSheet.tsx` and add `DecisionMessageDialog.tsx` plus `CommunicationHistory.tsx`. Extend `src/lib/dashboard/{client,ui-contracts,types,preview}.ts` as appropriate.

The dialog shows decision, claim amount/reference, and recipient at the top. It has separate fields labeled **Internal review note — not sent** and **Message to applicant**. Rejection opens with an editable generated explanation; approval begins with its deterministic template. Preserve manual edits on errors and stale-refresh transitions. Provide explicit Regenerate and Cancel actions; no keystroke-triggered generation.

Confirmation buttons: **Approve & send**, **Reject & send**, or **Save approval/rejection & preview** in preview mode. The UI persists the last edit before submitting the atomic decision-and-send request. Disable confirmation while draft generation/save is pending or claim/draft revisions are stale. Refresh stale evidence without silently discarding the reviewer's note.

After confirmation distinguish:

- Decision saved, email queued.
- Decision saved, email accepted by provider.
- Decision saved, email failed — Retry email.
- Decision saved, delivery outcome unknown — reconciliation needed.
- Preview saved — no email sent.

Communication history shows immutable content, recipient, decision linkage, time and delivery status. A network timeout on confirmation prompts a read of saved state; never issue a new request ID automatically. Retain a decision-only path when communication is disabled.

## 7. Phase 2: request information and resume

Add an independent request state (`draft | open | responded | closed | cancelled | expired`); the claim's human decision remains pending. Store `claim_information_requests` with claim/source bindings, requested document kinds/items, applicant question, expiry, token hash, and received-document IDs. Use a follow-on migration with its own coordinated readiness change if this phase ships separately.

Proposed routes/pages:

- POST `/api/submissions/:id/information-requests`: prepare request and editable email against a current pending claim.
- POST `/api/information-requests/:requestId/send`: atomically open the request, create its scoped token, and queue the confirmed email.
- GET `/respond/:token`: applicant page containing only the request, limited own-claim context, and upload controls.
- POST `/api/information-responses/:token/documents`: token-authorized supporting upload; derive claim server-side.
- POST `/api/information-responses/:token/complete`: submit the collected response and enqueue one reassessment for its evidence revision.

Use a cryptographically random, expiring, revocable token. Store its lookup hash; the raw link is sensitive and may appear only in the protected email payload and applicant URL, not general API responses/logs. GET must not consume it, since email scanners follow links. Use no-referrer policy, no third-party page assets, and redact tokens in request logging. Close/revoke access after response completion, cancellation, expiry, or a final human decision. The token must never authorize the reviewer dashboard, approvals, arbitrary claim reads, or uploads to another claim.

Reuse the existing supporting-document validation, private storage, extraction, amount semantics, eight-document/8 MiB limits, and evidence revision updates. The applicant does not provide a reviewer revision; the server resolves it under the current claim/request operation guard. Preserve failed extraction visibly and allow corrective submission within request limits. A file arrival alone does not mean the request is satisfied.

Explicit **Submit response** avoids rerunning the investigator after every upload. Persist `claim_resume_jobs` with a unique `(request_id, evidence_revision)`, claim ID, queued/running/completed/failed/superseded status, lease, attempt count, and resulting reconciliation/investigation run IDs. A durable worker performs one ordinary reassessment, then invokes the existing bounded investigator only if useful uncertainty remains and the configured budget permits it. Reuse existing reconciliation run records for the work itself; the job row only records scheduling and recovery. Do not reacquire a claim lease recursively. Newer evidence supersedes old work; no upload or investigation creates a human approval. The reviewer sees the changed checks and can then use the Release 1 decision/email flow.

## 8. Parallel delivery order

| Owner | Work | Dependency |
| --- | --- | --- |
| Backend/contracts agent | Shared DTOs, message state, atomic decision/queue, migration/store adapters, history/retry routes | Publish contracts first |
| Message/provider agent | Applicant composer, Azure draft handling, templates, Resend adapter, dispatcher/worker | Frozen DTOs and outbox claim/settle seam |
| Frontend agent | Dialog, editable previews, separate notes, statuses/history, client and preview adapter | Frozen DTOs; can use explicit preview fixtures |
| Teammate on investigator | Later request-response resume seam and bounded investigation integration | Phase 2 request/job contract |
| Integration owner | Sender/account setup, worker hosting, coordinated schema/app rollout, refresh from main and open implementation PR | Completed Release 1 path |

First deliver contracts, then run backend, composer/provider, and frontend work in parallel. Integrate Release 1 before adding public response links. No package/global config changes without coordination; no live sends merely because credentials exist. Follow the user's no-tests instruction. Completion review should inspect the implemented paths and recorded states; an actual demonstration email is a separate explicitly authorized action to a chosen recipient.

## Completion criteria

Release 1 is complete when an edited applicant message survives refresh; confirmation saves exactly one guarded decision and one immutable message; the worker delivers/reports the actual outcome; retries do not create another decision; preview sends nothing; and stale/blocked claims cannot bypass existing approval rules. Internal notes and other applicants' data never appear in outgoing content. Setup documentation identifies the sender, worker command, modes and remaining limitations.

Release 2 is complete when the applicant link is scoped to one open request; requested evidence stays on the same claim; an explicit completed response schedules at most one reassessment for that revision; and the reviewer sees its real outcome with prior history intact.

## Provider references

- [Resend default sender restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
- [Resend API key setup](https://resend.com/docs/dashboard/api-keys/introduction)
- [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction)
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend idempotency keys and 24-hour window](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend webhook delivery events](https://resend.com/docs/webhooks/introduction)
