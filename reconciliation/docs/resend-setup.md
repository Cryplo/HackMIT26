# Resend setup for the Sift demo

Sift persists applicant notices with human decisions and eligible automatic policy approvals. Preview mode saves the decision and notice without sending. Live mode can attempt delivery immediately and uses a separate Resend worker for durable retries. Internal review reasons remain private. See [current project context](../../docs/PROJECT_CONTEXT.md) and [the app README](../README.md) for current behavior; the [original architecture](../../docs/next-work/06-decision-email-plan.md) is historical. Request-information links and delivery webhooks remain future work.

## Simulated send

Leave `RECONCILIATION_EMAIL_MODE=preview` and `RECONCILIATION_EMAIL_DRAFT_MODE=template` (the defaults). No Resend account, key, or worker is needed. Choose **Approve & notify** or **Reject & notify** in ordinary review. After the server confirms the saved decision, Sift shows a paper-plane confirmation labeled **Email simulated**, then advances to the next eligible claim. Automatic policy approvals also create simulated notices. An optional applicant message is separate from the internal review reason; the advanced message editor remains available where needed. Reduced-motion preferences skip the flight animation. Failed saves show recovery actions, never a success animation. Private review notes stay separate from applicant text.

## 1. Create your account

Open [Resend signup](https://resend.com/signup), create an account using the inbox where you want demo notifications, and complete email verification. For this demo, skip custom domain setup.

Resend's default sender, `onboarding@resend.dev`, can send only to the email associated with your Resend account. It cannot send to arbitrary teammates or applicants. Other recipients require a verified custom sending domain. [Provider restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

## 2. Create a sending key

Open the Resend dashboard's **API Keys** page and choose **Create API Key**. Name it `sift-local`, choose **Sending access**, and copy the generated value into your local environment file. The full key cannot be viewed again after creation. Do not paste it into chat, a PR, or `.env.example`. [API key documentation](https://resend.com/docs/dashboard/api-keys/introduction), [sending permissions](https://resend.com/changelog/new-api-key-permissions).

## 3. Fill in local configuration

Edit `reconciliation/.env.local` from the repository root. Preserve the existing database, Azure, and Jev values. The file is ignored by Git; `.env.example` contains public placeholders only.

```dotenv
# Keep preview until you intend decisions and automatic approvals to send notices.
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

Ordinary review uses **Approve & notify** or **Reject & notify**, with standard wording and an optional separate applicant-facing rejection message. The advanced draft editor supports editable drafts. Internal review notes stay separate. Email delivery does not initiate a reimbursement payment.

Keep delivery in preview during setup. With delivery set to `live`, an eligible automatic approval can also create and send a notice without opening an email editor. A key alone does not enable sending, but changing the delivery mode affects subsequent automated work as well as manual decisions. See the rollout instructions below before enabling live mode.

## 5. Expand beyond your own inbox later

Verify a domain you control in Resend, configure the DNS records it provides, then set a sender on that verified domain. Keep the recipient allowlist for the private synthetic demo. Public deployment also needs reviewer authentication, worker hosting, and the coordinated database/app rollout described in the architecture plan. [Domain setup](https://resend.com/docs/dashboard/domains/introduction).

The UI distinguishes queued, accepted by Resend, failed, and unknown delivery outcomes. Inbox delivery status requires signed provider events; API acceptance alone is not a delivery receipt.


## 6. Deploy schema and app together

Migration `202609200004_communications.sql` introduced platform version **4**, message storage, and transaction/worker RPCs. Migration `202609200006_automatic_notices.sql` adds automatic-notice support; the current app also requires the remaining ordered migrations in [the app README](../README.md#live-setup), through 011. Version 4 alone does not establish that those additions are present.

Inspect the target database’s migration history and apply only missing migrations in order through the normal database-owner process. Coordinate app/worker rollout with schema changes. Do not replay earlier migrations, assume the database is still version 3, reset records, or drop audit tables to resolve a rollout problem. The existing demo’s dated deployment notes are in [Showcase](SHOWCASE.md#live-services). Local FileStore needs no SQL migration.

## 7. Run the delivery worker

From `reconciliation/`, with the project's Node runtime and dependencies installed:

```sh
npm run email:worker
```

The worker is a separate foreground process. Keep it running alongside Next.js, or supervise it on a private worker host. It reads the same ignored `.env.local` as the app. Preview/disabled mode does not deliver mail. No worker or email send is started by installing this release.

When ready for both manual and automatic decision notices to send, set `RECONCILIATION_EMAIL_MODE=live` and restart the app and worker. The dispatcher attempts eligible new notices immediately; the worker handles pending delivery and retries. For the advanced draft workflow, generate a fresh draft so the reviewer sees live-send labels. Drafts prepared under preview cannot be silently promoted to live delivery. For Azure-generated rejection explanations, separately set `RECONCILIATION_EMAIL_DRAFT_MODE=live`; approvals continue to use a deterministic template.

Live mode requires the synthetic-only gate, a valid key, exact allowed recipients, and a private reviewer environment. A local app origin qualifies; a hosted installation must actually be access-protected before setting `RECONCILIATION_EMAIL_PRIVATE_REVIEWER=true`. This flag is an operator assertion, not an authentication mechanism.

The worker sends frozen payloads under stable idempotency keys, records provider acceptance separately from delivery, and limits attempts. A lost response is shown as an unknown outcome. Automatic/manual retries reuse the same payload and key within a conservative window; exhausted or expired attempts require operator reconciliation with Resend records. Do not create a new notice merely to bypass an uncertain delivery outcome.
