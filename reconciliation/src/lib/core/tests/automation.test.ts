import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreService } from '../service';
import { MemoryStore } from '../store';
import { demoSnapshot, DEMO_IDS } from '../fixtures';
import { DatabaseRetrieval } from '../retrieval';
import { SimulatedJev } from '../jev';
import { workspaceRows } from '../projection';
import { investigateClaim } from '../investigations';
import { fixture, signal } from './investigation-fixtures';

test('policy automation approves only current passing evidence, preserves humans, and bounds investigation retries',async()=>{
 const store=new MemoryStore(demoSnapshot()),core=new CoreService(store,new DatabaseRetrieval(),new SimulatedJev(),true);
 const row=()=>workspaceRows(store.state)[0],id=DEMO_IDS[0];
 await core.reconcile([id]);
 assert.equal(row().decision_status,'pending','historical matches are not approvals');
 core.automationEnabled=true;
 assert.equal(row().decision_status,'pending','viewing or enabling automation does not convert history');
 await core.reconcile([id]);
 assert.equal(row().decision_status,'approved');assert.equal(row().decision_source,'automatic');
 assert.equal(store.state.corrections.length,0);
 await assert.rejects(store.rule({action:'propose',submission_id:id,expected_review_revision:row().review_revision,canonical_vendor:'Synthetic Sky Airlines'}),{code:'RULE_SOURCE_REQUIRED'});
 const approved=structuredClone(store.state);
 store.state.knowledge_revision!++;assert.equal(row().decision_status,'pending');store.state=structuredClone(approved);
 store.state.receipts[0].raw_extracted_text+=' changed';assert.equal(row().decision_status,'pending');store.state=structuredClone(approved);
 store.state.policies[0].max_amount_minor=1;assert.equal(row().decision_status,'pending');store.state=structuredClone(approved);
 const failedRun=await store.begin(id);await store.fail(failedRun,'offline');assert.equal(row().decision_status,'pending');
 await core.reconcile([id]);assert.equal(row().decision_status,'approved');
 await core.correct({submission_id:id,expected_review_revision:row().review_revision,human_verdict:'rejected',human_note:'Reviewer rejected the claim.',correction_type:'decision_override',correction_payload_json:{}});
 await core.reconcile([id]);assert.equal(row().decision_status,'rejected');assert.equal(row().decision_source,'human');assert.equal(store.state.corrections.length,1);

 for(const kind of ['cap','amount','currency','unknown','duplicate'] as const){
  const state=demoSnapshot(),receipt=state.receipts[0].parsed_fields_json!;
  if(kind==='cap')state.policies[0].max_amount_minor=1;
  if(kind==='amount')receipt.amount_minor!++;
  if(kind==='currency')receipt.currency='EUR';
  if(kind==='unknown')receipt.names=[];
  const blockedStore=new MemoryStore(state),blocked=new CoreService(blockedStore,new DatabaseRetrieval(),new SimulatedJev(),true,undefined,undefined,undefined,'disabled',true);
  const target=kind==='duplicate'?DEMO_IDS[1]:id;
  await blocked.reconcile([target]);
  assert.equal(workspaceRows(blockedStore.state).find(r=>r.id===target)!.decision_status,'pending',kind);
  assert.equal(blockedStore.state.corrections.length,0);
 }

 const resolved=fixture();resolved.core.automationEnabled=true;
 await resolved.core.reconcile([resolved.id]);
 assert.equal(resolved.store.state.investigations!.length,1);assert.equal(resolved.calls(),2);
 assert.equal(workspaceRows(resolved.store.state)[0].decision_source,'automatic');
 assert.equal(resolved.store.state.corrections.length,0);
 await resolved.core.reconcile([resolved.id]);assert.equal(resolved.store.state.investigations!.length,1);

 for(const failure of [false,true]){
  const f=fixture();f.core.automationEnabled=true;let attempts=0;
  f.core.intelligence={...f.port,async investigate(...args){attempts++;if(failure)throw new Error('offline');const result=await f.port.investigate(...args);f.setResolved(false);return result;}};
  await f.core.reconcile([f.id]);await f.core.reconcile([f.id]);
  assert.equal(attempts,1,'unchanged failed and unresolved completed runs are not automatically retried');
  assert.equal(workspaceRows(f.store.state)[0].decision_status,'pending');
  f.store.state.submissions[0].evidence_revision!++;
  await f.core.reconcile([f.id]);assert.equal(attempts,2,'new evidence permits one more attempt');
  await investigateClaim(f.core,f.id,{expected_review_revision:workspaceRows(f.store.state)[0].review_revision},signal());
  assert.equal(attempts,3,'manual investigation remains available');
 }
 const violation=fixture();violation.core.automationEnabled=true;violation.store.state.submissions[0].amount_requested_minor++;
 await violation.core.reconcile([violation.id]);assert.equal(violation.store.state.investigations!.length,0);
});
