import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { showcaseFixture } from '../../demo/showcase';
import { resetLiveDemo } from '../live-demo-reset';
import { workspaceSnapshot } from '../projection';
import type { CoreService } from '../service';
import { SupabaseStore } from '../store';

test('live reset archives all raw tables atomically and refuses stale, busy, real or invalid seeds', async () => {
  const db = new PGlite();
  async function scalar(sql: string, params: unknown[] = []) {
    const result = await db.query<Record<string, unknown>>(sql, params);
    return Object.values(result.rows[0])[0] as any;
  }
  const state = showcaseFixture().state;
  const seed = { submissions: state.submissions, receipts: state.receipts, policies: state.policies, supporting_documents: state.supporting_documents };
  const snapshot = () => scalar('select core_snapshot()');
  const reset = async (expected?: unknown, input = seed) => scalar('select core_reset_demo($1,$2)', [JSON.stringify(expected ?? await snapshot()), JSON.stringify(input)]);
  const claim = state.submissions[0].id;
  const document = state.supporting_documents![0].id;
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
    for (const migration of ['202609190001_reimbursement_core', '202609200002_platform', '202609200003_investigations', '202609200004_communications', '202609200005_demo_reset', '202609200006_automatic_notices', '202609200007_policy_revision_safeupdate', '202609200008_readable_demo_seed', '202609200009_designed_demo_seed']) {
      const sql = await readFile(new URL(`../../../../supabase/migrations/${migration}.sql`, import.meta.url), 'utf8');
      await db.exec(sql.replace('create extension if not exists pgcrypto;', ''));
    }
    // PGlite has no safeupdate extension; pin the production guard's required predicate.
    assert.match(await scalar("select pg_get_functiondef('core_policy_changed()'::regprocedure)"), /update platform_state set knowledge_revision=knowledge_revision\+1 where id = true;/);
    await reset();
    const run = await scalar('select core_begin_run($1)', [claim]);
    await db.query("update reconciliation_runs set status='completed',completed_at=now(),evidence_snapshot=$2 where id=$1", [run, JSON.stringify({ private_original: 'archive-sentinel' })]);
    await db.query("insert into model_calls(run_id,provider,model,latency_ms) values($1,'fixture','no-provider-call',0)", [run]);
    await db.query("insert into decisions(run_id,submission_id,field_checked,check_method,question_type,answer_json,verdict,rationale_text,evidence_json,state_snapshot_json) values($1,$2,'merchant','jev','boolean','{\"value\":true}','pass','synthetic','{\"provider_response\":\"raw-sentinel\"}','{\"private\":true}')", [run, claim]);
    await db.query('update submissions set review_revision=20,evidence_revision=30 where id=$1', [claim]);
    const before = await snapshot();
    const result = await reset(before);
    assert.equal(result.reset, true);
    const archived = await scalar('select snapshot from demo_reset_archives where id=$1', [result.archive_id]);
    assert.equal(Object.keys(archived).length, 19);
    assert.equal(archived.submissions.length, 14);
    assert.equal(archived.reconciliation_runs[0].evidence_snapshot.private_original, 'archive-sentinel');
    assert.equal(archived.decisions[0].evidence_json.provider_response, 'raw-sentinel');
    assert.equal(archived.model_calls.length, 1);
    const fresh = await snapshot();
    assert.equal(fresh.submissions.length, 14);
    assert.equal(fresh.receipts.length, 14);
    assert.equal(fresh.policies.length, 5);
    assert.equal(fresh.supporting_documents.length, 8);
    assert.deepEqual(fresh.runs, []);
    assert.deepEqual(fresh.decisions, []);
    assert.ok(fresh.submissions.every((s: any) => s.status === 'pending' && s.decision_status === 'pending' && s.latest_run_id === null && s.review_revision === 31 && s.evidence_revision === 31));
    assert.equal(fresh.knowledge_revision, before.knowledge_revision + 1);
    assert.equal(await scalar('select core_platform_version()'), 4);
    for (const name of Object.keys(archived).filter(name => !['platform_state', 'submissions', 'receipts', 'policy_rules', 'supporting_documents'].includes(name))) {
      assert.equal(await scalar(`select count(*)::int from ${name}`), 0, `${name} cleared`);
    }
    async function refuses(pattern: RegExp, expected?: unknown, input = seed) {
      const beforeAttempt = await snapshot();
      const archives = await scalar('select count(*)::int from demo_reset_archives');
      await assert.rejects(reset(expected, input), pattern);
      assert.deepEqual(await snapshot(), beforeAttempt, 'failed reset preserves the workspace');
      assert.equal(await scalar('select count(*)::int from demo_reset_archives'), archives, 'failed reset does not publish an archive');
    }
    const active = await scalar('select core_begin_run($1)', [claim]);
    await refuses(/RESET_BUSY/);
    await db.query("select core_fail_run($1,'test')", [active]);
    await db.query("update receipts set extraction_status='pending' where submission_id=$1", [claim]);
    await refuses(/RESET_BUSY/);
    await db.query("update receipts set extraction_status='succeeded' where submission_id=$1", [claim]);
    await db.query("update supporting_documents set extraction_status='pending' where id=$1", [document]);
    await refuses(/RESET_BUSY/);
    await db.query("update supporting_documents set extraction_status='succeeded' where id=$1", [document]);
    const message = { id: '55000000-0000-4000-8000-000000000001', claim_id: claim, kind: 'approval', status: 'queued', recipient: 'demo@example.invalid', subject: 'Synthetic message', body: 'No delivery requested.' };
    await db.query('insert into claim_messages(id,claim_id,doc) values($1,$2,$3)', [message.id, claim, JSON.stringify(message)]);
    await refuses(/RESET_BUSY/);
    await db.query("update claim_messages set doc=jsonb_set(doc,'{status}','\"cancelled\"') where id=$1", [message.id]);
    await db.query("update submissions set email='real@example.com' where id=$1", [claim]);
    await refuses(/SYNTHETIC_ONLY/);
    await db.query("update submissions set email='demo@example.invalid' where id=$1", [claim]);
    await db.query("update receipts set storage_path='real/original' where submission_id=$1", [claim]);
    await refuses(/SYNTHETIC_ONLY/);
    await db.query("update receipts set storage_path='synthetic/'||submission_id::text||'/'||id::text where submission_id=$1", [claim]);
    const stale = await snapshot();
    await db.query('update submissions set review_revision=review_revision+1 where id=$1', [claim]);
    await refuses(/STALE_SNAPSHOT/, stale);
    const invalid = structuredClone(seed);
    invalid.submissions[0].review_revision = 1;
    await refuses(/INVALID_RESET_SEED/, undefined, invalid);
    await db.exec("create function deny_demo_archive() returns trigger language plpgsql as $$ begin raise exception 'ARCHIVE_FAILED'; end $$; create trigger deny_demo_archive before insert on demo_reset_archives for each row execute function deny_demo_archive();");
    await refuses(/ARCHIVE_FAILED/);
    await db.exec('drop trigger deny_demo_archive on demo_reset_archives;');
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from demo_reset_archives'), /permission denied/);
    await assert.rejects(reset(fresh), /permission denied/);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from demo_reset_archives'), /permission denied/);
    await assert.rejects(reset(fresh), /permission denied/);
    await db.exec('set role service_role');
    assert.ok(await scalar('select count(*)::int from demo_reset_archives') > 0);
    await assert.rejects(db.query("insert into demo_reset_archives(snapshot) values('{}')"), /permission denied/);
    assert.equal((await reset()).reset, true);
  } finally { await db.close(); }
});

test('live reset helper verifies originals without overwrite and never retries an uncertain reset', async t => {
  const env = { SUPABASE_URL: 'https://reset.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-test-key',
    SUPABASE_RECEIPTS_BUCKET: 'receipts', RECONCILIATION_MODE: 'live', RECONCILIATION_INTAKE_MODE: 'live',
    RECONCILIATION_ALLOW_DEMO_RESET: 'true', RECONCILIATION_SYNTHETIC_ONLY: 'true' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const fixture = showcaseFixture();
  const originals = new Map([...fixture.originals.map(x => [x.receipt.storage_path, x.bytes] as const),
    ...fixture.supporting.map(x => [x.document.storage_path, x.bytes] as const)]);
  const core = { store: new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY), demoMode: false } as unknown as CoreService;
  const token = workspaceSnapshot(fixture.state).token;
  let requests = 0, uploads = 0, resets = 0, uncertain = false;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requests++;
    const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname;
    if (path.endsWith('/core_platform_version')) return Response.json(4);
    if (path.endsWith('/core_snapshot')) return Response.json(fixture.state);
    if (path.endsWith('/bucket/receipts')) return Response.json({ id: 'receipts', name: 'receipts', public: false });
    if (path.endsWith('/core_reset_demo')) {
      resets++;
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.p_expected, fixture.state);
      assert.equal(body.p_seed.submissions.length, 14);
      assert.equal(body.p_seed.receipts[0].raw_extracted_text, fixture.state.receipts[0].raw_extracted_text, 'cached facts preserve the designed original text');
      assert.match(body.p_seed.receipts[0].extraction_provenance, /no extraction provider called/);
      if (uncertain) throw new Error('response lost after possible commit');
      return Response.json({ reset: true, archive_id: '66000000-0000-4000-8000-000000000001' });
    }
    const storagePath = path.slice(path.indexOf('/synthetic/') + 1);
    assert.ok(storagePath.startsWith('synthetic/'), 'only known mocked storage requests');
    if (init?.method === 'POST') {
      uploads++;
      assert.equal(new Headers(init.headers).get('x-upsert'), 'false');
      assert.equal(originals.has(storagePath), false, 'an existing original is never overwritten');
      originals.set(storagePath, Buffer.from(init.body as Uint8Array));
      return Response.json({ Id: 'fixture-upload', Key: storagePath });
    }
    const bytes = originals.get(storagePath);
    return bytes ? new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf' } })
      : Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 404 });
  });
  process.env.RECONCILIATION_ALLOW_DEMO_RESET = 'false';
  await assert.rejects(resetLiveDemo(core, token), { code: 'RESET_DISABLED' });
  assert.equal(requests, 0);
  process.env.RECONCILIATION_ALLOW_DEMO_RESET = 'true';
  await assert.rejects(resetLiveDemo(core, 'b'.repeat(64)), { code: 'STALE_SNAPSHOT' });
  assert.equal(uploads, 0);
  assert.equal(resets, 0);
  const first = fixture.originals[0];
  originals.delete(first.receipt.storage_path);
  assert.equal((await resetLiveDemo(core, token)).reset, true);
  assert.equal(uploads, 1, 'restores only the missing original');
  assert.equal(originals.size, 22);
  originals.set(first.receipt.storage_path, Buffer.from('different original'));
  await assert.rejects(resetLiveDemo(core, token), { code: 'ORIGINAL_CONFLICT' });
  assert.equal(uploads, 1);
  assert.equal(resets, 1, 'conflicting bytes cannot reach the reset RPC');
  originals.set(first.receipt.storage_path, first.bytes);
  uncertain = true;
  await assert.rejects(resetLiveDemo(core, token), { code: 'RESET_UNCONFIRMED' });
  assert.equal(resets, 2, 'one attempt for each reset, no uncertain-write retry');
});
