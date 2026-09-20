import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { generate, writeDataset, sha256, validateReview, type Manifest } from './dataset';
import { CoreService } from '../../src/lib/core/service';
import { MemoryStore, type Snapshot } from '../../src/lib/core/store';
import { DatabaseRetrieval } from '../../src/lib/core/retrieval';
import { createAssessExample, type EvaluationObservation } from '../../src/lib/core/evaluation';
import { LiveJev, questions } from '../../src/lib/core/jev';
import { demoSnapshot } from '../../src/lib/core/fixtures';
import { extractReceipt } from '../../src/lib/intake/extract';
import { Submission as IntakeSubmission } from '../../src/lib/intake/schema';
import { responsesConfig } from '../../src/lib/providers/responses';
import type { PolicyRule, Receipt, Submission } from '../../src/lib/contracts';
import { directAi, directInstructions, type PriorReceipt } from './baseline';
import { factsFromSnapshot } from './production';
import { Meter, validatePrices } from './measurement';
import { casesCsv, callsJsonl, report, summarize, validateLabor } from './report';
import type { Arm, Assessment, Outcome, Pair, Run } from './types';

const json = async (p:string) => JSON.parse(await readFile(p,'utf8'));
const pretty = (v:unknown) => JSON.stringify(v,null,2)+'\n';
const outcome = (error:string):Outcome => ({assessment:null,error,latency_ms:0,call_ids:[],checks:[]});
const label = (s:string):Assessment => s==='approved'?'matched':s==='flagged'?'flagged':'needs_review';
const integer=(value:string|undefined,fallback:number) => {
  if(value===undefined)return fallback;
  if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1)throw new Error('Expected a positive integer.');
  return Number(value);
};
const options = {
  prepare:{type:'boolean'},live:{type:'boolean'},help:{type:'boolean'},exploratory:{type:'boolean'},
  seed:{type:'string'},dataset:{type:'string'},out:{type:'string'},review:{type:'string'},
  'baseline-model':{type:'string'},'max-model-calls':{type:'string'},limit:{type:'string'},
  prices:{type:'string'},labor:{type:'string'},
} as const;

export async function main(args=process.argv.slice(2)) {
  const {values:v}=parseArgs({args,options,strict:true,allowPositionals:false});
  if(v.help) {
    console.log('Prepare: run.ts --prepare --out evals/results/comparison-data [--seed 20260921]\nLive: run.ts --live --dataset DIR --out NEW_DIR --baseline-model DEPLOYMENT --max-model-calls 150 (--review FILE | --exploratory) [--limit 3] [--prices FILE] [--labor FILE]\nNo live calls without --live. Full run: up to 150 model calls (50 extraction + 50 Jev + 50 baseline), serial.'); return;
  }
  if(!!v.prepare===!!v.live)throw new Error('Choose exactly one of --prepare or --live.');
  if(!v.out)throw new Error('--out must name a new directory.');
  const out=path.resolve(v.out);
  if(v.prepare) {
    if(v.dataset||v.review||v.exploratory||v['baseline-model']||v['max-model-calls']||v.limit||v.prices||v.labor)throw new Error('Live options are invalid with --prepare.');
    const seed=integer(v.seed,20260921);
    await mkdir(path.dirname(out),{recursive:true});await mkdir(out); // exclusive creation
    const manifest=await writeDataset(out,generate(seed));
    await writeFile(path.join(out,'policies.json'),pretty(demoSnapshot().policies));
    await writeFile(path.join(out,'review.template.json'),pretty({dataset_dir:out,reviewers:[],reviewed_at:'',minutes_spent:0,inputs_sha256:manifest.inputs_sha256,expected_sha256:manifest.expected_sha256,policies_sha256:sha256(await readFile(path.join(out,'policies.json'))),corrections:[]}));
    await writeFile(path.join(out,'prices.template.json'),'[]\n');
    console.log(`Prepared 50 synthetic cases in ${out}. No API calls made. Review PDFs/labels and policies before a scored run.`);return;
  }
  if(v.seed)throw new Error('Seed belongs to preparation; live runs use frozen inputs.');
  if(!v.dataset||!v['baseline-model']||!v['max-model-calls'])throw new Error('Live needs --dataset, --baseline-model and --max-model-calls.');
  if(!!v.review===!!v.exploratory)throw new Error('Choose --review FILE or explicit --exploratory.');
  const budget=integer(v['max-model-calls'],0),limit=integer(v.limit,50);
  if(limit>50)throw new Error('--limit cannot exceed 50.');
  if(budget<3*limit)throw new Error(`Reserve at least ${3*limit} calls for ${limit} cases. No requests sent.`);
  const dir=path.resolve(v.dataset);
  const manifest:Manifest=await json(path.join(dir,'manifest.json'));
  const inputBytes=await readFile(path.join(dir,'inputs.json')), expectedBytes=await readFile(path.join(dir,'expected.json'));
  if(sha256(inputBytes)!==manifest.inputs_sha256||sha256(expectedBytes)!==manifest.expected_sha256)throw new Error('Frozen dataset hashes changed. Prepare and review a new dataset.');
  const input=JSON.parse(inputBytes.toString()), truth=JSON.parse(expectedBytes.toString());
  const policyBytes=await readFile(path.join(dir,'policies.json'));
  const policySchema=z.array(z.object({id:z.uuid(),category:z.enum(['flight','hotel','train','bus','other']),region_or_route:z.literal('*'),currency:z.literal('USD'),max_amount_minor:z.number().int().nonnegative(),date_range_start:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),date_range_end:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),created_at:z.string()}).strict()).min(1);
  const policies:PolicyRule[]=policySchema.parse(JSON.parse(policyBytes.toString()));
  if(!Array.isArray(input.cases)||input.cases.length!==50||!Array.isArray(truth.cases)||truth.cases.length!==50)throw new Error('Expected the frozen 50-case dataset.');
  const ids=new Set<string>();
  const cases=input.cases.map((c:Record<string,unknown>,i:number)=>{
    const id=`case-${String(i+1).padStart(2,'0')}`;
    if(c.case_id!==id||ids.has(id))throw new Error('Case identity/order is invalid.');ids.add(id);
    const t=truth.cases.find((t:{case_id:string})=>t.case_id===id);
    if(!t||!['approved','flagged','needs_review'].includes(t.expected)||typeof t.cohort!=='string')throw new Error('Missing/invalid expected label.');
    const {case_id,...raw}=c;
    const intake=IntakeSubmission.parse({...raw,amount_requested_minor:String(raw.amount_requested_minor)});
    return {id,intake,expected:label(t.expected),cohort:t.cohort as string};
  });
  // Validate every scored PDF before any provider call, including a limited smoke run.
  const bytes=new Map<string,Buffer>();
  for(const c of cases) {
    const file=`receipts/${c.id}.pdf`;
    const matches=manifest.cases.filter(x=>x.case_id===c.id&&x.file===file);
    const data=await readFile(path.join(dir,file));
    if(matches.length!==1||sha256(data)!==matches[0].sha256)throw new Error('Receipt bytes do not match the frozen manifest.');
    bytes.set(c.id,data);
  }
  if(v.review) {
    await validateReview(dir,v.review);
    const review=await json(v.review);
    if(new Set(review.reviewers).size<2||!Number.isFinite(Date.parse(review.reviewed_at))||!(review.minutes_spent>0)||review.policies_sha256!==sha256(policyBytes))throw new Error('Two reviewers, review date/time and matching policy hash are required.');
    if(review.corrections.length)throw new Error('Apply corrections in a new frozen dataset and re-review before scoring.');
  }
  const prices=v.prices?validatePrices(await json(v.prices)):[];
  const labor=v.labor?validateLabor(await json(v.labor)):null;
  const extractionConfig=responsesConfig('extraction');
  const baselineConfig={...extractionConfig,model:v['baseline-model']};
  const direct=process.env.TYPESAFE_API_KEY||process.env.JEV_API_KEY;
  const jevKey=direct||process.env.AI_GATEWAY_API_KEY;
  if(!jevKey)throw new Error('Configure Jev credentials for a live run.');
  const channel=direct?'typesafe':'gateway';
  const jevModel=process.env.JEV_MODEL||(direct?'jev-latest':'typesafe-ai/jev');
  // These adapters use only frozen inputs and local memory, never getCore()/Supabase.
  const meter=new Meter(budget);
  const nativeFetch=globalThis.fetch;
  const run:Run={assessment_policy:'fail-first-v2',baseline_kind:'direct_pdf',schema_version:1,mode:'live',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),started_at:new Date().toISOString(),dataset_sha256:sha256(Buffer.concat([inputBytes,expectedBytes,policyBytes])),reviewed:!!v.review,selected_cases:limit,planned_cases:50,concurrency:1,order:'alternating',baseline_model:baselineConfig.model,prices,labor,pairs:[],calls:meter.calls,status:'running',limitations:[
    'Production createAssessExample/CoreService/LiveJev run with isolated MemoryStore; database, HTTP intake/upload, narration and UI performance are excluded.',
    'Sift extracts then runs code/Jev. Direct-AI reads the original PDF and returns its own extracted fields and verdict in one call. Each arm uses its own accumulated historical extractions; an earlier extraction failure can affect later duplicate evidence.',
    'No active aliases are supplied to either arm. Unfamiliar-merchant cases may legitimately need evidence unavailable in extracted fields.',
    'No learning activation, competitor execution, or observed human timing is included. This does not replace the separately planned learning benchmark.',
    'No deliberate warmup is discarded. Provider cache state is uncontrolled; returned usage is retained where available.',
  ]};
  await mkdir(path.dirname(out),{recursive:true});await mkdir(out);
  const sources=['src/lib/core/service.ts','src/lib/core/evaluation.ts','src/lib/core/safety.ts','src/lib/core/rule-state.ts','src/lib/core/store.ts','src/lib/core/checks.ts','src/lib/core/jev.ts','src/lib/core/retrieval.ts','src/lib/intake/extract.ts','src/lib/intake/schema.ts','src/lib/providers/responses.ts','evals/comparison/production.ts','evals/comparison/baseline.ts','evals/comparison/run.ts','evals/comparison/measurement.ts','evals/comparison/report.ts'];
  const sourceHashes=Object.fromEntries(await Promise.all(sources.map(async file=>[file,sha256(await readFile(file))])));
  await writeFile(path.join(out,'manifest.json'),pretty({commit:run.commit,source_hashes:sourceHashes,dataset_sha256:run.dataset_sha256,inputs_sha256:manifest.inputs_sha256,expected_sha256:manifest.expected_sha256,policies_sha256:sha256(policyBytes),baseline:{provider:baselineConfig.provider,model:baselineConfig.model,instructions:directInstructions},extraction:{provider:extractionConfig.provider,model:extractionConfig.model},jev:{channel,model:jevModel,questions},budget,selected_cases:limit,concurrency:1,prices,labor}));
  if(v.review)await writeFile(path.join(out,'review.json'),await readFile(v.review));
  const save=async()=>{
    await writeFile(path.join(out,'results.tmp'),pretty(run));await rename(path.join(out,'results.tmp'),path.join(out,'results.json'));
    await writeFile(path.join(out,'report.md'),report(run));
    await writeFile(path.join(out,'summary.json'),pretty(summarize(run)));
    await writeFile(path.join(out,'cases.csv'),casesCsv(run));await writeFile(path.join(out,'calls.jsonl'),callsJsonl(run.calls));
  };
  let interrupted=false;
  const stop=()=>{interrupted=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const state:Snapshot={submissions:[],receipts:[],policies,decisions:[],corrections:[],runs:[]};
  const priorAi:PriorReceipt[]=[];
  let priorAiComplete=true;
  console.log(`Live serial comparison: ${limit} cases, planned ${limit*3} calls, hard ceiling ${budget}. Requests time out at 60s (Azure/OpenAI) / 25s (Jev); actual retries count toward ceiling. No shared storage writes.`);
  try {
    globalThis.fetch=meter.fetch;
    for(const [index,c] of cases.slice(0,limit).entries()) {
      if(interrupted)break;
      meter.case_id=c.id;
      const timestamp=new Date(Date.UTC(2026,8,20,0,0,index)).toISOString();
      const submission:Submission={...c.intake,id:randomUUID(),submitted_at:timestamp,updated_at:timestamp,status:'pending',latest_run_id:null};
      const pair:Pair={case_id:c.id,cohort:c.cohort,expected:c.expected,facts_sha256:sha256(bytes.get(c.id)!),first:index%2?'all_ai':'sift',extraction:{latency_ms:0,error:'NOT_RUN',call_ids:[]},sift:outcome('NOT_RUN'),all_ai:outcome('NOT_RUN')};
      run.pairs.push(pair);await save();
      const order:Arm[]=pair.first==='sift'?['sift','all_ai']:['all_ai','sift'];
      for(const arm of order) {
        if(interrupted)break;
        meter.stage=arm;let first=meter.calls.length,begin=performance.now();
        try {
          if(arm==='sift') {
            meter.stage='extraction';
            const receiptId=randomUUID();
            const extraction=await extractReceipt(bytes.get(c.id)!,'application/pdf',receiptId,'live');
            pair.extraction={latency_ms:performance.now()-begin,error:extraction.error?'EXTRACTION_FAILED':null,call_ids:meter.calls.slice(first).map(x=>x.id)};
            const receipt:Receipt={sha256:sha256(bytes.get(c.id)!),id:receiptId,submission_id:submission.id,storage_path:`synthetic/${submission.id}/${receiptId}`,file_type:'application/pdf',raw_extracted_text:extraction.raw,parsed_fields_json:extraction.fields,extraction_status:extraction.error?'failed':'succeeded',extraction_error:extraction.error,extracted_at:timestamp};
            state.submissions.push(submission);state.receipts.push(receipt);
            const frozen=structuredClone(state);
            pair.facts_sha256=sha256(JSON.stringify(frozen));
            await writeFile(path.join(out,`${c.id}.sift-facts.json`),pretty(frozen));
            meter.stage='sift';first=meter.calls.length;begin=performance.now();
            if(extraction.error||!extraction.fields) {
              pair.sift=outcome('EXTRACTION_FAILED');
            } else {
              const store=new MemoryStore(frozen);
              const core=new CoreService(store,new DatabaseRetrieval(),new LiveJev(jevKey,jevModel,channel),false);
              const observations:EvaluationObservation[]=[];
              try {
                const assessment=await createAssessExample(core,o=>observations.push(o))(factsFromSnapshot(frozen,submission.id),[],AbortSignal.timeout(90000));
                pair.sift={assessment,error:null,latency_ms:0,call_ids:[],checks:observations[0]?.checks??[]};
              } finally {
                await writeFile(path.join(out,`${c.id}.sift-observations.json`),pretty(observations));
              }
            }
          } else {
            await writeFile(path.join(out,`${c.id}.ai-input.json`),pretty({submission,policies,prior_receipts:priorAi,prior_receipts_complete:priorAiComplete,pdf_sha256:sha256(bytes.get(c.id)!)}));
            begin=performance.now();
            const result=await directAi(bytes.get(c.id)!,submission,policies,priorAi,priorAiComplete,baselineConfig);
            pair.all_ai={assessment:result.assessment,checks:result.checks,error:null,latency_ms:0,call_ids:[]};
            priorAi.push({sha256:sha256(bytes.get(c.id)!),submission_id:submission.id,attendee_name:submission.attendee_name,category:submission.category,currency:submission.currency,receipt:result.parsed_fields_json});
            await writeFile(path.join(out,`${c.id}.ai-output.json`),pretty(result));
          }
        } catch {
          pair[arm]=outcome(meter.calls.length>=budget?'ASSESSMENT_FAILED_OR_BUDGET_EXHAUSTED':'ASSESSMENT_FAILED');
          if(arm==='all_ai')priorAiComplete=false;
        }
        pair[arm].latency_ms=performance.now()-begin;pair[arm].call_ids=meter.calls.slice(first).map(x=>x.id);
        await save();
      }
      await save();console.log(`${c.id}: sift=${pair.sift.error??pair.sift.assessment}, all_ai=${pair.all_ai.error??pair.all_ai.assessment}; calls=${meter.calls.length}/${budget}`);
      if(meter.calls.some(call=>call.http_status===401||call.http_status===403)) {
        run.limitations.push('Stopped after an authentication/authorization failure; remaining cases were not attempted.');
        interrupted=true;break;
      }
    }
    run.status=interrupted?'interrupted':'completed';
  } finally {
    globalThis.fetch=nativeFetch;process.off('SIGINT',stop);process.off('SIGTERM',stop);
    if(run.status==='running')run.status='interrupted';await save();
  }
  const summary=summarize(run);
  console.log(`Saved ${path.join(out,'report.md')}. Presentation claim gate: ${summary.headline_eligible?'passed':'blocked'}.`);
  if(run.status!=='completed'||summary.arms.sift.errors||summary.arms.all_ai.errors)process.exitCode=2;
}
