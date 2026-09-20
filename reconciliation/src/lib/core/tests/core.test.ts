import test from 'node:test';
import assert from 'node:assert/strict';
import { demoSnapshot, DEMO_IDS } from '../fixtures';
import { MemoryStore } from '../store';
import { SimulatedRetrieval, applicableAliases, ElasticsearchRetrieval } from '../retrieval';
import { CoreService } from '../service';
import { LiveJev, SimulatedJev, validateAnswers } from '../jev';
import { correctionInput, reconcileInput } from '../validation';
import { mutationBody } from '../http';
import { decision } from '../checks';
import type { CorrectionInput } from '../../contracts';
function setup() { const store = new MemoryStore(demoSnapshot()); return { store, core: new CoreService(store, new SimulatedRetrieval(), new SimulatedJev(), true) }; }
const alias = (): CorrectionInput => ({ submission_id: DEMO_IDS[2], human_verdict: 'approved', human_note: 'Synthetic Harbor Hotel uses this billing descriptor.', correction_type: 'vendor_alias', correction_payload_json: { observed_vendor: 'SYN HBR 042', canonical_vendor: 'Synthetic Harbor Hotel', scope: { category: 'hotel', currency: 'USD' } } });
test('demo: clean, duplicate, ambiguity, scoped learning, category counterexample', async () => {
  const { core, store } = setup();
  const first = await core.reconcile(DEMO_IDS);
  assert.deepEqual(first.results.map(x => x.status), ['approved','flagged','needs_review','needs_review','needs_review']);
  const before = store.state.decisions.length;
  await core.correct(alias());
  assert.equal(store.state.decisions.length, before+1);
  const second = await core.reconcile([DEMO_IDS[3],DEMO_IDS[4]]);
  assert.deepEqual(second.results.map(x => x.status), ['approved','needs_review']);
  const reviews = await core.reviews();
  assert.equal(reviews.demo_mode, true); assert.equal(reviews.summary.approved_amount_minor, 61500); assert.equal(reviews.summary.flag_rate, .4);
  const learned = reviews.submissions[3].decisions.find(d => d.field_checked === 'merchant')!;
  assert.equal((learned.evidence_json.aliases as unknown[]).length, 1);
  assert.equal(learned.probability, null); assert.equal(learned.confidence_score, null); assert.match(learned.rationale_text,/SIMULATED/);
  const dup = reviews.submissions[1].decisions.find(d => d.field_checked === 'duplicate')!;
  assert.equal((dup.evidence_json.candidates as { submission_id: string }[])[0].submission_id, DEMO_IDS[0]);
  assert.equal(store.calls.length, 0);
});
test('one-time approval does not teach future claims or survive re-run', async () => {
  const { core } = setup();
  await core.reconcile([DEMO_IDS[2]]);
  await core.correct({ ...alias(), correction_type: 'decision_override', correction_payload_json: {} });
  assert.equal((await core.reviews()).submissions[2].status, 'approved');
  assert.deepEqual((await core.reconcile([DEMO_IDS[2],DEMO_IDS[3]])).results.map(x=>x.status), ['needs_review','needs_review']);
});
test('alias cannot change cap, money, date, or currency; missing names are unknown', async () => {
  for (const change of ['cap','amount','date','currency','name']) {
    const { core, store } = setup(); await core.correct(alias()); const s = store.state.submissions[3]; const p = store.state.receipts[3].parsed_fields_json!;
    if (change === 'cap') { s.amount_requested_minor = 30000; p.amount_minor = 30000; }
    if (change === 'amount') p.amount_minor = 19499;
    if (change === 'date') p.receipt_date = '2026-10-01';
    if (change === 'currency') p.currency = 'EUR';
    if (change === 'name') p.names = [];
    const result = (await core.reconcile([s.id])).results[0]; assert.notEqual(result.status,'approved',change);
    if (change === 'name') assert.equal((await core.reviews()).submissions[3].decisions.find(d=>d.field_checked==='name')!.verdict,'unknown');
  }
});
test('aliases cannot cross vendor/category/currency scopes; conflicting aliases remain ambiguous', async () => {
  const { core, store } = setup(); await core.correct(alias());
  const correction = store.state.corrections[0]; const p = store.state.receipts[3].parsed_fields_json!; const s = store.state.submissions[3];
  assert.equal(applicableAliases(s, {...p,vendor:'Different Merchant'},[correction]).length,0);
  assert.equal(applicableAliases({...s,category:'flight'},p,[correction]).length,0);
  const badCurrency = structuredClone(correction); (badCurrency.correction_payload_json.scope as Record<string,unknown>).currency='EUR';
  assert.equal(applicableAliases(s,p,[badCurrency]).length,0);
  await core.correct({...alias(),correction_payload_json:{...alias().correction_payload_json,canonical_vendor:'Synthetic Sky Airlines'}});
  assert.equal((await core.reconcile([s.id])).results[0].status,'needs_review');
});
test('human correction supersedes active run atomically and preserves decisions', async () => {
  const { core, store } = setup(); await core.reconcile([DEMO_IDS[2]]);
  const s = store.state.submissions[2]; const previousRun = s.latest_run_id; const count = store.state.decisions.length;
  const active = await store.begin(s.id); await assert.rejects(store.begin(s.id), /already active/);
  await core.correct(alias());
  await assert.rejects(store.finish(active,[decision(s,active,'overall_status','fail','flagged','stale')],'flagged'), /superseded/);
  await store.fail(active,'late failure');
  assert.equal(s.status,'approved'); assert.equal(s.latest_run_id,previousRun); assert.equal(store.state.decisions.length,count+1);
  assert.equal(store.state.runs.find(r=>r.id===active)!.status,'failed');
});
test('correction rejects foreign/stale decisions and invalid alias scope without side effects', async () => {
  const { core, store } = setup(); await core.reconcile([DEMO_IDS[0],DEMO_IDS[2]]);
  const foreign = store.state.decisions.find(d=>d.submission_id===DEMO_IDS[0])!;
  await assert.rejects(core.correct({...alias(),decision_id:foreign.id}),/latest completed/);
  await assert.rejects(core.correct({...alias(),correction_payload_json:{...alias().correction_payload_json,scope:{category:'flight',currency:'USD'}}}),/match/);
  assert.equal(store.state.corrections.length,0);
});
test('unknown values, missing extraction and ambiguous policies cannot approve', async () => {
  for (const change of ['null','failed','missing-policy','two-policies','invalid-date']) {
    const { core, store } = setup();
    if(change==='null') store.state.receipts[0].parsed_fields_json!.amount_minor=null;
    if(change==='failed') store.state.receipts[0].extraction_status='failed';
    if(change==='missing-policy') store.state.policies=[];
    if(change==='two-policies') store.state.policies.push({...store.state.policies[0],id:crypto.randomUUID()});
    if(change==='invalid-date') store.state.receipts[0].parsed_fields_json!.receipt_date='2026-02-30';
    assert.equal((await core.reconcile([DEMO_IDS[0]])).results[0].status,'needs_review',change);
  }
});
test('retrieval failure routes to review and does not silently simulate', async () => {
  const store = new MemoryStore(demoSnapshot()); const core = new CoreService(store,{retrieve:async()=>{throw new Error('offline');}},new SimulatedJev(),false);
  assert.equal((await core.reconcile([DEMO_IDS[0]])).results[0].status,'needs_review');
});
test('actual Jev wire payload, evidence, response validation, usage once per API call', async () => {
  const { store } = setup(); const state = {submission:store.state.submissions[0],receipt:store.state.receipts[0].parsed_fields_json!,evidence:{candidates:[],aliases:[],retrieval_mode:'elasticsearch' as const}};
  const simulated = await new SimulatedJev().evaluate(state); const raw = {...simulated.raw as object,model:'jev-latest',usage:{input_tokens:123,output_tokens:45}};
  const original = globalThis.fetch; let requests = 0;
  try {
    globalThis.fetch = async (url,init) => { requests++; assert.equal(url,'https://api.typesafe.ai/v1/systemone'); const body=JSON.parse(init!.body as string); assert.equal(body.model,'jev-latest'); assert.equal(Object.keys(body.questions).length,3); assert.deepEqual(body.state.evidence,state.evidence); return Response.json(raw); };
    const evaluation=await new LiveJev('synthetic-test-key').evaluate(state,crypto.randomUUID(),c=>store.usage(c));
    assert.equal(evaluation.simulated,false); assert.equal(requests,1); assert.equal(store.calls.length,1); assert.equal(store.calls[0].input_tokens,123); assert.equal(store.calls[0].estimated_cost_usd,null);
    globalThis.fetch=async()=>Response.json({error:'unavailable'},{status:503});
    await assert.rejects(new LiveJev('synthetic-test-key').evaluate(state,crypto.randomUUID(),c=>store.usage(c)),/503/);
    assert.equal(store.calls.length,2); assert.equal(store.calls[1].input_tokens,null);
    let attempts=0;
    globalThis.fetch=async()=>{attempts++;return attempts===1?Response.json({error:'rate limited'},{status:429,headers:{'retry-after':'0'}}):Response.json(raw)};
    assert.equal((await new LiveJev('synthetic-test-key').evaluate(state,crypto.randomUUID(),c=>store.usage(c))).simulated,false);
    assert.equal(attempts,2); assert.equal(store.calls.length,3);
    attempts=0; globalThis.fetch=async()=>{attempts++;return Response.json({error:'bad request'},{status:400})};
    await assert.rejects(new LiveJev('synthetic-test-key').evaluate(state,crypto.randomUUID(),c=>store.usage(c)),/400/);
    assert.equal(attempts,1);
  } finally { globalThis.fetch=original; }
  const malformed=structuredClone(simulated.answers); malformed.merchant.probabilities.pass=NaN; assert.throws(()=>validateAnswers(malformed));
});
test('Elasticsearch carries candidates, rehydrates evidence, and filters correction scope', async () => {
  const { core,store }=setup(); await core.correct(alias()); const snapshot=await store.snapshot(); const correction= snapshot.corrections[0]; const original=globalThis.fetch; const bodies: unknown[]=[];
  try {
    globalThis.fetch=async(url,init)=>{
      if(String(url).includes('_bulk')) { assert.match(String(init!.body),/SYN-FLIGHT-001/); return Response.json({errors:false}); }
      const body=JSON.parse(String(init!.body)); bodies.push(body);
      const isAlias=JSON.stringify(body).includes('"alias"'); return Response.json({hits:{total:{relation:'eq',value:1},hits:[{_id:isAlias?correction.id:DEMO_IDS[0],_score:9.5,_source:{untrusted:'not used'}}]}});
    };
    const ev=await new ElasticsearchRetrieval('https://search.example.invalid','synthetic').retrieve(snapshot.submissions[3],snapshot.receipts[3].parsed_fields_json!,snapshot);
    assert.equal(ev.aliases.length,1); assert.equal(ev.candidates[0].receipt.receipt_number,'SYN-FLIGHT-001'); assert.equal(ev.retrieval_mode,'elasticsearch'); assert.match(JSON.stringify(bodies),/scope.category/); assert.match(JSON.stringify(bodies),/must_not/);
  } finally { globalThis.fetch=original; }
});
test('server validation and mutation boundary reject malformed or cross-origin requests', async () => {
  assert.throws(()=>reconcileInput({submission_ids:[]})); assert.throws(()=>reconcileInput({submission_ids:['wrong']})); assert.deepEqual(reconcileInput({submission_ids:[DEMO_IDS[0],DEMO_IDS[0]]}),[DEMO_IDS[0]]);
  assert.throws(()=>correctionInput({...alias(),human_note:''})); assert.throws(()=>correctionInput({...alias(),correction_type:'decision_override'}));
  const make=(origin:string,body:string)=>new Request('http://localhost:3000/api/corrections',{method:'POST',headers:{origin,'content-type':'application/json'},body});
  await assert.rejects(mutationBody(make('https://attacker.invalid','{}')),/Same-origin/);
  await assert.rejects(mutationBody(make('http://localhost:3000','a'.repeat(33000))),/32 KiB/);
  assert.deepEqual(await mutationBody(make('http://localhost:3000','{}')),{});
});
test('in-flight orchestration returns reviewer result instead of overwriting it', async () => {
  const store=new MemoryStore(demoSnapshot()); let release!:()=>void; let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}); const gate=new Promise<void>(resolve=>{release=resolve;});
  const core=new CoreService(store,new SimulatedRetrieval(),{evaluate:async(state)=>{entered();await gate;return new SimulatedJev().evaluate(state);}},true);
  const pending=core.reconcile([DEMO_IDS[2]]); await started; await core.correct(alias()); release();
  const result=(await pending).results[0]; assert.equal(result.status,'approved'); assert.match(result.error!,/superseded/); assert.equal((await core.reviews()).submissions[2].status,'approved');
});
test('even a confident all-pass provider cannot approve missing names, conflicting aliases, or policy failure',async()=>{
  for(const scenario of ['missing-name','conflicting-alias','cap']) {
    const store=new MemoryStore(demoSnapshot()); const simulator=new SimulatedJev();
    const goodState={submission:store.state.submissions[0],receipt:store.state.receipts[0].parsed_fields_json!,evidence:{candidates:[],aliases:[],retrieval_mode:'simulated' as const}};
    const pass=await simulator.evaluate(goodState); const core=new CoreService(store,new SimulatedRetrieval(),{evaluate:async()=>({...pass,simulated:false,model:'mock-all-pass'})},false);
    if(scenario==='missing-name') store.state.receipts[0].parsed_fields_json!.names=[];
    if(scenario==='cap') {store.state.submissions[0].amount_requested_minor=90000;store.state.receipts[0].parsed_fields_json!.amount_minor=90000;}
    if(scenario==='conflicting-alias') {await core.correct(alias()); await core.correct({...alias(),correction_payload_json:{...alias().correction_payload_json,canonical_vendor:'Synthetic Sky Airlines'}});}
    const id=scenario==='conflicting-alias'?DEMO_IDS[3]:DEMO_IDS[0]; assert.notEqual((await core.reconcile([id])).results[0].status,'approved',scenario);
  }
});
test('metadata intake bridge is idempotent, preserves decisions, and never accepts changed claim values',async()=>{
 const {core,store}=setup(); const source=demoSnapshot(); const claim={...source.submissions[0],id:crypto.randomUUID(),submitted_at:'2026-09-20T00:00:00.000Z'}; const receipt={...source.receipts[0],id:crypto.randomUUID(),submission_id:claim.id}; receipt.storage_path=`synthetic/${claim.id}/${receipt.id}`; receipt.parsed_fields_json={...receipt.parsed_fields_json!,receipt_number:'SYN-IMPORTED'};
 await store.importIntakeRecord(claim,receipt); await store.importIntakeRecord(claim,receipt); assert.equal(store.state.submissions.length,6); assert.equal(store.state.receipts.length,6);
 await core.reconcile([claim.id]); const reviewed=store.state.submissions.find(s=>s.id===claim.id)!; const run=reviewed.latest_run_id; await store.importIntakeRecord(claim,receipt); assert.equal(reviewed.latest_run_id,run); assert.equal(reviewed.status,'approved');
 await assert.rejects(store.importIntakeRecord({...claim,amount_requested_minor:1},receipt),/cannot be changed/);
 await store.importIntakeRecord(claim,{...receipt,extraction_status:'failed',extraction_error:'Updated extraction failed.'}); assert.equal(reviewed.status,'needs_review');
});
test('reviews expose only the current human override while preserving historical human decisions',async()=>{
 const {core,store}=setup();await core.reconcile([DEMO_IDS[2]]);await core.correct({...alias(),correction_type:'decision_override',correction_payload_json:{}});await core.correct({...alias(),correction_type:'decision_override',correction_payload_json:{},human_verdict:'rejected',human_note:'Reconsidered synthetic claim.'});
 const row=(await core.reviews()).submissions[2];assert.equal(row.status,'rejected');assert.equal(row.decisions.filter(d=>d.check_method==='human').length,1);assert.equal(row.decisions.find(d=>d.check_method==='human')!.answer_json.value,'rejected');assert.equal(store.state.decisions.filter(d=>d.check_method==='human').length,2);
});
