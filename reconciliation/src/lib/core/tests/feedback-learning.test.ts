import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreService } from '../service';
import { MemoryStore } from '../store';
import { DatabaseRetrieval } from '../retrieval';
import { SimulatedJev } from '../jev';
import { intelligence } from '../../intelligence';
import { showcaseFixture } from '../../demo/showcase';
import { workspaceRows } from '../projection';
import { processFeedbackLearning } from '../feedback-learning';
import { feedbackJob, publicLearning } from '../feedback-learning-state';
import { classifyFeedback } from '../feedback-learning-classifier';
import { deriveCandidate } from '../evidence';
import { changeProcedure, publicProcedure } from '../procedures';
const note = 'The booking confirmation identifies Harbor Hotel and matches this receipt’s booking reference, amount and guest.';
async function fixture(reason = note, index = 2) {
  const store = new MemoryStore(showcaseFixture().state);
  const core = new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), true, undefined, undefined, intelligence, 'simulated');
  const id = store.state.submissions[index].id;
  await core.reconcile([id]);
  const correction = await core.correct({ submission_id: id, expected_review_revision: workspaceRows(store.state)[index].review_revision, human_verdict: 'approved', human_note: reason, correction_type: 'decision_override', correction_payload_json: {} });
  return { store, core, id, correctionId: correction.correction_id };
}

test('human reason queues atomically and safely activates without an investigation; later claims cite their own evidence', async () => {
  const { store, core, id, correctionId } = await fixture();
  assert.equal(feedbackJob(store.state.corrections[0])?.status, 'queued');
  assert.equal(store.calls.length, 0);
  const human = structuredClone(store.state.decisions.filter(d => d.check_method === 'human'));
  await Promise.all([processFeedbackLearning(core, correctionId), processFeedbackLearning(core, correctionId)]);
  const procedure = store.state.procedures![0];
  assert.equal(procedure?.state, 'active');
  assert.equal(publicProcedure(procedure).source_kind, 'review_feedback');
  assert.equal(store.state.procedures!.length, 1);
  assert.equal(store.state.procedure_tests![0].observations.length, 24);
  assert.equal(store.state.investigations!.length, 0);
  assert.equal(workspaceRows(store.state).find(r => r.id === id)!.learning?.status, 'active');
  assert.deepEqual(store.state.decisions.filter(d => d.check_method === 'human'), human);
  const later = workspaceRows(store.state)[3], merchant = later.decisions.find(d => d.field_checked === 'merchant')!;
  assert.equal(later.decision_status, 'pending');
  assert.equal(merchant.evidence_json.exact_method, 'booking_reference_identity');
  assert((merchant.evidence_json.evidence_refs as { id: string }[]).some(ref => ref.id === store.state.receipts[3].id));
  assert(!(merchant.evidence_json.evidence_refs as { id: string }[]).some(ref => ref.id === store.state.receipts[2].id));
  for (const [index, field] of [[8, 'amount'], [9, 'policy_cap'], [11, 'duplicate']] as const) assert.equal(workspaceRows(store.state)[index].decisions.find(d => d.field_checked === field)!.verdict, 'fail');
  const second = await core.correct({ submission_id: later.id, expected_review_revision: later.review_revision, human_verdict: 'approved', human_note: note, correction_type: 'decision_override', correction_payload_json: {} });
  await processFeedbackLearning(core, second.correction_id);
  assert.equal(store.state.procedures!.length, 1, 'Equivalent current tested check is reused.');
  assert.equal(store.state.procedure_tests!.length, 1);
  await core.reconcile([id]);
  assert.equal(publicLearning(store.state, store.state.corrections[0])!.status, 'active', 'Assessment revision alone does not disable an active learned rule.');
  await changeProcedure(core, procedure.id, 'disable', { expected_procedure_version: 2 }, new AbortController().signal);
  assert.equal(publicLearning(store.state, store.state.corrections[0])!.status, 'failed');
  assert.equal(publicLearning(store.state, store.state.corrections[1])!.status, 'failed', 'A reused rule cannot retain stale active status.');
});

test('exception, contrary and policy notes never generalize; missing or conflicting evidence does not create checks', async () => {
  for (const [reason, expected] of [
    [`${note} This is a one-time exception.`, 'not_applicable'],
    [`${note} Do not apply to future claims.`, 'not_applicable'],
    ['The booking does not match but approve anyway.', 'not_applicable'],
    ['Waive the policy cap for these hotels.', 'needs_confirmation'],
    ['Approved, looks good.', 'not_applicable'],
  ]) {
    const f = await fixture(reason);
    await processFeedbackLearning(f.core, f.correctionId);
    assert.equal(feedbackJob(f.store.state.corrections[0])?.status, expected, reason);
    assert.equal(f.store.state.procedures!.length, 0);
  }
  for (const index of [4, 5, 6]) {
    const f = await fixture(note, index);
    await processFeedbackLearning(f.core, f.correctionId);
    assert.equal(feedbackJob(f.store.state.corrections[0])?.status, 'not_applicable');
    assert.equal(f.store.state.procedures!.length, 0);
  }
});

test('stale evidence, repeated workers, expired leases, test failures and retry cannot publish an unsafe rule', async () => {
  const stale = await fixture();
  const claimed = await stale.store.feedbackLearning({ action: 'start', correction_id: stale.correctionId });
  stale.store.state.receipts[2].raw_extracted_text += '\nChanged evidence';
  await assert.rejects(stale.store.feedbackLearning({ action: 'propose', correction_id: stale.correctionId, lease: claimed.job!.lease!, mode: 'simulated' }), { code: 'STALE_FEEDBACK' });
  await stale.store.feedbackLearning({ action: 'expire' });
  assert.equal(feedbackJob(stale.store.state.corrections[0])?.status, 'failed');
  await assert.rejects(stale.store.feedbackLearning({ action: 'retry', correction_id: stale.correctionId, expected_review_revision: workspaceRows(stale.store.state)[2].review_revision }), { code: 'STALE_FEEDBACK' });
  const f = await fixture();
  f.core.intelligence = { ...intelligence, evaluate_procedure: async () => { throw new Error('offline test failed'); } };
  await processFeedbackLearning(f.core, f.correctionId);
  assert.equal(feedbackJob(f.store.state.corrections[0])?.status, 'failed');
  assert(f.store.state.procedures!.every(p => p.state === 'draft'));
  const oldLease = feedbackJob(f.store.state.corrections[0])!.lease!;
  await f.core.reconcile([f.id]); // A harmless assessment revision must not strand retry.
  await f.store.feedbackLearning({ action: 'retry', correction_id: f.correctionId, expected_review_revision: workspaceRows(f.store.state)[2].review_revision });
  await assert.rejects(f.store.feedbackLearning({ action: 'finish', correction_id: f.correctionId, lease: oldLease, status: 'active', summary: 'stale worker' }), { code: 'STALE_FEEDBACK' });
  f.core.intelligence = intelligence;
  await processFeedbackLearning(f.core, f.correctionId);
  assert.equal(feedbackJob(f.store.state.corrections[0])?.status, 'active');
  assert.equal(f.store.state.procedures!.filter(p => p.state === 'active').length, 1);
  const expired = await fixture();
  feedbackJob(expired.store.state.corrections[0])!.lease_expires_at = '2026-01-01T00:00:00Z';
  await expired.store.feedbackLearning({ action: 'expire' });
  assert.equal(feedbackJob(expired.store.state.corrections[0])!.status, 'failed');
});

test('live classifier uses bounded structured output and deterministic vetoes without actual providers', async () => {
  const f = await fixture();
  const candidate = deriveCandidate(f.store.state, f.id)!;
  const prior = { endpoint: process.env.AZURE_OPENAI_ENDPOINT, key: process.env.AZURE_OPENAI_API_KEY, deployment: process.env.AZURE_OPENAI_DEPLOYMENT };
  Object.assign(process.env, { AZURE_OPENAI_ENDPOINT: 'https://example.invalid', AZURE_OPENAI_API_KEY: 'offline-test', AZURE_OPENAI_DEPLOYMENT: 'offline-fast' });
  let calls = 0;
  f.core.demoMode = false;
  const transport: typeof fetch = async (_url, options) => {
    calls++;
    const input = JSON.parse(String(options!.body));
    assert.equal(input.text.format.strict, true);
    assert.equal(input.store, false);
    return Response.json({ status: 'completed', model: 'offline-fast', output: [{ content: [{ type: 'output_text', text: '{"intent":"booking_reference_identity"}' }] }] });
  };
  try {
    assert.equal(await classifyFeedback(f.core, note, candidate, new AbortController().signal, transport), 'booking_reference_identity');
    assert.equal(await classifyFeedback(f.core, `${note} Do not apply to future claims.`, candidate, new AbortController().signal, transport), 'one_time');
    assert.equal(calls, 1);
    await assert.rejects(classifyFeedback(f.core, note, candidate, new AbortController().signal, async () => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"intent":"approve_everything"}' }] }] })), { code: 'INVALID_PROVIDER_OUTPUT' });
  } finally {
    for (const [name, value] of [['AZURE_OPENAI_ENDPOINT', prior.endpoint], ['AZURE_OPENAI_API_KEY', prior.key], ['AZURE_OPENAI_DEPLOYMENT', prior.deployment]]) { if (value === undefined) delete process.env[name!]; else process.env[name!] = value; }
  }
});
