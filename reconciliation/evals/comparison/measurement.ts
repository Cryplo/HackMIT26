import { randomUUID } from 'node:crypto';
import type { Arm, Call, Price } from './types';

const count = (x: unknown): number | null => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : null;

/** Installed only inside the serial, standalone evaluator process. No production changes. */
export class Meter {
  calls: Call[] = [];
  case_id = '';
  stage: 'extraction' | Arm = 'extraction';
  constructor(private limit: number, private transport: typeof fetch = fetch) {}
  fetch: typeof fetch = async (input, init) => {
    if (this.calls.length >= this.limit) throw new Error('MODEL_CALL_BUDGET_EXHAUSTED');
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    const request = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const provider = url.hostname === 'ai-gateway.vercel.sh' ? 'vercel-typesafe' : url.hostname === 'api.typesafe.ai' ? 'typesafe' : url.hostname === 'api.openai.com' ? 'openai' : 'azure-openai';
    const call: Call = { id: randomUUID(), case_id: this.case_id, stage: this.stage, provider,
      requested_model: String(request.model ?? 'unknown'), returned_model: null,
      input_tokens: null, output_tokens: null, cached_input_tokens: null, cache_write_tokens: null,
      latency_ms: 0, http_status: null, request_id: null, error: null };
    this.calls.push(call); // Reserve before network; failed attempts count too.
    const start = performance.now();
    try {
      const response = await this.transport(input, init);
      call.http_status = response.status;
      call.request_id = response.headers.get('x-request-id') ?? response.headers.get('apim-request-id');
      const body = await response.clone().json().catch(() => null);
      call.returned_model = typeof body?.model === 'string' ? body.model : null;
      call.input_tokens = count(body?.usage?.input_tokens);
      call.output_tokens = count(body?.usage?.output_tokens);
      call.cached_input_tokens = count(body?.usage?.input_tokens_details?.cached_tokens);
      call.cache_write_tokens = count(body?.usage?.input_tokens_details?.cache_write_tokens);
      if (!response.ok) call.error = `HTTP_${response.status}`;
      return response;
    } catch { call.error = 'TRANSPORT_ERROR'; throw new Error('TRANSPORT_ERROR'); }
    finally { call.latency_ms = performance.now() - start; }
  };
}

/** Provider invoices are not available here. This is a dated rate-card estimate. */
export function cost(call: Call, prices: Price[]): { usd: number | null; basis: string } {
  const rates = prices.filter(p => p.provider === call.provider && p.requested_model === call.requested_model && p.returned_model === call.returned_model);
  if (rates.length !== 1) return { usd: null, basis: 'missing_or_ambiguous_price' };
  if (call.input_tokens === null || call.output_tokens === null) return { usd: null, basis: 'missing_usage' };
  const p = rates[0];
  const writes=call.cache_write_tokens??0;
  if (writes>0 && (p.cache_write_usd_per_million===undefined || !p.cache_write_accounting)) return { usd: null, basis: 'missing_cache_write_price_or_accounting' };
  if (call.cached_input_tokens !== null && call.cached_input_tokens > call.input_tokens) return { usd: null, basis: 'invalid_cached_usage' };
  if (call.cached_input_tokens === null && p.input_usd_per_million !== p.cached_input_usd_per_million)
    return { usd: null, basis: 'missing_cache_breakdown' };
  const cached = call.cached_input_tokens ?? 0;
  const uncached=call.input_tokens-cached-(p.cache_write_accounting==='included_in_input'?writes:0);
  if(uncached<0)return {usd:null,basis:'invalid_cache_accounting'};
  return { usd: (uncached * p.input_usd_per_million + cached * p.cached_input_usd_per_million + writes*(p.cache_write_usd_per_million??0) + call.output_tokens * p.output_usd_per_million) / 1e6, basis: 'rate_card_estimate' };
}

export function validatePrices(value: unknown): Price[] {
  if (!Array.isArray(value)) throw new Error('Prices must be an array.');
  const keys = new Set<string>();
  for (const p of value) {
    if (!p || ['provider','requested_model','returned_model','sku','region','source_url','checked_at'].some(k => typeof p[k] !== 'string' || !p[k].trim()) ||
      !/^https:\/\//.test(p.source_url) || !/^\d{4}-\d{2}-\d{2}$/.test(p.checked_at) || !Number.isFinite(Date.parse(p.checked_at)) ||
      ['input_usd_per_million','output_usd_per_million','cached_input_usd_per_million'].some(k => typeof p[k] !== 'number' || !Number.isFinite(p[k]) || p[k] < 0)) throw new Error('Invalid dated rate card.');
    const key = JSON.stringify([p.provider,p.requested_model,p.returned_model]);
    if((p.cache_write_usd_per_million!==undefined || p.cache_write_accounting!==undefined) &&
      (!['included_in_input','additional_to_input'].includes(p.cache_write_accounting)||typeof p.cache_write_usd_per_million!=='number'||!Number.isFinite(p.cache_write_usd_per_million)||p.cache_write_usd_per_million<0))throw new Error('Cache writes require a verified price and explicit token accounting.');
    if (keys.has(key)) throw new Error('Duplicate rate-card mapping.');
    keys.add(key);
  }
  return value;
}

export function percentile(values: number[], fraction: number): number | null {
  const sorted = [...values].sort((a,b) => a-b);
  if (!sorted.length) return null;
  if (fraction === .5) return sorted.length % 2 ? sorted[(sorted.length-1)/2] : (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length)-1)];
}
