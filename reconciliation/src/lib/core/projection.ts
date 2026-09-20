import { createHash } from 'node:crypto';
import type { ReviewRow } from '../review-contracts';
import type { Snapshot } from './store';
import { overall } from './checks';
import { CoreError } from './validation';
import { confirmedDuplicates, latestCorrection, reviewRevision } from './safety';

/** Project persisted machine checks and human corrections independently. Machine
 * status never implies a human approval, even for historical v1 records. */
export function workspaceRows(state: Snapshot): ReviewRow[] {
 return state.submissions.map(s=>{
  const receipt=state.receipts.find(r=>r.submission_id===s.id);
  const runs=state.runs.filter(r=>r.submission_id===s.id);
  const machineRun=runs.filter(r=>r.status==='completed' && (r.evidence_revision ?? 0)===(s.evidence_revision ?? 0) && state.decisions.some(d=>d.run_id===r.id && d.check_method!=='human')).sort((a,b)=>Number(a.id===s.latest_run_id)-Number(b.id===s.latest_run_id)||(a.completed_at||a.started_at).localeCompare(b.completed_at||b.started_at)||a.id.localeCompare(b.id)).at(-1);
  const checks=state.decisions.filter(d=>d.run_id===machineRun?.id && d.check_method!=='human');
  const evidence=checks.filter(d=>d.field_checked!=='overall_status');
  const correction=latestCorrection(state,s.id);
  const human=correction?state.decisions.find(d=>d.check_method==='human' && d.evidence_json.correction_id===correction.id):undefined;
  const assessment_status=!evidence.length?null:overall(evidence)==='approved'?'matched':overall(evidence) as 'flagged'|'needs_review';
  const decision_status=correction?.human_verdict||'pending';
  const running=runs.some(r=>r.status==='running');
  // The existing run lease is also used to serialize reviewer writes. Exclude
  // its cancellation record from assessment errors and completed evidence.
  const last=runs.filter(r=>r.error!=='Superseded by human correction.').sort((a,b)=>a.started_at.localeCompare(b.started_at)||a.id.localeCompare(b.id)).at(-1);
  const decisions=[...checks,...(human?[human]:[])].map(({id,field_checked,check_method,verdict,answer_json,probability,confidence_score,rationale_text,evidence_json})=>({id,field_checked,check_method,verdict,answer_json,probability,confidence_score,rationale_text,evidence_json}));
  return {...s,review_revision:reviewRevision(state,s.id),
   latest_run_id:machineRun?.id||null,assessment_status,decision_status,assessment_knowledge_revision:machineRun?machineRun.knowledge_revision ?? -1:null,
   processing_status:running?'running':last?.status==='failed'?'failed':'idle',processing_error:last?.status==='failed'?last.error:null,
   status:decision_status!=='pending'?decision_status:assessment_status==='matched'?'approved':assessment_status||'pending',
   receipt:receipt?{id:receipt.id,file_type:receipt.file_type,sha256:receipt.sha256??null,extraction_provenance:receipt.extraction_provenance??'historical fixture / unknown',extraction_status:receipt.extraction_status,extraction_error:receipt.extraction_error,parsed_fields_json:receipt.parsed_fields_json}:null,
   decisions,duplicate_submission_ids:confirmedDuplicates(state,s.id).map(d=>d.submission_id),investigation:null} satisfies ReviewRow;
 });
}
export function workspaceSnapshot(state: Snapshot) {
 if(state.submissions.length>1000)throw new CoreError('REVIEW_LIMIT','Review snapshot exceeds the supported 1000 claims.',503);
 const rows=workspaceRows(state);
 return {rows,token:createHash('sha256').update(JSON.stringify({rows,knowledge_revision:state.knowledge_revision??0})).digest('hex')};
}
