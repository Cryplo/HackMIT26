import test from 'node:test';
import assert from 'node:assert/strict';
import { demoSnapshot,DEMO_IDS } from '../fixtures';
import { MemoryStore } from '../store';
import { CoreService } from '../service';
import { SimulatedRetrieval } from '../retrieval';
import { SimulatedJev } from '../jev';
import {workspaceRows,workspaceReviews,workspaceDecide} from '../workspace';
const setup=()=>new CoreService(new MemoryStore(demoSnapshot()),new SimulatedRetrieval(),new SimulatedJev(),true);
const input=(id:string,revision:number,verdict='approved')=>({submission_id:id,expected_review_revision:revision,human_verdict:verdict,human_note:'Checked the synthetic original.',correction_type:'decision_override',correction_payload_json:{}});
test('workspace projects real stored rows, keeps assessment separate and preserves human decision on recheck',async()=>{
 const core=setup();let initial=await workspaceReviews(core);assert.equal(initial.contract_version,2);assert.equal(initial.submissions.length,5);assert.equal(initial.summary.approved_amount_minor,0);
 await core.reconcile([DEMO_IDS[0]]);let row=workspaceRows(await core.store.snapshot())[0];assert.equal(row.assessment_status,'matched');assert.equal(row.decision_status,'pending');
 const decision=await workspaceDecide(core,input(row.id,row.review_revision));assert.equal(decision.row.decision_status,'approved');const revision=decision.row.review_revision;
 await core.reconcile([row.id]);row=workspaceRows(await core.store.snapshot())[0];assert.equal(row.decision_status,'approved');assert.equal(row.assessment_status,'matched');assert.ok(row.review_revision>revision);assert.ok(row.decisions.some(d=>d.check_method==='human'&&d.rationale_text==='Checked the synthetic original.'));
 assert.equal((await workspaceReviews(core)).summary.approved_amount_minor,row.amount_requested_minor);
 await assert.rejects(workspaceDecide(core,input(row.id,revision,'rejected')),{code:'STALE_REVIEW'});
});
test('approval blocks unassessed and duplicate claims; rejection can be recorded without a machine verdict',async()=>{
 const core=setup();await assert.rejects(workspaceDecide(core,input(DEMO_IDS[0],0)),{code:'APPROVAL_BLOCKED'});
 await core.reconcile([DEMO_IDS[1]]);let row=workspaceRows(await core.store.snapshot())[1];await assert.rejects(workspaceDecide(core,input(row.id,row.review_revision)),{code:'APPROVAL_BLOCKED'});
 const rejected=await workspaceDecide(core,input(DEMO_IDS[2],0,'rejected'));assert.equal(rejected.row.decision_status,'rejected');assert.equal(rejected.row.assessment_status,null);
});
test('concurrent decisions cannot both save using one review revision',async()=>{
 const core=setup();await core.reconcile([DEMO_IDS[0]]);const row=workspaceRows(await core.store.snapshot())[0];
 const out=await Promise.allSettled([workspaceDecide(core,input(row.id,row.review_revision)),workspaceDecide(core,input(row.id,row.review_revision,'rejected'))]);
 assert.equal(out.filter(x=>x.status==='fulfilled').length,1);assert.equal((await core.store.snapshot()).corrections.length,1);
});
test('concurrent reads share one store snapshot and still observe completed writes',async()=>{
 const core=setup();const store=core.store as MemoryStore;let reads=0;
 const real=store.snapshot.bind(store);store.snapshot=async()=>{reads++;await new Promise(r=>setTimeout(r,5));return real()};
 const [a,b]=await Promise.all([workspaceReviews(core),workspaceReviews(core)]);
 assert.equal(reads,1);assert.equal(a.snapshot_token,b.snapshot_token);
 await core.reconcile([DEMO_IDS[0]]);
 const after=await workspaceReviews(core);assert.equal(after.submissions.find(r=>r.id===DEMO_IDS[0])!.assessment_status,'matched');
});
