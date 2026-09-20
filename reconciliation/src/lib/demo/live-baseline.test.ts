import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { liveBaseline, LIVE_UNCHECKED_NUMBERS } from './live-baseline';
import { showcaseFixture } from './showcase';
import { workspaceRows } from '../core/projection';
import { automaticApproval, shouldInvestigateAutomatically } from '../core/automation';
import { decision, overall } from '../core/checks';
import { MemoryStore, type Snapshot } from '../core/store';
import { CoreService } from '../core/service';
import { DatabaseRetrieval } from '../core/retrieval';
import { SimulatedJev } from '../core/jev';
import { isAuditEligible } from '../dashboard/audit-session';

function seed(state: Snapshot) {
  const { submissions, receipts, policies, supporting_documents, runs, decisions, corrections } = state;
  return { submissions, receipts, policies, supporting_documents, runs, decisions, corrections };
}
function assertBaseline(state: Snapshot) {
  const rows = workspaceRows(state);
  assert.equal(rows.filter(isAuditEligible).length, 10);
  assert.equal(rows.filter(r => r.latest_run_id).length, 70);
  assert.equal(rows.filter(r => r.decision_status === 'approved').length, 59);
  assert.equal(rows.filter(r => r.decision_status === 'rejected').length, 7);
  assert.equal(rows.filter(r => r.assessment_status === 'needs_review').length, 4);
  assert.equal(state.runs.length, 70);
  assert.equal(state.decisions.length, 637);
  assert.deepEqual(state.corrections.map(c => Number(c.submission_id.slice(-12))).sort((a, b) => a - b), [15, 30, 35, 37, 44, 59, 68]);
  assert.deepEqual(rows.filter(isAuditEligible).map(r => Number(r.id.slice(-12))).sort((a, b) => a - b), [1, 2, 5, 6, 7, 9, 10, 12, 13, 14]);
  assert.ok(state.runs.every(r => r.status === 'completed' && (!r.evidence_snapshot || r.evidence_snapshot.demo_baseline === true)));
  assert.ok(state.decisions.every(d => d.evidence_json.demo_baseline === true && d.evidence_json.simulated === true));
  assert.ok(state.corrections.every(c => c.human_note.startsWith('Prepared demo decision:') && !c.correction_payload_json.feedback_learning));
  assert.deepEqual(state.investigations ?? [], []);
  assert.deepEqual(state.claim_messages ?? [], []);
}

test('prepared live history leaves ten varied claims and two automatic-investigation candidates', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Provider/database calls forbidden in the baseline builder.'); });
  const fixture = await liveBaseline({ submissions: [], knowledge_revision: 0 });
  assertBaseline(fixture.state);
  const originals = showcaseFixture(80);
  assert.deepEqual(fixture.originals.map(o => o.bytes), originals.originals.map(o => o.bytes));
  assert.deepEqual(fixture.supporting.map(o => o.bytes), originals.supporting.map(o => o.bytes));
  const state = fixture.state, store = new MemoryStore(state);
  const core = new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), true);
  const ids = LIVE_UNCHECKED_NUMBERS.map(n => state.submissions[n - 1].id);
  for (const id of ids) {
    const run = await store.begin(id), s = state.submissions.find(s => s.id === id)!;
    const checks = await core.assess(await store.snapshot(), id, run, async () => { throw new Error('No provider usage.'); });
    const status = overall(checks), approval = automaticApproval(state, id, run, checks, true);
    checks.push(decision(s, run, 'overall_status', status === 'approved' ? 'pass' : status === 'flagged' ? 'fail' : 'unknown', status,
      'Offline test assessment', { ...(approval ? { auto_approval: approval } : {}) }));
    await store.finish(run, checks, status);
  }
  const rows = workspaceRows(state).filter(r => ids.includes(r.id));
  assert.equal(rows.filter(r => r.assessment_status === 'matched').length, 4);
  assert.equal(rows.filter(r => r.assessment_status === 'flagged').length, 3);
  assert.equal(rows.filter(r => r.assessment_status === 'needs_review').length, 3);
  assert.deepEqual(rows.filter(r => shouldInvestigateAutomatically(state, r)).map(r => r.attendee_name).sort(), ['Morgan Blake', 'Riley Chen']);
  assert.deepEqual(store.calls, []);
});

test('SQL reset restores prepared history with valid revisions, archives custom checks, and rolls back invalid seeds', async () => {
  const db = new PGlite();
  async function scalar(sql: string, params: unknown[] = []) {
    const result = await db.query<Record<string, unknown>>(sql, params);
    return Object.values(result.rows[0])[0] as any;
  }
  const snapshot = () => scalar('select core_snapshot()') as Promise<Snapshot>;
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
    const directory = new URL('../../../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
      await db.exec((await readFile(new URL(name, directory), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
    }
    const customId = '74000000-0000-4000-8000-000000000001';
    await db.query('insert into custom_checks(id,doc) values($1,$2)', [customId, JSON.stringify({ id: customId, field: 'custom_review', state: 'active', version: 1 })]);
    await db.query('insert into custom_check_history(check_id,doc) values($1,$2)', [customId, JSON.stringify({ preserved: true })]);
    const before = await snapshot(), fixture = await liveBaseline(before);
    const result = await scalar('select core_reset_demo($1,$2)', [JSON.stringify(before), JSON.stringify(seed(fixture.state))]);
    assert.equal(result.reset, true);
    const after = await snapshot();
    assertBaseline(after);
    assert.equal(after.knowledge_revision, (before.knowledge_revision ?? 0) + 1);
    assert.deepEqual(after.custom_checks, []);
    assert.deepEqual(after.custom_check_history, []);
    const archived = await scalar('select snapshot from demo_reset_archives where id=$1', [result.archive_id]);
    assert.equal(archived.custom_checks.length, 1);
    assert.equal(archived.custom_check_history[0].doc.preserved, true);
    assert.equal(await scalar('select count(*)::int from model_calls'), 0);
    assert.equal(await scalar("select count(*)::int from reconciliation_runs where evidence_snapshot->>'demo_baseline'='true'"), 70);
    assert.equal(await scalar('select count(*)::int from claim_messages'), 0);
    const next = seed((await liveBaseline(after)).state), invalid = structuredClone(next);
    invalid.runs[0].knowledge_revision = 999;
    await assert.rejects(scalar('select core_reset_demo($1,$2)', [JSON.stringify(after), JSON.stringify(invalid)]), /INVALID_RESET_SEED/);
    assert.deepEqual(await snapshot(), after);
    assert.equal(await scalar('select count(*)::int from demo_reset_archives'), 1);
    await scalar('select core_reset_demo($1,$2)', [JSON.stringify(after), JSON.stringify(next)]);
    assertBaseline(await snapshot());
    await db.exec('set role service_role');
    await assert.rejects(scalar('select core_reset_demo_unchecked($1,$2)', [JSON.stringify(after), '{}']), /permission denied/);
  } finally { await db.close(); }
});
