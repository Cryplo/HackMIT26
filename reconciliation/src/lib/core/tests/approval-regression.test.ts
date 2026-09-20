import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../store';
import { demoSnapshot, DEMO_IDS } from '../fixtures';
import { CoreService } from '../service';
import { SimulatedJev } from '../jev';
import { DatabaseRetrieval } from '../retrieval';
import { workspaceDecide, workspaceRows } from '../workspace';
import { POST as legacy } from '../../../app/api/corrections/route';
import { POST as decide } from '../../../app/api/workspace/decisions/route';

test('$900 claim against $500 cap is blocked through memory and both HTTP entry points', async () => {
 process.env.RECONCILIATION_SYNTHETIC_ONLY='true';
 const state=demoSnapshot(); state.submissions[0].amount_requested_minor=90000; state.receipts[0].parsed_fields_json!.amount_minor=90000;
 const core=new CoreService(new MemoryStore(state),new DatabaseRetrieval(),new SimulatedJev(),true);
 await core.reconcile([DEMO_IDS[0]]);
 const row=workspaceRows(await core.store.snapshot())[0]; assert.equal(row.assessment_status,'flagged');
 const input={submission_id:row.id,expected_review_revision:row.review_revision,human_verdict:'approved' as const,human_note:'Reviewed receipt.',correction_type:'decision_override' as const,correction_payload_json:{}};
 await assert.rejects(workspaceDecide(core,input),{code:'APPROVAL_BLOCKED'});
 const global=globalThis as typeof globalThis & {reimbursementCore?:CoreService};global.reimbursementCore=core;
 const request=()=>new Request('http://localhost:3000/api/corrections',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify(input)});
 try { assert.equal((await decide(request())).status,409); assert.equal((await legacy(request())).status,409); }
 finally { delete global.reimbursementCore; }
 await assert.rejects(core.store.correct(input),{code:'APPROVAL_BLOCKED'});
 assert.equal((await core.store.snapshot()).corrections.length,0);
});
