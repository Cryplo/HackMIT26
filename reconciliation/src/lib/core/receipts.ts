import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CoreService } from './service';
import type { IntakeStore } from '../intake/store';
import type { ExtractionResult } from '../intake/extract';
import { CoreError } from './validation';
import { workspaceRows } from './projection';
import { IntakeError } from '../intake/schema';
const revision=z.object({expected_review_revision:z.number().int().nonnegative()}).strict();
export async function retryExtraction(core:CoreService,id:string,raw:unknown,originals:IntakeStore,extract:(bytes:Uint8Array,fileType:string,id:string)=>Promise<ExtractionResult>){
 const input=revision.safeParse(raw);if(!z.uuid().safeParse(id).success||!input.success)throw new CoreError('INVALID_INPUT','Claim ID and current review revision are required.');
 const lease=await core.store.beginExtraction(id,input.data.expected_review_revision);
 try{
  const state=await core.store.snapshot();const receipt=state.receipts.find(r=>r.submission_id===id)!;
  const original=await originals.read(receipt.id);if(!original)throw new CoreError('ORIGINAL_UNAVAILABLE','The private original is unavailable; retry could not start.',409);
  const hash=createHash('sha256').update(original.bytes).digest('hex');
  if(receipt.sha256&&receipt.sha256!==hash)throw new CoreError('RECEIPT_CONFLICT','Original bytes do not match the stored receipt hash.',409);
  let result:ExtractionResult;
  try{result=await extract(original.bytes,receipt.file_type,receipt.id);if(result.usage)await core.store.usage(result.usage);}
  catch{result={fields:null,raw:null,usage:null,error:'Extraction or usage persistence failed; original retained.'};}
  await core.store.finishExtraction(lease,{...receipt,sha256:hash,parsed_fields_json:result.fields,raw_extracted_text:result.raw,extraction_status:result.error?'failed':'succeeded',extraction_error:result.error,extracted_at:new Date().toISOString(),extraction_provenance:result.usage?`${result.usage.provider}:${result.usage.model}`:result.raw?.startsWith('SIMULATED')?'simulated fixture':'unavailable'});
  return {row:workspaceRows(await core.store.snapshot()).find(r=>r.id===id)!};
 }catch(e){const error=e instanceof IntakeError?new CoreError(e.code.toUpperCase(),e.message,e.status):e;await core.store.fail(lease,error instanceof CoreError?error.message:'Extraction unavailable; original retained.');throw error;}
}
/** Explicit operator-invoked backfill; never called by GET or startup. No model calls. */
export async function backfillReceiptHashes(core:CoreService,originals:IntakeStore){
 const results:{receipt_id:string;status:'hashed'|'unavailable'}[]=[];
 for(const receipt of (await core.store.snapshot()).receipts){
  if(receipt.sha256)continue;
  const original=await originals.read(receipt.id);if(!original){results.push({receipt_id:receipt.id,status:'unavailable'});continue;}
  await core.store.receiptHash(receipt.id,createHash('sha256').update(original.bytes).digest('hex'));results.push({receipt_id:receipt.id,status:'hashed'});
 }
 return results;
}
