import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CoreService } from '../core/service';
import { MemoryStore } from '../core/store';
import { FileStore } from '../core/file-store';
import { LocalSupportingOriginals } from './supporting-originals';
import { parseSupportingUpload,uploadSupporting,supportingDocuments,supportingOriginal } from './supporting-documents';
import { demoSnapshot,DEMO_IDS } from '../core/fixtures';
import { DatabaseRetrieval } from '../core/retrieval';
import { SimulatedJev } from '../core/jev';
import { workspaceRows } from '../core/projection';
import { extractReceipt } from './extract';
const signal=()=>new AbortController().signal;
const input=(revision=0,text='one')=>({revision,kind:'booking_confirmation' as const,bytes:new Uint8Array(Buffer.from('%PDF-'+text)),fileType:'application/pdf'});
const extraction=async()=>({raw:'Synthetic Harbor Hotel\nBooking reference: TRIP-01',fields:null,supporting_facts:{vendor:'Synthetic Harbor Hotel',booking_reference:'TRIP-01',receipt_number:null,names:['Sam Example'],purchase_date:'2026-09-18',currency:'USD',amount_minor:18000},error:null,usage:null});
test('two private documents and extraction failures survive restart; foreign IDs never expose originals',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sift-supporting-'));try{
 const core=new CoreService(new FileStore(dir),new DatabaseRetrieval(),new SimulatedJev(),true),originals=new LocalSupportingOriginals(dir),id=DEMO_IDS[2];await core.reconcile([id]);const revision=workspaceRows(await core.store.snapshot()).find(s=>s.id===id)!.review_revision;
 const first=await uploadSupporting(core,id,input(revision),originals,extraction,signal());assert.equal(first.document.extraction_status,'succeeded');assert.equal(first.row.assessment_status,null);assert.equal(first.row.amount_requested_minor,18000);assert.equal(first.row.decision_status,'pending');
 const second=await uploadSupporting(core,id,input(first.row.review_revision,'two'),originals,async()=>({fields:null,raw:null,error:'Offline failure',usage:null}),signal());assert.equal(second.document.extraction_status,'failed');
 const restarted=new CoreService(new FileStore(dir),new DatabaseRetrieval(),new SimulatedJev(),true);assert.equal((await supportingDocuments(restarted,id)).documents.length,2);
 const bytes=(await supportingOriginal(restarted,id,first.document.id,originals)).bytes;assert.deepEqual(bytes,input().bytes);
 await assert.rejects(supportingOriginal(restarted,DEMO_IDS[0],first.document.id,originals),{code:'NOT_FOUND'});
 assert.doesNotMatch(JSON.stringify(await supportingDocuments(restarted,id)),/storage_path/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('stale and concurrent evidence, duplicate bytes, eight-document ceiling and reviewed claims are rejected before extraction',async()=>{
 const store=new MemoryStore(demoSnapshot()),core=new CoreService(store,new DatabaseRetrieval(),new SimulatedJev(),true);let paid=0;const originals={put:async()=>{},read:async()=>null};const extract=async()=>{paid++;return extraction();};
 let result=await uploadSupporting(core,DEMO_IDS[2],input(),originals,extract,signal());assert.equal(paid,1);
 await assert.rejects(uploadSupporting(core,DEMO_IDS[2],input(0,'stale'),originals,extract,signal()),{code:'STALE_REVIEW'});
 await assert.rejects(uploadSupporting(core,DEMO_IDS[2],input(result.row.review_revision),originals,extract,signal()),{code:'DOCUMENT_EXISTS'});
 const lease=await store.begin(DEMO_IDS[2]);await assert.rejects(uploadSupporting(core,DEMO_IDS[2],input(result.row.review_revision,'concurrent'),originals,extract,signal()),{code:'RUN_ACTIVE'});await store.fail(lease,'test');assert.equal(paid,1);
 for(let i=1;i<8;i++)result=await uploadSupporting(core,DEMO_IDS[2],input(result.row.review_revision,String(i)),originals,extract,signal());
 await assert.rejects(uploadSupporting(core,DEMO_IDS[2],input(result.row.review_revision,'ninth'),originals,extract,signal()),{code:'DOCUMENT_LIMIT'});assert.equal(paid,8);
 await core.correct({submission_id:DEMO_IDS[0],expected_review_revision:0,human_verdict:'rejected',human_note:'Rejected fixture.',correction_type:'decision_override',correction_payload_json:{}});
 await assert.rejects(uploadSupporting(core,DEMO_IDS[0],input(1),originals,extract,signal()),{code:'EVIDENCE_LOCKED'});
});
test('multipart guards reject unknown/duplicate fields, invalid decimal revisions and signatures',async()=>{
 const prior=process.env.RECONCILIATION_SYNTHETIC_ONLY;process.env.RECONCILIATION_SYNTHETIC_ONLY='true';try{
 for(const [revision,extra] of [['1e2',false],['-1',false],['1.0',false],['0',true]]){
 const body=new FormData();body.set('file',new File(['%PDF-test'],'test.pdf',{type:'application/pdf'}));body.set('kind','booking_confirmation');body.set('expected_review_revision',revision as string);if(extra)body.append('kind','itinerary');
 await assert.rejects(parseSupportingUpload(new Request('http://127.0.0.1:3000/api/test',{method:'POST',headers:{origin:'http://127.0.0.1:3000'},body})),{code:'INVALID_INPUT'});
 }
 const body=new FormData();body.set('file',new File(['not pdf'],'x.pdf',{type:'application/pdf'}));body.set('kind','other');body.set('expected_review_revision','0');await assert.rejects(parseSupportingUpload(new Request('http://127.0.0.1:3000/api/test',{method:'POST',headers:{origin:'http://127.0.0.1:3000'},body})),{code:'unsupported_file'});
 }finally{if(prior===undefined)delete process.env.RECONCILIATION_SYNTHETIC_ONLY;else process.env.RECONCILIATION_SYNTHETIC_ONLY=prior;}
});
test('supporting extraction uses a distinct booking-reference schema and logs actual failed attempts once',async()=>{
 const env={...process.env};Object.assign(process.env,{AZURE_OPENAI_ENDPOINT:'https://mock.openai.azure.com',AZURE_OPENAI_API_KEY:'fake',AZURE_OPENAI_DEPLOYMENT:'mock'});try{
 let attempts=0;const result=await extractReceipt(input().bytes,'application/pdf',crypto.randomUUID(),'live',async(_url,init)=>{attempts++;const body=JSON.parse(String(init?.body));assert.ok(body.text.format.schema.properties.facts.properties.booking_reference);return Response.json({error:'fail'},{status:503});},{supporting:true,signal:signal()});
 assert.equal(attempts,1);assert.ok(result.error);assert.equal(result.usage!.input_tokens,null);
 }finally{for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
