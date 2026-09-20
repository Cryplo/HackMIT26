import { z } from 'zod';
import type { CoreService } from './service';
import { workspaceSnapshot } from './projection';
import { CoreError } from './validation';
const schema=z.object({snapshot_token:z.string().regex(/^[a-f0-9]{64}$/),submission_ids:z.array(z.uuid()).min(1).max(1000).refine(ids=>new Set(ids).size===ids.length)}).strict();
const columns=['claim_id','attendee_name','category','currency','requested_amount_minor','receipt_amount_minor','assessment_status','decision_status','processing_status','review_revision','assessment_knowledge_revision','knowledge_revision','assessment_stale','failed_checks','unknown_checks','duplicate_claim_ids','latest_reviewer_note','receipt_id'];
function field(value:unknown){const s=value==null?'':String(value);return '"'+(typeof value==='string'&&/^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(s)?"'"+s:s).replaceAll('"','""')+'"';}
export async function exportReviews(core:CoreService,raw:unknown){
 const input=schema.safeParse(raw);if(!input.success)throw new CoreError('INVALID_INPUT','Export requires a snapshot and 1–1000 unique claim IDs.');
 const state=await core.store.snapshot(),snapshot=workspaceSnapshot(state),revision=state.knowledge_revision??0;
 if(input.data.snapshot_token!==snapshot.token)throw new CoreError('STALE_SNAPSHOT','Claims or rules changed. Refresh before exporting.',409);
 const rows=input.data.submission_ids.map(id=>{const r=snapshot.rows.find(r=>r.id===id);if(!r)throw new CoreError('STALE_SNAPSHOT','Selected claim is not in this snapshot.',409);return r;});
 return [columns.join(','),...rows.map(r=>{
  const checks=r.decisions.filter(d=>d.check_method!=='human'&&d.field_checked!=='overall_status');
  return [r.id,r.attendee_name,r.category,r.currency,r.amount_requested_minor,r.receipt?.parsed_fields_json?.amount_minor??null,r.assessment_status,r.decision_status,r.processing_status,r.review_revision,r.assessment_knowledge_revision,revision,r.assessment_knowledge_revision!==null&&r.assessment_knowledge_revision<revision,checks.filter(d=>d.verdict==='fail').map(d=>d.field_checked).join(';'),checks.filter(d=>d.verdict==='unknown').map(d=>d.field_checked).join(';'),r.duplicate_submission_ids.join(';'),r.decisions.find(d=>d.check_method==='human')?.rationale_text??'',r.receipt?.id??''].map(field).join(',');
 })].join('\r\n')+'\r\n';
}
