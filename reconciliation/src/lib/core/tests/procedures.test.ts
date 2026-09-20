import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,signal,approve,evidenceState,procedureFacts } from './investigation-fixtures';
import { investigateClaim } from '../investigations';
import { workspaceRows } from '../projection';
import { proposeProcedure,changeProcedure } from '../procedures';
import { createAssessProcedureExample } from '../evaluation';
import { deriveCandidate,itineraryIdentity } from '../evidence';
import { intelligence } from '../../intelligence';
import type { IntelligencePort,ProcedureEvaluationCase,ResolutionProcedure,Assessment,EvaluationMetrics } from '../../review-contracts';
import {backendEvaluator,backendSuite} from './procedure-fixtures';
async function source(){const f=fixture();f.core.intelligence={...f.port,...backendEvaluator};await f.core.reconcile([f.id]);const run=(await investigateClaim(f.core,f.id,{expected_review_revision:workspaceRows(f.store.state)[0].review_revision},signal())).run;await approve(f.core,f.id);f.setResolved(false);const result=await proposeProcedure(f.core,{run_id:run.run_id,expected_review_revision:workspaceRows(f.store.state)[0].review_revision});return {...f,procedure:result.procedure,run};}
test('reviewed source approval revision is allowed, test proof is required, and procedure application retains protected checks',async()=>{
 const f=await source();assert.equal(f.procedure.state,'draft');assert.equal(f.store.state.corrections.length,1);
 await assert.rejects(changeProcedure(f.core,f.procedure.id,'activate',{expected_procedure_version:1},signal()),{code:'STALE_RULE_TEST'});
 const report=await changeProcedure(f.core,f.procedure.id,'test',{expected_procedure_version:1},signal());assert.ok('passed' in report&&report.passed);
 assert.equal(f.store.state.procedure_tests![0].observations.length,24);
 await changeProcedure(f.core,f.procedure.id,'activate',{expected_procedure_version:1},signal());
 const active=f.store.state.procedures![0];assert.equal(active.state,'active');assert.equal(f.store.state.knowledge_revision,1);
 const assess=createAssessProcedureExample(f.core),before=await f.store.snapshot();
 for(const e of backendSuite())assert.equal(await assess(e.facts,[],[active],signal()),e.expected_assessment,e.id);
 assert.deepEqual(await f.store.snapshot(),before);assert.equal(f.store.state.corrections.length,1);
 await changeProcedure(f.core,active.id,'disable',{expected_procedure_version:2},signal());assert.equal(f.store.state.knowledge_revision,2);
 await assert.rejects(changeProcedure(f.core,active.id,'activate',{expected_procedure_version:3},signal()),{code:'STALE_RULE'});
});
test('source withdrawal, changed evidence and failed retest invalidate proof and preserve history',async()=>{
 const f=await source();await changeProcedure(f.core,f.procedure.id,'test',{expected_procedure_version:1},signal());
 const good=f.core.intelligence!;f.core.intelligence={...good,evaluate_procedure:async()=>{throw new Error('mock failure');}};
 await assert.rejects(changeProcedure(f.core,f.procedure.id,'test',{expected_procedure_version:1},signal()),{code:'PROCEDURE_TEST_FAILED'});assert.equal(f.store.state.procedures![0].latest_test,null);assert.equal(f.store.state.procedure_tests!.length,2);
 f.core.intelligence=good;await changeProcedure(f.core,f.procedure.id,'test',{expected_procedure_version:1},signal());
 f.store.state.knowledge_revision!++;await assert.rejects(changeProcedure(f.core,f.procedure.id,'activate',{expected_procedure_version:1},signal()),{code:'STALE_RULE_TEST'});
 await changeProcedure(f.core,f.procedure.id,'test',{expected_procedure_version:1},signal());await changeProcedure(f.core,f.procedure.id,'activate',{expected_procedure_version:1},signal());
 await f.core.correct({submission_id:f.id,expected_review_revision:workspaceRows(f.store.state)[0].review_revision,human_verdict:'rejected',human_note:'Withdrawing source approval.',correction_type:'decision_override',correction_payload_json:{}});
 assert.equal(f.store.state.procedures![0].state,'disabled');assert.equal(f.store.state.procedures![0].latest_test,null);
});
test('booking reference must be explicit, nonempty, supported by text, and consistent across all booking documents',()=>{
 for(const mutate of [(s:ReturnType<typeof evidenceState>)=>{s.receipts[0].raw_extracted_text='Receipt number: TRIP-01';},s=>{s.supporting_documents[0].facts.booking_reference='';},s=>{s.supporting_documents[0].extracted_text='An unrelated document';},s=>{s.supporting_documents.push({...structuredClone(s.supporting_documents[0]),id:crypto.randomUUID(),facts:{...s.supporting_documents[0].facts,booking_reference:'OTHER'}});}] as ((s:ReturnType<typeof evidenceState>)=>void)[]){const s=evidenceState();mutate(s);assert.equal(deriveCandidate(s,s.submissions[0].id),null);}
});
test('a linked itinerary supplies identity only under one explicit policy and no conflicting traveler facts',()=>{
 const s=evidenceState(),id=s.submissions[0].id;s.receipts[0].parsed_fields_json!.names=[];
 s.supporting_documents[0].kind='itinerary' as never;
 assert.equal(itineraryIdentity(s,id),null);
 s.policies.find(p=>p.category==='hotel')!.claimant_identity_evidence='receipt_or_linked_itinerary';assert.ok(itineraryIdentity(s,id));
 s.supporting_documents[0].facts.booking_reference='UNRELATED';assert.equal(itineraryIdentity(s,id),null);
});
test('missing procedure capability remains unavailable without creating draft or spending',async()=>{
 const f=fixture();f.core.intelligence={...intelligence,build_procedure_suite:undefined,evaluate_procedure:undefined};
 await assert.rejects(proposeProcedure(f.core,{run_id:crypto.randomUUID(),expected_review_revision:0}),{code:'PROCEDURE_UNAVAILABLE'});assert.equal(f.store.state.procedures!.length,0);
});

test('procedure evaluator reads defensive copies of actual scorer observations',async()=>{
 const f=await source();let checked=false;
 f.core.intelligence={...f.core.intelligence!,async evaluate_procedure(input,assess){
  const report=await backendEvaluator.evaluate_procedure!(input,assess);
  const observed=input.get_observations!();assert.equal(observed.length,24);
  assert.ok(observed.some(o=>o.phase==='after'&&o.checks.some(c=>c.evidence_json.exact_method==='booking_reference_identity')));
  observed[0].checks.length=0;observed.length=0;
  assert.equal(input.get_observations!().length,24);assert.ok(input.get_observations!()[0].checks.length);checked=true;return report;
 }};
 const report=await changeProcedure(f.core,f.procedure.id,'test',{expected_procedure_version:1},signal());assert.ok('passed' in report&&report.passed);assert.ok(checked);
});
