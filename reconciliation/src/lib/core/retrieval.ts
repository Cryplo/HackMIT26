import type { Correction, ParsedReceipt, Submission } from '../contracts';
import type { Snapshot } from './store';
import { aliasPayload, normalize, CoreError } from './validation';
export interface Candidate { submission_id: string; attendee_name: string; category: string; currency: string; receipt: ParsedReceipt; search_score?: number }
export interface Evidence { candidates: Candidate[]; aliases: Correction[]; retrieval_mode: 'elasticsearch' | 'simulated'; }
export interface Retrieval { retrieve(s: Submission, receipt: ParsedReceipt, state: Snapshot): Promise<Evidence> }
export function applicableAliases(s: Submission, p: ParsedReceipt, cs: Correction[]): Correction[] {
  return cs.filter(c => {
    if (c.correction_type !== 'vendor_alias') return false;
    try { const a = aliasPayload(c.correction_payload_json); return a.scope.category === s.category && a.scope.currency === s.currency && p.vendor !== null && normalize(a.observed_vendor) === normalize(p.vendor); } catch { return false; }
  });
}
function candidates(s: Submission, state: Snapshot): Candidate[] {
  return state.submissions.filter(x => x.id !== s.id && (x.submitted_at < s.submitted_at || (x.submitted_at === s.submitted_at && x.id < s.id))).flatMap(x => {
    const p = state.receipts.find(r => r.submission_id === x.id && r.extraction_status === 'succeeded')?.parsed_fields_json;
    return p ? [{ submission_id: x.id, attendee_name: x.attendee_name, category: x.category, currency: x.currency, receipt: p }] : [];
  });
}
export class SimulatedRetrieval implements Retrieval {
  async retrieve(s: Submission, p: ParsedReceipt, state: Snapshot): Promise<Evidence> {
    return { candidates: candidates(s, state).filter(c => (p.receipt_number && c.receipt.receipt_number === p.receipt_number) || (p.amount_minor !== null && c.receipt.amount_minor === p.amount_minor && c.receipt.receipt_date === p.receipt_date)), aliases: applicableAliases(s, p, state.corrections), retrieval_mode: 'simulated' };
  }
}
/** Rebuild the small demo corpus before each search; refresh=wait_for makes new corrections visible.
 * Source Postgres remains authoritative. No stale ES documents are trusted without rehydration.
 */
export class ElasticsearchRetrieval implements Retrieval {
  constructor(private url: string, private apiKey: string, private prefix = 'reimbursement-demo') {
    if (!/^[a-z0-9-]+$/.test(prefix)) throw new CoreError('CONFIG_ERROR', 'Invalid Elasticsearch index prefix.', 503);
  }
  private async request(path: string, body: unknown, ndjson = false) {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/${path}`, { method: 'POST', headers: { Authorization: `ApiKey ${this.apiKey}`, 'Content-Type': ndjson ? 'application/x-ndjson' : 'application/json' }, body: ndjson ? String(body) : JSON.stringify(body), signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!res.ok) throw new CoreError('RETRIEVAL_FAILED', 'Elasticsearch retrieval failed.', 503);
    return res.json();
  }
  async retrieve(s: Submission, p: ParsedReceipt, state: Snapshot): Promise<Evidence> {
    const all = candidates(s, state); const aliases = state.corrections.filter(c => c.correction_type === 'vendor_alias');
    if (all.length + aliases.length > 1000) throw new CoreError('DEMO_LIMIT', 'Demo retrieval corpus exceeds 1000 records.', 503);
    const docs = [...all.map(c => ({ id: c.submission_id, kind: 'candidate', ...c })), ...aliases.map(c => ({ ...c, kind: 'alias', ...aliasPayload(c.correction_payload_json), observed_vendor_normalized: normalize(aliasPayload(c.correction_payload_json).observed_vendor) }))];
    // Fields used in exact filters have explicit keyword mappings (see provision script).
    const bulk = docs.flatMap(d => [JSON.stringify({ index: { _index: this.prefix, _id: d.id } }), JSON.stringify(d)]).join('\n') + '\n';
    if (docs.length) { const result = await this.request('_bulk?refresh=wait_for', bulk, true); if (result.errors) throw new CoreError('RETRIEVAL_FAILED', 'Elasticsearch indexing failed.', 503); }
    const should: unknown[] = [];
    if (p.receipt_number) should.push({ term: { 'receipt.receipt_number': p.receipt_number } });
    if (p.amount_minor !== null && p.receipt_date) should.push({ bool: { filter: [{ term: { 'receipt.amount_minor': p.amount_minor } }, { term: { 'receipt.receipt_date': p.receipt_date } }] } });
    const [candidateHits, aliasHits] = await Promise.all([
      this.request(`${this.prefix}/_search`, { size: 100, track_total_hits: true, query: { bool: { filter: [{ term: { kind: 'candidate' } }], must_not: [{ term: { submission_id: s.id } }], should, minimum_should_match: 1 } } }),
      this.request(`${this.prefix}/_search`, { size: 100, track_total_hits: true, query: { bool: { filter: [{ term: { kind: 'alias' } }, { term: { 'scope.category': s.category } }, { term: { 'scope.currency': s.currency } }], must: [{ term: { observed_vendor_normalized: normalize(p.vendor || '__missing__') } }] } } }),
    ]);
    if ([candidateHits, aliasHits].some(h => h.timed_out || h._shards?.failed > 0)) throw new CoreError('RETRIEVAL_FAILED', 'Elasticsearch returned incomplete evidence.', 503);
    if (candidateHits.hits.total.relation !== 'eq' || candidateHits.hits.total.value > 100 || aliasHits.hits.total.relation !== 'eq' || aliasHits.hits.total.value > 100) throw new CoreError('RETRIEVAL_LIMIT', 'Too many retrieval matches; review required.', 503);
    const ids = new Map<string, number>(candidateHits.hits.hits.map((h: { _id: string; _score: number }) => [h._id, h._score]));
    const aliasIds = new Set<string>(aliasHits.hits.hits.map((h: { _id: string }) => h._id));
    return { candidates: all.filter(c => ids.has(c.submission_id)).map(c => ({ ...c, search_score: ids.get(c.submission_id) })), aliases: applicableAliases(s, p, aliases.filter(c => aliasIds.has(c.id))), retrieval_mode: 'elasticsearch' };
  }
}
