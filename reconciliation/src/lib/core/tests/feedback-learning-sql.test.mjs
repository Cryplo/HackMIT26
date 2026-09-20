import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
const require = createRequire(import.meta.url);
const { showcaseFixture } = require('../../demo/showcase.ts');
const { CoreService } = require('../service.ts');
const { DatabaseRetrieval } = require('../retrieval.ts');
const { SimulatedJev } = require('../jev.ts');
const { intelligence } = require('../../intelligence/index.ts');
const { workspaceRows } = require('../projection.ts');
const { processFeedbackLearning } = require('../feedback-learning.ts');
const { changeProcedure } = require('../procedures.ts');
const root = new URL('../../../../supabase/migrations/', import.meta.url);
const note = 'The booking confirmation identifies Harbor Hotel and matches this receipt booking reference, amount and guest.';

test('SQL queue/lease/procedure proof and activation are atomic, scoped, private, restart-safe and safeupdate compatible', async () => {
  const db = new PGlite();
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
  const rpc = (name, ...params) => scalar(`select ${name}(${params.map((_, i) => `$${i + 1}`).join(',')})`, params.map(p => p !== null && typeof p === 'object' ? JSON.stringify(p) : p));
  try {
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
    for (const filename of (await readdir(root)).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec((await readFile(new URL(filename, root), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
    }
    assert.equal(await scalar('select core_platform_version()'), 4);
    for (const name of ['core_procedure', 'core_invalidate_procedures', 'core_procedure_source_changed', 'core_correct_v3']) {
      const definition = await scalar('select prosrc from pg_proc where proname=$1', [name]);
      for (const statement of definition.match(/update platform_state[^;]+;/g) ?? []) assert.match(statement, /where id\s*=\s*true/, `${name} must work with safeupdate`);
    }
    const fixture = showcaseFixture().state;
    for (const [table, rows] of [['policy_rules', fixture.policies], ['submissions', fixture.submissions], ['receipts', fixture.receipts], ['supporting_documents', fixture.supporting_documents]]) {
      await db.query(`insert into ${table} select * from jsonb_populate_recordset(null::${table},$1)`, [JSON.stringify(rows)]);
    }
    const store = {
      feedbackLearning: command => rpc('core_feedback_learning', command),
      messages: command => rpc('core_messages', command), supporting: command => rpc('core_supporting', command), investigation: command => rpc('core_investigation', command), procedure: command => rpc('core_procedure', command),
      snapshot: () => rpc('core_snapshot'), begin: id => rpc('core_begin_run', id), finish: (id, ds, status) => rpc('core_finish_run', id, ds, status), fail: (id, error) => rpc('core_fail_run', id, error),
      correct: input => rpc('core_correct', input), usage: async () => { throw new Error('No live calls allowed'); },
      rule: command => rpc('core_rule', command), beginExtraction: (id, rev) => rpc('core_begin_extraction', id, rev), finishExtraction: (id, receipt) => rpc('core_finish_extraction', id, receipt), receiptHash: (id, hash) => rpc('core_receipt_hash', id, hash),
    };
    const core = new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), true, undefined, undefined, intelligence);
    const sourceId = fixture.submissions[2].id, laterId = fixture.submissions[3].id;
    await core.reconcile([sourceId]);
    const correction = await store.correct({ submission_id: sourceId, expected_review_revision: workspaceRows(await store.snapshot()).find(r => r.id === sourceId).review_revision, human_verdict: 'approved', human_note: note, correction_type: 'decision_override', correction_payload_json: {} });
    const job = (await store.snapshot()).corrections.find(c => c.id === correction.correction_id).correction_payload_json.feedback_learning;
    assert.equal(job.status, 'queued', 'SQL correction wrapper queues before commit');
    await processFeedbackLearning(core, correction.correction_id);
    let state = await store.snapshot(), procedure = state.procedures[0];
    assert.equal(procedure.state, 'active');
    assert.equal(procedure.latest_test.passed, true);
    assert.equal(workspaceRows(state).find(r => r.id === sourceId).learning.status, 'active');
    assert.equal(state.investigations.length, 0);
    assert.equal(workspaceRows(state).find(r => r.id === laterId).decisions.find(d => d.field_checked === 'merchant').evidence_json.exact_method, 'booking_reference_identity');
    const historyCount = await scalar('select count(*)::int from procedure_history');
    await processFeedbackLearning(core, correction.correction_id);
    assert.equal(await scalar('select count(*)::int from procedure_history'), historyCount);
    await core.reconcile([sourceId]);
    await store.feedbackLearning({ action: 'expire' });
    assert.equal(workspaceRows(await store.snapshot()).find(r => r.id === sourceId).learning.status, 'active', 'A source recheck alone preserves active feedback');
    await changeProcedure(core, procedure.id, 'disable', { expected_procedure_version: 2 }, new AbortController().signal);
    await store.feedbackLearning({ action: 'expire' });
    assert.equal(workspaceRows(await store.snapshot()).find(r => r.id === sourceId).learning.status, 'failed');
    // Both decision APIs share the same wrapped correction function.
    await core.reconcile([laterId]);
    const second = await rpc('core_correct_message', { submission_id: laterId, expected_review_revision: workspaceRows(await store.snapshot()).find(r => r.id === laterId).review_revision, human_verdict: 'approved', human_note: note, correction_type: 'decision_override', correction_payload_json: {} }, null);
    const start = await store.feedbackLearning({ action: 'start', correction_id: second.correction_id });
    assert.equal(start.acquired, true);
    assert.equal((await store.feedbackLearning({ action: 'start', correction_id: second.correction_id })).acquired, false);
    await store.feedbackLearning({ action: 'propose', correction_id: second.correction_id, lease: start.job.lease, mode: 'simulated' });
    state = await store.snapshot();procedure = state.procedures.find(p => p.source_correction_id === second.correction_id);
    await assert.rejects(changeProcedure(core, procedure.id, 'activate', { expected_procedure_version: 1 }, new AbortController().signal), /STALE_RULE_TEST/);
    await db.query("update corrections set correction_payload_json=jsonb_set(correction_payload_json,'{feedback_learning,lease_expires_at}',to_jsonb((now()-interval '1 minute')::text))where id=$1", [second.correction_id]);
    await assert.rejects(changeProcedure(core, procedure.id, 'test', { expected_procedure_version: 1 }, new AbortController().signal), /STALE_FEEDBACK/);
    await store.feedbackLearning({ action: 'expire' });
    await store.feedbackLearning({ action: 'retry', correction_id: second.correction_id, expected_review_revision: workspaceRows(await store.snapshot()).find(r => r.id === laterId).review_revision });
    await assert.rejects(store.feedbackLearning({ action: 'propose', correction_id: second.correction_id, lease: start.job.lease, mode: 'simulated' }), /STALE_FEEDBACK/);
    await db.exec('set role anon');
    await assert.rejects(db.query("select core_feedback_learning('{\"action\":\"expire\"}')"), /permission denied/);
  } finally { await db.close(); }
});
