import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.CORE_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../../../supabase/', import.meta.url);
const scalar = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
async function database() {
 const db = new PGlite();
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 await db.exec((await readFile(new URL('migrations/202609190001_reimbursement_core.sql', root), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
 await db.exec(await readFile(new URL('seed.sql', root), 'utf8'));
 await db.exec(await readFile(new URL('migrations/202609200002_platform.sql', root), 'utf8'));
 await db.exec(await readFile(new URL('migrations/202609200003_investigations.sql', root), 'utf8'));
 await db.exec(await readFile(new URL('migrations/202609200004_communications.sql', root), 'utf8'));
 await db.exec(await readFile(new URL('migrations/202609210011_custom_checks.sql', root), 'utf8'));
 return db;
}
const criteria = { pass: 'Evidence satisfies it.', fail: 'Evidence violates it.', unknown: 'Evidence is missing.' };
const create = { action: 'create', label: 'Itemized receipt', instructions: 'Does the receipt include an itemized breakdown?', criteria, category: null };

test('SQL custom check lifecycle mirrors the memory store: versioning, revision bumps, history, staleness', async () => {
 const db = await database(); try {
  const created = await scalar(db, 'select core_custom_check($1)', [JSON.stringify(create)]);
  assert.match(created.check.field, /^custom_itemized_receipt/);
  assert.equal(created.check.state, 'active');
  assert.equal(created.check.version, 1);
  assert.equal(created.knowledge_revision, 1);
  const snapshot = await scalar(db, 'select core_snapshot()');
  assert.equal(snapshot.custom_checks.length, 1);
  assert.equal(snapshot.custom_check_history.length, 1);
  const evidence = await scalar(db, 'select core_evidence()');
  assert.equal(evidence.check_configuration.custom[0].field, created.check.field);
  assert.equal(evidence.check_configuration.custom[0].version, 1);
  await assert.rejects(db.query('select core_custom_check($1)', [JSON.stringify({ ...create, action: 'update', id: created.check.id, expected_check_version: 9 })]), /STALE_CHECK/);
  const updated = await scalar(db, 'select core_custom_check($1)', [JSON.stringify({ action: 'update', id: created.check.id, expected_check_version: 1, label: 'Itemized detail', instructions: 'Does the receipt itemize each charge?', criteria, category: 'hotel' })]);
  assert.equal(updated.check.version, 2);
  assert.equal(updated.check.category, 'hotel');
  assert.equal(updated.knowledge_revision, 2);
  const disabled = await scalar(db, 'select core_custom_check($1)', [JSON.stringify({ action: 'disable', id: created.check.id, expected_check_version: 2 })]);
  assert.equal(disabled.check.state, 'disabled');
  assert.equal((await scalar(db, 'select core_evidence()')).check_configuration.custom.length, 0);
  await assert.rejects(db.query('select core_custom_check($1)', [JSON.stringify({ action: 'disable', id: created.check.id, expected_check_version: 3 })]), /STALE_CHECK/);
  const enabled = await scalar(db, 'select core_custom_check($1)', [JSON.stringify({ action: 'enable', id: created.check.id, expected_check_version: 3 })]);
  assert.equal(enabled.check.state, 'active');
  assert.equal(enabled.knowledge_revision, 4);
  assert.equal((await scalar(db, 'select core_snapshot()')).custom_check_history.length, 4);
  // The configuration fingerprint is part of run evidence: a mid-run change stales the run.
  const submission = (await scalar(db, 'select core_snapshot()')).submissions[0];
  const run = await scalar(db, 'select core_begin_run($1)', [submission.id]);
  await scalar(db, 'select core_custom_check($1)', [JSON.stringify({ action: 'disable', id: created.check.id, expected_check_version: enabled.check.version })]);
  await assert.rejects(db.query('select core_finish_run($1,$2,$3)', [run, '[]', 'approved']), /STALE_RUN/);
  await scalar(db, 'select core_fail_run($1,$2)', [run, 'stale']);
  for (let i = 0; i < 11; i++) await scalar(db, 'select core_custom_check($1)', [JSON.stringify({ ...create, label: `Check number ${i}` })]);
  await assert.rejects(db.query('select core_custom_check($1)', [JSON.stringify({ ...create, label: 'One more' })]), /CHECK_LIMIT/);
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from custom_checks'), /permission denied/);
  await assert.rejects(db.query('select core_custom_check($1)', [JSON.stringify(create)]), /permission denied/);
 } finally { await db.close(); }
});
