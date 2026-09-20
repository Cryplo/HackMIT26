import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { seedShowcase } from '../../../../scripts/seed-showcase';
import { FileStore } from '../file-store';
import { MemoryStore, SupabaseStore } from '../store';
import { CoreService } from '../service';
import { DatabaseRetrieval } from '../retrieval';
import { SimulatedJev } from '../jev';
import { workspaceSnapshot } from '../projection';
import { resetSimulation } from '../demo-reset';
import { LocalStore } from '../../intake/store';
import { LocalSupportingOriginals } from '../../intake/supporting-originals';
import { POST } from '../../../app/api/workspace/demo-reset/route';

test('simulation reset guards live/busy/stale state, archives results, rolls back I/O failures and never resurrects extra intake', async t => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sift-reset-test-'));
  const env = { ...process.env };
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden'); });
  try {
    Object.assign(process.env, { RECONCILIATION_MODE: 'simulated', RECONCILIATION_INTAKE_MODE: 'demo', RECONCILIATION_SYNTHETIC_ONLY: 'true', RECONCILIATION_AUTOMATION_MODE: 'policy-caps', RECONCILIATION_APP_ORIGIN: 'http://localhost:3000' });
    for (const key of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[key];
    const { directory } = await seedShowcase(path.join(root, 'claims'));
    const store = new FileStore(directory);
    const core = new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), true);
    const snapshot = async () => workspaceSnapshot(await store.snapshot());
    const initial = await snapshot();
    const stateFile = path.join(directory, 'core-state.json');
    const originalState = await fs.readFile(stateFile, 'utf8');
    for (const [key, value] of Object.entries({ RECONCILIATION_MODE: 'live', RECONCILIATION_INTAKE_MODE: 'live', RECONCILIATION_SYNTHETIC_ONLY: 'false', SUPABASE_URL: 'https://example.invalid', NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only' })) {
      const previous = process.env[key]; process.env[key] = value;
      await assert.rejects(resetSimulation(core, initial.token), { code: 'DEMO_RESET_DISABLED', status: 403 });
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    }
    for (const other of [new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), false), new CoreService(new MemoryStore(await store.snapshot()), new DatabaseRetrieval(), new SimulatedJev(), true), new CoreService(new SupabaseStore('https://example.invalid', 'test-only'), new DatabaseRetrieval(), new SimulatedJev(), true)]) await assert.rejects(resetSimulation(other, initial.token), { code: 'DEMO_RESET_DISABLED' });
    const request = (body: unknown, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/workspace/demo-reset', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await POST(request({ snapshot_token: initial.token }, 'https://foreign.invalid'))).status, 403);
    assert.equal((await POST(request({ snapshot_token: initial.token, force: true }))).status, 400);
    await assert.rejects(resetSimulation(core, '0'.repeat(64)), { code: 'STALE_SNAPSHOT', status: 409 });
    assert.equal(await fs.readFile(stateFile, 'utf8'), originalState);
    const run = await store.begin(initial.rows[0].id);
    await assert.rejects(resetSimulation(core, (await snapshot()).token), { code: 'DEMO_BUSY', status: 409 });
    await store.fail(run, 'Test run finished.');

    // Initial uploads register pending extraction under the same lock as reset.
    const state = await store.snapshot();
    const claim = { ...state.submissions[0], id: randomUUID(), attendee_name: 'Extra upload', status: 'pending' as const, latest_run_id: null };
    const receipt = { ...state.receipts[0], id: randomUUID(), submission_id: claim.id, extraction_status: 'pending' as const, extracted_at: null };
    receipt.storage_path = `synthetic/${claim.id}/${receipt.id}`;
    const originals = new LocalStore(directory);
    await originals.create(claim, receipt, Buffer.from('%PDF-extra-test-original'));
    await assert.rejects(resetSimulation(core, (await snapshot()).token), { code: 'DEMO_BUSY', status: 409 });
    await originals.finish({ ...receipt, extraction_status: 'failed', extraction_error: 'Synthetic test extraction ended.', extracted_at: new Date().toISOString() });
    const before = await snapshot();
    assert.equal(before.rows.length, 15);

    // Fail after replacement starts: restore state and loose metadata from the archive.
    const rename = fs.rename;
    const failure = t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
      if (String(args[0]).includes('.reset-')) throw new Error('Injected replacement failure');
      return rename(...args);
    });
    await assert.rejects(resetSimulation(core, before.token), /Injected replacement failure/);
    failure.mock.restore();
    assert.equal((await snapshot()).token, before.token);
    assert(await originals.read(receipt.id));

    const maxRevision = Math.max(...(await store.snapshot()).submissions.map(row => Math.max(row.review_revision ?? 0, row.evidence_revision ?? 0)));
    assert.deepEqual(await resetSimulation(core, before.token), { reset: true });
    const after = await snapshot();
    assert.equal(after.rows.length, 14);
    assert(after.rows.every(row => row.decision_status === 'pending' && row.assessment_status === null && !row.decisions.length && row.review_revision > maxRevision));
    assert.notEqual(after.token, before.token);
    assert.equal(await originals.read(receipt.id), null);
    for (const field of ['decisions', 'corrections', 'runs', 'investigations', 'rules', 'procedures', 'claim_messages'] as const) assert.equal((await store.snapshot())[field]?.length ?? 0, 0);
    const reset = await store.snapshot();
    assert.equal(reset.receipts.length, 14); assert.equal(reset.supporting_documents!.length, 8); assert.equal(reset.policies.length, 5);
    for (const r of reset.receipts) assert.equal(createHash('sha256').update((await originals.read(r.id))!.bytes).digest('hex'), r.sha256);
    for (const doc of reset.supporting_documents!) assert.equal(createHash('sha256').update((await new LocalSupportingOriginals(directory).read(doc))!).digest('hex'), doc.sha256);
    const archives = (await fs.readdir(root)).filter(name => name.startsWith('claims.archive-'));
    assert(archives.length >= 2);
    for (const name of archives) {
      const archive = path.join(root, name);
      assert.equal((await fs.stat(archive)).mode & 0o777, 0o700);
      const saved = JSON.parse(await fs.readFile(path.join(archive, 'core-state.json'), 'utf8'));
      assert(saved.state.decisions.length > 0);
      assert.equal(saved.state.submissions.length, 15);
      assert(await fs.readFile(path.join(archive, `${receipt.id}.receipt.json`)));
    }
    await assert.rejects(resetSimulation(core, before.token), { code: 'STALE_SNAPSHOT' });
    await resetSimulation(core, after.token);
    const twice = await snapshot();
    assert.equal(twice.rows.length, 14);
    assert(twice.rows.every(row => row.assessment_status === null && !row.decisions.length));
    assert.notEqual(twice.token, after.token);
    assert.equal((await new FileStore(directory).snapshot()).submissions.length, 14);
    // Simulate a process dying after it journals the backup and removes an original.
    await fs.writeFile(path.join(directory, '.demo-reset.json'), JSON.stringify({ archive: await fs.realpath(path.join(root, archives[0])) }), { mode: 0o600 });
    await fs.rm(path.join(directory, `${reset.receipts[0].id}.bin`));
    const recovered = await new FileStore(directory).snapshot();
    assert.equal(recovered.submissions.length, 15);
    assert(recovered.decisions.length > 0);
    assert(await originals.read(receipt.id));
    await assert.rejects(fs.stat(path.join(directory, '.demo-reset.json')), { code: 'ENOENT' });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await fs.rm(root, { recursive: true, force: true });
  }
});
