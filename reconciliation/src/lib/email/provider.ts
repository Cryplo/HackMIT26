import 'server-only';
/** Frozen, single-recipient payload. No CC/BCC, attachments, or model-provided HTML. */
export interface EmailPayload { from: string; to: string; replyTo: string | null; subject: string; text: string; html: string }
export type EmailSendResult =
  | {outcome:'accepted';providerMessageId:string}
  | {outcome:'failed'|'delivery_unknown';error:string;retryable:boolean;retryAfterSeconds?:number};
export interface EmailProvider { send(payload: EmailPayload, idempotencyKey: string, signal?: AbortSignal): Promise<EmailSendResult> }
