import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../store';
import { FileStore } from '../file-store';
import { demoSnapshot,DEMO_IDS } from '../fixtures';
import { CoreService } from '../service';
import { DatabaseRetrieval } from '../retrieval';
import { SimulatedJev } from '../jev';
import { intelligence } from '../../intelligence';
import { workspaceRows,workspaceReviews,workspaceDecide } from '../workspace';
import { proposeRule,changeRule } from '../rules';
import { exportReviews } from '../export';
import { createAssessExample } from '../evaluation';
import { retryExtraction,backfillReceiptHashes } from '../receipts';
import { LocalStore } from '../../intake/store';
import { extractReceipt } from '../../intake/extract';
const core=(store=new MemoryStore(demoSnapshot()))=>new CoreService(store,new DatabaseRetrieval(),new SimulatedJev(),true,undefined,undefined,intelligence);
const signal=()=>new AbortController().signal;
async function approve(c:CoreService,id=DEMO_IDS[2],verdict:'approved'|'rejected'='approved'){
 const r=workspaceRows(await c.store.snapshot()).find(r=>r.id===id)!;
 return workspaceDecide(c,{submission_id:id,expected_review_revision:r.review_revision,human_verdict:verdict,human_note:'Checked the synthetic original.',correction_type:'decision_override',correction_payload_json:{}});
}
async function propose(c:CoreService){await c.reconcile([DEMO_IDS[2]]);const {row}=await approve(c);return (await proposeRule(c,{submission_id:row.id,expected_review_revision:row.review_revision,canonical_vendor:'Synthetic Harbor Hotel'})).rule;}
test('real isolated ten-case suite: approved source, test, activate, improve a different claim, disable; no decision side effects',async()=>{
 const c=core();const rule=await propose(c);assert.equal((await c.store.snapshot()).knowledge_revision,0);
 await assert.rejects(changeRule(c,rule.id,'activate',{expected_rule_version:1},signal()),{code:'STALE_RULE_TEST'});
 const report=await changeRule(c,rule.id,'test',{expected_rule_version:1},signal());assert.ok('passed' in report&&report.passed);
 const state=await c.store.snapshot();assert.equal(state.rule_tests![0].observations.length,20);assert.equal(state.rule_tests![0].observations.filter(o=>o.alias_ids.includes(rule.id)).length,10);assert.equal(state.rule_tests![0].observations.filter(o=>o.phase==='before').length,10);assert.equal(state.rule_tests![0].observations.filter(o=>o.phase==='after').length,10);assert.ok(state.rule_tests![0].observations.every(o=>o.case_id));
 await changeRule(c,rule.id,'activate',{expected_rule_version:1},signal());assert.equal((await c.store.snapshot()).knowledge_revision,1);
 await c.reconcile([DEMO_IDS[3]]);let row=workspaceRows(await c.store.snapshot())[3];assert.equal(row.assessment_status,'matched');assert.equal(row.decision_status,'pending');
 await changeRule(c,rule.id,'disable',{expected_rule_version:2},signal());assert.equal((await c.store.snapshot()).knowledge_revision,2);
 await assert.rejects(approve(c,DEMO_IDS[3]),{code:'STALE_REVIEW'});
 await c.reconcile([DEMO_IDS[3]]);row=workspaceRows(await c.store.snapshot())[3];assert.equal(row.assessment_status,'needs_review');
 await assert.rejects(changeRule(c,rule.id,'activate',{expected_rule_version:3},signal()),{code:'STALE_RULE'});
});
test('failed test replaces eligibility, source rejection disables knowledge, and stale source/test snapshots fail',async()=>{
 const c=core(),rule=await propose(c);await changeRule(c,rule.id,'test',{expected_rule_version:1},signal());
 const original=c.intelligence!;c.intelligence={...original,evaluate_rule:async()=>{throw new Error('private provider detail');}};
 await assert.rejects(changeRule(c,rule.id,'test',{expected_rule_version:1},signal()),{code:'RULE_TEST_FAILED'});
 assert.equal((await c.store.snapshot()).rules![0].latest_test,null);assert.equal((await c.store.snapshot()).rule_tests!.length,2);
 await assert.rejects(changeRule(c,rule.id,'activate',{expected_rule_version:1},signal()),{code:'STALE_RULE_TEST'});
 c.intelligence=original;await changeRule(c,rule.id,'test',{expected_rule_version:1},signal());
 await c.reconcile([DEMO_IDS[2]]);await assert.rejects(changeRule(c,rule.id,'activate',{expected_rule_version:1},signal()),{code:'STALE_RULE_TEST'});
 await changeRule(c,rule.id,'test',{expected_rule_version:1},signal());await changeRule(c,rule.id,'activate',{expected_rule_version:1},signal());
 await approve(c,DEMO_IDS[2],'rejected');const s=await c.store.snapshot();assert.equal(s.rules![0].state,'disabled');assert.equal(s.rules![0].latest_test,null);assert.equal(s.knowledge_revision,2);
});
test('evaluation uses supplied facts only, logs null run IDs, observes errors and cancellation, and writes no claims',async()=>{
 const c=core(),rule=await propose(c),example=intelligence.build_rule_suite(rule)[0],before=await c.store.snapshot();
 const observations:unknown[]=[];assert.equal(await createAssessExample(c,o=>observations.push(o))(example.facts,[],signal()),'needs_review');
 assert.deepEqual(await c.store.snapshot(),before);assert.equal(observations.length,1);
 const failing=new CoreService(c.store,new DatabaseRetrieval(),{evaluate:async(_state,run,log)=>{await log({id:crypto.randomUUID(),run_id:run,receipt_id:null,provider:'test',model:'test',input_tokens:null,output_tokens:null,latency_ms:1,estimated_cost_usd:null,created_at:new Date().toISOString()});throw new Error('offline');}},false);
 const failed:import('../evaluation').EvaluationObservation[]=[];await assert.rejects(createAssessExample(failing,o=>failed.push(o))(example.facts,[],signal()));assert.equal(failed[0].assessment,null);assert.ok(failed[0].error_code);assert.equal(failed[0].model_calls[0].run_id,null);
 const abort=new AbortController();abort.abort();await assert.rejects(createAssessExample(failing,o=>failed.push(o))(example.facts,[],abort.signal));assert.equal(failed[1].error_code,'ABORTED');assert.equal(failed[1].model_calls.length,0);
});
test('exact duplicate bytes defeat an all-pass semantic provider and simultaneous approvals across claims',async()=>{
 const state=demoSnapshot();state.receipts[0].sha256=state.receipts[2].sha256='a'.repeat(64);
 const store=new MemoryStore(state),c=core(store);await c.reconcile([DEMO_IDS[0],DEMO_IDS[2]]);
 // Test commit-time authority even if a historical/model duplicate result incorrectly passed.
 for(const d of store.state.decisions)if(d.field_checked==='duplicate')d.verdict='pass';
 const results=await Promise.allSettled([approve(c,DEMO_IDS[0]),approve(c,DEMO_IDS[2])]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.deepEqual(workspaceRows(await store.snapshot())[2].duplicate_submission_ids,[DEMO_IDS[0]]);
 assert.deepEqual(workspaceRows(await store.snapshot())[0].duplicate_submission_ids,[]);
});
test('export freezes exact selection, quotes text, neutralizes formulas, retains unknown amounts and rejects stale/foreign/duplicate IDs',async()=>{
 const c=core();const store=c.store as MemoryStore;store.state.submissions[0].attendee_name='=HYPERLINK("bad")';store.state.receipts[0].parsed_fields_json!.amount_minor=null;
 const reviews=await workspaceReviews(c),request={snapshot_token:reviews.snapshot_token,submission_ids:[DEMO_IDS[0]]};
 const csv=await exportReviews(c,request);assert.match(csv,/"'=HYPERLINK\(""bad""\)"/);assert.match(csv,/,"24000","",/);assert.equal(csv.split('\r\n').length,3);assert.doesNotMatch(csv,/storage_path|provider_response|https:/);
 await assert.rejects(exportReviews(c,{...request,submission_ids:[crypto.randomUUID()]}),{code:'STALE_SNAPSHOT'});
 await assert.rejects(exportReviews(c,{...request,submission_ids:[DEMO_IDS[0],DEMO_IDS[0]]}),{code:'INVALID_INPUT'});
 store.state.knowledge_revision=1;await assert.rejects(exportReviews(c,request),{code:'STALE_SNAPSHOT'});
});
test('local restart preserves rules, review history, private original and failed/successful retry history',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sift-platform-'));try{
 const c=new CoreService(new FileStore(dir),new DatabaseRetrieval(),new SimulatedJev(),true,undefined,undefined,intelligence),originals=new LocalStore(dir);
 const rule=await propose(c);await changeRule(c,rule.id,'test',{expected_rule_version:1},signal());await changeRule(c,rule.id,'activate',{expected_rule_version:1},signal());
 await assert.rejects(retryExtraction(c,DEMO_IDS[2],{expected_review_revision:workspaceRows(await c.store.snapshot())[2].review_revision},originals,async()=>{throw new Error('must not call');}),{code:'RETRY_BLOCKED'});
 await c.reconcile([DEMO_IDS[0]]);const row=workspaceRows(await c.store.snapshot())[0],bytes=(await originals.read(row.receipt!.id))!.bytes;
 const failed=await retryExtraction(c,row.id,{expected_review_revision:row.review_revision},originals,async()=>({fields:null,raw:null,error:'Provider unavailable.',usage:null}));assert.equal(failed.row.receipt!.extraction_status,'failed');assert.equal(failed.row.assessment_status,null);assert.equal(failed.row.processing_status,'failed');
 const recovered=await retryExtraction(c,row.id,{expected_review_revision:failed.row.review_revision},originals,(b,t,id)=>extractReceipt(b,t,id,'demo'));assert.equal(recovered.row.receipt!.extraction_status,'succeeded');assert.equal(recovered.row.assessment_status,null);
 const restarted=new FileStore(dir),state=await restarted.snapshot();assert.equal(state.rules![0].state,'active');assert.equal(state.knowledge_revision,1);assert.equal(state.extraction_history!.length,2);assert.deepEqual((await originals.read(row.receipt!.id))!.bytes,bytes);assert.equal(state.corrections.length,1);assert.deepEqual(await backfillReceiptHashes(c,originals),[]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('known mandatory failure remains flagged during provider failure; in-flight knowledge changes cannot publish',async()=>{
 const state=demoSnapshot();state.submissions[0].amount_requested_minor=90000;state.receipts[0].parsed_fields_json!.amount_minor=90000;
 const store=new MemoryStore(state);const failing=new CoreService(store,new DatabaseRetrieval(),{evaluate:async()=>{throw new Error('offline');}},false);
 assert.equal((await failing.reconcile([DEMO_IDS[0]])).results[0].status,'flagged');
 const id=await store.begin(DEMO_IDS[0]);store.state.knowledge_revision=1;await assert.rejects(store.finish(id,[],'approved'),{code:'STALE_RUN'});
});
test('source evidence replacement atomically disables active aliases and test eligibility',async()=>{
 const c=core(),rule=await propose(c);await changeRule(c,rule.id,'test',{expected_rule_version:1},signal());await changeRule(c,rule.id,'activate',{expected_rule_version:1},signal());
 const state=await c.store.snapshot(),s=state.submissions[2],r=state.receipts[2];r.storage_path=`synthetic/${s.id}/${r.id}`;
 const store=c.store as MemoryStore;store.state.receipts[2].storage_path=r.storage_path;
 await store.importIntakeRecord(s,{...r,parsed_fields_json:{...r.parsed_fields_json!,vendor:'Changed vendor'}});
 const after=await store.snapshot();assert.equal(after.rules![0].state,'disabled');assert.equal(after.rules![0].latest_test,null);assert.equal(after.knowledge_revision,2);assert.equal(after.corrections.length,1);
});
test('historical assessments with unknown knowledge cannot authorize a new human approval',async()=>{
 const c=core();await c.reconcile([DEMO_IDS[0]]);const store=c.store as MemoryStore;delete store.state.runs[0].knowledge_revision;
 assert.equal(workspaceRows(await store.snapshot())[0].assessment_knowledge_revision,-1);await assert.rejects(approve(c,DEMO_IDS[0]),{code:'STALE_REVIEW'});
});
test('falsy provider failures are rejected and observed, never scored as legitimate ambiguity',async()=>{
 const c=core(),rule=await propose(c),example=intelligence.build_rule_suite(rule)[0];
 for(const failure of [undefined,null,false,0,'']){
  const failing=new CoreService(c.store,new DatabaseRetrieval(),{evaluate:async()=>{throw failure;}},false);
  const observations:import('../evaluation').EvaluationObservation[]=[];let rejected=false;
  try{await createAssessExample(failing,o=>observations.push(o))(example.facts,[],signal());}catch{rejected=true;}
  assert.equal(rejected,true);assert.equal(observations[0].assessment,null);assert.equal(observations[0].error_code,'PROVIDER_UNAVAILABLE');
 }
});
