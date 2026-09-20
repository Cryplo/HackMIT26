import type { ReviewRow } from '../review-contracts';
import type { Snapshot } from './store';
import type { Receipt, Submission } from '../contracts';
import { CoreError, normalize } from './validation';
export function latestCorrection(state:Snapshot,id:string) {
 return state.corrections.filter(c=>c.submission_id===id).at(-1);
}
export function reviewRevision(state:Snapshot,id:string) {
 return state.submissions.find(s=>s.id===id)?.review_revision ?? state.decisions.filter(d=>d.submission_id===id).length+state.corrections.filter(c=>c.submission_id===id).length;
}
export function earlier(a:Submission,b:Submission) { return a.submitted_at<b.submitted_at || (a.submitted_at===b.submitted_at&&a.id<b.id); }
export function samePurchase(a:Receipt|undefined,b:Receipt|undefined):'sha256'|'receipt_identity'|null {
 if(!a||!b)return null;
 if(a.sha256&&b.sha256&&a.sha256===b.sha256)return 'sha256';
 const p=a.parsed_fields_json,q=b.parsed_fields_json;
 if(a.extraction_status!=='succeeded'||b.extraction_status!=='succeeded'||!p||!q)return null;
 return p.receipt_number?.trim()&&q.receipt_number?.trim()&&normalize(p.receipt_number)===normalize(q.receipt_number)&&p.vendor?.trim()&&q.vendor?.trim()&&normalize(p.vendor)===normalize(q.vendor)&&p.amount_minor!==null&&p.amount_minor===q.amount_minor&&p.receipt_date!==null&&p.receipt_date===q.receipt_date&&p.currency!==null&&p.currency===q.currency?'receipt_identity':null;
}
export function confirmedDuplicates(state:Snapshot,id:string) {
 const s=state.submissions.find(s=>s.id===id);if(!s)return [];
 const receipt=state.receipts.find(r=>r.submission_id===id);
 return state.submissions.filter(x=>earlier(x,s)).flatMap(x=>{
  const method=samePurchase(receipt,state.receipts.find(r=>r.submission_id===x.id));
  return method?[{submission_id:x.id,method}]:[];
 });
}
export function assertApprovable(row:ReviewRow,knowledgeRevision?:number){
 if(row.receipt?.extraction_status!=='succeeded'||!row.assessment_status)throw new CoreError('APPROVAL_BLOCKED','Extract and recheck the receipt before approving.',409);
 if(knowledgeRevision!==undefined&&row.assessment_knowledge_revision!==knowledgeRevision)throw new CoreError('STALE_REVIEW','Rules changed. Recheck before approving.',409);
 const checks=row.decisions.filter(d=>d.check_method!=='human'&&d.field_checked!=='overall_status');
 for(const field of ['currency','amount','policy','receipt_date','policy_cap','duplicate'])if(!checks.some(d=>d.field_checked===field&&d.verdict==='pass')||checks.some(d=>d.field_checked===field&&d.verdict!=='pass'))throw new CoreError('APPROVAL_BLOCKED',`${field} must pass before approval.`,409);
}
