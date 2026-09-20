import 'server-only';
import type { Store } from '../core/store';
import type { ClaimMessage } from '../core/communications-state';
import { CoreError } from '../core/validation';
import { assertEmailRecipient, emailConfig, type EmailConfig } from './config';
import type { EmailPayload, EmailProvider, EmailSendResult } from './provider';
import { ResendProvider } from './resend';
/** Send the exact content frozen in the decision/outbox transaction, including across worker upgrades. */
export function messagePayload(message: ClaimMessage): EmailPayload {
  if (!message.from || !message.outcome_header || (!message.correction_id && !(message.decision_source==='automatic'&&message.automatic_decision_key)) || !message.rendered_text || !message.rendered_html) throw new CoreError('EMAIL_UNAVAILABLE','This notice has no confirmed decision and immutable content snapshot.',409);
  return {from:message.from,to:message.recipient,replyTo:message.reply_to,subject:message.subject,text:message.rendered_text,html:message.rendered_html};
}
export interface DispatchOptions { env?: Record<string,string|undefined>; config?: EmailConfig; provider?: EmailProvider; signal?: AbortSignal }
export async function dispatchEmailOnce(store: Store, options: DispatchOptions = {}): Promise<{processed:boolean;messageId?:string;status?:string}> {
  const config = options.config ?? emailConfig(options.env);
  if (config.mode !== 'live') return {processed:false};
  options.signal?.throwIfAborted();
  const {message} = await store.messages({action:'lease'});
  if (!message) return {processed:false};
  if (!message.lease_token) throw new CoreError('EMAIL_UNAVAILABLE','Email store did not return a send lease.',503);
  let result: EmailSendResult;
  try {
    assertEmailRecipient(config,message.recipient);
    if (message.mode !== 'live' || message.from !== config.from || message.reply_to !== config.replyTo) throw new CoreError('EMAIL_UNAVAILABLE','The frozen sender configuration changed. Restore it before retrying this message.',409);
    if (message.idempotency_key !== `sift-message/${message.id}`) throw new CoreError('EMAIL_UNAVAILABLE','The message has an invalid send key.',409);
    result = await (options.provider ?? new ResendProvider(config.apiKey!)).send(messagePayload(message),message.idempotency_key,options.signal);
  } catch (error) {
    result = {outcome:'failed',error:error instanceof CoreError?error.message:'Email transport could not start.',retryable:false};
  }
  const retryDelay = result.outcome!=='accepted' && result.retryable ? Math.max(message.attempt_count===1?30:120,result.retryAfterSeconds ?? 0) : undefined;
  // Do not retry earlier than a provider's requested delay. Oversized delays require manual reconciliation.
  const retryAfter = retryDelay!==undefined && retryDelay<=3600 ? retryDelay : undefined;
  const saved = await store.messages({action:'settle',message_id:message.id,lease_token:message.lease_token,outcome:result.outcome,...(result.outcome==='accepted'?{provider_message_id:result.providerMessageId}:{error:result.error,...(retryAfter!==undefined?{retry_after_seconds:retryAfter}:{})})});
  return {processed:true,messageId:message.id,status:saved.message?.status ?? result.outcome};
}
