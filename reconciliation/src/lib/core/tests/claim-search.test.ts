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
function mock(transform?:(answers:Record<string,unknown>)=>void):typeof fetch{return async (_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(Object.keys(body.questions).length,1);assert.ok(body.state.row);assert.equal(body.state.rows,undefined);const answers=Object.fromEntries(Object.keys(body.questions).map(k=>[k,answer('match',['match','no_match'])]));transform?.(answers);return Response.json({answers,usage:{input_tokens:12,output_tokens:3}})}}
test('individual binary search retains every row ID, logs every request and preserves low-confidence matches',async()=>{
 calls.length=0;const rows=Array.from({length:23},(_,i)=>row(String(i)));
 const result=await search({query:'hotel claims',rows},options,mock(a=>{if(a['0'])(a['0'] as {confidence:number}).confidence=.6}));
 assert.equal(result.judgments.length,23);assert.equal(result.judgments[0].result,'match');assert.equal(result.judgments[0].confidence,.6);assert.deepEqual(result.judgments.map(x=>x.submission_id),rows.map(x=>x.submission_id));assert.equal(calls.length,23);assert.equal(calls[0].input_tokens,12);
});
test('missing and extra IDs fail the entire search',async()=>{
 for(const modify of [(a:Record<string,unknown>)=>{delete a['1']},(a:Record<string,unknown>)=>{a.extra=a['1']}]) await assert.rejects(search({query:'hotel claims',rows:[row('1')]},options,mock(modify)),{code:'INVALID_PROVIDER_OUTPUT'});
});
test('broad queries reach each claim directly without an intent gate',async()=>{
 for(const query of ['approve all hotel claims','total spend on trains','names with Demo','claims above 240','odd-looking receipts']){
  let n=0;const good=mock();const result=await search({query,rows:[row('1'),row('2')]},options,async(...args)=>{n++;return good(...args)});
  assert.equal(n,2);assert.equal(result.judgments.length,2);
 }
});
test('binary no-match remains no-match and ternary or invalid probability output is rejected',async()=>{
 const result=await search({query:'flights',rows:[row('1')]},options,mock(a=>{a['1']=answer('no_match',['match','no_match'],.2)}));assert.equal(result.judgments[0].result,'no_match');
 for(const a of [answer('uncertain',['match','no_match','uncertain']),{...answer('match',['match','no_match']),probabilities:{match:.4,no_match:.6}}])await assert.rejects(search({query:'hotels',rows:[row('1')]},options,mock(v=>{v['1']=a})),{code:'INVALID_PROVIDER_OUTPUT'});
});
test('all one-claim requests run concurrently and preserve input order',async()=>{
 let active=0,peak=0;const good=mock();const rows=Array.from({length:9},(_,i)=>row(String(i)));
 const result=await search({query:'hotels',rows},options,async(...args)=>{active++;peak=Math.max(peak,active);try{await new Promise(r=>setTimeout(r,5));return await good(...args)}finally{active--}});
 assert.equal(peak,rows.length);assert.equal(active,0);assert.deepEqual(result.judgments.map(r=>r.submission_id),rows.map(r=>r.submission_id));
});
test('pre-aborted search makes no provider calls',async()=>{
 let n=0;await assert.rejects(search({query:'hotels',rows:[row('1')]},{...options,signal:AbortSignal.abort()},async()=>{n++;return Response.json({})}),{name:'AbortError'});assert.equal(n,0);
});
test('a failed individual request returns no partial results',async()=>{
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
 assert.equal((await new DatabaseRetrieval().retrieve(s,receipt,state)).candidates.some(c=>c.submission_id===state.submissions[0].id),false,'amount alone does not corroborate a purchase');
 prior.vendor=receipt.vendor;prior.receipt_date=receipt.receipt_date;
 assert.equal((await new DatabaseRetrieval().retrieve(s,receipt,state)).candidates.some(c=>c.submission_id===state.submissions[0].id),false,'distinct explicit numbers are preserved');
 state.receipts[0].raw_extracted_text=state.receipts.at(-1)!.raw_extracted_text='Booking reference: SHARED-TRIP';
 assert.ok((await new DatabaseRetrieval().retrieve(s,receipt,state)).candidates.some(c=>c.submission_id===state.submissions[0].id),'booking plus amount/date/currency permits semantic duplicate investigation');
 prior.receipt_number=receipt.receipt_number;
 assert.ok((await new DatabaseRetrieval().retrieve(s,receipt,state)).candidates.some(c=>c.submission_id===state.submissions[0].id));
});

test('search retries only the throttled claim and logs each attempt', async () => {
 const attempts=new Map<string,number>(); const usage:UsageRecord[]=[]; const good=mock();
 const result=await search({query:'hotel',rows:[row('1'),row('2')]},{...options,log_usage:async record=>{usage.push(record)}},async(...args)=>{
  const id=JSON.parse(String(args[1]?.body)).state.row.submission_id;
  const n=(attempts.get(id)??0)+1;attempts.set(id,n);
  return id==='1'&&n<3?new Response('',{status:429,headers:{'Retry-After':'0'}}):good(...args);
 });
 assert.deepEqual(result.judgments.map(r=>r.submission_id),['1','2']);
 assert.equal(attempts.get('1'),3);assert.equal(attempts.get('2'),1);
 assert.equal(usage.length,4);assert.equal(usage.filter(u=>u.input_tokens===null).length,2);
});

test('exhausted search rate limits return an error rather than partial matches', async () => {
 let attempts=0;const good=mock();
 await assert.rejects(search({query:'hotel',rows:[row('1'),row('2')]},options,async(...args)=>{
  if(JSON.parse(String(args[1]?.body)).state.row.submission_id==='1'){attempts++;return new Response('',{status:429,headers:{'Retry-After':'0'}})}
  return good(...args);
 }),{code:'PROVIDER_UNAVAILABLE'});
 assert.equal(attempts,4);
});
