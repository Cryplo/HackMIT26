import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CoreService } from '../core/service';
import { CoreError } from '../core/validation';
import { workspaceRows } from '../core/projection';
import type { StoredDocument } from '../core/investigation-state';
import type { SupportingDocument } from '../review-contracts';
import { boundedMultipart } from './http';
import { MAX_FILE_BYTES,detectType } from './schema';
import { DocumentKindSchema,SupportingFactsSchema } from './supporting-schema';
import type { ExtractionResult } from './extract';
export interface SupportingOriginals {put(document:StoredDocument,bytes:Uint8Array):Promise<void>;read(document:StoredDocument):Promise<Uint8Array|null>}
export function publicDocument({storage_path:_path,...document}:StoredDocument):SupportingDocument{return structuredClone(document);}
export async function parseSupportingUpload(request:Request){
 if(process.env.RECONCILIATION_SYNTHETIC_ONLY!=='true')throw new CoreError('SYNTHETIC_ONLY','Enable the synthetic-only demo before mutations.',403);
 const form=await boundedMultipart(request);
 if([...form.keys()].some(k=>!['file','kind','expected_review_revision'].includes(k)||form.getAll(k).length!==1))throw new CoreError('INVALID_INPUT','Provide one file, kind, and revision.');
 const kind=DocumentKindSchema.safeParse(form.get('kind')),rev=z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(z.number().safe().int().nonnegative()).safeParse(form.get('expected_review_revision'));
 if(!kind.success||!rev.success)throw new CoreError('INVALID_INPUT','Document kind and serialized decimal revision are required.');
 const file=form.get('file');if(!(file instanceof File)||file.size===0)throw new CoreError('INVALID_INPUT','A nonempty file is required.');
 if(file.size>MAX_FILE_BYTES)throw new CoreError('BODY_TOO_LARGE','Document limit is 8 MiB.',413);
 const bytes=new Uint8Array(await file.arrayBuffer());return {bytes,fileType:detectType(bytes,file.type),kind:kind.data,revision:rev.data};
}
export function validClaim(id:string){if(!z.uuid().safeParse(id).success)throw new CoreError('INVALID_INPUT','Claim ID must be a UUID.');}
export async function supportingDocuments(core:CoreService,id:string){validClaim(id);const state=await core.store.snapshot();if(!state.submissions.some(s=>s.id===id))throw new CoreError('NOT_FOUND','Claim not found.',404);return {documents:(state.supporting_documents??[]).filter(d=>d.claim_id===id).map(publicDocument)};}
export async function supportingOriginal(core:CoreService,id:string,documentId:string,originals:SupportingOriginals){
 validClaim(id);validClaim(documentId);const document=(await core.store.snapshot()).supporting_documents?.find(d=>d.id===documentId&&d.claim_id===id);if(!document)throw new CoreError('NOT_FOUND','Supporting document not found for this claim.',404);
 const bytes=await originals.read(document);if(!bytes)throw new CoreError('NOT_FOUND','Private original is unavailable.',404);
 if(createHash('sha256').update(bytes).digest('hex')!==document.sha256)throw new CoreError('DOCUMENT_CONFLICT','Original bytes no longer match their stored hash.',409);
 return {document:publicDocument(document),bytes};
}
export async function uploadSupporting(core:CoreService,id:string,input:Awaited<ReturnType<typeof parseSupportingUpload>>,originals:SupportingOriginals,extract:(bytes:Uint8Array,type:string,id:string,signal:AbortSignal)=>Promise<ExtractionResult>,signal:AbortSignal){
 validClaim(id);signal.throwIfAborted();
 const document:StoredDocument={id:crypto.randomUUID(),claim_id:id,kind:input.kind,file_type:input.fileType,sha256:createHash('sha256').update(input.bytes).digest('hex'),created_at:new Date().toISOString(),extraction_status:'pending',extraction_error:null,extraction_provenance:null,extracted_text:null,facts:null,storage_path:''};
 document.storage_path=`synthetic/${id}/supporting/${document.id}`;
 const {lease}=await core.store.supporting({action:'start',claim_id:id,expected_review_revision:input.revision,document});
 try{
  await originals.put(document,input.bytes);signal.throwIfAborted();
  const result=await extract(input.bytes,input.fileType,document.id,signal);
  if(result.usage)await core.store.usage({...result.usage,receipt_id:null,run_id:lease});
  const facts=result.supporting_facts?SupportingFactsSchema.parse(result.supporting_facts):null;
  Object.assign(document,{extraction_status:result.error||!facts?'failed':'succeeded',extraction_error:result.error||(!facts?'Supporting evidence extraction unavailable.':null),extraction_provenance:result.usage?`${result.usage.provider}:${result.usage.model}`:result.raw?.startsWith('SIMULATED')?'simulated / unknown evidence':'unavailable',extracted_text:result.raw,facts});
 }catch{
  Object.assign(document,{extraction_status:'failed',extraction_error:signal.aborted?'Supporting extraction aborted; original retained.':'Supporting storage, extraction or usage persistence failed; potentially committed original retained.',extraction_provenance:'failed attempt',facts:null});
 }
 try{await core.store.supporting({action:'finish',lease,document});}catch(e){await core.store.fail(lease,'Supporting evidence publication failed; original retained.');throw e;}
 return {document:publicDocument(document),row:workspaceRows(await core.store.snapshot()).find(r=>r.id===id)!};
}
