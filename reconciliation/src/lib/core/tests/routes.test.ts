import test from 'node:test';
import assert from 'node:assert/strict';
import { POST as reconcile } from '../../../app/api/reconcile/route';
import { POST as correct } from '../../../app/api/corrections/route';
import { GET as reviews } from '../../../app/api/reviews/route';
import { DEMO_IDS } from '../fixtures';
// Run with --conditions=react-server so the real server-only package permits imports.
for (const key of ['SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ELASTICSEARCH_URL','ELASTICSEARCH_API_KEY','TYPESAFE_API_KEY','JEV_API_KEY','RECONCILIATION_APP_ORIGIN']) delete process.env[key];
process.env.RECONCILIATION_MODE='simulated';
const request=(path:string,body:unknown,origin='http://localhost:3000')=>new Request(`http://localhost:3000/api/${path}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
test('route handlers: reconcile, correction learning, reviews and structured validation errors',async()=>{
 const initial=await reviews(); assert.equal(initial.status,200); assert.equal(initial.headers.get('cache-control'),'no-store'); assert.equal((await initial.json()).submissions.length,5);
 const denied=await reconcile(request('reconcile',{submission_ids:[DEMO_IDS[0]]},'https://other.invalid'));assert.equal(denied.status,403);assert.equal((await denied.json()).error.code,'INVALID_ORIGIN');
 const bad=await correct(request('corrections',{}));assert.equal(bad.status,400);assert.equal((await bad.json()).error.code,'INVALID_INPUT');
 const run=await reconcile(request('reconcile',{submission_ids:DEMO_IDS})); assert.equal(run.status,200);assert.deepEqual((await run.json()).results.map((r:{status:string})=>r.status),['approved','flagged','needs_review','needs_review','needs_review']);
 const correction=await correct(request('corrections',{submission_id:DEMO_IDS[2],human_verdict:'approved',human_note:'Synthetic billing descriptor verified.',correction_type:'vendor_alias',correction_payload_json:{observed_vendor:'SYN HBR 042',canonical_vendor:'Synthetic Harbor Hotel',scope:{category:'hotel',currency:'USD'}}}));assert.equal(correction.status,200);assert.equal((await correction.json()).status,'approved');
 const learned=await reconcile(request('reconcile',{submission_ids:[DEMO_IDS[3],DEMO_IDS[4]]}));assert.deepEqual((await learned.json()).results.map((r:{status:string})=>r.status),['approved','needs_review']);
 const final=await (await reviews()).json();assert.equal(final.demo_mode,true);assert.equal(final.summary.approved_amount_minor,61500);assert.equal(final.summary.flag_rate,.4);
});
