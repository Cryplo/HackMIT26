import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { CoreService } from '../service';
import { MemoryStore, type Store } from '../store';
import { demoSnapshot, DEMO_IDS } from '../fixtures';
import { DatabaseRetrieval } from '../retrieval';
import { SimulatedJev } from '../jev';
import { workspaceDecide, workspaceRows } from '../workspace';
import { sendAutomaticApprovalNotice } from '../email-actions';
import { dispatchEmailOnce } from '../../email/dispatcher';
import { emailConfig } from '../../email/config';

process.env.RECONCILIATION_EMAIL_MODE='preview';
const make=(store:Store,automatic=false)=>new CoreService(store,new DatabaseRetrieval(),new SimulatedJev(),true,undefined,undefined,undefined,'disabled',automatic);
async function input(store:Store,id=DEMO_IDS[0],verdict:'approved'|'rejected'='approved'){
 return {submission_id:id,expected_review_revision:workspaceRows(await store.snapshot()).find(r=>r.id===id)!.review_revision,human_verdict:verdict,human_note:'PRIVATE REVIEWER NOTE',correction_type:'decision_override',correction_payload_json:{},request_id:randomUUID()};
}

test('automatic human notice is atomic, replayable, and isolates private notes',async()=>{
 const store=new MemoryStore(demoSnapshot()),core=make(store);
 await core.reconcile([DEMO_IDS[0]]);
 const request={...await input(store),applicant_reason:'The additional travel evidence establishes your eligibility.'};
 const saved=await workspaceDecide(core,request);
 assert.equal(saved.message?.status,'previewed');assert.equal(saved.row.decision_status,'approved');
 assert.match(saved.message!.body,/additional travel evidence/);assert.doesNotMatch(saved.message!.rendered_text!,/PRIVATE REVIEWER NOTE/);
 assert.equal(store.state.corrections.length,1);assert.equal(store.state.claim_messages!.length,1);
 const replay=await workspaceDecide(core,request);assert.equal(replay.correction_id,saved.correction_id);
 await assert.rejects(workspaceDecide(core,{...request,applicant_reason:'Changed public reason'}),{code:'MESSAGE_CONFLICT'});
 assert.equal(store.state.corrections.length,1);
 const bad={...await input(store),expected_review_revision:0};
 await assert.rejects(workspaceDecide(core,bad),{code:'STALE_REVIEW'});assert.equal(store.state.corrections.length,1);
 // Provider/status reads failing after confirmation cannot erase the successful decision.
 const second={...await input(store),human_verdict:'rejected' as const,applicant_reason:'Requested by the applicant.'};
 const messages=store.messages.bind(store);let confirmed=false;
 store.messages=async command=>{if(confirmed&&command.action==='get')throw new Error('Read unavailable');const result=await messages(command);if(command.action==='confirm')confirmed=true;return result;};
 const committed=await workspaceDecide(core,second);
 assert.ok(committed.correction_id);assert.equal(committed.row.decision_status,'rejected');assert.match(committed.email_error!,/saved/);
});

test('concurrent identical requests recover one atomic confirmation',async()=>{
 const store=new MemoryStore(demoSnapshot()),core=make(store);await core.reconcile([DEMO_IDS[0]]);
 const request=await input(store),results=await Promise.all([workspaceDecide(core,request),workspaceDecide(core,request)]);
 assert.equal(results[0].correction_id,results[1].correction_id);assert.equal(store.state.corrections.length,1);assert.equal(store.state.claim_messages!.length,1);
});

test('ambiguous confirmation is recovered by stable request without another correction',async()=>{
 const store=new MemoryStore(demoSnapshot()),core=make(store);await core.reconcile([DEMO_IDS[0]]);
 const request=await input(store),messages=store.messages.bind(store);let lost=false;
 store.messages=async command=>{const result=await messages(command);if(command.action==='confirm'&&!lost){lost=true;throw new Error('Response lost after commit');}return result;};
 await assert.rejects(workspaceDecide(core,request),/Response lost/);
 const recovered=await workspaceDecide(core,request);assert.ok(recovered.correction_id);assert.equal(store.state.corrections.length,1);assert.equal(store.state.claim_messages!.length,1);
});

test('notice publication failure is reported without failing a completed assessment',async()=>{
 const store=new MemoryStore(demoSnapshot()),core=make(store,true);
 store.messages=async()=>{throw new Error('Outbox unavailable');};
 const result=await core.reconcile([DEMO_IDS[0]]);
 assert.equal(result.results[0].status,'approved');assert.equal(result.results[0].error,undefined);
 assert.ok((result.results[0] as {email_error?:string}).email_error);assert.equal(store.state.runs[0].status,'completed');
});

test('uncertain rejection uses explicit public reason; legacy and disabled decisions remain supported',async()=>{
 const store=new MemoryStore(demoSnapshot()),core=make(store);
 const saved=await workspaceDecide(core,{...await input(store,DEMO_IDS[0],'rejected'),applicant_reason:'We could not verify the required travel documentation.'});
 assert.match(saved.message!.body,/could not verify/);assert.doesNotMatch(saved.message!.body,/PRIVATE/);
 const legacy=await workspaceDecide(core,await input(store,DEMO_IDS[2],'rejected'));
 assert.equal(legacy.row.decision_status,'rejected');assert.equal(legacy.message,undefined);
 process.env.RECONCILIATION_EMAIL_MODE='disabled';
 try{const disabled=await workspaceDecide(core,await input(store,DEMO_IDS[3],'rejected'));assert.equal(disabled.row.decision_status,'rejected');assert.equal(disabled.message,undefined);}
 finally{process.env.RECONCILIATION_EMAIL_MODE='preview';}
});

test('policy notices never create human feedback, dedupe rechecks, and refuse stale or unsafe sends',async()=>{
 const store=new MemoryStore(demoSnapshot()),core=make(store,true);
 await core.reconcile([DEMO_IDS[0]]);
 const notice=store.state.claim_messages![0];assert.ok(notice);assert.equal(notice.decision_source,'automatic');assert.equal(notice.correction_id,null);
 assert.equal(store.state.corrections.length,0);assert.equal(notice.status,'previewed');
 await core.reconcile([DEMO_IDS[0]]);assert.equal(store.state.claim_messages!.length,1);
 let sends=0;const provider={async send(){sends++;return {outcome:'accepted' as const,providerMessageId:'mock-provider'};}};
 assert.deepEqual(await dispatchEmailOnce(store,{config:emailConfig({}),provider}),{processed:false});assert.equal(sends,0);
 const config={...emailConfig({}),mode:'live' as const,allowedRecipients:[notice.recipient]};
 Object.assign(notice,{mode:'live',status:'queued',next_attempt_at:new Date().toISOString()});
 const sent=await dispatchEmailOnce(store,{config,provider});assert.equal(sent.status,'accepted');assert.equal(sends,1);
 Object.assign(notice,{status:'queued',next_attempt_at:new Date().toISOString()});store.state.knowledge_revision!++;
 assert.deepEqual(await dispatchEmailOnce(store,{config,provider}),{processed:false});assert.equal(notice.status,'cancelled');assert.equal(sends,1);
 const unsafe=new MemoryStore(demoSnapshot());unsafe.state.policies[0].max_amount_minor=1;await make(unsafe,true).reconcile([DEMO_IDS[0]]);assert.equal(unsafe.state.claim_messages?.length??0,0);
 const draft={...notice,id:randomUUID(),status:'draft' as const,mode:'preview' as const,correction_id:null,request_id:null};
 await assert.rejects(store.messages({action:'publish_automatic',message:draft,mode:'preview',from:config.from,reply_to:null}),{code:'STALE_MESSAGE'});
});

async function database(){
 const db=new PGlite();const root=new URL('../../../../supabase/',import.meta.url);
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 for(const file of ['migrations/202609190001_reimbursement_core.sql','seed.sql','migrations/202609200002_platform.sql','migrations/202609200003_investigations.sql','migrations/202609200004_communications.sql','migrations/202609200005_demo_reset.sql','migrations/202609200006_automatic_notices.sql'])await db.exec((await readFile(new URL(file,root),'utf8')).replace('create extension if not exists pgcrypto;',''));
 const scalar=async(sql:string,params:unknown[]=[])=>Object.values((await db.query(sql,params)).rows[0] as Record<string,unknown>)[0];
 const store={snapshot:()=>scalar('select core_snapshot()'),messages:(cmd:unknown)=>scalar('select core_messages($1)',[JSON.stringify(cmd)]),begin:(id:string)=>scalar('select core_begin_run($1)',[id]),finish:(id:string,ds:unknown,status:string)=>scalar('select core_finish_run($1,$2,$3)',[id,JSON.stringify(ds),status]),fail:(id:string,error:string)=>scalar('select core_fail_run($1,$2)',[id,error]),correct:(value:unknown)=>scalar('select core_correct($1)',[JSON.stringify(value)]),usage:async()=>{}} as unknown as Store;
 return {db,store,scalar};
}

test('006 SQL publishes human and policy notices atomically, dedupes and blocks stale policy leases',async()=>{
 const {db,store,scalar}=await database();try{
 const core=make(store,true),id=DEMO_IDS[0];await core.reconcile([id]);await sendAutomaticApprovalNotice(core,id);
 let notices=(await store.messages({action:'list',claim_id:id})).messages!;
 assert.equal(notices.length,1);assert.equal(notices[0].decision_source,'automatic');assert.equal((await store.snapshot()).corrections.length,0);
 await core.reconcile([id]);await sendAutomaticApprovalNotice(core,id);
 assert.equal((await store.messages({action:'list',claim_id:id})).messages!.length,1);
 notices=(await store.messages({action:'list',claim_id:id})).messages!;
 await db.query("update claim_messages set doc=doc||jsonb_build_object('mode','live','status','queued','next_attempt_at',now()) where id=$1",[notices[0].id]);
 const leased=await store.messages({action:'lease'});assert.equal(leased.message?.id,notices[0].id);
 await store.messages({action:'settle',message_id:leased.message!.id,lease_token:leased.message!.lease_token!,outcome:'failed',error:'Mock failure'});
 await db.query("update claim_messages set doc=doc||jsonb_build_object('status','queued','next_attempt_at',now()) where id=$1",[notices[0].id]);
 await db.exec('update policy_rules set max_amount_minor=1');
 assert.equal((await store.messages({action:'lease'})).message,null);assert.equal((await store.messages({action:'get',message_id:notices[0].id})).message!.status,'cancelled');
 await assert.rejects(store.messages({action:'publish_automatic',message:{...notices[0],id:randomUUID(),status:'draft'},mode:'preview',from:'onboarding@resend.dev',reply_to:null}),/STALE_MESSAGE/);
 const request={...await input(store,id,'rejected'),applicant_reason:'The applicant withdrew this request.'};
 const saved=await workspaceDecide(core,request);assert.equal(saved.message?.status,'previewed');
 assert.equal((await workspaceDecide(core,request)).correction_id,saved.correction_id);assert.equal((await store.snapshot()).corrections.length,1);
 assert.equal(await scalar('select core_platform_version()'),4);
 await db.exec('set role anon');await assert.rejects(db.query("select core_messages('{}')"),/permission denied/);
 }finally{await db.close();}
});
