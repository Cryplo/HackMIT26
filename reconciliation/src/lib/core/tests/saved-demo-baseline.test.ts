import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { liveBaseline, liveResetSeed } from '../../demo/live-baseline';
import { workspaceRows } from '../projection';
import type { Snapshot } from '../store';

function seed(state: Snapshot) {
  const { submissions, receipts, policies, supporting_documents, runs, decisions, corrections } = state;
  return { submissions, receipts, policies, supporting_documents, runs, decisions, corrections };
}
function assertBaseline(state: Snapshot) {
  const rows = workspaceRows(state);
  assert.equal(rows.length, 80);
  assert.equal(rows.filter(r => r.latest_run_id).length, 70);
  assert.equal(rows.filter(r => !r.latest_run_id).length, 10);
  assert.equal(rows.filter(r => r.decision_status === 'approved').length, 59);
  assert.equal(rows.filter(r => r.decision_status === 'rejected').length, 7);
  assert.equal(rows.filter(r => r.assessment_status === 'needs_review').length, 4);
  assert.equal(state.decisions.length, 637);
  assert.equal(state.corrections.length, 7);
  assert.equal(state.rules?.length, 1);
  assert.equal(state.rules![0].state, 'disabled');
  assert.equal(state.rules![0].source_correction_id, null);
  assert.equal(state.rules![0].latest_test, null);
}

test('saved baseline installs without changing the audit and restores repeatedly with fresh revisions and intact guards', async t => {
  const db = new PGlite();
  async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
    return Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0];
  }
  const snapshot = () => scalar<Snapshot>('select core_snapshot()');
  const archives = () => scalar<number>('select count(*)::int from demo_reset_archives');
  const save = (value: unknown, bucket = 'receipts') => scalar<{ saved: boolean; id: string }>('select core_save_demo_baseline($1,$2)', [JSON.stringify(value), bucket]);
  const restore = (expected: Snapshot, bucket = 'receipts') => scalar<{ reset: boolean; archive_id: string }>('select core_reset_saved_demo($1,$2)', [JSON.stringify(expected), bucket]);
  const originalState = (await liveBaseline({ submissions: [], knowledge_revision: 0 })).state;
  const base = liveResetSeed(originalState);
  assert.ok(Buffer.byteLength(JSON.stringify(base)) < 3_000_000, 'Saved template avoids repeated full-ledger snapshots.');
  assert.ok(base.runs.every(r => r.evidence_snapshot.baseline_id === 'live-80-v1'
    && r.evidence_snapshot.source_submission_id === r.submission_id));
  assert.ok(originalState.runs[0].evidence_snapshot?.receipts, 'Compaction must not mutate original history.');
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
    const directory = new URL('../../../../supabase/migrations/', import.meta.url);
    const migrations = (await readdir(directory)).filter(n => n.endsWith('.sql')).sort();
    for (const name of migrations.filter(n => n < '202609210018')) {
      await db.exec((await readFile(new URL(name, directory), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
    }
    // The old ledger retains its full historical evidence; only the new saved template is compact.
    await scalar('select core_reset_demo($1,$2)', [JSON.stringify(await snapshot()), JSON.stringify(seed(originalState))]);
    const originalEvidence = await scalar<Record<string, unknown>>('select evidence_snapshot from reconciliation_runs where id=$1', [base.runs[0].id]);
    const before = await snapshot(), priorArchives = await archives();
    for (const name of migrations.filter(n => n >= '202609210018')) {
      await db.exec((await readFile(new URL(name, directory), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
    }
    assert.deepEqual(await snapshot(), before, 'Migration creates no live history or knowledge.');
    await db.exec('set role service_role');
    await assert.rejects(restore(before), /BASELINE_MISSING/);
    const invalid = structuredClone(base);
    invalid.submissions[0].email = 'not-synthetic@example.com';
    await assert.rejects(save(invalid), /INVALID_RESET_SEED/);
    const wrongRevision = structuredClone(base);
    wrongRevision.runs[0].knowledge_revision = 2;
    await assert.rejects(save(wrongRevision), /INVALID_RESET_SEED/);
    const unknownRun = structuredClone(base);
    unknownRun.decisions[0].run_id = '71000000-0000-4000-8000-000000000001';
    unknownRun.decisions[0].submission_id = '41000000-0000-4000-8000-000000000001';
    await assert.rejects(save(unknownRun), /INVALID_RESET_SEED/);
    const nullRun = structuredClone(base);
    await assert.rejects(save({ ...nullRun, decisions: [{ ...nullRun.decisions[0], run_id: null }, ...nullRun.decisions.slice(1)] }), /INVALID_RESET_SEED/);
    await assert.rejects(save(base, 'missing'), /BASELINE_BUCKET_MISMATCH/);
    assert.deepEqual(await save(base), { saved: true, id: 'live-80-v1' });
    assert.deepEqual(await snapshot(), before);
    assert.equal(await archives(), priorArchives);
    assert.deepEqual(await save(base), { saved: false, id: 'live-80-v1' });
    await assert.rejects(save(invalid), /BASELINE_EXISTS/);
    const saved = await scalar<{ seed: unknown; bucket: string; created_at: string }>("select to_jsonb(b) from demo_reset_baselines b where id='live-80-v1'");
    assert.equal(saved.bucket, 'receipts');
    assert.deepEqual(saved.seed, base);
    await assert.rejects(db.query("update demo_reset_baselines set bucket='other' where id='live-80-v1'"), /permission denied/);

    async function refuses(expected: Snapshot, pattern: RegExp, bucket = 'receipts') {
      const state = await snapshot(), count = await archives();
      await assert.rejects(restore(expected, bucket), pattern);
      assert.deepEqual(await snapshot(), state);
      assert.equal(await archives(), count);
    }
    await refuses(before, /BASELINE_BUCKET_MISMATCH/, 'other');
    await db.exec('reset role');
    await db.query('update submissions set review_revision=review_revision+1 where id=$1', [before.submissions[0].id]);
    await refuses(before, /STALE_SNAPSHOT/);
    const busyRun = await scalar<string>('select core_begin_run($1)', [before.submissions[0].id]);
    await refuses(await snapshot(), /RESET_BUSY/);
    await scalar('select core_fail_run($1,$2)', [busyRun, 'Offline fixture stopped.']);
    await db.query('update storage.buckets set public=true where id=$1', ['receipts']);
    await refuses(await snapshot(), /BASELINE_BUCKET_MISMATCH/);
    await db.query('update storage.buckets set public=false where id=$1', ['receipts']);
    await db.exec('set role service_role');
    const review = (await snapshot()).submissions.find(s => s.id.endsWith('000036'))!;
    const human = await scalar<{ correction_id: string }>('select core_correct($1)', [JSON.stringify({
      submission_id: review.id, expected_review_revision: review.review_revision,
      human_verdict: 'rejected', human_note: 'Offline test decision: preserve this review in the reset archive.',
      correction_type: 'decision_override', correction_payload_json: {},
    })]);

    for (let attempt = 0; attempt < 2; attempt++) {
      const previous = await snapshot(), previousArchives = await archives();
      const delta = Math.max(0, ...previous.submissions.flatMap(s => [s.review_revision ?? 0, s.evidence_revision ?? 0]));
      const started = performance.now(), result = await restore(previous);
      t.diagnostic(`Isolated PGlite saved restore ${attempt + 1}: ${Math.round(performance.now() - started)} ms (not a live benchmark).`);
      const current = await snapshot();
      assert.equal(result.reset, true);
      assertBaseline(current);
      assert.equal(current.knowledge_revision, (previous.knowledge_revision ?? 0) + 1);
      assert.ok(current.submissions.every(s => s.evidence_revision === delta + 1 && s.review_revision! >= delta + 1));
      assert.ok(current.runs.every(r => r.evidence_revision === delta + 1 && r.review_revision === delta + 1 && r.knowledge_revision === current.knowledge_revision));
      assert.ok(current.corrections.every(c => c.review_revision === delta + 3));
      const markers = current.decisions.flatMap(d => d.evidence_json.auto_approval ? [d.evidence_json.auto_approval as Record<string, unknown>] : []);
      assert.equal(markers.length, 59);
      assert.ok(markers.every(m => m.evidence_revision === delta + 1 && m.knowledge_revision === current.knowledge_revision));
      const stored = await scalar<{ evidence_revision: number; review_revision: number }[]>('select jsonb_agg(state_snapshot_json->\'submission\') from decisions');
      assert.ok(stored.every(s => s.evidence_revision === delta + 1 && s.review_revision >= delta + 1 && s.review_revision <= delta + 3));
      assert.equal(await archives(), previousArchives + 1);
      assert.equal(await scalar<number>("select jsonb_array_length(snapshot->'submissions') from demo_reset_archives where id=$1", [result.archive_id]), 80);
      const archivedCorrections = await scalar<Snapshot['corrections']>("select snapshot->'corrections' from demo_reset_archives where id=$1", [result.archive_id]);
      assert.deepEqual(archivedCorrections.toSorted((a, b) => a.id.localeCompare(b.id)), previous.corrections.toSorted((a, b) => a.id.localeCompare(b.id)));
      if (attempt === 0) assert.ok(archivedCorrections.some(c => c.id === human.correction_id && c.human_note.startsWith('Offline test decision:')));
      if (attempt === 0) {
        const archivedEvidence = await scalar("select r->'evidence_snapshot' from demo_reset_archives a, jsonb_array_elements(a.snapshot->'reconciliation_runs') r where a.id=$1 and r->>'id'=$2", [result.archive_id, base.runs[0].id]);
        assert.deepEqual(archivedEvidence, originalEvidence, 'Existing full historical evidence is archived unchanged.');
      }
      assert.deepEqual(await scalar('select evidence_snapshot from reconciliation_runs where id=$1', [base.runs[0].id]), base.runs[0].evidence_snapshot);
      assert.deepEqual(await scalar("select to_jsonb(b) from demo_reset_baselines b where id='live-80-v1'"), saved, 'Restoration never rewrites the saved template.');
    }
    await db.exec('reset role');
    assert.equal(await scalar<number>('select count(*)::int from model_calls'), 0);
    assert.equal(await scalar<number>('select count(*)::int from claim_messages'), 0);
    assert.equal(await scalar<number>('select count(*)::int from rule_tests'), 0);
    await db.exec('set role anon');
    await assert.rejects(save(base), /permission denied/);
    await assert.rejects(restore(before), /permission denied/);
    await assert.rejects(db.query('select * from demo_reset_baselines'), /permission denied/);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(save(base), /permission denied/);
    await assert.rejects(restore(before), /permission denied/);
  } finally { await db.close(); }
});
