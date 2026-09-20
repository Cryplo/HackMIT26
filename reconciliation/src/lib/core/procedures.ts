import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CoreService } from './service';
import type { ProcedureEvaluationCase, ProcedureTestReport, ResolutionProcedure } from '../review-contracts';
import type { ProcedureAttempt } from './procedure-state';
import { createAssessProcedureExample } from './evaluation';
import { activeAliases } from './rule-state';
import { CoreError } from './validation';
import { requiredChecks } from './checks';
const proposal=z.object({run_id:z.uuid(),expected_review_revision:z.number().safe().int().nonnegative()}).strict();
const mutation=z.object({expected_procedure_version:z.number().safe().int().positive()}).strict();
export function publicProcedure(p:ResolutionProcedure):ResolutionProcedure{
 const {id,version,state,source_claim_id,source_run_id,source_correction_id,created_at,latest_test,latest_test_error,kind,trigger_scope,required_evidence,matching_fields,source_evidence_refs}=p;
 return {id,version,state,source_claim_id,source_run_id,source_correction_id,created_at,latest_test,latest_test_error,kind,trigger_scope,required_evidence,matching_fields,source_evidence_refs};
}
function port(core:CoreService){if(!core.intelligence?.build_procedure_suite||!core.intelligence?.evaluate_procedure)throw new CoreError('PROCEDURE_UNAVAILABLE','Procedure evaluation is not installed.',503);return {build:core.intelligence.build_procedure_suite.bind(core.intelligence),evaluate:core.intelligence.evaluate_procedure.bind(core.intelligence)};}
export async function procedures(core:CoreService){const state=await core.store.snapshot();return {procedures:(state.procedures??[]).map(publicProcedure),knowledge_revision:state.knowledge_revision??0};}
export async function proposeProcedure(core:CoreService,raw:unknown){port(core);const input=proposal.safeParse(raw);if(!input.success)throw new CoreError('INVALID_INPUT','Proposal requires only the investigation run and current revision.');const result=await core.store.procedure({action:'propose',...input.data});return {...result,procedure:publicProcedure(result.procedure)};}
export async function changeProcedure(core:CoreService,id:string,action:'test'|'activate'|'disable',raw:unknown,signal:AbortSignal){
 const input=mutation.safeParse(raw);if(!z.uuid().safeParse(id).success||!input.success)throw new CoreError('INVALID_INPUT','Procedure ID and current version are required.');
 if(action==='disable'){const r=await core.store.procedure({action,id,...input.data});return {...r,procedure:publicProcedure(r.procedure)};}
 const evaluator=port(core),state=await core.store.snapshot(),p=state.procedures?.find(p=>p.id===id);if(!p)throw new CoreError('NOT_FOUND','Procedure not found.',404);
 const examples=evaluator.build(publicProcedure(p));
 if(examples.length!==12||new Set(examples.map(e=>e.id)).size!==12||new Set(examples.map(e=>e.facts.submission.id)).size!==12||examples.some(e=>e.facts.submission.id===p.source_claim_id))throw new CoreError('INVALID_PROCEDURE_TEST','The independent twelve-case suite is required.',503);
 const mode=core.demoMode?'simulated':'live',binding={suite_hash:createHash('sha256').update(JSON.stringify(examples)).digest('hex'),provider_identity:core.providerIdentity,mode} as const;
 if(action==='activate'){const r=await core.store.procedure({action,id,...input.data,...binding});return {...r,procedure:publicProcedure(r.procedure)};}
 signal.throwIfAborted();const started=await core.store.procedure({action:'test',id,...input.data,...binding}),attempt_id=started.procedure.latest_attempt_id!,observations:ProcedureAttempt['observations']=[];
 try{
  const current=await core.store.snapshot();if(current.knowledge_revision!==started.knowledge_revision)throw new CoreError('STALE_RULE_TEST','Knowledge changed before testing.',409);
  const report=await evaluator.evaluate({procedure:publicProcedure(started.procedure),active_aliases:activeAliases(current),active_procedures:(current.procedures??[]).filter(p=>p.state==='active').map(publicProcedure),knowledge_revision:started.knowledge_revision,examples,mode,signal,get_observations:()=>structuredClone(observations)},createAssessProcedureExample(core,o=>observations.push({...o,phase:o.procedure_ids?.includes(id)?'after':'before',case_id:examples.find(e=>e.facts.submission.id===o.submission_id)?.id})));
  signal.throwIfAborted();validateProcedureReport(report,p,started.knowledge_revision,mode,examples,observations);
  const saved=await core.store.procedure({action:'tested',id,attempt_id,report,error:null,observations});
  if(saved.procedure.latest_attempt_id!==attempt_id||!saved.procedure.latest_test)throw new CoreError('STALE_RULE_TEST','Procedure test was superseded.',409);
  return saved.procedure.latest_test;
 }catch(e){await core.store.procedure({action:'tested',id,attempt_id,report:null,error:e instanceof CoreError?e.code:signal.aborted?'ABORTED':'PROCEDURE_TEST_FAILED',observations});throw e instanceof CoreError?e:new CoreError('PROCEDURE_TEST_FAILED','Procedure test failed; no activation proof saved.',503);}
}
export function validateProcedureReport(r:ProcedureTestReport,p:ResolutionProcedure,k:number,mode:string,examples:ProcedureEvaluationCase[],obs:ProcedureAttempt['observations']){
 const bad=()=>{throw new CoreError('INVALID_PROCEDURE_TEST','A complete, observed, compatible safety report is required.',503);};
 if(r.procedure_id!==p.id||r.procedure_version!==p.version||r.knowledge_revision!==k||r.suite_version!=='booking-reference-v1'||r.mode!==mode||obs.length!==24||obs.some(o=>o.error_code||!o.assessment||o.checks.some(c=>c.check_method==='jev'&&c.evidence_json.simulated!==(mode==='simulated'))))bad();
 if(mode==='live'&&(obs.some(o=>o.model_calls.length!==1)||new Set(obs.flatMap(o=>o.model_calls.map(c=>`${c.provider}:${c.model}`))).size!==1))bad();
 const metrics=(phase:string)=>{const rows=obs.filter(o=>o.phase===phase);return {total:rows.length,correct:rows.filter(o=>examples.find(e=>e.id===o.case_id)?.expected_assessment===o.assessment).length,false_matches:rows.filter(o=>o.assessment==='matched'&&examples.find(e=>e.id===o.case_id)?.expected_assessment!=='matched').length,needs_review:rows.filter(o=>o.assessment==='needs_review').length};};
 for(const phase of ['before','after'] as const)if(Object.entries(metrics(phase)).some(([key,value])=>r[phase][key as keyof typeof r.before]!==value))bad();
 const applied:string[]=[],regressed:string[]=[];let protectedRegression=false;
 for(const e of examples){
  const before=obs.filter(o=>o.case_id===e.id&&o.phase==='before'),after=obs.filter(o=>o.case_id===e.id&&o.phase==='after');if(before.length!==1||after.length!==1)bad();
  const a=after[0],b=before[0];
  if(a.assessment===e.expected_assessment&&a.checks.some(c=>c.field_checked==='merchant'&&c.verdict==='pass'&&Array.isArray(c.evidence_json.procedure_ids)&&c.evidence_json.procedure_ids.includes(p.id)&&c.evidence_json.exact_method==='booking_reference_identity'&&Array.isArray(c.evidence_json.evidence_refs)&&c.evidence_json.evidence_refs.some((ref:{kind:string})=>ref.kind==='supporting_document')))applied.push(e.id);
  if(b.assessment===e.expected_assessment&&a.assessment!==e.expected_assessment)regressed.push(e.id);
  if(requiredChecks.some(field=>['pass','fail'].some(verdict=>b.checks.some(c=>c.field_checked===field&&c.verdict===verdict)&&!a.checks.some(c=>c.field_checked===field&&c.verdict===verdict))))protectedRegression=true;
 }
 if(JSON.stringify([...r.applied_case_ids].sort())!==JSON.stringify(applied.sort())||JSON.stringify([...r.regressed_case_ids].sort())!==JSON.stringify(regressed.sort()))bad();
 if(r.passed&&(!applied.some(id=>examples.find(e=>e.id===id)?.expected_assessment==='matched')||r.after.false_matches||regressed.length||protectedRegression||r.after.correct<r.before.correct))bad();
}
