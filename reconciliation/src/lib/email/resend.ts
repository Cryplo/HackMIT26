import 'server-only';
import type { EmailPayload, EmailProvider, EmailSendResult } from './provider';
/** Provider acceptance is not inbox delivery. Never expose raw provider errors or response payloads. */
export class ResendProvider implements EmailProvider {
  constructor(private readonly key: string, private readonly transport: typeof fetch = fetch) {}
  async send(payload: EmailPayload, idempotencyKey: string, signal?: AbortSignal): Promise<EmailSendResult> {
    const timeout = AbortSignal.timeout(10000);
    const boundedSignal = signal ? AbortSignal.any([signal,timeout]) : timeout;
    if (boundedSignal.aborted) return {outcome:'failed',error:'Email attempt was cancelled before sending.',retryable:true};
    try {
      const response = await this.transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${this.key}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},signal:boundedSignal,body:JSON.stringify({from:payload.from,to:[payload.to],subject:payload.subject,text:payload.text,html:payload.html,...(payload.replyTo?{reply_to:payload.replyTo}:{})})});
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter ? (/^\d+$/.test(retryAfter)?Number(retryAfter):Math.ceil((Date.parse(retryAfter)-Date.now())/1000)) : undefined;
      const retryAfterSeconds = seconds !== undefined && Number.isFinite(seconds) ? Math.max(1,seconds) : undefined;
      if (!response.ok) {
        const retryable = response.status === 429 || response.status === 408 || response.status === 409 || response.status >= 500;
        // Server errors can leave the provider outcome uncertain; retries retain the same key and body.
        return {outcome:response.status>=500 || response.status===408?'delivery_unknown':'failed',error:`Email provider returned HTTP ${response.status}.`,retryable,retryAfterSeconds};
      }
      const value: unknown = await response.json();
      if (!value || typeof value!=='object' || !('id' in value) || typeof value.id!=='string' || !value.id || value.id.length>200) return {outcome:'delivery_unknown',error:'Email provider accepted the request without a usable message ID. Reconciliation may be needed.',retryable:true};
      return {outcome:'accepted',providerMessageId:value.id};
    } catch {
      return {outcome:'delivery_unknown',error:'The provider response was lost or timed out. Delivery is unconfirmed.',retryable:true};
    }
  }
}
