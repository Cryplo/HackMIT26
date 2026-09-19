import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileStore } from '../file-store';
import { CoreService } from '../service';
import { SimulatedJev } from '../jev';
import { SimulatedRetrieval } from '../retrieval';
import { DEMO_IDS } from '../fixtures';
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
