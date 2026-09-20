import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { liveBaseline } from '../../demo/live-baseline';
import { workspaceRows } from '../projection';
import type { Snapshot } from '../store';

const ruleId = '74000000-0000-4000-8000-000000000001';
function seed(state: Snapshot) {
  const { submissions, receipts, policies, supporting_documents, runs, decisions, corrections } = state;
  return { submissions, receipts, policies, supporting_documents, runs, decisions, corrections };
}

test('prepared rule preserves the current audit, is idempotent, rejects collisions, and survives guarded reset', async () => {
  const db = new PGlite();
  async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
    return Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0];
  }
  const snapshot = () => scalar<Snapshot>('select core_snapshot()');
  const install = () => scalar<{ inserted: boolean }>('select core_seed_prepared_demo_rule()');
  const reset = async (before: Snapshot) => scalar<{ archive_id: string }>('select core_reset_demo($1,$2)',
    [JSON.stringify(before), JSON.stringify(seed((await liveBaseline(before)).state))]);
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
    const directory = new URL('../../../../supabase/migrations/', import.meta.url);
    const migrations = (await readdir(directory)).filter(n => n.endsWith('.sql')).sort();
    // Start with an existing checked workspace, as on the live deployment.
    for (const name of migrations.filter(n => n < '202609210017')) {
      await db.exec((await readFile(new URL(name, directory), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
    }
    await reset(await snapshot());
    const before = await snapshot();
    for (const name of migrations.filter(n => n >= '202609210017')) {
      await db.exec((await readFile(new URL(name, directory), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
    }
    assert.deepEqual(await snapshot(), before, 'Migration alone must not seed or alter the live audit.');
    await db.exec('set role service_role');
    assert.equal((await install()).inserted, true);
    const after = await snapshot();
    assert.equal(after.rules?.length, 1);
    const rule = after.rules![0];
    assert.equal(rule.id, ruleId);
    assert.equal(rule.state, 'disabled');
    assert.equal((rule as unknown as { prepared_demo: boolean }).prepared_demo, true);
    assert.equal(rule.source_correction_id, null);
    assert.equal(rule.latest_test, null);
    assert.equal(await scalar<number>('select count(*)::int from rule_history'), 1);
    assert.deepEqual({ ...after, rules: before.rules }, before);
    assert.deepEqual(workspaceRows(after), workspaceRows(before), 'Inactive example must preserve all current approval identities.');
    assert.equal((await install()).inserted, false);
    assert.deepEqual(await snapshot(), after);
    assert.equal(await scalar<number>('select count(*)::int from rule_history'), 1);
    await assert.rejects(scalar('select core_reset_demo_before_prepared_rule($1,$2)', ['{}', '{}']), /permission denied/);
    await db.exec('reset role');

    await db.query("update merchant_rules set doc=jsonb_set(doc-'prepared_demo','{state}','\"active\"') where id=$1", [ruleId]);
    const collision = await snapshot();
    await assert.rejects(install(), /PREPARED_RULE_ID_COLLISION/);
    assert.deepEqual(await snapshot(), collision, 'A reserved-ID collision cannot be overwritten.');
    await db.query('update merchant_rules set doc=$2 where id=$1', [ruleId, JSON.stringify(rule)]);
    await db.query("update receipts set parsed_fields_json=jsonb_set(parsed_fields_json,'{vendor}','\"Different Vendor\"') where id=$1", ['62000000-0000-4000-8000-000000000003']);
    await assert.rejects(install(), /INVALID_PREPARED_RULE_SOURCE/);
    await db.query('update receipts set parsed_fields_json=$2 where id=$1', ['62000000-0000-4000-8000-000000000003', JSON.stringify(before.receipts.find(r => r.id.endsWith('000003'))!.parsed_fields_json)]);

    const restoredBefore = await snapshot(), result = await reset(restoredBefore), restored = await snapshot();
    const rows = workspaceRows(restored);
    assert.equal(restored.rules?.length, 1);
    assert.equal(await scalar<number>('select count(*)::int from rule_history'), 1);
    assert.equal(restored.rules![0].id, ruleId);
    assert.equal(rows.filter(r => r.latest_run_id).length, 70);
    assert.equal(rows.filter(r => !r.latest_run_id).length, 10);
    assert.equal(rows.filter(r => r.decision_status === 'approved').length, 59);
    assert.equal(rows.filter(r => r.decision_status === 'rejected').length, 7);
    assert.equal(restored.knowledge_revision, (restoredBefore.knowledge_revision ?? 0) + 1);
    assert.equal(await scalar<number>('select count(*)::int from rule_tests'), 0);
    assert.equal(await scalar<number>('select count(*)::int from claim_messages'), 0);
    assert.equal(await scalar<number>('select count(*)::int from model_calls'), 0);
    assert.equal(await scalar<number>("select jsonb_array_length(snapshot->'merchant_rules') from demo_reset_archives where id=$1", [result.archive_id]), 1);
    await db.exec('set role anon');
    await assert.rejects(install(), /permission denied/);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(install(), /permission denied/);
  } finally { await db.close(); }
});
