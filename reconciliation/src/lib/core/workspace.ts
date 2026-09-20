import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ReviewRow, ReviewsResponse, SearchRow, SearchResponse } from '../review-contracts';
import type { Snapshot } from './store';
import type { CoreService } from './service';
import { CoreError, correctionInput } from './validation';
import { search } from '../intelligence/search';

/** Project persisted machine checks and human corrections independently. Machine
 * status never implies a human approval, even for historical v1 records. */
export function workspaceRows(state: Snapshot): ReviewRow[] {
 return state.submissions.map(s=>{
  const receipt=state.receipts.find(r=>r.submission_id===s.id);
  const runs=state.runs.filter(r=>r.submission_id===s.id);
  const machineRun=runs.filter(r=>r.status==='completed' && state.decisions.some(d=>d.run_id===r.id && d.check_method!=='human')).sort((a,b)=>(a.completed_at||a.started_at).localeCompare(b.completed_at||b.started_at)||a.id.localeCompare(b.id)).at(-1);
  const checks=state.decisions.filter(d=>d.run_id===machineRun?.id && d.check_method!=='human');
  const evidence=checks.filter(d=>d.field_checked!=='overall_status');
  const correction=state.corrections.filter(c=>c.submission_id===s.id).sort((a,b)=>a.corrected_at.localeCompare(b.corrected_at)||a.id.localeCompare(b.id)).at(-1);
  const human=correction?state.decisions.find(d=>d.check_method==='human' && d.evidence_json.correction_id===correction.id):undefined;
  const assessment_status=!evidence.length?null:evidence.some(d=>d.verdict==='fail')?'flagged':evidence.some(d=>d.verdict==='unknown')?'needs_review':'matched';
  const decision_status=correction?.human_verdict||'pending';
  const running=runs.some(r=>r.status==='running');
  // The existing run lease is also used to serialize reviewer writes. Exclude
  // its cancellation record from assessment errors and completed evidence.
  const last=runs.filter(r=>r.error!=='Superseded by human correction.').sort((a,b)=>a.started_at.localeCompare(b.started_at)||a.id.localeCompare(b.id)).at(-1);
  const decisions=[...checks,...(human?[human]:[])].map(({id,field_checked,check_method,verdict,answer_json,probability,confidence_score,rationale_text,evidence_json})=>({id,field_checked,check_method,verdict,answer_json,probability,confidence_score,rationale_text,evidence_json}));
  return {...s,review_revision:state.decisions.filter(d=>d.submission_id===s.id).length+state.corrections.filter(c=>c.submission_id===s.id).length,
   latest_run_id:machineRun?.id||null,assessment_status,decision_status,assessment_knowledge_revision:machineRun?0:null,
   processing_status:running?'running':last?.status==='failed'?'failed':'idle',processing_error:last?.status==='failed'?last.error:null,
   status:decision_status!=='pending'?decision_status:assessment_status==='matched'?'approved':assessment_status||'pending',
   receipt:receipt?{id:receipt.id,file_type:receipt.file_type,sha256:null,extraction_status:receipt.extraction_status,extraction_error:receipt.extraction_error,parsed_fields_json:receipt.parsed_fields_json}:null,
   decisions,duplicate_submission_ids:[],investigation:null} satisfies ReviewRow;
 });
}
export function workspaceSnapshot(state: Snapshot) {
 const rows=workspaceRows(state);
 return {rows,token:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
}
export async function workspaceReviews(core:CoreService):Promise<ReviewsResponse> {
 const snapshot=workspaceSnapshot(await core.store.snapshot());
 const old=await core.reviews();const rows=snapshot.rows;
 return {contract_version:2,snapshot_token:snapshot.token,knowledge_revision:0,submissions:rows,demo_mode:core.demoMode,
 summary:{approved_amount_minor:rows.filter(r=>r.decision_status==='approved').reduce((a,r)=>a+r.amount_requested_minor,0),pending_review_count:rows.filter(r=>r.decision_status==='pending').length,matched_count:rows.filter(r=>r.assessment_status==='matched').length,flagged_count:rows.filter(r=>r.assessment_status==='flagged').length,needs_review_count:rows.filter(r=>r.assessment_status==='needs_review').length},
 execution:{extraction:process.env.RECONCILIATION_EXTRACTION_MODE==='live'?(process.env.AZURE_OPENAI_API_KEY?'live Azure':'live OpenAI'):'sample extraction',decisions:old.execution?.decisions||'unknown',retrieval:old.execution?.retrieval||'stored candidates',storage:old.execution?.storage||'unknown',investigation:'not enabled'}};
}
const financial=['currency','amount','policy','receipt_date','policy_cap'];
export function assertApprovable(row:ReviewRow){
 if(row.receipt?.extraction_status!=='succeeded'||!row.assessment_status)throw new CoreError('APPROVAL_BLOCKED','Extract and recheck the receipt before approving.',409);
 const checks=row.decisions.filter(d=>d.check_method!=='human' && d.field_checked!=='overall_status');
 for(const field of [...financial,'duplicate'])if(!checks.some(d=>d.field_checked===field&&d.verdict==='pass')||checks.some(d=>d.field_checked===field&&d.verdict!=='pass'))throw new CoreError('APPROVAL_BLOCKED',`${field} must pass before approval.`,409);
}
export async function workspaceDecide(core:CoreService,raw:unknown){
 const input=correctionInput(raw);
 const parsed=z.object({expected_review_revision:z.number().int().nonnegative()}).safeParse(raw);
 if(!parsed.success||input.correction_type!=='decision_override')throw new CoreError('INVALID_INPUT','A current review revision and one-time decision are required.');
 const inspect=async()=>{
  const row=workspaceRows(await core.store.snapshot()).find(r=>r.id===input.submission_id);
  if(!row)throw new CoreError('NOT_FOUND','Claim not found.',404);
  if(row.review_revision!==parsed.data.expected_review_revision)throw new CoreError('STALE_REVIEW','This claim changed. Review the updated evidence.',409);
  if(input.human_verdict==='approved')assertApprovable(row);
  return row;
 };
 await inspect();
 // The existing database lease serializes approvals against reconciliation and
 // other workspace decisions; check revision again after acquiring it.
 const lease=await core.store.begin(input.submission_id);
 try{
  await inspect();
  const {submission_id,human_verdict,human_note}=input;
  const result=await core.correct({submission_id,human_verdict,human_note,correction_type:'decision_override',correction_payload_json:{}});
  return {correction_id:result.correction_id,row:workspaceRows(await core.store.snapshot()).find(r=>r.id===submission_id)!};
 }catch(error){await core.store.fail(lease,'Reviewer update did not complete.').catch(()=>{});throw error}
}
const searchSchema=z.object({query:z.string().trim().min(1).max(500),snapshot_token:z.string().regex(/^[a-f0-9]{64}$/),filters:z.object({category:z.enum(['flight','hotel','train','bus','other']).optional(),assessment_status:z.enum(['matched','flagged','needs_review']).optional(),decision_status:z.enum(['pending','approved','rejected']).optional()}).strict()}).strict();
export async function workspaceSearch(core:CoreService,raw:unknown,signal:AbortSignal):Promise<SearchResponse>{
 const parsed=searchSchema.safeParse(raw);if(!parsed.success)throw new CoreError('INVALID_INPUT','Invalid search request.');
 const {query,snapshot_token,filters}=parsed.data;const snapshot=workspaceSnapshot(await core.store.snapshot());
 if(snapshot.token!==snapshot_token)throw new CoreError('STALE_SNAPSHOT','Claims changed. Refresh and search again.',409);
 const rows=snapshot.rows.filter(r=>(!filters.category||r.category===filters.category)&&(!filters.assessment_status||r.assessment_status===filters.assessment_status)&&(!filters.decision_status||r.decision_status===filters.decision_status));
 const facts:SearchRow[]=rows.map(r=>({submission_id:r.id,attendee_name:r.attendee_name,category:r.category,amount_requested_minor:r.amount_requested_minor,currency:r.currency,vendor:r.receipt?.parsed_fields_json?.vendor??null,receipt_amount_minor:r.receipt?.parsed_fields_json?.amount_minor??null,receipt_date:r.receipt?.parsed_fields_json?.receipt_date??null,has_receipt:!!r.receipt,extraction_status:r.receipt?.extraction_status??null,assessment_status:r.assessment_status,decision_status:r.decision_status,failed_checks:r.decisions.filter(d=>d.check_method!=='human'&&d.field_checked!=='overall_status'&&d.verdict==='fail').map(d=>d.field_checked),unknown_checks:r.decisions.filter(d=>d.check_method!=='human'&&d.field_checked!=='overall_status'&&d.verdict==='unknown').map(d=>d.field_checked),duplicate_submission_ids:r.duplicate_submission_ids}));
 const evaluation=await search({query,rows:facts},{mode:process.env.RECONCILIATION_MODE==='simulated'?'simulated':'live',signal,log_usage:r=>core.store.usage({...r,id:crypto.randomUUID(),run_id:null,receipt_id:null,created_at:new Date().toISOString()})});
 if(workspaceSnapshot(await core.store.snapshot()).token!==snapshot_token)throw new CoreError('STALE_SNAPSHOT','Claims changed during search. Search again.',409);
 const judgments=new Map(evaluation.judgments.map(j=>[j.submission_id,j.result]));
 return {snapshot_token,evaluated_count:rows.length,matches:rows.filter(r=>judgments.get(r.id)==='match'),possible_matches:rows.filter(r=>judgments.get(r.id)==='uncertain'),mode:evaluation.mode,model:evaluation.model,latency_ms:evaluation.latency_ms};
}
