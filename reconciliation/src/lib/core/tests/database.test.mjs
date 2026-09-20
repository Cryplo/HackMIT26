import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { CoreService } = require('../service.ts');
const { DatabaseRetrieval } = require('../retrieval.ts');
const { SimulatedJev } = require('../jev.ts');
const { intelligence } = require('../../intelligence/index.ts');
const { workspaceDecide,workspaceRows } = require('../workspace.ts');
const { proposeRule,changeRule } = require('../rules.ts');
const { PGlite } = await import(process.env.CORE_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../../../supabase/', import.meta.url);
const ids=Array.from({length:5},(_,i)=>`10000000-0000-4000-8000-00000000000${i+1}`);
const scalar=async(db,sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
async function database(){
 const db=new PGlite();
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 await db.exec((await readFile(new URL('migrations/202609190001_reimbursement_core.sql',root),'utf8')).replace('create extension if not exists pgcrypto;',''));
 await db.exec(await readFile(new URL('seed.sql',root),'utf8'));
 await db.exec(await readFile(new URL('migrations/202609200002_platform.sql',root),'utf8'));
 await db.exec(await readFile(new URL('migrations/202609200003_investigations.sql',root),'utf8'));
 const json=v=>JSON.stringify(v);
 const store={supporting:cmd=>scalar(db,'select core_supporting($1)',[json(cmd)]),investigation:cmd=>scalar(db,'select core_investigation($1)',[json(cmd)]),procedure:cmd=>scalar(db,'select core_procedure($1)',[json(cmd)]),snapshot:()=>scalar(db,'select core_snapshot()'),begin:id=>scalar(db,'select core_begin_run($1)',[id]),finish:(id,ds,status)=>scalar(db,'select core_finish_run($1,$2,$3)',[id,json(ds),status]),fail:(id,error)=>scalar(db,'select core_fail_run($1,$2)',[id,error]),correct:input=>scalar(db,'select core_correct($1)',[json(input)]),rule:cmd=>scalar(db,'select core_rule($1)',[json(cmd)]),usage:async()=>{throw new Error('No paid calls in SQL tests');},beginExtraction:(id,rev)=>scalar(db,'select core_begin_extraction($1,$2)',[id,rev]),finishExtraction:(id,r)=>scalar(db,'select core_finish_extraction($1,$2)',[id,json(r)]),receiptHash:(id,hash)=>scalar(db,'select core_receipt_hash($1,$2)',[id,hash])};
 return {db,store,core:new CoreService(store,new DatabaseRetrieval(),new SimulatedJev(),true,undefined,undefined,intelligence)};
}
async function input(store,id,verdict='approved'){
 const row=workspaceRows(await store.snapshot()).find(r=>r.id===id);
 return {submission_id:id,expected_review_revision:row.review_revision,human_verdict:verdict,human_note:'Reviewed synthetic original.',correction_type:'decision_override',correction_payload_json:{}};
}
const signal=()=>new AbortController().signal;
test('SQL migration preserves claims and history; both decision paths block cap, duplicates, missing revision, active/stale writes',async()=>{
 const {db,store,core}=await database();try{
 assert.equal((await store.snapshot()).submissions.length,5);assert.equal(await scalar(db,"select public from storage.buckets where id='receipts'"),false);
 await db.exec(`update submissions set amount_requested_minor=90000 where id='${ids[0]}';update receipts set parsed_fields_json=jsonb_set(parsed_fields_json,'{amount_minor}','90000') where submission_id='${ids[0]}';`);
 await core.reconcile([ids[0]]);const cap=await input(store,ids[0]);await assert.rejects(store.correct(cap),/APPROVAL_BLOCKED/);await assert.rejects(workspaceDecide(core,cap),/APPROVAL_BLOCKED/);
 await assert.rejects(store.correct({...cap,expected_review_revision:undefined}),/INVALID_INPUT/);await assert.rejects(store.correct({...cap,correction_type:'vendor_alias'}),/LEGACY_ALIAS_DISABLED/);
 await core.reconcile([ids[2]]);const valid=await input(store,ids[2]),run=await store.begin(ids[2]);await assert.rejects(store.correct(valid),/RUN_ACTIVE/);await assert.rejects(store.begin(ids[2]),/RUN_ACTIVE/);await store.fail(run,'Test cancellation.');
 const results=await Promise.allSettled([store.correct(valid),store.correct({...valid,human_verdict:'rejected'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await store.snapshot()).corrections.length,1);
 await core.reconcile([ids[2]]);assert.equal(workspaceRows(await store.snapshot())[2].decision_status,'approved');assert.equal((await store.snapshot()).submissions[2].status,'approved');
 const stale=await store.begin(ids[3]);await db.exec('update policy_rules set max_amount_minor=max_amount_minor+1');await assert.rejects(store.finish(stale,[],'approved'),/STALE_RUN/);await store.fail(stale,'Stale policy.');
 await db.exec('set role anon');await assert.rejects(db.query('select * from submissions'),/permission denied/);await assert.rejects(db.query('select core_snapshot()'),/permission denied/);await assert.rejects(db.query("select core_rule('{}')"),/permission denied/);
 }finally{await db.close();}
});
test('SQL exact bytes serialize DIFFERENT claim approvals and invalid publication rolls back completely',async()=>{
 const {db,store,core}=await database();try{
 await db.exec(`update receipts set sha256=repeat('a',64) where submission_id in ('${ids[0]}','${ids[2]}');`);
 await core.reconcile([ids[0],ids[2]]);
 // Deliberately stale machine duplicate pass cannot defeat commit-time receipt identity.
 await db.exec("update decisions set verdict='pass' where field_checked='duplicate'");
 const results=await Promise.allSettled([store.correct(await input(store,ids[0])),store.correct(await input(store,ids[2]))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(workspaceRows(await store.snapshot())[2].duplicate_submission_ids[0],ids[0]);
 const run=await store.begin(ids[3]),before=await store.snapshot();await assert.rejects(store.finish(run,[],'approved'),/INVALID_DECISIONS/);assert.equal((await store.snapshot()).decisions.length,before.decisions.length);
 await store.receiptHash(before.receipts.find(r=>r.submission_id===ids[3]).id,'b'.repeat(64));await assert.rejects(store.finish(run,[],'approved'),/STALE_RUN/);
 }finally{await db.close();}
});
test('SQL rule lifecycle, audit history, failed retest and source withdrawal; retry preserves bytes identity and extraction history',async()=>{
 const {db,store,core}=await database();try{
 await core.reconcile([ids[2]]);await store.correct(await input(store,ids[2]));let row=workspaceRows(await store.snapshot())[2];
 const rule=(await proposeRule(core,{submission_id:ids[2],expected_review_revision:row.review_revision,canonical_vendor:'Synthetic Harbor Hotel'})).rule;
 await changeRule(core,rule.id,'test',{expected_rule_version:1},signal());assert.equal(await scalar(db,'select count(*)::int from rule_tests'),1);
 await changeRule(core,rule.id,'activate',{expected_rule_version:1},signal());assert.equal((await store.snapshot()).knowledge_revision,1);
 await core.reconcile([ids[3]]);assert.equal(workspaceRows(await store.snapshot())[3].assessment_status,'matched');
 await store.correct(await input(store,ids[2],'rejected'));assert.equal((await store.snapshot()).knowledge_revision,2);assert.equal((await store.snapshot()).rules[0].state,'disabled');assert.equal((await store.snapshot()).rules[0].latest_test,null);assert.ok(await scalar(db,'select count(*)::int from rule_history')>=4);
 row=workspaceRows(await store.snapshot())[0];const lease=await store.beginExtraction(row.id,row.review_revision),receipt=(await store.snapshot()).receipts.find(r=>r.submission_id===row.id);
 await assert.rejects(store.correct(await input(store,row.id,'rejected')),/RUN_ACTIVE/);
 await store.finishExtraction(lease,{...receipt,sha256:'c'.repeat(64),extraction_status:'failed',extraction_error:'Offline fixture failure.',parsed_fields_json:null,raw_extracted_text:null,extracted_at:new Date().toISOString()});
 row=workspaceRows(await store.snapshot())[0];assert.equal(row.receipt.extraction_status,'failed');assert.equal(row.assessment_status,null);assert.equal(row.decision_status,'pending');assert.ok(await scalar(db,'select count(*)::int from extraction_history')>=1);
 await assert.rejects(store.beginExtraction(ids[2],workspaceRows(await store.snapshot())[2].review_revision),/RETRY_BLOCKED/);
 }finally{await db.close();}
});
test('SQL initial extraction cannot overwrite retry and replacement of active source invalidates knowledge',async()=>{
 const {db,store,core}=await database();try{
 await core.reconcile([ids[2]]);await store.correct(await input(store,ids[2]));const row=workspaceRows(await store.snapshot())[2];
 const rule=(await proposeRule(core,{submission_id:ids[2],expected_review_revision:row.review_revision,canonical_vendor:'Synthetic Harbor Hotel'})).rule;
 await changeRule(core,rule.id,'test',{expected_rule_version:1},signal());await changeRule(core,rule.id,'activate',{expected_rule_version:1},signal());
 await db.exec(`update receipts set parsed_fields_json=jsonb_set(parsed_fields_json,'{vendor}','"Changed vendor"') where submission_id='${ids[2]}';`);
 let state=await store.snapshot();assert.equal(state.rules[0].state,'disabled');assert.equal(state.rules[0].latest_test,null);assert.equal(state.knowledge_revision,2);
 await db.exec(`update receipts set extraction_status='pending' where submission_id='${ids[0]}';update submissions set submitted_at=now() where id='${ids[0]}';`);
 state=await store.snapshot();let claim=state.submissions.find(s=>s.id===ids[0]);await assert.rejects(store.beginExtraction(ids[0],claim.review_revision),/RUN_ACTIVE/);
 await db.exec(`update submissions set submitted_at=now()-interval '10 minutes' where id='${ids[0]}';`);
 const lease=await store.beginExtraction(ids[0],claim.review_revision);const original=(await store.snapshot()).receipts.find(r=>r.submission_id===ids[0]);
 const initial={...original,extraction_status:'succeeded',extracted_at:new Date().toISOString()};
 await assert.rejects(scalar(db,'select core_finish_initial_extraction($1)',[JSON.stringify(initial)]),/STALE_REVIEW/);
 await store.finishExtraction(lease,{...original,extraction_status:'failed',extraction_error:'Retry failure.',extracted_at:new Date().toISOString()});
 await assert.rejects(scalar(db,'select core_finish_initial_extraction($1)',[JSON.stringify(initial)]),/STALE_REVIEW/);
 assert.equal((await store.snapshot()).receipts.find(r=>r.submission_id===ids[0]).extraction_status,'failed');
 }finally{await db.close();}
});
test('SQL readiness marker is service-only and atomic read projections retain stored audit evidence',async()=>{
 const {db,store,core}=await database();try{
 assert.equal(await scalar(db,'select core_platform_version()'),3);
 await core.reconcile([ids[0]]);
 await db.exec("update decisions set evidence_json=evidence_json||'{\"provider_response\":{\"private_diagnostic\":\"audit-sentinel\"}}'::jsonb where check_method='jev'");
 const stored=await scalar(db,"select jsonb_build_object('runs',(select jsonb_agg(evidence_snapshot) from reconciliation_runs),'decisions',(select jsonb_agg(jsonb_build_object('state',state_snapshot_json,'evidence',evidence_json)) from decisions))");
 const snapshot=await store.snapshot();
 assert.ok(snapshot.runs.length>0);assert.ok(snapshot.decisions.length>0);
 assert.ok(snapshot.runs.every(r=>!('evidence_snapshot' in r)));
 assert.ok(snapshot.decisions.every(d=>Object.keys(d.state_snapshot_json).length===0&&!('provider_response' in d.evidence_json)));
 assert.ok(snapshot.decisions.some(d=>d.evidence_json.provider_answer));
 assert.equal(JSON.stringify(stored).includes('audit-sentinel'),true);
 assert.deepEqual(await scalar(db,"select jsonb_build_object('runs',(select jsonb_agg(evidence_snapshot) from reconciliation_runs),'decisions',(select jsonb_agg(jsonb_build_object('state',state_snapshot_json,'evidence',evidence_json)) from decisions))"),stored);
 await db.exec("update reconciliation_runs set started_at=now()-interval '10 minutes'");
 const lease=await store.begin(ids[0]);await db.query("update reconciliation_runs set started_at=now()-interval '6 minutes' where id=$1",[lease]);
 assert.equal(workspaceRows(await store.snapshot())[0].processing_status,'failed');
 const next=await store.begin(ids[0]);assert.notEqual(next,lease);assert.equal((await store.snapshot()).runs.find(r=>r.id===lease).status,'failed');
 await db.exec('set role anon');await assert.rejects(db.query('select core_platform_version()'),/permission denied/);
 }finally{await db.close();}
});

test('SQL v3 persists private supporting evidence, awaited tool progress, reviewed procedure lifecycle and source invalidation',async()=>{
 const {db,store,core}=await database();try{
 const {fixture}=require('./investigation-fixtures.ts');const {backendEvaluator}=require('./procedure-fixtures.ts');
 const {investigateClaim}=require('../investigations.ts');const {uploadSupporting}=require('../../intake/supporting-documents.ts');const {proposeProcedure,changeProcedure}=require('../procedures.ts');
 const f=fixture();core.investigationMode='simulated';
 await db.query("update receipts set raw_extracted_text=$1 where submission_id=$2",['Merchant: SYN HBR 042\nBooking reference: TRIP-01\nGuest: Sam Example',ids[2]]);
 let rev=(await store.snapshot()).submissions.find(s=>s.id===ids[2]).review_revision;
 let extracted=0;const original={put:async()=>{},read:async()=>null};
 const upload={revision:rev,kind:'booking_confirmation',fileType:'application/pdf',bytes:new Uint8Array(Buffer.from('%PDF-SQL-fixture'))};
 const doc=await uploadSupporting(core,ids[2],upload,original,async()=>{extracted++;return {fields:null,raw:'Synthetic Harbor Hotel\nBooking reference: TRIP-01\nGuest: Sam Example',supporting_facts:{vendor:'Synthetic Harbor Hotel',booking_reference:'TRIP-01',receipt_number:null,names:['Sam Example'],purchase_date:'2026-09-18',currency:'USD',amount_minor:18000},usage:null,error:null};},signal());
 assert.equal(doc.document.extraction_status,'succeeded');assert.equal(doc.row.assessment_status,null);
 await assert.rejects(uploadSupporting(core,ids[2],{...upload,revision:doc.row.review_revision},original,async()=>{extracted++;throw new Error('must not extract');},signal()),/DOCUMENT_EXISTS/);assert.equal(extracted,1);
 await core.reconcile([ids[2]]);
 core.intelligence={...f.port,...backendEvaluator,async investigate(input,tools,options){
 const receipt=await tools.read_receipt();const docs=await tools.read_supporting_documents();
 assert.equal(await scalar(db,'select count(*)::int from investigation_steps'),2);
 const state=await store.snapshot();const {deriveCandidate}=require('../evidence.ts');
 return {status:'completed',mode:options.mode,model:'offline-sql-mock',summary:'Read linked booking evidence.',next_action:'human_review',evidence_refs:[],steps:[],error_code:null,findings:[{id:'mock',check:'merchant',statement:'Same stored booking reference.',evidence_refs:[{kind:'receipt',id:receipt.id},{kind:'supporting_document',id:docs[0].id}]}],proposed_learning:deriveCandidate(state,input.submission.id)};
 }};
 const result=await investigateClaim(core,ids[2],{expected_review_revision:workspaceRows(await store.snapshot())[2].review_revision},signal());assert.equal(result.run.status,'completed');assert.equal(result.row.decision_status,'pending');assert.equal(result.run.steps.length,2);
 await store.correct(await input(store,ids[2]));const source=workspaceRows(await store.snapshot())[2];
 const procedure=(await proposeProcedure(core,{run_id:result.run.run_id,expected_review_revision:source.review_revision})).procedure;
 await assert.rejects(changeProcedure(core,procedure.id,'activate',{expected_procedure_version:1},signal()),/STALE_RULE_TEST/);
 await changeProcedure(core,procedure.id,'test',{expected_procedure_version:1},signal());
 await changeProcedure(core,procedure.id,'activate',{expected_procedure_version:1},signal());assert.equal((await store.snapshot()).procedures[0].state,'active');
 await store.correct(await input(store,ids[2],'rejected'));assert.equal((await store.snapshot()).procedures[0].state,'disabled');assert.equal((await store.snapshot()).procedures[0].latest_test,null);
 assert.equal(await scalar(db,'select count(*)::int from procedure_tests'),1);
 await db.exec('set role anon');for(const table of ['supporting_documents','investigation_steps','resolution_procedures','procedure_tests'])await assert.rejects(db.query('select * from '+table),/permission denied/);await assert.rejects(db.query("select core_investigation('{}')"),/permission denied/);
 }finally{await db.close();}
});
test('SQL investigation publication is atomic on knowledge changes and preserves the previous assessment on failure',async()=>{
 const {db,store,core}=await database();try{
 await core.reconcile([ids[2]]);const row=workspaceRows(await store.snapshot())[2];
 const inv=await store.investigation({action:'start',claim_id:row.id,expected_review_revision:row.review_revision,trigger:'manual',mode:'simulated'});
 await assert.rejects(store.begin(row.id),/RUN_ACTIVE/);await assert.rejects(store.correct(await input(store,row.id,'rejected')),/RUN_ACTIVE/);
 await db.exec('update policy_rules set max_amount_minor=max_amount_minor+1');
 await assert.rejects(store.investigation({action:'finish',run_id:inv.run_id,result:inv,decisions:[]}),/STALE_RUN/);
 await store.investigation({action:'fail',run_id:inv.run_id,error:'STALE_RUN',superseded:true});
 const state=await store.snapshot();assert.equal(state.investigations[0].status,'superseded');assert.equal(state.investigations[0].after_assessment,null);assert.equal(state.decisions.filter(d=>d.run_id===inv.run_id).length,0);assert.equal(workspaceRows(state)[2].assessment_status,row.assessment_status);
 }finally{await db.close();}
});
