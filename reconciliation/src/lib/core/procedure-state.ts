import { feedbackJob, guardFeedbackLease } from './feedback-learning-state';
import { createHash } from 'node:crypto';
import type { ResolutionProcedure, ProcedureTestReport, ProviderMode } from '../review-contracts';
import type { Snapshot } from './store';
import type { EvaluationObservation } from './evaluation';
import { latestCorrection, reviewRevision } from './safety';
import { CoreError, normalize } from './validation';
import { deriveCandidate } from './evidence';
export interface ProcedureBinding {observed_models?:string[];source_correction_id:string;source_review_revision:number;source_evidence_revision:number;source_fingerprint:string;knowledge_revision:number;suite_hash:string;provider_identity:string;mode:ProviderMode}
export interface StoredProcedure extends ResolutionProcedure {feedback_lease?:string;source_evidence_revision:number;source_fingerprint:string;test_binding?:ProcedureBinding|null;latest_attempt_id?:string|null}
export interface ProcedureAttempt {id:string;procedure_id:string;procedure_version:number;binding:ProcedureBinding;status:'running'|'completed'|'failed';report:ProcedureTestReport|null;error:string|null;observations:(EvaluationObservation & {phase?:'before'|'after';case_id?:string})[]}
export type ProcedureCommand=
 |{action:'propose';run_id:string;expected_review_revision:number}
 |{action:'test';id:string;expected_procedure_version:number;suite_hash:string;provider_identity:string;mode:ProviderMode}
 |{action:'tested';id:string;attempt_id:string;report:ProcedureTestReport|null;error:string|null;observations:ProcedureAttempt['observations']}
 |{action:'activate'|'disable';id:string;expected_procedure_version:number;suite_hash?:string;provider_identity?:string;mode?:ProviderMode};
export function sourceFingerprint(state:Snapshot,id:string){return createHash('sha256').update(JSON.stringify({receipt:state.receipts.find(r=>r.submission_id===id),documents:(state.supporting_documents??[]).filter(d=>d.claim_id===id).sort((a,b)=>a.id.localeCompare(b.id))})).digest('hex');}
export function invalidateProcedures(state:Snapshot,id:string){
 let active=false;state.procedure_history??=[];
 for(const p of state.procedures??[])if(p.source_claim_id===id&&p.state!=='disabled'){active ||= p.state==='active';p.state='disabled';p.version++;p.latest_test=null;p.test_binding=null;p.latest_test_error='Source evidence or approval changed.';state.procedure_history.push(structuredClone(p));}
 if(active)state.knowledge_revision=(state.knowledge_revision??0)+1;
}
function checkSource(state:Snapshot,p:StoredProcedure){
 const c=latestCorrection(state,p.source_claim_id),s=state.submissions.find(s=>s.id===p.source_claim_id);
 if(!c||c.id!==p.source_correction_id||c.human_verdict!=='approved'||s?.evidence_revision!==p.source_evidence_revision||sourceFingerprint(state,p.source_claim_id)!==p.source_fingerprint)throw new CoreError('STALE_RULE','Procedure source changed. Propose a new procedure.',409);
 if(p.source_kind==='review_feedback'){const job=feedbackJob(c);if(!job||!p.feedback_lease)throw new CoreError('STALE_FEEDBACK','Feedback proof missing.',409);guardFeedbackLease(state,c,job,p.feedback_lease);}
 return c;
}
export function mutateProcedure(state:Snapshot,cmd:ProcedureCommand){
 state.procedures??=[];state.procedure_history??=[];state.procedure_tests??=[];state.knowledge_revision??=0;
 let p:StoredProcedure;
 if(cmd.action==='propose'){
  const run=state.investigations?.find(r=>r.run_id===cmd.run_id);if(!run)throw new CoreError('NOT_FOUND','Investigation not found.',404);
  const s=state.submissions.find(s=>s.id===run.claim_id)!;
  if(reviewRevision(state,s.id)!==cmd.expected_review_revision)throw new CoreError('STALE_REVIEW','Source review changed.',409);
  const c=latestCorrection(state,s.id),candidate=deriveCandidate(state,s.id);
  const observed=new Set(run.steps.filter(x=>x.status==='completed').flatMap(x=>x.evidence_refs.map(r=>`${r.kind}:${r.id}`)));
  if(c?.human_verdict!=='approved'||!c.human_note.trim()||run.status!=='completed'||!run.after_assessment||!run.proposed_learning||!candidate||run.after_assessment.evidence_revision!==s.evidence_revision||!candidate.source_evidence_refs.every(r=>observed.has(`${r.kind}:${r.id}`))||JSON.stringify(candidate)!==JSON.stringify(run.proposed_learning))throw new CoreError('PROCEDURE_SOURCE_REQUIRED','A reviewed, unchanged, evidence-backed completed investigation is required.',409);
  p={...candidate,id:crypto.randomUUID(),version:1,state:'draft',source_claim_id:s.id,source_run_id:run.run_id,source_correction_id:c.id,source_evidence_revision:s.evidence_revision??0,source_fingerprint:sourceFingerprint(state,s.id),created_at:new Date().toISOString(),latest_test:null,latest_test_error:null};state.procedures.push(p);
 }else{
  const found=state.procedures.find(p=>p.id===cmd.id);if(!found)throw new CoreError('NOT_FOUND','Procedure not found.',404);p=found;
  if(cmd.action==='tested'){
   const attempt=state.procedure_tests.find(t=>t.id===cmd.attempt_id&&t.procedure_id===p.id);if(!attempt)throw new CoreError('STALE_RULE_TEST','Test attempt not found.',409);
   const b=attempt.binding;b.observed_models=[...new Set(cmd.observations.flatMap(o=>o.model_calls.map(c=>`${c.provider}:${c.model}`)))].sort();
   let fresh=p.state==='draft'&&p.version===attempt.procedure_version&&p.latest_attempt_id===attempt.id&&b.knowledge_revision===state.knowledge_revision&&b.source_review_revision===reviewRevision(state,p.source_claim_id)&&b.source_fingerprint===sourceFingerprint(state,p.source_claim_id);
   try{checkSource(state,p);}catch{fresh=false;}
   Object.assign(attempt,{observations:structuredClone(cmd.observations),report:structuredClone(cmd.report??attempt.report),error:fresh?cmd.error:'STALE_RULE_TEST',status:fresh&&!cmd.error?'completed':'failed'});
   if(fresh){p.latest_test_error=cmd.error;p.latest_test=cmd.error?null:structuredClone(cmd.report);p.test_binding=cmd.error?null:b;}
  }else{
   if(p.version!==cmd.expected_procedure_version)throw new CoreError('STALE_RULE','Procedure version changed.',409);
   if(cmd.action==='disable'){
    if(p.state==='disabled')throw new CoreError('STALE_RULE','Procedure is already disabled.',409);
    if(p.state==='active')state.knowledge_revision++;p.state='disabled';p.version++;p.latest_test=null;p.test_binding=null;
   }else{
    checkSource(state,p);if(p.state!=='draft')throw new CoreError('STALE_RULE','Only draft procedures may be tested or activated.',409);
    if(cmd.action==='test'){
     const binding:ProcedureBinding={source_correction_id:p.source_correction_id,source_review_revision:reviewRevision(state,p.source_claim_id),source_evidence_revision:p.source_evidence_revision,source_fingerprint:p.source_fingerprint,knowledge_revision:state.knowledge_revision,suite_hash:cmd.suite_hash,provider_identity:cmd.provider_identity,mode:cmd.mode};
     const attempt:ProcedureAttempt={id:crypto.randomUUID(),procedure_id:p.id,procedure_version:p.version,binding,status:'running',report:null,error:null,observations:[]};state.procedure_tests.push(attempt);p.latest_attempt_id=attempt.id;p.latest_test=null;p.test_binding=null;p.latest_test_error=null;
    }else{
     const b=p.test_binding,t=p.latest_test;
     if(!t?.passed||!b||t.procedure_id!==p.id||t.procedure_version!==p.version||t.suite_version!=='booking-reference-v1'||t.knowledge_revision!==state.knowledge_revision||b.knowledge_revision!==state.knowledge_revision||b.source_review_revision!==reviewRevision(state,p.source_claim_id)||b.mode!==cmd.mode||t.mode!==cmd.mode||b.provider_identity!==cmd.provider_identity||b.suite_hash!==cmd.suite_hash)throw new CoreError('STALE_RULE_TEST','A fresh passing procedure test is required.',409);
     if(state.procedures.some(q=>q.state==='active'&&normalize(q.trigger_scope.observed_vendor)===normalize(p.trigger_scope.observed_vendor)&&normalize(q.trigger_scope.canonical_vendor)!==normalize(p.trigger_scope.canonical_vendor)))throw new CoreError('RULE_CONFLICT','Conflicting active procedure identity.',409);
     p.state='active';p.version++;state.knowledge_revision++;
     if(p.source_kind==='review_feedback'){const job=feedbackJob(latestCorrection(state,p.source_claim_id))!;Object.assign(job,{status:'active',summary:`${b.mode==='simulated'?'Simulated':'Live'} twelve-case safety test passed. The booking-reference check is active; later claims still need their own evidence.`,updated_at:new Date().toISOString()});}
    }
   }
  }
 }
 state.procedure_history.push(structuredClone(p));return {procedure:structuredClone(p),knowledge_revision:state.knowledge_revision};
}
