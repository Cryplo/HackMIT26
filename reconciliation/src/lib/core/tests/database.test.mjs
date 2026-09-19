import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// Optional isolated harness avoids edits to Module 1's manifest.
const { PGlite } = await import(process.env.CORE_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../../../supabase/', import.meta.url);
const id = '10000000-0000-4000-8000-000000000003';
async function database() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
  // PGlite provides gen_random_uuid built-in but not the pgcrypto extension. All other SQL is exact.
  await db.exec((await readFile(new URL('migrations/202609190001_reimbursement_core.sql',root),'utf8')).replace('create extension if not exists pgcrypto;',''));
  await db.exec(await readFile(new URL('seed.sql',root),'utf8'));
  return db;
}
const correction = () => ({submission_id:id,human_verdict:'approved',human_note:'Synthetic alias verified.',correction_type:'vendor_alias',correction_payload_json:{observed_vendor:'SYN HBR 042',canonical_vendor:'Synthetic Harbor Hotel',scope:{category:'hotel',currency:'USD'}}});
const call = async(db,sql,params=[]) => (await db.query(sql,params)).rows[0];
const scalar = async(db,sql,params=[]) => Object.values(await call(db,sql,params))[0];
test('SQL migration/seed, active uniqueness, correction wins and rejects stale publication',async()=>{
 const db=await database();
 try {
  const state=await scalar(db,'select core_snapshot()'); assert.equal(state.submissions.length,5); assert.equal(state.receipts.length,5);
  const run=await scalar(db,'select core_begin_run($1)',[id]);
  await assert.rejects(scalar(db,'select core_begin_run($1)',[id]),/RUN_ACTIVE/);
  const result=await scalar(db,'select core_correct($1)',[JSON.stringify(correction())]); assert.equal(result.status,'approved');
  await assert.rejects(scalar(db,"select core_finish_run($1,'[]','flagged')",[run]),/STALE_RUN/);
  await scalar(db,"select core_fail_run($1,'stale failure')",[run]);
  const after=await scalar(db,'select core_snapshot()'); const s=after.submissions.find(s=>s.id===id);
  assert.equal(s.status,'approved'); assert.equal(after.corrections.length,1); assert.equal(after.decisions.length,1);
  assert.equal(after.runs.find(r=>r.id===run).status,'failed'); assert.equal(after.decisions[0].check_method,'human');
  assert.equal(await scalar(db,"select public from storage.buckets where id='receipts'"),false);
  await db.exec('set role anon'); await assert.rejects(db.query('select * from submissions'),/permission denied/); await assert.rejects(db.query('select core_snapshot()'),/permission denied/);
 } finally {await db.close();}
});
test('SQL finish atomically publishes a valid complete batch; invalid batch rolls back',async()=>{
 const db=await database();
 try {
  const run=await scalar(db,'select core_begin_run($1)',[id]);
  const d={id:crypto.randomUUID(),run_id:run,submission_id:id,field_checked:'overall_status',check_method:'deterministic',question_type:'rule',answer_json:{value:'needs_review'},probability:null,confidence_score:null,verdict:'unknown',rationale_text:'Ambiguous merchant.',evidence_json:{},state_snapshot_json:{},model_used:null,created_at:new Date().toISOString()};
  await assert.rejects(scalar(db,"select core_finish_run($1,$2,'approved')",[run,JSON.stringify([d])]),/INVALID_DECISIONS/);
  const pending=await scalar(db,'select core_snapshot()'); assert.equal(pending.decisions.length,0); assert.equal(pending.submissions.find(s=>s.id===id).latest_run_id,null);
  await scalar(db,"select core_finish_run($1,$2,'needs_review')",[run,JSON.stringify([d])]);
  const state=await scalar(db,'select core_snapshot()'); assert.equal(state.submissions.find(s=>s.id===id).latest_run_id,run); assert.equal(state.decisions.length,1);
  const bad={...correction(),decision_id:d.id,correction_payload_json:{...correction().correction_payload_json,scope:{category:'flight',currency:'USD'}}};
  await assert.rejects(scalar(db,'select core_correct($1)',[JSON.stringify(bad)]),/INVALID_SCOPE/);
  assert.equal((await scalar(db,'select core_snapshot()')).corrections.length,0);
  await scalar(db,'select core_correct($1)',[JSON.stringify({...correction(),decision_id:d.id})]);
  const corrected=await scalar(db,'select core_snapshot()'); assert.equal(corrected.decisions.length,2); assert.equal(corrected.decisions[0].id,d.id);
 } finally {await db.close();}
});
