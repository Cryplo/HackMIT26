import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SearchRow, SearchJudgment } from '../review-contracts';
import type { Snapshot, Store } from './store';
import { search } from '../intelligence/search';
import { CoreError } from './validation';
export type ClaimSearchRow = SearchRow & { receipt_id: string | null };
export interface ClaimSearchResult { snapshot_token: string; evaluated_count: number; matches: ClaimSearchRow[]; possible_matches: ClaimSearchRow[]; judgments: SearchJudgment[]; mode: 'live'; model: string | null; latency_ms: number }
export const searchInput = z.object({ query:z.string().trim().min(1).max(500), snapshot_token:z.string().regex(/^[a-f0-9]{64}$/), category:z.enum(['flight','hotel','train','bus','other']).optional() }).strict();
export function searchSnapshot(state: Snapshot) {
  const rows: ClaimSearchRow[] = state.submissions.map(s => {
    const receipt=state.receipts.find(r=>r.submission_id===s.id);
    const checks=state.decisions.filter(d=>d.run_id===s.latest_run_id && d.check_method!=='human' && d.field_checked!=='overall_status');
    const correction=state.corrections.filter(c=>c.submission_id===s.id).sort((a,b)=>a.corrected_at.localeCompare(b.corrected_at)||a.id.localeCompare(b.id)).at(-1);
    const decision_status=correction?.human_verdict || 'pending';
    const assessment_status=!checks.length ? null : checks.some(d=>d.verdict==='fail') ? 'flagged' : checks.some(d=>d.verdict==='unknown') ? 'needs_review' : 'matched';
    return {submission_id:s.id, attendee_name:s.attendee_name, category:s.category, amount_requested_minor:s.amount_requested_minor, currency:s.currency, vendor:receipt?.parsed_fields_json?.vendor??null, receipt_amount_minor:receipt?.parsed_fields_json?.amount_minor??null, receipt_date:receipt?.parsed_fields_json?.receipt_date??null, has_receipt:!!receipt, receipt_id:receipt?.id??null, extraction_status:receipt?.extraction_status??null, assessment_status, decision_status, failed_checks:checks.filter(d=>d.verdict==='fail').map(d=>d.field_checked), unknown_checks:checks.filter(d=>d.verdict==='unknown').map(d=>d.field_checked), duplicate_submission_ids:[] } satisfies ClaimSearchRow;
  }).sort((a,b)=>a.submission_id.localeCompare(b.submission_id));
  return { rows, snapshot_token:createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
}
export async function searchClaims(store: Store, body: unknown, signal: AbortSignal, evaluator = search): Promise<ClaimSearchResult> {
  const parsed=searchInput.safeParse(body);
  if (!parsed.success) throw new CoreError('INVALID_INPUT','Provide a query, current snapshot token, and optional valid category.');
  const input=parsed.data; const snapshot=searchSnapshot(await store.snapshot());
  if (snapshot.snapshot_token!==input.snapshot_token) throw new CoreError('STALE_SNAPSHOT','Claims changed. Refresh the list and search again.',409);
  const rows=snapshot.rows.filter(r=>!input.category || r.category===input.category);
  if(rows.length>100) throw new CoreError('SEARCH_LIMIT','Search supports 100 claims at a time. Select a category to narrow the list.',422);
  const result=await evaluator({query:input.query,rows}, {mode:process.env.RECONCILIATION_MODE==='simulated'?'simulated':'live',signal,log_usage: record=>store.usage({...record,id:crypto.randomUUID(),run_id:null,receipt_id:null,created_at:new Date().toISOString()})});
  if (searchSnapshot(await store.snapshot()).snapshot_token!==snapshot.snapshot_token) throw new CoreError('STALE_SNAPSHOT','Claims changed during search. Refresh and search again.',409);
  const byId=new Map(result.judgments.map(j=>[j.submission_id,j.result]));
  return {snapshot_token:snapshot.snapshot_token,evaluated_count:rows.length,matches:rows.filter(r=>byId.get(r.submission_id)==='match'),possible_matches:rows.filter(r=>byId.get(r.submission_id)==='uncertain'),judgments:result.judgments,mode:'live',model:result.model,latency_ms:result.latency_ms};
}
