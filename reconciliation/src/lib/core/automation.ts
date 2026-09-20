import { createHash } from 'node:crypto';
import type { Decision, ReconciliationRun } from '../contracts';
import type { ReviewRow } from '../review-contracts';
import type { Snapshot } from './store';
import { deterministic, overall, requiredChecks } from './checks';
import { boundedEvidence, supportingFor } from './evidence';
import { confirmedDuplicates, earlier, latestCorrection, samePurchase } from './safety';

/** Ignore review bookkeeping; bind the evidence the assessor could actually read. */
function evidenceIdentity(state:Snapshot,id:string) {
 // ponytail: scans prior receipts within the 1000-claim limit; track candidate dependencies if the workspace grows.
 const s=state.submissions.find(s=>s.id===id)!;
 const claims=state.submissions.filter(x=>x.id===id||earlier(x,s)).map(({id,attendee_name,email,amount_requested_minor,currency,category,origin_location,submitted_at})=>({id,attendee_name,email,amount_requested_minor,currency,category,origin_location,submitted_at})).sort((a,b)=>a.id.localeCompare(b.id));
 const ids=new Set(claims.map(s=>s.id));
 const byId=<T extends {id:string}>(values:T[])=>values.toSorted((a,b)=>a.id.localeCompare(b.id));
 const evidence={claims,receipts:byId(state.receipts.filter(r=>ids.has(r.submission_id))),policies:byId(state.policies),documents:byId(supportingFor(state,id)),rules:byId((state.rules??[]).filter(r=>r.state==='active')),procedures:byId((state.procedures??[]).filter(p=>p.state==='active'))};
 // JSONB can reorder object keys between the assessment and the next snapshot.
 return createHash('sha256').update(JSON.stringify(evidence,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)).digest('hex');
}

function eligible(state:Snapshot,id:string,checks:Pick<Decision,'field_checked'|'verdict'|'check_method'>[]) {
 const s=state.submissions.find(s=>s.id===id),r=state.receipts.find(r=>r.submission_id===id);
 return !!s&&!latestCorrection(state,id)&&(s.decision_status??'pending')==='pending'
  &&overall(checks.filter(d=>d.check_method!=='human'&&d.field_checked!=='overall_status'))==='approved'
  &&deterministic(s,r??null,state.policies,'automatic-policy-check').every(d=>d.verdict==='pass')
  &&!confirmedDuplicates(state,id).length
  &&!state.submissions.some(x=>x.id!==id&&latestCorrection(state,x.id)?.human_verdict==='approved'&&samePurchase(r,state.receipts.find(r=>r.submission_id===x.id)));
}

/** Only server assessment paths issue this marker; it is never human feedback. */
export function automaticApproval(state:Snapshot,id:string,runId:string,checks:Decision[],enabled:boolean) {
 if(!enabled||!eligible(state,id,checks))return null;
 return {policy:'policy-caps-v1',run_id:runId,evidence_revision:state.submissions.find(s=>s.id===id)!.evidence_revision??0,knowledge_revision:state.knowledge_revision??0,evidence_identity:evidenceIdentity(state,id)};
}

export function hasAutomaticApproval(state:Snapshot,id:string,run:ReconciliationRun|undefined,checks:Decision[]) {
 const marker=checks.find(d=>d.field_checked==='overall_status'&&d.check_method!=='human')?.evidence_json.auto_approval;
 if(!run||!marker||typeof marker!=='object'||Array.isArray(marker))return false;
 const value=marker as Record<string,unknown>,s=state.submissions.find(s=>s.id===id)!;
 return value.policy==='policy-caps-v1'&&value.run_id===run.id&&run.status==='completed'
  &&run.evidence_revision===(s.evidence_revision??0)&&value.evidence_revision===run.evidence_revision
  &&run.knowledge_revision===(state.knowledge_revision??0)&&value.knowledge_revision===run.knowledge_revision
  &&!state.runs.some(r=>r.submission_id===id&&['assessment','investigation'].includes(r.operation??'assessment')&&(r.review_revision??-1)>(run.review_revision??-1))
  &&eligible(state,id,checks)&&value.evidence_identity===evidenceIdentity(state,id);
}

export function shouldInvestigateAutomatically(state:Snapshot,row:ReviewRow) {
 if(row.decision_status!=='pending'||row.processing_status==='running'||!row.latest_run_id||row.assessment_knowledge_revision!==(state.knowledge_revision??0)||row.duplicate_submission_ids.length)return false;
 const checks=row.decisions.filter(d=>d.check_method!=='human'&&d.field_checked!=='overall_status');
 const unresolved=checks.filter(d=>d.verdict!=='pass');
 if(!unresolved.length||unresolved.some(d=>!['merchant','name'].includes(d.field_checked))||requiredChecks.some(field=>!checks.some(d=>d.field_checked===field)))return false;
 if(!supportingFor(state,row.id).some(d=>d.extraction_status==='succeeded'&&!!d.facts&&!!d.extracted_text?.trim()))return false;
 try{boundedEvidence(state,row.id);}catch{return false;}
 const revision=state.submissions.find(s=>s.id===row.id)?.evidence_revision??0;
 // Rechecking unchanged evidence must not create another paid investigation,
 // including after a failed or manually initiated attempt. Manual retries remain available.
 return !(state.investigations??[]).some(r=>r.claim_id===row.id&&r.before_assessment.evidence_revision===revision&&r.before_assessment.knowledge_revision===(state.knowledge_revision??0));
}
