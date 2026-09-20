import test from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../../intelligence/search';
import { searchClaims, searchSnapshot } from '../claim-search';
import { MemoryStore } from '../store';
import { DatabaseRetrieval } from '../retrieval';
import type { SearchRow, ProviderOptions, UsageRecord } from '../../review-contracts';
import { demoSnapshot } from '../fixtures';
const row=(id:string):SearchRow=>({submission_id:id,attendee_name:'Test',category:'hotel',amount_requested_minor:20000,currency:'USD',vendor:'Hotel',receipt_amount_minor:20000,receipt_date:'2026-09-18',has_receipt:true,extraction_status:'succeeded',assessment_status:'matched',decision_status:'pending',failed_checks:[],unknown_checks:[],duplicate_submission_ids:[]});
const answer=(selected:string,labels:string[],confidence=1)=>({type:'choice',choice:selected,confidence,probabilities:Object.fromEntries(labels.map(k=>[k,k===selected?1:0]))});
const calls:UsageRecord[]=[];
const options:ProviderOptions={mode:'live',signal:AbortSignal.timeout(60000),log_usage:async c=>{calls.push(c)}};
process.env.AI_GATEWAY_API_KEY='test-only';
function mock(transform?:(answers:Record<string,unknown>)=>void):typeof fetch{return async (_url,init)=>{const body=JSON.parse(String(init?.body));const intent=!!body.questions.intent;const answers=Object.fromEntries(Object.keys(body.questions).map(k=>[k,answer(intent?'supported':'match',intent?['supported','unsupported']:['match','no_match','uncertain'])]));if(!intent)transform?.(answers);return Response.json({answers,usage:{input_tokens:12,output_tokens:3}})}}
test('search batches retain all row IDs, log each request and downgrade low confidence',async()=>{
 calls.length=0;const rows=Array.from({length:23},(_,i)=>row(String(i)));
 const result=await search({query:'hotel claims',rows},options,mock(a=>{if(a['0'])(a['0'] as {confidence:number}).confidence=.6}));
 assert.equal(result.judgments.length,23);assert.equal(result.judgments[0].result,'uncertain');assert.deepEqual(result.judgments.map(x=>x.submission_id),rows.map(x=>x.submission_id));assert.equal(calls.length,4);assert.equal(calls[0].input_tokens,12);
});
test('missing and extra IDs fail the entire search',async()=>{
 for(const modify of [(a:Record<string,unknown>)=>{delete a['1']},(a:Record<string,unknown>)=>{a.extra=a['1']}]) await assert.rejects(search({query:'hotel claims',rows:[row('1')]},options,mock(modify)),{code:'INVALID_PROVIDER_OUTPUT'});
});
test('unsupported intent is rejected before evaluating claims',async()=>{
 let n=0;await assert.rejects(search({query:'approve all claims',rows:[row('1')]},options,async()=>{n++;return Response.json({answers:{intent:answer('unsupported',['supported','unsupported'])}})}),{code:'UNSUPPORTED_QUERY'});assert.equal(n,1);
});
test('a failed batch returns no partial results',async()=>{
 let n=0;const good=mock();await assert.rejects(search({query:'hotel claims',rows:Array.from({length:21},(_,i)=>row(String(i)))},options,async(...args)=>{n++;return n===3?new Response('',{status:503}):good(...args)}),{code:'PROVIDER_UNAVAILABLE'});
});
test('empty corpus makes no paid calls; simulation does not impersonate Jev',async()=>{
 assert.equal((await search({query:'hotel',rows:[]},options,async()=>{throw Error('must not call')})).judgments.length,0);
 await assert.rejects(search({query:'hotel',rows:[row('1')]},{...options,mode:'simulated'}),{code:'SEARCH_DISABLED'});
});
test('search projection keeps machine approval distinct from human approval and rejects stale snapshots',async()=>{
 const state=demoSnapshot();const store=new MemoryStore(state);state.submissions[0].status='approved';
 const snap=searchSnapshot(state);assert.equal(snap.rows.find(r=>r.submission_id===state.submissions[0].id)?.decision_status,'pending');
 await assert.rejects(searchClaims(store,{query:'hotels',snapshot_token:'0'.repeat(64)},options.signal),{code:'STALE_SNAPSHOT'});
 const evaluate:typeof search=async({rows})=>({judgments:rows.map(r=>({submission_id:r.submission_id,result:'match',confidence:1})),mode:'live',model:'test',latency_ms:0});
 const out=await searchClaims(store,{query:'hotels',snapshot_token:snap.snapshot_token,category:'hotel'},options.signal,evaluate);assert.ok(out.matches.length);assert.ok(out.matches.every(r=>r.category==='hotel'));
 await assert.rejects(searchClaims(store,{query:'hotels',snapshot_token:snap.snapshot_token},options.signal,async(...args)=>{const r=await evaluate(...args);state.submissions[0].amount_requested_minor++;return r}),{code:'STALE_SNAPSHOT'});
});
test('database retrieval uses stored receipts and excludes the current/later claim',async()=>{
 const state=demoSnapshot();const s=state.submissions.at(-1)!;const receipt=state.receipts.find(r=>r.submission_id===s.id)!.parsed_fields_json!;
 const result=await new DatabaseRetrieval().retrieve(s,receipt,state);assert.equal(result.retrieval_mode,'database');assert.ok(result.candidates.every(c=>c.submission_id!==s.id));
 const prior=state.receipts[0].parsed_fields_json!;prior.amount_minor=receipt.amount_minor;
 assert.ok((await new DatabaseRetrieval().retrieve(s,receipt,state)).candidates.some(c=>c.submission_id===state.submissions[0].id));
});
