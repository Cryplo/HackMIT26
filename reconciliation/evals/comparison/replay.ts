import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { CoreService } from '../../src/lib/core/service';
import { MemoryStore, type Snapshot } from '../../src/lib/core/store';
import { DatabaseRetrieval } from '../../src/lib/core/retrieval';
import { createAssessExample, type EvaluationObservation } from '../../src/lib/core/evaluation';
import { validateAnswers, type Jev } from '../../src/lib/core/jev';
import { factsFromSnapshot } from './production';
import { sha256 } from './dataset';
import type { Run, Assessment } from './types';

async function main(){
  const {values:v}=parseArgs({options:{source:{type:'string'},dataset:{type:'string'},out:{type:'string'}},strict:true,allowPositionals:false});
  if(!v.source||!v.dataset||!v.out)throw new Error('replay.ts --source OLD_RUN_DIR --dataset FROZEN_DATASET --out NEW_DIR');
  const raw=await readFile(path.join(v.source,'results.json'));
  const run:Run=JSON.parse(raw.toString());
  const manifest=JSON.parse(await readFile(path.join(v.dataset,'manifest.json'),'utf8'));
  const input=await readFile(path.join(v.dataset,'inputs.json')),expected=await readFile(path.join(v.dataset,'expected.json')),policies=await readFile(path.join(v.dataset,'policies.json'));
  if(sha256(Buffer.concat([input,expected,policies]))!==run.dataset_sha256)throw new Error('Replay dataset differs from the original run.');
  const hashes=new Map<string,string>();
  for(const p of run.pairs){
    const bytes=await readFile(path.join(v.dataset,`receipts/${p.case_id}.pdf`));const hash=sha256(bytes);
    if(!manifest.cases.some((c:{case_id:string;sha256:string})=>c.case_id===p.case_id&&c.sha256===hash))throw new Error('Receipt hash changed.');
    hashes.set(p.case_id,hash);
  }
  await mkdir(path.dirname(path.resolve(v.out)),{recursive:true});await mkdir(v.out);
  const rows=[];
  const network=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('REPLAY_NETWORK_FORBIDDEN');};
  try {
    for(const p of run.pairs){
      const factsRaw=await readFile(path.join(v.source,`${p.case_id}.sift-facts.json`));
      const state:Snapshot=JSON.parse(factsRaw.toString());
      if(sha256(JSON.stringify(state))!==p.facts_sha256)throw new Error('Recorded facts hash changed.');
      // Original runner's snapshots contain only this run's claims in input order.
      if(state.submissions.length!==run.pairs.indexOf(p)+1)throw new Error('Unexpected reference corpus.');
      state.submissions.forEach((s,i)=>{const receipt=state.receipts.find(r=>r.submission_id===s.id);if(receipt)receipt.sha256=hashes.get(run.pairs[i].case_id)!;});
      const answers=Object.fromEntries((p.sift.checks as {field_checked:string;evidence_json?:{provider_answer?:unknown}}[]).filter(c=>['merchant','name','duplicate'].includes(c.field_checked)).map(c=>[c.field_checked,c.evidence_json?.provider_answer]));
      const jev:Jev={async evaluate(){if(p.sift.error)throw new Error('RECORDED_PROVIDER_FAILURE');return {answers:validateAnswers(answers),model:'recorded-provider-response',simulated:false,raw:{replay:true}};}};
      const core=new CoreService(new MemoryStore(structuredClone(state)),new DatabaseRetrieval(),jev,false);
      const observations:EvaluationObservation[]=[];
      let assessment:Assessment|null=null,error:string|null=null;
      try{assessment=await createAssessExample(core,o=>observations.push(o))(factsFromSnapshot(state,state.submissions.at(-1)!.id),[],new AbortController().signal);}catch{error=p.sift.error?'RECORDED_PROVIDER_FAILURE':'REPLAY_ERROR';}
      rows.push({case_id:p.case_id,expected:p.expected,before:p.sift.assessment,after:assessment,error,changed:assessment!==p.sift.assessment,checks:observations[0]?.checks??[]});
    }
  }finally{globalThis.fetch=network;}
  const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const beforeCorrect=rows.filter(r=>r.before===r.expected).length,afterCorrect=rows.filter(r=>!r.error&&r.after===r.expected).length;
  const changes=rows.filter(r=>r.changed);
  const result={mode:'offline_recorded_answer_replay',source_commit:run.commit,current_commit:commit,source_results_sha256:sha256(raw),provider_calls:0,before_correct:beforeCorrect,after_correct:afterCorrect,rows};
  await writeFile(path.join(v.out,'replay.json'),JSON.stringify(result,null,2)+'\n');
  const report=['# Corroboration against latest production code','',`Old: ${run.commit}. Current: ${commit}.`, '',
    'Offline replay of the SAME recorded extraction and Jev answers. Actual PDF hashes are supplied to the new production duplicate checks. No live model calls, new latency measurement, or new cost measurement. Original provider failure stays a failure. This isolates deterministic changes; the changed Jev prompt still requires a fresh live run.', '',
    `Correct versus unreviewed labels: ${beforeCorrect}/${rows.length} → ${afterCorrect}/${rows.length}. Changed outcomes: ${changes.length}.`, '',
    '| Case | Before | After | Expected |','| --- | --- | --- | --- |',...changes.map(r=>`| ${r.case_id} | ${r.before} | ${r.after} | ${r.expected} |`),'',
    'Merchant confidence thresholds did not change. New rule-learning features are not exercised because this cost benchmark supplies no active aliases. The historical cost/speed results must not be attributed to the new commit.'].join('\n');
  await writeFile(path.join(v.out,'report.md'),report+'\n');console.log(report);
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Replay failed');process.exitCode=2;});
