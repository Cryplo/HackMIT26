import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileStore } from '../file-store';
import { CoreService } from '../service';
import { SimulatedJev } from '../jev';
import { SimulatedRetrieval } from '../retrieval';
import { DEMO_IDS } from '../fixtures';
import type { CoreError } from '../validation';
import { LocalStore } from '../../intake/store';
import { submitReceipt } from '../../intake/service';
import { extractReceipt } from '../../intake/extract';
import { receiptPdf, sampleReceipts } from '../../demo/samples';

test('durable local intake -> reconcile -> duplicate -> reviewer learning survives a fresh service', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reconcile-integration-'));
  const service = () => new CoreService(new FileStore(dir), new SimulatedRetrieval(), new SimulatedJev(), true);
  try {
    const core = service();
    assert.equal((await core.reviews()).submissions.length, 5);
    const intake = new LocalStore(dir);
    for (let i = 1; i <= 5; i++) assert.ok((await intake.read(`20000000-0000-4000-8000-00000000000${i}`))!.bytes.length > 100);
    const bytes = receiptPdf(sampleReceipts().train);
    const upload = () => submitReceipt({ attendee_name: 'Alex Demo', email: 'alex@example.invalid', amount_requested_minor: 12345, currency: 'USD', category: 'train', origin_location: 'New York' }, bytes, 'application/pdf', intake, id => extractReceipt(bytes, 'application/pdf', id, 'demo'));
    const first = await upload();
    assert.ok((await core.reviews()).submissions.some(s => s.id === first.submission_id));
    assert.equal((await core.reconcile([first.submission_id])).results[0].status, 'approved');
    const second = await upload();
    assert.equal((await core.reconcile([second.submission_id])).results[0].status, 'flagged');
    assert.equal((await core.reconcile([DEMO_IDS[2]])).results[0].status, 'needs_review');
    await core.correct({ submission_id: DEMO_IDS[2], human_verdict: 'approved', human_note: 'Synthetic vendor alias verified.', correction_type: 'vendor_alias', correction_payload_json: { observed_vendor: 'SYN HBR 042', canonical_vendor: 'Synthetic Harbor Hotel', scope: { category: 'hotel', currency: 'USD' } } });
    const restarted = service();
    assert.equal((await restarted.reviews()).submissions.find(s => s.id === first.submission_id)!.status, 'approved');
    assert.deepEqual((await restarted.reconcile([DEMO_IDS[3], DEMO_IDS[4]])).results.map(r => r.status), ['approved', 'needs_review']);
    assert.equal((await restarted.store.snapshot()).corrections.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a stale lock, a corrupt state file and a broken intake record fail loudly without losing data', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reconcile-recovery-'));
  const lock = path.join(dir, '.core-lock');
  try {
    const store = new FileStore(dir);
    await store.snapshot();
    // A lock owned by a dead process is recovered; a lock owned by this live process is not stolen.
    await mkdir(lock); await writeFile(path.join(lock, 'owner'), '999999:dead');
    assert.equal((await store.snapshot()).submissions.length, 5);
    await mkdir(lock); await writeFile(path.join(lock, 'owner'), `${process.pid}:someone-else`);
    await assert.rejects(store.snapshot(), (e: CoreError) => e.code === 'DEMO_BUSY');
    await rm(lock, { recursive: true, force: true });
    const runs = (await store.snapshot()).runs.length;
    // One unreadable intake record is quarantined; the rest of the ledger still loads.
    await writeFile(path.join(dir, '99999999-9999-4999-8999-999999999999.receipt.json'), '{not json');
    assert.equal((await store.snapshot()).submissions.length, 5);
    assert.equal((await store.snapshot()).runs.length, runs);
    // Corrupt state is reported as such and never silently reseeded.
    const state = path.join(dir, 'core-state.json');
    const good = await readFile(state, 'utf8');
    for (const broken of ['{"version":1,"state":{', 'null', '{"version":1}']) {
      await writeFile(state, broken);
      await assert.rejects(store.snapshot(), (e: CoreError) => e.code === 'DEMO_CORRUPT' && e.status === 503);
      assert.equal(await readFile(state, 'utf8'), broken);
    }
    await writeFile(state, good);
    assert.equal((await store.snapshot()).submissions.length, 5);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('separate local store instances serialize runs; edits to bundled PDF never fabricate extraction', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reconcile-lock-'));
  try {
    const stores = [new FileStore(dir), new FileStore(dir)];
    const begins = await Promise.allSettled(stores.map(s => s.begin(DEMO_IDS[0])));
    assert.equal(begins.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await stores[0].snapshot()).runs.length, 1);
    const altered = Buffer.concat([receiptPdf(sampleReceipts().train), Buffer.from('\nchanged')]);
    const extraction = await extractReceipt(altered, 'application/pdf', crypto.randomUUID(), 'demo');
    assert.equal(extraction.fields!.amount_minor, null);
    assert.equal(extraction.usage, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
