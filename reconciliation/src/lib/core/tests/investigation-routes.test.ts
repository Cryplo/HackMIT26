import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fixture,approve} from './investigation-fixtures';
import {backendEvaluator} from './procedure-fixtures';
import {workspaceRows} from '../projection';
import type {CoreService} from '../service';
import {GET as listDocs,POST as upload} from '../../../app/api/submissions/[id]/supporting-documents/route';
import {GET as original} from '../../../app/api/submissions/[id]/supporting-documents/[documentId]/route';
import {POST as investigate} from '../../../app/api/submissions/[id]/investigate/route';
import {GET as listRuns} from '../../../app/api/investigations/route';
import {GET as getRun} from '../../../app/api/investigations/[runId]/route';
import {GET as listProcedures,POST as propose} from '../../../app/api/procedures/route';
import {POST as testProcedure} from '../../../app/api/procedures/[id]/test/route';
import {POST as activate} from '../../../app/api/procedures/[id]/activate/route';
import {POST as disable} from '../../../app/api/procedures/[id]/disable/route';
const origin='http://localhost:3000';
const ctx=(id:string)=>({params:Promise.resolve({id})});
const request=(body:unknown,headers:Record<string,string>={})=>new Request(origin+'/api/test',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
test('all new HTTP endpoints return saved DTOs, enforce guards and expose private originals only to their owning claim',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sift-inv-api-')),env={...process.env},global=globalThis as typeof globalThis&{reimbursementCore?:CoreService},prior=global.reimbursementCore,f=fixture();
 Object.assign(process.env,{RECONCILIATION_INTAKE_DEMO_DIR:dir,RECONCILIATION_INTAKE_MODE:'demo',RECONCILIATION_SYNTHETIC_ONLY:'true',RECONCILIATION_APP_ORIGIN:origin});global.reimbursementCore=f.core;f.core.intelligence={...f.port,...backendEvaluator};
 const outputs:Record<string,unknown>={provenance:'OFFLINE MOCK PROVIDERS / synthetic backend fixtures, not a live demonstration'};
 const take=async(name:string,res:Response,status=200)=>{assert.equal(res.status,status,JSON.stringify(await res.clone().json()));const data=await res.json();outputs[name]=data;return data;};
 const network=t.mock.method(globalThis,'fetch',async()=>{throw new Error('No network in route tests');});
 try{
  for(const fn of [(r:Request)=>investigate(r,ctx(f.id)),(r:Request)=>propose(r),(r:Request)=>testProcedure(r,ctx(f.id)),(r:Request)=>activate(r,ctx(f.id)),(r:Request)=>disable(r,ctx(f.id))]){
   assert.equal((await fn(request({}, {origin:'https://foreign.invalid'}))).status,403);
   process.env.RECONCILIATION_SYNTHETIC_ONLY='false';assert.equal((await fn(request({}))).status,403);process.env.RECONCILIATION_SYNTHETIC_ONLY='true';
  }
  const body=new FormData();body.set('kind','other');body.set('expected_review_revision','0');body.set('file',new File(['%PDF-offline-api-test'],'test.pdf',{type:'application/pdf'}));
  const uploaded=await take('POST supporting-documents',await upload(new Request(origin+'/api/test',{method:'POST',headers:{origin},body}),ctx(f.id)),201);assert.equal(uploaded.document.extraction_status,'failed');
  await take('GET supporting-documents',await listDocs(new Request(origin),ctx(f.id)));
  const file=await original(new Request(origin),{params:Promise.resolve({id:f.id,documentId:uploaded.document.id})});assert.equal(file.status,200);assert.equal(file.headers.get('content-type'),'application/pdf');outputs['GET supporting original']={status:file.status,content_type:file.headers.get('content-type'),bytes:(await file.arrayBuffer()).byteLength};
  assert.equal((await original(new Request(origin),{params:Promise.resolve({id:crypto.randomUUID(),documentId:uploaded.document.id})})).status,404);
  await f.core.reconcile([f.id]);const investigated=await take('POST investigate',await investigate(request({expected_review_revision:workspaceRows(f.store.state)[0].review_revision}),ctx(f.id)));assert.equal(investigated.run.status,'completed');
  await take('GET investigations',await listRuns(new Request(origin+'/api/investigations?claim_id='+f.id)));
  await take('GET investigation',await getRun(new Request(origin),{params:Promise.resolve({runId:investigated.run.run_id})}));
  await approve(f.core,f.id);f.setResolved(false);
  const proposal=await take('POST procedures',await propose(request({run_id:investigated.run.run_id,expected_review_revision:workspaceRows(f.store.state)[0].review_revision})),201),id=proposal.procedure.id;
  await take('POST procedure test',await testProcedure(request({expected_procedure_version:1}),ctx(id)));
  await take('POST procedure activate',await activate(request({expected_procedure_version:1}),ctx(id)));
  await take('GET procedures',await listProcedures());
  await take('POST procedure disable',await disable(request({expected_procedure_version:2}),ctx(id)));
  assert.doesNotMatch(JSON.stringify(outputs),/storage_path|private-test-only|private_provider_payload|test_binding|source_fingerprint/);
  if(process.env.SIFT_RECORD_HANDOFF){await mkdir(path.dirname(process.env.SIFT_RECORD_HANDOFF),{recursive:true});await writeFile(process.env.SIFT_RECORD_HANDOFF,JSON.stringify(outputs,null,2)+'\n');}
  assert.equal(network.mock.callCount(),0);
 }finally{global.reimbursementCore=prior;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);await rm(dir,{recursive:true,force:true});}
});
