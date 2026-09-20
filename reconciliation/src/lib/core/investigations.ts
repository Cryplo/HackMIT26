import { sendAutomaticApprovalNotice } from './email-actions';
import { investigationFailure, invalidInvestigation, type InvestigationStage } from '../intelligence/investigation-errors';
import { z } from 'zod';
import { setTimeout as pause } from 'node:timers/promises';
import type { CoreService } from './service';
import type { EvidenceRef, InvestigationFinding, InvestigationRun, InvestigationRunStep, InvestigationTools, InvestigationTool, ReceiptEvidence } from '../review-contracts';
import { CoreError } from './validation';
import { workspaceRows, publicInvestigation } from './projection';
import { activeAliases } from './rule-state';
import { boundedEvidence, deriveCandidate, supportingFor } from './evidence';
import { decision,overall } from './checks';
import { DatabaseRetrieval } from './retrieval';
import { validClaim } from '../intake/supporting-documents';
import { automaticApproval, shouldInvestigateAutomatically } from './automation';
const revision=z.object({expected_review_revision:z.number().safe().int().nonnegative()}).strict();
const ref=z.object({kind:z.enum(['receipt','supporting_document','claim','policy','alias','procedure']),id:z.uuid()}).strict();
const finding=z.object({id:z.string().max(200),check:z.string().min(1).max(80),statement:z.string().trim().min(1).max(2000),evidence_refs:z.array(ref).min(1).max(30)}).strict();
const key=(r:EvidenceRef)=>`${r.kind}:${r.id}`;
function publicReceipt(r:NonNullable<Awaited<ReturnType<CoreService['store']['snapshot']>>['receipts'][number]>):ReceiptEvidence{
 const {id,submission_id,file_type,sha256,extraction_status,extraction_error,extraction_provenance,parsed_fields_json,raw_extracted_text}=r;
 return {id,submission_id,file_type,sha256:sha256??null,extraction_status,extraction_error,extraction_provenance,parsed_fields_json,raw_extracted_text};
}
export async function investigations(core:CoreService,claimId?:string){
 if(claimId)validClaim(claimId);const state=await core.store.snapshot();
 if(claimId&&!state.submissions.some(s=>s.id===claimId))throw new CoreError('NOT_FOUND','Claim not found.',404);
 const runs=(state.investigations??[]).filter(r=>!claimId||r.claim_id===claimId).toSorted((a,b)=>b.started_at.localeCompare(a.started_at)||b.run_id.localeCompare(a.run_id));
 if(runs.length>1000)throw new CoreError('INVESTIGATION_LIMIT','Investigation history exceeds 1000 runs; filter by claim.',503);
 return {runs:runs.map(publicInvestigation),coverage:{complete:true,returned:runs.length,total:runs.length}};
}
export async function investigation(core:CoreService,id:string){validClaim(id);const run=(await core.store.snapshot()).investigations?.find(r=>r.run_id===id);if(!run)throw new CoreError('NOT_FOUND','Investigation not found.',404);return {run:publicInvestigation(run)};}
export async function investigateClaim(core:CoreService,id:string,raw:unknown,requestSignal:AbortSignal,trigger:InvestigationRun['trigger']='manual',limits={totalMs:90000,planningMs:65000}){
 validClaim(id);const parsed=revision.safeParse(raw);if(!parsed.success)throw new CoreError('INVALID_INPUT','Expected current review revision.');
 if(core.investigationMode==='disabled'||!core.intelligence)throw new CoreError('INVESTIGATION_UNAVAILABLE','Investigation capability is unavailable.',503);
 requestSignal.throwIfAborted();
 const outer=AbortSignal.any([requestSignal,AbortSignal.timeout(Math.min(90000,limits.totalMs))]);
 const initial=await core.store.snapshot(),row=workspaceRows(initial).find(r=>r.id===id);
 if(!row)throw new CoreError('NOT_FOUND','Claim not found.',404);
 if(trigger==='recoverable_uncertainty'&&(!core.automationEnabled||!shouldInvestigateAutomatically(initial,row)))throw new CoreError('INVESTIGATION_NOT_NEEDED','No new eligible evidence is available for automatic investigation.',409);
 let run=await core.store.investigation({action:'start',claim_id:id,expected_review_revision:parsed.data.expected_review_revision,trigger,mode:core.investigationMode});
 let stage:InvestigationStage='EVIDENCE';
 const inFlight=new Set<Promise<unknown>>();let stepWrites=Promise.resolve();let executed=0;let calls=0;let violation:unknown;
 try{
  const state=await core.store.snapshot(),s=state.submissions.find(s=>s.id===id)!,r=state.receipts.find(r=>r.submission_id===id);
  boundedEvidence(state,id);
  const plannerSignal=AbortSignal.any([outer,AbortSignal.timeout(Math.min(65000,limits.planningMs))]),observed=new Set<string>([`claim:${id}`]);
  const record=async(step:InvestigationRunStep)=>{run=await core.store.investigation({action:'step',run_id:run.run_id,step});};
  const wrap=<T>(tool:InvestigationTool,read:()=>Promise<{value:T;refs:EvidenceRef[];summary:string}>)=>(...args:unknown[]):Promise<T>=>{
   plannerSignal.throwIfAborted();if(args.length)throw new CoreError('INVALID_INPUT','Investigation tools take no arguments.');
   if(++executed>6){violation=new CoreError('BUDGET_EXHAUSTED','At most six read tools may execute.',503);throw violation;}
   const step:InvestigationRunStep={id:crypto.randomUUID(),run_id:run.run_id,sequence:executed,tool,status:'running',started_at:new Date().toISOString(),completed_at:null,summary:`Reading ${tool.replaceAll('_',' ')}.`,evidence_refs:[],error:null};
   const start=stepWrites.then(()=>record(step));stepWrites=start.catch(()=>{});
   const work=(async()=>{
    try{await start;plannerSignal.throwIfAborted();
     // The isolated audit rehearsal gives viewers time to see persisted tool activity. Live work never waits.
     if(core.demoMode&&core.investigationMode==='simulated'&&process.env.RECONCILIATION_AUDIT_DEMO==='true')await pause(1200,undefined,{signal:plannerSignal});
     const data=await read();plannerSignal.throwIfAborted();step.status='completed';step.completed_at=new Date().toISOString();step.summary=data.summary;step.evidence_refs=data.refs;await record(step);data.refs.forEach(r=>observed.add(key(r)));return data.value;}
    catch(e){violation=e;step.status='failed';step.completed_at=new Date().toISOString();step.error=investigationFailure(e,plannerSignal,'EVIDENCE');step.summary='Evidence read failed.';await record(step);throw e;}
   })();inFlight.add(work);void work.finally(()=>inFlight.delete(work)).catch(()=>{});return work;
  };
  const tools:InvestigationTools={
   read_receipt:wrap('read_receipt',async()=>({value:r?publicReceipt(r):null,refs:r?[{kind:'receipt',id:r.id}]:[],summary:r?'Read the stored original receipt extraction.':'No original receipt evidence stored.'})),
   read_supporting_documents:wrap('read_supporting_documents',async()=>{const documents=supportingFor(state,id);return {value:documents,refs:documents.map(d=>({kind:'supporting_document' as const,id:d.id})),summary:`Read ${documents.length} stored supporting documents; no extraction call.`};}),
   read_policy:wrap('read_policy',async()=>{const policies=state.policies.filter(p=>p.category===s.category&&p.currency===s.currency);return {value:policies,refs:policies.map(p=>({kind:'policy' as const,id:p.id})),summary:`Read ${policies.length} applicable-category policy records.`};}),
   read_active_aliases:wrap('read_active_aliases',async()=>{const aliases=activeAliases(state).filter(a=>a.payload.scope.category===s.category&&a.payload.scope.currency===s.currency);return {value:aliases,refs:aliases.map(a=>({kind:'alias' as const,id:a.id})),summary:`Read ${aliases.length} active scoped aliases.`};}),
   find_related_claims:wrap('find_related_claims',async()=>{
    const candidates=r?.parsed_fields_json?(await new DatabaseRetrieval().retrieve(s,r.parsed_fields_json,state)).candidates:[];
    const related=candidates.map(c=>{const claim=state.submissions.find(x=>x.id===c.submission_id)!,receipt=state.receipts.find(x=>x.submission_id===claim.id);return {submission:{id:claim.id,attendee_name:claim.attendee_name,email:claim.email,amount_requested_minor:claim.amount_requested_minor,currency:claim.currency,category:claim.category,origin_location:claim.origin_location,submitted_at:claim.submitted_at},receipt:receipt?publicReceipt(receipt):null,decision_status:claim.decision_status??'pending'};});
    if(related.reduce((n,c)=>n+(c.receipt?.raw_extracted_text?.length??0),0)>12000)throw new CoreError('EVIDENCE_LIMIT','Related receipt text exceeds evidence limit.',409);
    return {value:related,refs:related.flatMap(c=>[{kind:'claim' as const,id:c.submission.id},...(c.receipt?[{kind:'receipt' as const,id:c.receipt.id}]:[])]),summary:`Read ${related.length} corroborated prior purchase candidates.`};
   }),
  };
  stage='PLANNING';
  const result=await core.intelligence.investigate({submission:{id:s.id,attendee_name:s.attendee_name,email:s.email,amount_requested_minor:s.amount_requested_minor,currency:s.currency,category:s.category,origin_location:s.origin_location,submitted_at:s.submitted_at},checks:run.before_assessment.checks},tools,{mode:core.investigationMode,signal:plannerSignal,log_usage:async usage=>{calls++;await core.store.usage({...usage,id:crypto.randomUUID(),run_id:run.run_id,receipt_id:null,created_at:new Date().toISOString()});if(calls>3){violation=new CoreError('BUDGET_EXHAUSTED','At most three planning calls are permitted.',503);throw violation;}}});
  await Promise.allSettled([...inFlight]);plannerSignal.throwIfAborted();if(violation)throw violation;
  stage='VALIDATION';
  if(result.status!=='completed'||result.mode!==core.investigationMode)throw new CoreError('INVESTIGATION_UNAVAILABLE','Investigator did not return a completed result.',503);
  const checked=z.array(finding).max(30).safeParse(result.findings??[]);
  if(!checked.success)throw invalidInvestigation('SCHEMA','Invalid structured findings.');
  if(!checked.data.length&&!(typeof result.unresolved_question==='string'&&result.unresolved_question.trim()))throw invalidInvestigation('EMPTY_FINDINGS','Empty findings require an unresolved question.');
  if(checked.data.some(f=>f.evidence_refs.some(ref=>!observed.has(key(ref)))))throw invalidInvestigation('UNOBSERVED_CITATION','Findings must reference actual evidence read in this run.');
  const findings:InvestigationFinding[]=checked.data.map(f=>({...f,id:crypto.randomUUID()}));
  const candidate=deriveCandidate(state,id);
  const proposed=result.proposed_learning&&candidate&&candidate.source_evidence_refs.every(r=>observed.has(key(r)))?candidate:null;
  stage='REASSESSMENT';
  let providerFailed=false,providerError:unknown;
  const assessSignal=AbortSignal.any([outer,AbortSignal.timeout(25000)]);
  const checks=await core.assess(state,id,run.run_id,c=>core.store.usage(c),assessSignal,e=>{providerFailed=true;providerError=e;});
  assessSignal.throwIfAborted();if(providerFailed)throw providerError;
  const status=overall(checks),question=typeof result.unresolved_question==='string'?result.unresolved_question.trim().slice(0,2000):'';
  const auto_approval=automaticApproval(state,id,run.run_id,checks,core.automationEnabled);
  checks.push(decision(s,run.run_id,'overall_status',status==='approved'?'pass':status==='flagged'?'fail':'unknown',status,'Investigation reassessed stored evidence through mandatory core checks.',{investigation_run_id:run.run_id,...(auto_approval?{auto_approval}:{})}));
  const completed:InvestigationRun={...run,status:'completed',headline:auto_approval?'Automatically approved':status==='approved'?'Ready for approval':status==='flagged'?'Discrepancy found':'Needs your input',summary:typeof result.summary==='string'?result.summary.slice(0,4000):'Stored evidence reassessed.',unresolved_question:status==='needs_review'?(question||'Which additional evidence resolves the remaining unknown checks?'):null,findings,proposed_learning:proposed,model:result.model,error:null};
  stage='PUBLICATION';
  run=await core.store.investigation({action:'finish',run_id:run.run_id,result:completed,decisions:checks});
 }catch(e){
  await Promise.allSettled([...inFlight]);
  run=await core.store.investigation({action:'fail',run_id:run.run_id,error:investigationFailure(e,outer,stage),superseded:e instanceof CoreError&&e.code==='STALE_RUN'});
 }
 const notice=run.status==='completed'?await sendAutomaticApprovalNotice(core,id):{};
 return {...notice,run,row:workspaceRows(await core.store.snapshot()).find(r=>r.id===id)!};
}
