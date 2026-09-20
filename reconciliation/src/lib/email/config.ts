import 'server-only';
import { CoreError } from '../core/validation';
export type EmailMode = 'disabled' | 'preview' | 'live';
export interface EmailConfig { mode: EmailMode; draftMode: 'template' | 'live'; from: string; replyTo: string | null; allowedRecipients: string[]; apiKey: string | null; privateReviewer: boolean }
const address = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
export function emailAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !address.test(normalized)) throw new CoreError('RECIPIENT_NOT_ALLOWED', 'A valid stored claimant email is required.', 409);
  return normalized;
}
export function emailConfig(env: Record<string, string | undefined> = process.env): EmailConfig {
  const mode = env.RECONCILIATION_EMAIL_MODE || 'preview';
  const draftMode = env.RECONCILIATION_EMAIL_DRAFT_MODE || 'template';
  const invalid = (message: string) => new CoreError('EMAIL_UNAVAILABLE', message, 503);
  if (!['disabled','preview','live'].includes(mode) || !['template','live'].includes(draftMode)) throw invalid('Configure valid email and draft modes.');
  const from = (env.RECONCILIATION_EMAIL_FROM || 'onboarding@resend.dev').trim();
  const fromAddress = from.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] || from;
  try { emailAddress(fromAddress); } catch { throw invalid('Configure a valid email sender.'); }
  if (/\r|\n/.test(from)) throw invalid('Configure a valid email sender.');
  const replyTo = env.RECONCILIATION_EMAIL_REPLY_TO?.trim() || null;
  if (replyTo) { try { emailAddress(replyTo); } catch { throw invalid('Configure a valid reply-to address.'); } }
  let allowedRecipients: string[];
  try { allowedRecipients = [...new Set((env.RECONCILIATION_EMAIL_ALLOWED_RECIPIENTS || '').split(',').map(x => x.trim()).filter(Boolean).map(emailAddress))]; }
  catch { throw invalid('Configure exact comma-separated allowed recipient email addresses.'); }
  let localOrigin = false;
  try { const url = new URL(env.RECONCILIATION_APP_ORIGIN || ''); localOrigin = ['127.0.0.1','localhost','[::1]'].includes(url.hostname); } catch { /* live mode requires an explicit private environment */ }
  const privateReviewer = localOrigin || env.RECONCILIATION_EMAIL_PRIVATE_REVIEWER === 'true';
  const apiKey = env.RESEND_API_KEY?.trim() || null;
  if (mode === 'live') {
    if (env.RECONCILIATION_SYNTHETIC_ONLY !== 'true') throw invalid('Live demo email requires RECONCILIATION_SYNTHETIC_ONLY=true.');
    if (!apiKey) throw invalid('Live email requires RESEND_API_KEY.');
    if (!privateReviewer) throw invalid('Live email requires a private reviewer environment. Use local app origin or explicitly configure RECONCILIATION_EMAIL_PRIVATE_REVIEWER for a protected deployment.');
    if (!allowedRecipients.length) throw invalid('Live email requires an exact recipient allowlist.');
    if (fromAddress.toLowerCase().endsWith('@resend.dev') && (fromAddress.toLowerCase() !== 'onboarding@resend.dev' || allowedRecipients.length !== 1)) throw invalid('The default Resend sender requires exactly one allowed recipient: your Resend account email.');
  }
  return {mode: mode as EmailMode, draftMode: draftMode as 'template'|'live', from, replyTo, allowedRecipients, apiKey, privateReviewer};
}
export function assertEmailRecipient(config: EmailConfig, recipient: string): void {
  const normalized = emailAddress(recipient);
  if (config.mode === 'disabled') throw new CoreError('EMAIL_UNAVAILABLE', 'Decision emails are disabled. Save the decision without an email.', 503);
  if (config.mode === 'live' && !config.allowedRecipients.includes(normalized)) throw new CoreError('RECIPIENT_NOT_ALLOWED', 'The stored claimant email is not allowed for live delivery. Create a new demo claim using your configured Resend account email; existing applicants are never redirected.', 409);
}
export function emailCapabilities(env: Record<string,string|undefined> = process.env) {
  try { const config = emailConfig(env); return { decision_email_drafts: config.mode !== 'disabled', decision_emails: config.mode === 'live', email_mode: config.mode, error: null }; }
  catch (error) { return {decision_email_drafts:false,decision_emails:false,email_mode:'disabled' as EmailMode,error:error instanceof CoreError ? error.message : 'Email configuration is unavailable.'}; }
}
