# Resend setup for the Sift demo

Status: architecture and configuration preparation only. The email composer, reviewer dialog, database outbox, migration, and delivery worker are not implemented by this change. Setting these variables will not make the current app send email. See the [implementation plan](../../docs/next-work/06-decision-email-plan.md) for ownership, routes, persistence, and delivery behavior.

## 1. Create your account

Open [Resend signup](https://resend.com/signup), create an account using the inbox where you want demo notifications, and complete email verification. For this demo, skip custom domain setup.

Resend's default sender, `onboarding@resend.dev`, can send only to the email associated with your Resend account. It cannot send to arbitrary teammates or applicants. Other recipients require a verified custom sending domain. [Provider restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

## 2. Create a sending key

Open the Resend dashboard's **API Keys** page and choose **Create API Key**. Name it `sift-local`, choose **Sending access**, and copy the generated value into your local environment file. The full key cannot be viewed again after creation. Do not paste it into chat, a PR, or `.env.example`. [API key documentation](https://resend.com/docs/dashboard/api-keys/introduction), [sending permissions](https://resend.com/changelog/new-api-key-permissions).

## 3. Fill in local configuration

Edit `reconciliation/.env.local` from the repository root. Preserve the existing database, Azure, and Jev values. The file is ignored by Git; `.env.example` contains public placeholders only.

```dotenv
# Planned configuration; keep preview until the email feature is implemented.
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

`preview` means no delivery. `template` means no model call for draft generation. The planned `live` draft mode uses the existing Azure configuration, separately from the email delivery switch. An API key alone never enables sending.

Leave public origin and webhook secret blank for the first decision-email demo. Public applicant upload links and signed delivery webhooks are later setup steps; do not email external recipients a localhost link.

## 4. Prepare one demo claim after implementation

Use a new synthetic claim whose stored applicant email matches your Resend account email. Existing synthetic claims often contain fictional addresses: do not replace them in bulk or attempt retrospective notifications. The planned server derives the destination from the saved claim and rejects destinations outside the allowlist.

Once the feature is implemented, the reviewer will edit the applicant message and confirm **Approve & send** or **Reject & send**. Rejection explanations can be AI-generated and manually edited; internal review notes stay separate. Email delivery does not initiate a reimbursement payment.

The implementation must provide a documented worker command and migration instructions before enabling live mode. There is no email-worker command to run yet. A future demo send should be an explicit action to the chosen inbox; this setup does not send one.

## 5. Expand beyond your own inbox later

Verify a domain you control in Resend, configure the DNS records it provides, then set a sender on that verified domain. Keep the recipient allowlist for the private synthetic demo. Public deployment also needs reviewer authentication, worker hosting, and the coordinated database/app rollout described in the architecture plan. [Domain setup](https://resend.com/docs/dashboard/domains/introduction).

The planned UI distinguishes queued, accepted by Resend, failed, and unknown delivery outcomes. Inbox delivery status requires signed provider events; API acceptance alone is not a delivery receipt.
