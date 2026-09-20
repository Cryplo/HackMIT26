import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { validatePrices } from './measurement';
import { report, summarize, casesCsv, callsJsonl, validateLabor } from './report';
import { sha256 } from './dataset';
import type { Run } from './types';

async function main() {
  const {values:v}=parseArgs({options:{run:{type:'string'},prices:{type:'string'},out:{type:'string'},labor:{type:'string'}},strict:true,allowPositionals:false});
  if(!v.run||!v.prices||!v.out)throw new Error('Usage: reprice.ts --run ORIGINAL_RUN_DIR --prices RATE_CARD --out NEW_DIR [--labor ASSUMPTIONS]');
  const original=await readFile(path.join(v.run,'results.json'));
  const run:Run=JSON.parse(original.toString());
  if(run.schema_version!==1||!Array.isArray(run.calls)||!Array.isArray(run.pairs)||!['direct_pdf','shared_extraction'].includes(run.baseline_kind))throw new Error('Unsupported comparison run.');
  run.prices=validatePrices(JSON.parse(await readFile(v.prices,'utf8')));
  if(v.labor)run.labor=validateLabor(JSON.parse(await readFile(v.labor,'utf8')));
  const out=path.resolve(v.out);await mkdir(path.dirname(out),{recursive:true});await mkdir(out);
  const put=(file:string,value:unknown)=>writeFile(path.join(out,file),JSON.stringify(value,null,2)+'\n');
  await put('provenance.json',{original_run:path.resolve(v.run),original_results_sha256:sha256(original),repriced_at:new Date().toISOString(),prices:run.prices,labor:run.labor});
  await put('results.json',run);await put('summary.json',summarize(run));
  await writeFile(path.join(out,'report.md'),report(run));await writeFile(path.join(out,'cases.csv'),casesCsv(run));await writeFile(path.join(out,'calls.jsonl'),callsJsonl(run.calls));
  console.log(`Repriced recorded usage in ${out}; no model calls made. Original evidence preserved in ${path.resolve(v.run)}.`);
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Repricing failed');process.exitCode=2;});
