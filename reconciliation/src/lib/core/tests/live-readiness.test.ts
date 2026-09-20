import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseStore, MemoryStore } from '../store';
import { CoreService } from '../service';
import { demoSnapshot, DEMO_IDS } from '../fixtures';
import { DatabaseRetrieval } from '../retrieval';
import { SimulatedJev } from '../jev';
import { workspaceReviews } from '../workspace';
import { retryExtraction, backfillReceiptHashes } from '../receipts';
import { IntakeError } from '../../intake/schema';
import type { IntakeStore } from '../../intake/store';

test('live operations require a fresh exact schema version; old or unavailable schemas never reach a mutation', async t => {
  const store = new SupabaseStore('https://schema.example.invalid', 'synthetic-test-key');
  const paths: string[] = [];
  let version: unknown = 2;
  let missing = false;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(new Request(input, init).url).pathname;
    paths.push(path);
    if (path.endsWith('/core_platform_version')) return missing ? Response.json({code:'PGRST202'}, {status:404}) : Response.json(version);
    return Response.json(path.endsWith('/core_snapshot') ? demoSnapshot() : path.startsWith('/rest/v1/rpc/') ? {} : []);
  });
  const input = {submission_id:DEMO_IDS[0],expected_review_revision:0,human_verdict:'approved' as const,human_note:'Reviewed.',correction_type:'decision_override' as const,correction_payload_json:{}};
  await store.snapshot();
  await store.correct(input);
  assert.equal(paths.filter(p=>p.endsWith('/core_platform_version')).length, 2);
  for (const invalid of [1, 3, null, '2', {version:2}]) {
    version = invalid;
    const before = paths.length;
    await assert.rejects(store.correct(input), {code:'SCHEMA_MISMATCH',status:503});
    assert.deepEqual(paths.slice(before), ['/rest/v1/rpc/core_platform_version']);
  }
  missing = true;
  const before = paths.length;
  await assert.rejects(store.snapshot(), {code:'SCHEMA_MISMATCH',status:503});
  await assert.rejects(store.begin(DEMO_IDS[0]), {code:'SCHEMA_MISMATCH',status:503});
  await assert.rejects(store.receiptHash(demoSnapshot().receipts[0].id,'a'.repeat(64)), {code:'SCHEMA_MISMATCH',status:503});
  assert.ok(paths.slice(before).every(p=>p.endsWith('/core_platform_version')));
});

test('public reviews omit raw provider payloads, preserve useful evidence and expose expired operations for retry', async () => {
  const store = new MemoryStore(demoSnapshot());
  const core = new CoreService(store,new DatabaseRetrieval(),new SimulatedJev(),true);
  await core.reconcile([DEMO_IDS[0]]);
  const check = store.state.decisions.find(d=>d.check_method==='jev')!;
  check.evidence_json.provider_response = {private_diagnostic:'raw-audit-sentinel'};
  const raw = structuredClone(check.evidence_json);
  for (const response of [await workspaceReviews(core), await core.reviews()]) {
    const published = response.submissions[0].decisions.find(d=>d.id===check.id)!;
    assert.equal('provider_response' in published.evidence_json,false);
    assert.deepEqual(published.evidence_json.provider_answer,raw.provider_answer);
  }
  assert.deepEqual(check.evidence_json,raw);
  const lease = await store.begin(DEMO_IDS[0]);
  const active = store.state.runs.find(r=>r.id===lease)!;
  assert.equal((await workspaceReviews(core)).submissions[0].processing_status,'running');
  for (const prior of store.state.runs) if(prior.id!==lease) prior.started_at = new Date(Date.now()-600000).toISOString();
  active.started_at = new Date(Date.now()-301000).toISOString();
  const row = (await workspaceReviews(core)).submissions[0];
  assert.equal(row.processing_status,'failed');
  assert.match(row.processing_error!,/expired/);
  assert.equal(active.status,'running'); // Read projection never edits persisted audit.
});

test('hash backfill continues past unavailable originals but surfaces storage failures; retry preserves the error status', async () => {
  const state = demoSnapshot();
  state.receipts = state.receipts.slice(0,2);
  const core = new CoreService(new MemoryStore(state),new DatabaseRetrieval(),new SimulatedJev(),true);
  const originals: IntakeStore = {
    create:async()=>{},finish:async()=>{},usage:async()=>{},
    read:async id=>id===state.receipts[0].id?null:{receipt:state.receipts[1],bytes:new Uint8Array([1,2,3])},
  };
  const results = await backfillReceiptHashes(core,originals);
  assert.deepEqual(results.map(r=>r.status),['unavailable','hashed']);
  assert.equal((await core.store.snapshot()).receipts[0].sha256,undefined);
  assert.match((await core.store.snapshot()).receipts[1].sha256!,/^[a-f0-9]{64}$/);
  originals.read = async()=>{throw new IntakeError('storage_unavailable','Receipt storage is unavailable.',503);};
  await assert.rejects(backfillReceiptHashes(core,originals), {code:'storage_unavailable',status:503});
  await assert.rejects(retryExtraction(core,DEMO_IDS[0],{expected_review_revision:0},originals,async()=>{throw new Error('Extraction must not start');}), {code:'STORAGE_UNAVAILABLE',status:503});
  assert.equal((await core.store.snapshot()).runs.at(-1)!.status,'failed');
});
