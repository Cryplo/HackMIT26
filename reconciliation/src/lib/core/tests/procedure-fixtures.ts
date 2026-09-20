import {evidenceState,procedureFacts} from './investigation-fixtures';
import type {IntelligencePort,ProcedureEvaluationCase,Assessment,EvaluationMetrics} from '../../review-contracts';
const ids=['valid_a','valid_b','missing_booking','conflicting_reference','unrelated_descriptor','missing_traveler','overclaim','over_cap','non_usd','out_of_policy_date','exact_duplicate','wrong_category'];
/** Backend test inputs only, NOT C's delivered booking-reference-v1 suite or activation evidence. */
export function backendSuite():ProcedureEvaluationCase[]{return ids.map((id,index)=>{
 const facts=procedureFacts(evidenceState());facts.submission.id=`81000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`;facts.receipt!.submission_id=facts.submission.id;facts.receipt!.id=`82000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`;facts.receipt!.sha256=String(index).padStart(64,'0');
 const doc=facts.supporting_documents[0];doc.claim_id=facts.submission.id;doc.id=`83000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`;
 const p=facts.receipt!.parsed_fields_json!;let expected:Assessment=index<2?'matched':'needs_review';
 if(id==='missing_booking')facts.supporting_documents=[];
 if(id==='conflicting_reference')doc.facts!.booking_reference='OTHER';
 if(id==='unrelated_descriptor')p.vendor='UNRELATED AMBIGUOUS';
 if(id==='missing_traveler'){p.names=[];doc.facts!.names=[];}
 if(id==='overclaim'){facts.submission.amount_requested_minor++;expected='flagged';}
 if(id==='over_cap'){facts.submission.amount_requested_minor=p.amount_minor=25001;doc.facts!.amount_minor=25001;expected='flagged';}
 if(id==='non_usd'){p.currency='EUR';doc.facts!.currency='EUR';expected='flagged';}
 if(id==='out_of_policy_date'){p.receipt_date='2026-10-01';doc.facts!.purchase_date=p.receipt_date;expected='flagged';}
 if(id==='exact_duplicate'){const prior=structuredClone(facts.submission);prior.id='84000000-0000-4000-8000-000000000001';prior.submitted_at='2026-01-01T00:00:00Z';facts.related_claims=[{submission:prior,receipt:{...structuredClone(facts.receipt!),id:'85000000-0000-4000-8000-000000000001',submission_id:prior.id},decision_status:'pending'}];expected='flagged';}
 if(id==='wrong_category')facts.submission.category='flight';
 return {id,facts,expected_assessment:expected};
});}
export const backendEvaluator:Pick<IntelligencePort,'build_procedure_suite'|'evaluate_procedure'>={build_procedure_suite:()=>backendSuite(),async evaluate_procedure(input,assess){
 const before:Assessment[]=[],after:Assessment[]=[];for(const e of input.examples){before.push(await assess(e.facts,input.active_aliases,input.active_procedures,input.signal));after.push(await assess(e.facts,input.active_aliases,[...input.active_procedures,{...input.procedure,state:'active'}],input.signal));}
 const metrics=(a:Assessment[]):EvaluationMetrics=>({total:a.length,correct:a.filter((v,i)=>v===input.examples[i].expected_assessment).length,false_matches:a.filter((v,i)=>v==='matched'&&input.examples[i].expected_assessment!=='matched').length,needs_review:a.filter(v=>v==='needs_review').length});
 return {procedure_id:input.procedure.id,procedure_version:input.procedure.version,knowledge_revision:input.knowledge_revision,suite_version:'booking-reference-v1',mode:input.mode,tested_at:new Date().toISOString(),passed:true,before:metrics(before),after:metrics(after),applied_case_ids:['valid_a','valid_b','overclaim','over_cap','out_of_policy_date','exact_duplicate','non_usd','missing_traveler'],regressed_case_ids:[],reasons:['Offline backend lifecycle test; production C suite remains a dependency.']};
}};
