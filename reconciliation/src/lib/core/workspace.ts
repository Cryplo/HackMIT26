import { z } from 'zod';
import type { ReviewRow, ReviewsResponse, SearchRow, SearchResponse } from '../review-contracts';
import type { CoreService } from './service';
import { CoreError, correctionInput } from './validation';
import { workspaceRows, workspaceSnapshot } from './projection';
export { workspaceRows, workspaceSnapshot } from './projection';
export { assertApprovable } from './safety';
import { search } from '../intelligence/search';

export async function workspaceReviews(core:CoreService):Promise<ReviewsResponse> {
 const state=await core.readSnapshot();const snapshot=workspaceSnapshot(state);
 const rows=snapshot.rows;
 return {contract_version:2,snapshot_token:snapshot.token,knowledge_revision:state.knowledge_revision??0,capabilities:{supporting_documents:true,investigations:core.investigationMode!=='disabled',resolution_procedures:!!core.intelligence?.build_procedure_suite&&!!core.intelligence?.evaluate_procedure,rule_learning:!!core.intelligence,extraction_retry:true,export:true,custom_checks:false,duplicate_links:true,knowledge_revisions:true},coverage:{complete:true,returned:snapshot.rows.length,total:snapshot.rows.length},submissions:rows,demo_mode:core.demoMode,
 summary:{approved_amount_minor:rows.filter(r=>r.decision_status==='approved').reduce((a,r)=>a+r.amount_requested_minor,0),pending_review_count:rows.filter(r=>r.decision_status==='pending').length,matched_count:rows.filter(r=>r.assessment_status==='matched').length,flagged_count:rows.filter(r=>r.assessment_status==='flagged').length,needs_review_count:rows.filter(r=>r.assessment_status==='needs_review').length},
 execution:{extraction:'See each receipt extraction provenance',decisions:core.execution?.decisions||'unknown',retrieval:core.execution?.retrieval||'stored candidates',storage:core.execution?.storage||'unknown',investigation:core.execution?.investigation||core.investigationMode}};
}
export async function workspaceDecide(core:CoreService,raw:unknown){
 const input=correctionInput(raw);
 const result=await core.correct(input);
 return {correction_id:result.correction_id,row:workspaceRows(await core.store.snapshot()).find(r=>r.id===input.submission_id)!};
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
