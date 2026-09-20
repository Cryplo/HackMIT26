# Resend setup for the Sift demo

Release 1 provides reviewer-confirmed decision emails: editable drafts, an atomic decision/outbox transaction, saved message history, and a separate Resend delivery worker. Preview mode saves the decision and message without sending. The SQL migration must be deployed alongside this app version before using Supabase. Request-information links and delivery webhooks remain future work; see the [architecture](../../docs/next-work/06-decision-email-plan.md).

## Simulated send

Leave `RECONCILIATION_EMAIL_MODE=preview` and `RECONCILIATION_EMAIL_DRAFT_MODE=template` (the defaults). No Resend account, key, or worker is needed. Review the applicant message, then choose **Save decision & simulate email**. After the server confirms the saved decision, Sift shows a paper-plane animation and **Email simulated — No email was sent**. Choose **Continue review** to return to the claim. Reduced-motion preferences skip the flight animation. Failed saves show recovery actions, never a success animation. Private review notes stay separate from applicant text.

## 1. Create your account

Open [Resend signup](https://resend.com/signup), create an account using the inbox where you want demo notifications, and complete email verification. For this demo, skip custom domain setup.

Resend's default sender, `onboarding@resend.dev`, can send only to the email associated with your Resend account. It cannot send to arbitrary teammates or applicants. Other recipients require a verified custom sending domain. [Provider restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

## 2. Create a sending key

Open the Resend dashboard's **API Keys** page and choose **Create API Key**. Name it `sift-local`, choose **Sending access**, and copy the generated value into your local environment file. The full key cannot be viewed again after creation. Do not paste it into chat, a PR, or `.env.example`. [API key documentation](https://resend.com/docs/dashboard/api-keys/introduction), [sending permissions](https://resend.com/changelog/new-api-key-permissions).

## 3. Fill in local configuration

Edit `reconciliation/.env.local` from the repository root. Preserve the existing database, Azure, and Jev values. The file is ignored by Git; `.env.example` contains public placeholders only.

```dotenv
# Keep preview until you intend to send a confirmed demo decision.
RECONCILIATION_EMAIL_MODE=preview
RECONCILIATION_EMAIL_DRAFT_MODE=template
RESEND_API_KEY=your_resend_key
RECONCILIATION_EMAIL_FROM=onboarding@resend.dev
RECONCILIATION_EMAIL_REPLY_TO=
RECONCILIATION_EMAIL_ALLOWED_RECIPIENTS=your_resend_account_email
RECONCILIATION_PUBLIC_ORIGIN=
RESEND_WEBHOOK_SECRET=
```

Replace the two placeholder values with the key and the exact email associated with the account. Keep a single allowed recipient when using the default sender. Reply-to is optional for this demo; use an inbox you monitor if you set it.

`preview` means no delivery. `template` means no model call for draft generation. The `live` draft mode uses the existing Azure configuration, separately from the email delivery switch. An API key alone never enables sending.

Leave public origin and webhook secret blank for the first decision-email demo. Public applicant upload links and signed delivery webhooks are later setup steps; do not email external recipients a localhost link.

## 4. Prepare one demo claim

Use a new synthetic claim whose stored applicant email matches your Resend account email. Existing synthetic claims often contain fictional addresses: do not replace them in bulk or attempt retrospective notifications. The server derives the destination from the saved claim and rejects destinations outside the allowlist.

The reviewer edits the applicant message and confirms **Approve & send** or **Reject & send**. Rejection explanations can be AI-generated and manually edited; internal review notes stay separate. Email delivery does not initiate a reimbursement payment.

Keep delivery in preview during setup. A live demo send is an explicit reviewer action to the chosen inbox; adding credentials does not send one. See the rollout instructions below before enabling live mode.

## 5. Expand beyond your own inbox later

Verify a domain you control in Resend, configure the DNS records it provides, then set a sender on that verified domain. Keep the recipient allowlist for the private synthetic demo. Public deployment also needs reviewer authentication, worker hosting, and the coordinated database/app rollout described in the architecture plan. [Domain setup](https://resend.com/docs/dashboard/domains/introduction).

The UI distinguishes queued, accepted by Resend, failed, and unknown delivery outcomes. Inbox delivery status requires signed provider events; API acceptance alone is not a delivery receipt.


## 6. Deploy schema and app together

This release requires platform version **4**, provided by `supabase/migrations/202609200004_communications.sql`. It adds service-only message storage and transaction/worker RPCs. Prior migrations 001–003 must already be applied. This PR does not apply SQL to your live database.

Before rollout, stop the app and any workers, inspect the target database and its migration history, and confirm `select public.core_platform_version();` returns `3`. Apply migration 004 once through the database owner's normal migration process, with an all-or-nothing transaction. Do not edit or replay previous migrations. Confirm version `4` and restart the app from this release. Both intake and core now require version 4, so roll them out together. Local FileStore needs no SQL migration.

Do not start an older version-3 app against version 4. If rollout fails, retain data and repair the forward schema/app pairing; do not drop the communication or audit tables.

## 7. Run the delivery worker

From `reconciliation/`, with the project's Node runtime and dependencies installed:

```sh
npm run email:worker
```

The worker is a separate foreground process. Keep it running alongside Next.js, or supervise it on a private worker host. It reads the same ignored `.env.local` as the app. Preview/disabled mode does not deliver mail. No worker or email send is started by installing this release.

When ready to send, set `RECONCILIATION_EMAIL_MODE=live`, restart the app and worker, and generate a fresh draft so the reviewer sees live-send labels. Drafts prepared under preview cannot be silently promoted to live delivery. For Azure-generated rejection explanations, separately set `RECONCILIATION_EMAIL_DRAFT_MODE=live`; approvals continue to use a deterministic template.

Live mode requires the synthetic-only gate, a valid key, exact allowed recipients, and a private reviewer environment. A local app origin qualifies; a hosted installation must actually be access-protected before setting `RECONCILIATION_EMAIL_PRIVATE_REVIEWER=true`. This flag is an operator assertion, not an authentication mechanism.

The worker sends frozen payloads under stable idempotency keys, records provider acceptance separately from delivery, and limits attempts. A lost response is shown as an unknown outcome. Automatic/manual retries reuse the same payload and key within a conservative window; exhausted or expired attempts require operator reconciliation with Resend records. Do not create a new notice merely to bypass an uncertain delivery outcome.
