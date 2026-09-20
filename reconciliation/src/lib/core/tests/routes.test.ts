import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { POST as reconcile } from '../../../app/api/reconcile/route';
import { POST as correct } from '../../../app/api/corrections/route';
import { GET as reviews } from '../../../app/api/reviews/route';
import { POST as justify } from '../../../app/api/justifications/route';
import { DEMO_IDS } from '../fixtures';
import { CoreService } from '../service';
import { FileStore } from '../file-store';
import { DatabaseRetrieval } from '../retrieval';
import { SimulatedJev } from '../jev';
import { workspaceRows } from '../workspace';
// Run with --conditions=react-server; storage and providers are explicitly offline.
const request=(path:string,body:unknown,origin='http://localhost:3000')=>new Request(`http://localhost:3000/api/${path}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
test('legacy routes require current revisions, disable alias learning, and retain structured reviews and errors',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'reconcile-routes-'));
 const global=globalThis as typeof globalThis & {reimbursementCore?:CoreService},previousCore=global.reimbursementCore;
 const keys=['RECONCILIATION_SYNTHETIC_ONLY','RECONCILIATION_APP_ORIGIN'] as const,previousEnv=keys.map(key=>process.env[key]);
 process.env.RECONCILIATION_SYNTHETIC_ONLY='true';process.env.RECONCILIATION_APP_ORIGIN='http://localhost:3000';
 const core=new CoreService(new FileStore(dir),new DatabaseRetrieval(),new SimulatedJev(),true,{decisions:'simulated',retrieval:'local candidate scan',storage:'local disk',justification:'deterministic summary'});
 global.reimbursementCore=core;
 const transport=t.mock.method(globalThis,'fetch',async()=>{throw new Error('Offline route test attempted network access.');});
 t.after(async()=>{
  if(previousCore)global.reimbursementCore=previousCore;else delete global.reimbursementCore;
  keys.forEach((key,i)=>{if(previousEnv[i]===undefined)delete process.env[key];else process.env[key]=previousEnv[i];});
  await rm(dir,{recursive:true,force:true});assert.equal(transport.mock.callCount(),0);
 });
 const initial=await reviews(); assert.equal(initial.status,200); assert.equal(initial.headers.get('cache-control'),'no-store'); assert.equal((await initial.json()).submissions.length,5);
 const denied=await reconcile(request('reconcile',{submission_ids:[DEMO_IDS[0]]},'https://other.invalid'));assert.equal(denied.status,403);assert.equal((await denied.json()).error.code,'INVALID_ORIGIN');
 const bad=await correct(request('corrections',{}));assert.equal(bad.status,400);assert.equal((await bad.json()).error.code,'INVALID_INPUT');
 const run=await reconcile(request('reconcile',{submission_ids:DEMO_IDS})); assert.equal(run.status,200);assert.deepEqual((await run.json()).results.map((r:{status:string})=>r.status),['approved','flagged','needs_review','needs_review','needs_review']);
 const source=workspaceRows(await core.store.snapshot())[2];
 const override={submission_id:source.id,human_verdict:'approved',human_note:'Synthetic billing descriptor verified.',correction_type:'decision_override',correction_payload_json:{}};
 for(const revision of [undefined,-1,1.5,String(source.review_revision)]){
  const invalid=await correct(request('corrections',{...override,expected_review_revision:revision}));assert.equal(invalid.status,400);assert.equal((await invalid.json()).error.code,'INVALID_INPUT');
 }
 const alias=await correct(request('corrections',{...override,expected_review_revision:source.review_revision,correction_type:'vendor_alias',correction_payload_json:{observed_vendor:'SYN HBR 042',canonical_vendor:'Synthetic Harbor Hotel',scope:{category:'hotel',currency:'USD'}}}));
 assert.equal(alias.status,410);const aliasError=await alias.json();assert.equal(aliasError.error.code,'LEGACY_ALIAS_DISABLED');assert.match(aliasError.error.message,/\/api\/rules/);
 assert.equal((await core.store.snapshot()).corrections.length,0);
 const correction=await correct(request('corrections',{...override,expected_review_revision:source.review_revision}));assert.equal(correction.status,200);assert.equal((await correction.json()).status,'approved');
 const stale=await correct(request('corrections',{...override,expected_review_revision:source.review_revision}));assert.equal(stale.status,409);assert.equal((await stale.json()).error.code,'STALE_REVIEW');
 const unlearned=await reconcile(request('reconcile',{submission_ids:[DEMO_IDS[3],DEMO_IDS[4]]}));assert.deepEqual((await unlearned.json()).results.map((r:{status:string})=>r.status),['needs_review','needs_review']);
 const final=await (await reviews()).json();assert.equal(final.demo_mode,true);assert.equal(final.summary.approved_amount_minor,18000);assert.equal(final.summary.flag_rate,.6);
 assert.equal(final.execution.justification,'deterministic summary');
 const invalid=await justify(request('justifications',{submission_id:'not-a-uuid'}));assert.equal(invalid.status,400);assert.equal((await invalid.json()).error.code,'INVALID_INPUT');
 const missing=await justify(request('justifications',{submission_id:'11111111-1111-4111-8111-111111111111'}));assert.equal(missing.status,404);
 const explained=await justify(request('justifications',{submission_id:DEMO_IDS[1]}));assert.equal(explained.status,200);
 const payload=await explained.json();assert.equal(payload.status,'flagged');assert.equal(payload.justification.simulated,true);assert.ok(payload.justification.reasons.length);
});
