import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Meter, cost, percentile, validatePrices } from './measurement';
import { report, summarize, validateLabor } from './report';
import { allAi } from './baseline';
import { generate, receiptBytes, sha256 } from './dataset';
import { main } from './run';
import { factsFromSnapshot } from './production';
import { demoSnapshot } from '../../src/lib/core/fixtures';
import { CoreService } from '../../src/lib/core/service';
import { MemoryStore } from '../../src/lib/core/store';
import { DatabaseRetrieval } from '../../src/lib/core/retrieval';
import { createAssessExample } from '../../src/lib/core/evaluation';
import { validateAnswers } from '../../src/lib/core/jev';
import type { Call, Outcome, Pair, Price, Run } from './types';

const call=(id:string,stage:Call['stage']='sift'):Call=>({id,case_id:'case-01',stage,provider:'openai',requested_model:'deployment',returned_model:'model',input_tokens:1000,output_tokens:100,cached_input_tokens:200,cache_write_tokens:0,latency_ms:100,http_status:200,request_id:'req',error:null});
const price:Price={provider:'openai',requested_model:'deployment',returned_model:'model',sku:'test-only',region:'test',source_url:'https://example.invalid/test-only',checked_at:'2026-09-20',input_usd_per_million:2,output_usd_per_million:10,cached_input_usd_per_million:1};
const outcome=(id:string,ms:number):Outcome=>({assessment:'matched',error:null,latency_ms:ms,call_ids:[id],checks:[]});
function fixture():Run {
  const pair:Pair={case_id:'case-01',cohort:'valid',expected:'matched',facts_sha256:'hash',first:'sift',extraction:{latency_ms:1000,error:null,call_ids:['e']},sift:outcome('s',100),all_ai:outcome('a',400)};
  return {baseline_kind:'shared_extraction',schema_version:1,mode:'live',commit:'test',started_at:'2026-09-20',dataset_sha256:'hash',reviewed:true,selected_cases:1,planned_cases:1,concurrency:1,order:'alternating',baseline_model:'deployment',prices:[price],labor:null,pairs:[pair],calls:[call('e','extraction'),call('s'),call('a','all_ai')],status:'completed',limitations:[]};
}
test('cost uses actual input/output and cached tokens; missing usage or wrong SKU cannot become zero',()=>{
  assert.equal(cost(call('1'),[price]).usd,.0028);
  assert.equal(cost({...call('1'),output_tokens:null},[price]).usd,null);
  assert.equal(cost({...call('1'),cached_input_tokens:null},[price]).usd,null);
  assert.equal(cost({...call('1'),returned_model:'different'},[price]).usd,null);
  assert.equal(cost({...call('1'),cache_write_tokens:10},[price]).usd,null);
  assert.equal(cost({...call('1'),cache_write_tokens:100},[{...price,cache_write_usd_per_million:3,cache_write_accounting:'included_in_input'}]).usd,.0029);
  assert.equal(cost({...call('1'),cache_write_tokens:100},[{...price,cache_write_usd_per_million:3,cache_write_accounting:'additional_to_input'}]).usd,.0031);
  assert.equal(cost({...call('1'),cached_input_tokens:1001},[price]).usd,null);
  assert.throws(()=>validatePrices([price,price]),/Duplicate/);
});
test('shared extraction allocated to both hypothetical pipelines but experiment charged once',()=>{
  const s=summarize(fixture());
  assert.equal(s.arms.sift.calls,2);assert.equal(s.arms.all_ai.calls,2);assert.equal(s.experiment_calls,3);
  assert.equal(s.arms.sift.estimated_total_usd,.0056);assert.equal(s.experiment_estimated_usd,.0084);
  assert.equal(s.arms.sift.e2e_median_ms,1100);assert.equal(s.arms.all_ai.e2e_median_ms,1400);
  assert.equal(s.paired_decision_delta_median_ms,300);
});
test('direct PDF baseline does not inherit Sift extraction latency, cost or failures',()=>{
  const r=fixture();r.baseline_kind='direct_pdf';
  let s=summarize(r);
  assert.equal(s.arms.all_ai.calls,1);assert.equal(s.arms.all_ai.estimated_total_usd,.0028);
  assert.equal(s.arms.all_ai.e2e_median_ms,400);assert.equal(s.paired_decision_delta_median_ms,-700);
  r.pairs[0].extraction.error='EXTRACTION_FAILED';r.pairs[0].sift.error='EXTRACTION_FAILED';r.pairs[0].sift.assessment=null;
  s=summarize(r);assert.equal(s.arms.all_ai.errors,0);assert.equal(s.arms.all_ai.correct,1);assert.equal(s.arms.sift.errors,1);
});
test('quality, incomplete runs and unreviewed labels suppress presentation savings',()=>{
  for(const mutate of [
    (r:Run)=>{r.reviewed=false;},(r:Run)=>{r.status='interrupted';},
    (r:Run)=>{r.pairs[0].sift.assessment='needs_review';},
    (r:Run)=>{r.pairs[0].expected='flagged';},
    (r:Run)=>{r.pairs[0].sift.error='PROVIDER_FAILED';r.pairs[0].sift.assessment=null;},
  ]){const r=fixture();mutate(r);const s=summarize(r);assert.equal(s.headline_eligible,false);assert.equal(s.cost_saving_percent,null);assert.equal(s.serial_latency_saving_percent,null);}
  const r=fixture();r.prices=[];assert.equal(summarize(r).arms.sift.estimated_total_usd,null);assert.equal(summarize(r).cost_saving_percent,null);
});
test('failures stay in denominators and missing tokens suppress the total but preserve known subtotal',()=>{
  const r=fixture();r.pairs[0].all_ai.error='TIMEOUT';r.pairs[0].all_ai.assessment=null;r.calls[2].input_tokens=null;
  const s=summarize(r);assert.equal(s.arms.all_ai.attempts,1);assert.equal(s.arms.all_ai.errors,1);assert.equal(s.arms.all_ai.correct,0);
  assert.equal(s.arms.all_ai.estimated_total_usd,null);assert.equal(s.arms.all_ai.known_cost_subtotal_usd,.0028);
  assert.match(report(r),/Billed dollars are not measured/);
});
test('human scenario includes review time for matched claims and permits negative savings',()=>{
  const r=fixture();r.labor=validateLabor({manual_seconds_per_claim:10,matched_seconds_per_claim:20,exception_seconds_per_claim:40,hourly_usd:36,source:'Explicit test assumptions'});
  assert.equal(summarize(r).arms.sift.labor?.seconds_saved,-10);
  assert.equal(summarize(r).arms.sift.labor?.labor_usd_saved,-.1);
  assert.equal(percentile([1,2,3,4],.5),2.5);assert.equal(percentile([], .95),null);
});
test('meter captures errors, tokens and exact attempt budget without retaining credentials',async()=>{
  let requests=0;
  const meter=new Meter(1,async()=>{requests++;return Response.json({model:'model',usage:{input_tokens:12,output_tokens:5,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:3}}},{status:200,headers:{'x-request-id':'req'}});});
  await meter.fetch('https://api.openai.com/v1/responses',{method:'POST',body:JSON.stringify({model:'deployment'}),headers:{Authorization:'Bearer SECRET'}});
  await assert.rejects(()=>meter.fetch('https://api.openai.com/v1/responses'),/BUDGET/);
  assert.equal(requests,1);assert.equal(meter.calls[0].output_tokens,5);assert.equal(meter.calls[0].cached_input_tokens,0);assert.doesNotMatch(JSON.stringify(meter.calls),/SECRET/);
});
test('dataset remains deterministic, disjoint from bundled fixtures and exact duplicates preserve bytes',()=>{
  const a=generate(20260921),b=generate(20260921);assert.deepEqual(a,b);assert.equal(a.scored.length,50);
  assert.equal(a.scored.filter(c=>c.cohort==='duplicate').length,6);
  for(const c of a.scored.filter(c=>c.duplicate_of)) assert.equal(sha256(receiptBytes(c)),sha256(receiptBytes(a.scored.find(o=>o.case_id===c.duplicate_of)!)));
});
test('adversarial cohort is opt-in, deterministic, appended after the frozen base and entirely non-approvable',()=>{
  const base=generate(20260921),extended=generate(20260921,{adversarial:true});
  assert.deepEqual(extended.scored.slice(0,50),base.scored);
  assert.deepEqual(extended, generate(20260921,{adversarial:true}));
  const adversarial=extended.scored.slice(50);
  assert.equal(adversarial.length,10);assert.equal(extended.scored.length,60);
  for(const [i,c] of adversarial.entries()){assert.equal(c.cohort,'adversarial');assert.equal(c.case_id,`case-${51+i}`);assert.notEqual(c.expected,'approved');}
  assert.equal(adversarial.filter(c=>c.expected==='needs_review').length,1);
  const hashes=new Set(extended.scored.map(c=>sha256(receiptBytes(c))));
  assert.equal(hashes.size,60-6); // only the six exact duplicates share bytes
  assert.ok(adversarial.some(c=>/REVIEWER NOTE/.test(c.fields.vendor??'')));
});
test('all-AI preserves actual LLM verdict and rejects refusal/incomplete/invalid outputs',async()=>{
  const c={url:'https://api.openai.com/v1/responses',key:'fake',model:'test',provider:'openai' as const};
  const state={submission:{} as never,receipt:{} as never,evidence:{candidates:[],aliases:[],retrieval_mode:'database' as const}};
  await assert.rejects(()=>allAi(state,[],c,async()=>Response.json({status:'incomplete'})),/INCOMPLETE/);
  await assert.rejects(()=>allAi(state,[],c,async()=>Response.json({status:'completed',output:[{content:[{type:'refusal'}]}]})),/REFUSAL/);
  await assert.rejects(()=>allAi(state,[],c,async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:'{"assessment":"matched"}'}]}]})));
});
test('offline preparation and two-case live protocol exercise production engine with mocked providers and no Supabase',async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'sift-comparison-'));
  const dataset=path.join(temp,'dataset'),out=path.join(temp,'run');
  const originalFetch=globalThis.fetch, env={...process.env};
  try {
    globalThis.fetch=async()=>{throw new Error('Preparation must never call network');};
    await main(['--prepare','--out',dataset]);
    const all=generate(20260921);
    let extractions=0,baselineExtractions=0,requests=0;
    const bodies:string[]=[];
    process.env.AZURE_OPENAI_ENDPOINT='https://unit-test.openai.azure.com';process.env.AZURE_OPENAI_API_KEY='fake';process.env.AZURE_OPENAI_DEPLOYMENT='extract-model';process.env.AI_GATEWAY_API_KEY='fake';delete process.env.TYPESAFE_API_KEY;delete process.env.JEV_API_KEY;process.env.JEV_MODEL='typesafe-ai/jev';
    globalThis.fetch=async(input,init)=>{
      requests++;const body=JSON.parse(String(init?.body));bodies.push(JSON.stringify(body));
      assert.doesNotMatch(String(input),/supabase/);
      if(body.questions) return Response.json({model:'typesafe-ai/jev',answers:Object.fromEntries(['merchant','name','duplicate'].map(f=>[f,{type:'choice',choice:'pass',probabilities:{pass:1,fail:0,unknown:0},confidence:1}])),usage:{input_tokens:100,output_tokens:40}});
      const data=body.model==='extract-model'?{raw_extracted_text:'synthetic',parsed_fields_json:all.scored[extractions++].fields}:{assessment:'matched',parsed_fields_json:{...all.scored[baselineExtractions++].fields,vendor:'BASELINE ONLY'},checks:Object.fromEntries(['currency','amount','policy','receipt_date','policy_cap','merchant','name','duplicate'].map(f=>[f,'pass']))};
      return Response.json({model:body.model,status:'completed',usage:{input_tokens:100,output_tokens:40,input_tokens_details:{cached_tokens:0}},output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}]});
    };
    await main(['--live','--dataset',dataset,'--out',out,'--baseline-model','baseline-model','--max-model-calls','6','--limit','2','--exploratory']);
    assert.equal(requests,6);
    const result:Run=JSON.parse(await readFile(path.join(out,'results.json'),'utf8'));
    assert.equal(result.pairs.length,2);assert.equal(result.pairs[0].first,'sift');assert.equal(result.pairs[1].first,'all_ai');
    assert.equal(result.pairs[0].sift.assessment,'matched');assert.equal(result.pairs[0].all_ai.assessment,'matched');
    assert.equal(result.baseline_kind,'direct_pdf');assert.equal(result.assessment_policy,'fail-first-v2');
    assert.equal(summarize(result).arms.all_ai.calls,2);assert.equal(summarize(result).arms.sift.calls,4);
    const aiBodies=bodies.map(b=>JSON.parse(b)).filter(b=>b.model==='baseline-model');
    assert.equal(aiBodies.length,2);assert.equal(aiBodies[0].input[0].content[1].type,'input_file');
    const aiEvidence=JSON.parse(aiBodies[1].input[0].content[0].text);
    assert.equal(aiEvidence.prior_receipts.length,1);assert.equal('receipt' in aiEvidence,false);
    assert.equal(aiEvidence.prior_receipts[0].receipt.vendor,'BASELINE ONLY');
    assert.equal(aiEvidence.sha256,sha256(receiptBytes(all.scored[1])));
    assert.equal(aiEvidence.prior_receipts[0].sha256,sha256(receiptBytes(all.scored[0])));
    for(const b of bodies.map(b=>JSON.parse(b)).filter(b=>b.questions))assert.doesNotMatch(JSON.stringify(b),/BASELINE ONLY/);
    assert.equal(summarize(result).headline_eligible,false);
    for(const b of bodies)assert.doesNotMatch(b,/expected|cohort|duplicate_of/);
    await assert.rejects(()=>main(['--live','--dataset',dataset,'--out',path.join(temp,'over'),'--baseline-model','baseline-model','--max-model-calls','1','--limit','2','--exploratory']),/Reserve/);
    // Recheck: no extraction calls, Sift facts come from the source run, the baseline rereads the PDF with its saved history, both arms see the alias.
    const recheck=path.join(temp,'recheck');requests=0;bodies.length=0;
    await main(['--live','--dataset',dataset,'--out',recheck,'--baseline-model','baseline-model','--max-model-calls','4','--limit','2','--exploratory','--recheck',out,'--learned-alias']);
    assert.equal(requests,4);
    const again:Run=JSON.parse(await readFile(path.join(recheck,'results.json'),'utf8'));
    assert.equal(again.recheck?.source_commit,result.commit);assert.deepEqual(again.recheck?.learned_alias,all.alias);
    assert.deepEqual(again.pairs.map(p=>p.facts_sha256),result.pairs.map(p=>p.facts_sha256));
    for(const p of again.pairs){assert.deepEqual(p.extraction,{latency_ms:0,error:null,call_ids:[]});assert.equal(p.sift.call_ids.length,1);assert.equal(p.all_ai.call_ids.length,1);}
    assert.equal(summarize(again).arms.sift.calls,2);assert.equal(summarize(again).arms.all_ai.calls,2);
    assert.ok(again.calls.every(c=>c.stage!=='extraction'));
    const recheckAi=bodies.map(b=>JSON.parse(b)).filter(b=>b.model==='baseline-model').map(b=>JSON.parse(b.input[0].content[0].text));
    assert.deepEqual(recheckAi[1].active_aliases,[all.alias]);assert.equal(recheckAi[1].prior_receipts[0].receipt.vendor,'BASELINE ONLY');
    const jevBodies=bodies.filter(b=>JSON.parse(b).questions);
    assert.equal(jevBodies.length,2);
    const observed=JSON.parse(await readFile(path.join(recheck,'case-01.sift-observations.json'),'utf8'));
    assert.deepEqual(observed[0].alias_ids,['benchmark-alias-01']);
    assert.match(report(again),/Recheck run/);
    await assert.rejects(()=>main(['--live','--dataset',dataset,'--out',path.join(temp,'twice'),'--baseline-model','baseline-model','--max-model-calls','4','--limit','2','--exploratory','--recheck',recheck]),/not another recheck/);
  } finally {globalThis.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);await rm(temp,{recursive:true,force:true});}
});

test('benchmark adapter preserves production fail-first and hash duplicates despite uncertain merchant or passing Jev duplicate',async()=>{
  const state=demoSnapshot();state.submissions=state.submissions.slice(0,2);state.receipts=state.receipts.slice(0,2);
  state.receipts.forEach(r=>{r.sha256='same-file-hash';r.parsed_fields_json!.receipt_number=null;});
  const answers=validateAnswers(Object.fromEntries(['merchant','name','duplicate'].map(f=>[f,{type:'choice',choice:f==='merchant'?'unknown':'pass',probabilities:f==='merchant'?{pass:0,fail:0,unknown:1}:{pass:1,fail:0,unknown:0},confidence:1}])));
  const core=new CoreService(new MemoryStore(state),new DatabaseRetrieval(),{async evaluate(){return {answers,model:'test',simulated:false,raw:{}};}},false);
  const assess=createAssessExample(core);
  const first=factsFromSnapshot(state,state.submissions[0].id),second=factsFromSnapshot(state,state.submissions[1].id);
  assert.deepEqual(first.exact_duplicate_ids,[]);
  assert.deepEqual(second.exact_duplicate_ids,[state.submissions[0].id]);
  assert.equal(second.receipt!.sha256,'same-file-hash');
  assert.equal(await assess(first,[],new AbortController().signal),'needs_review');
  assert.equal(await assess(second,[],new AbortController().signal),'flagged');
  first.submission.amount_requested_minor+=100;
  assert.equal(await assess(first,[],new AbortController().signal),'flagged');
});
