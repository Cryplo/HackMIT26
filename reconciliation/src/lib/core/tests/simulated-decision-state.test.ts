import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seedShowcase } from '../../../../scripts/seed-showcase';
import { FileStore } from '../file-store';
import { CoreService } from '../service';
import { DatabaseRetrieval } from '../retrieval';
import { SimulatedJev } from '../jev';
import { workspaceDecide, workspaceReviews } from '../workspace';

// Use the real 14-claim file-backed path, including outbox confirmation and intake reimports.
test('simulated decisions and notices survive refresh, a new store, and rechecks', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sift-decision-state-'));
  const env = { ...process.env };
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden'); });
  try {
    Object.assign(process.env, { RECONCILIATION_EMAIL_MODE: 'preview', RECONCILIATION_EMAIL_DRAFT_MODE: 'template', RECONCILIATION_AUTOMATION_MODE: 'disabled' });
    const seeded = await seedShowcase(path.join(directory, 'claims'), true);
    const make = () => new CoreService(new FileStore(seeded.directory), new DatabaseRetrieval(), new SimulatedJev(), true);
    const core = make();
    const initial = await workspaceReviews(core);
    assert.equal(initial.submissions.length, 14);
    const claim = initial.submissions[0];
    const request = { submission_id: claim.id, expected_review_revision: claim.review_revision, human_verdict: 'rejected', human_note: 'Private reviewer note', applicant_reason: 'The applicant withdrew this request.', correction_type: 'decision_override', correction_payload_json: {}, request_id: crypto.randomUUID() };
    const saved = await workspaceDecide(core, request);
    assert.equal(saved.row.decision_status, 'rejected');
    assert.equal(saved.message?.status, 'previewed');
    assert.equal(saved.row.review_revision, claim.review_revision + 1);
    const refreshed = await workspaceReviews(make());
    assert.equal(refreshed.summary.pending_review_count, initial.summary.pending_review_count - 1);
    assert.equal(refreshed.submissions.find(row => row.id === claim.id)!.decision_status, 'rejected');
    assert.notEqual(refreshed.snapshot_token, initial.snapshot_token);
    const replay = await workspaceDecide(make(), request);
    assert.equal(replay.correction_id, saved.correction_id);
    assert.equal(replay.message?.status, 'previewed');
    const checked = await core.reconcile([claim.id]);
    assert.equal(checked.results[0].error, undefined);
    const final = await workspaceReviews(make());
    assert.equal(final.summary.pending_review_count, refreshed.summary.pending_review_count);
    assert.equal(final.submissions.find(row => row.id === claim.id)!.decision_status, 'rejected');
    const state = await make().store.snapshot();
    assert.equal(state.corrections.length, 1);
    assert.equal(state.claim_messages!.length, 1);
    assert.equal(state.claim_messages![0].status, 'previewed');
    assert.equal(state.claim_messages![0].correction_id, saved.correction_id);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await rm(directory, { recursive: true, force: true });
  }
});
