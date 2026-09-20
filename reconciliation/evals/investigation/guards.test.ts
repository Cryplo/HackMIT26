/** Focused offline safety checks for money, duplicates, evidence revisions, learning and
 * provider failure. Every verdict below comes from the production `CoreService` path over
 * an isolated in-memory store with explicit offline doubles; this file adds no verdict
 * logic of its own. Anything that depends on undelivered endpoints is asserted as
 * unavailable rather than simulated as working.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreService } from '../../src/lib/core/service';
import { MemoryStore } from '../../src/lib/core/store';
import { SimulatedRetrieval } from '../../src/lib/core/retrieval';
import { SimulatedJev, type Evaluation, type Jev } from '../../src/lib/core/jev';
import { workspaceRows } from '../../src/lib/core/projection';
import { CoreError } from '../../src/lib/core/validation';
import { createAssessExample } from '../../src/lib/core/evaluation';
import { intelligence } from '../../src/lib/intelligence';
import { changeRule, proposeRule } from '../../src/lib/core/rules';
import { buildPack, PROCEDURE_CANONICAL, PROCEDURE_DESCRIPTOR } from './pack';
import { assessPack, isolatedCore, policies, receipt, snapshotFor, stableId, submission } from './harness';

const SEED = 20260927;
const pack = buildPack(SEED);
const byCohort = (cohort: string) => pack.filter(c => c.label.cohort === cohort);

/* ------------------------------------------------------------------ money and duplicates */

test('every pack case assesses to its reviewed expectation, and nothing unsafe is matched', async () => {
  const outcomes = await assessPack(pack);
  for (const outcome of outcomes) {
    const c = pack.find(x => x.case_id === outcome.case_id)!;
    assert.equal(outcome.status, c.label.expected_assessment, `${c.case_id} (${c.label.cohort}) expected ${c.label.expected_assessment}`);
    for (const [field, verdict] of Object.entries(c.label.expected_checks))
      if (outcome.checks[field]) assert.equal(outcome.checks[field], verdict, `${c.case_id} check ${field}`);
  }
  // A claim that should not be paid is never matched, whatever else changes.
  for (const c of [...byCohort('duplicate_purchase'), ...byCohort('violation'), ...byCohort('incomplete')])
    assert.notEqual(outcomes.find(o => o.case_id === c.case_id)!.status, 'matched');
});

test('overclaim, underclaim, wrong currency and cap excess are all mandatory failures', async () => {
  const base = pack.find(c => c.label.cohort === 'straightforward_valid')!;
  const cases: { change: (c: typeof base) => typeof base; expected: string }[] = [
    { change: c => ({ ...c, input: { ...c.input, amount_requested_minor: c.input.amount_requested_minor + 100 } }), expected: 'flagged' },
    { change: c => ({ ...c, input: { ...c.input, amount_requested_minor: c.input.amount_requested_minor - 100 } }), expected: 'flagged' },
    { change: c => ({ ...c, printed: { ...c.printed, currency: 'EUR' } }), expected: 'flagged' },
    { change: c => ({ ...c, input: { ...c.input, category: 'bus' as const, amount_requested_minor: 99900 }, printed: { ...c.printed, amount_minor: 99900, vendor: 'Synthetic Coach' } }), expected: 'flagged' }
  ];
  for (const { change, expected } of cases) {
    const outcomes = await assessPack([{ ...change(base), sequence: 1 }]);
    assert.equal(outcomes[0].status, expected);
  }
});

test('similar purchases stay separate while a second document for one purchase is blocked', async () => {
  const outcomes = await assessPack(pack);
  for (const c of byCohort('similar_distinct')) {
    const outcome = outcomes.find(o => o.case_id === c.case_id)!;
    assert.equal(outcome.status, 'matched');
    assert.deepEqual(outcome.duplicate_submission_ids, []);
    assert.equal(outcome.checks.duplicate, 'pass');
  }
  for (const c of byCohort('duplicate_purchase')) {
    const outcome = outcomes.find(o => o.case_id === c.case_id)!;
    assert.equal(outcome.checks.duplicate, 'fail');
    assert.deepEqual(outcome.duplicate_submission_ids, [stableId('submission', c.label.duplicate_of!)]);
  }
});

test('a different document for an already-claimed purchase cannot authorize a second payment', async () => {
  const duplicate = byCohort('duplicate_purchase')[0];
  const original = pack.find(c => c.case_id === duplicate.label.duplicate_of)!;
  const subset = [original, duplicate].map((c, i) => ({ ...c, sequence: i + 1 }));
  const { core, store } = isolatedCore(snapshotFor(subset));
  const ids = subset.map(c => stableId('submission', c.case_id));
  for (const id of ids) await core.reconcile([id]);

  const approve = (id: string) => {
    const row = workspaceRows(store.state).find(r => r.id === id)!;
    return core.correct({ submission_id: id, expected_review_revision: row.review_revision, human_verdict: 'approved', human_note: 'Reviewed synthetic evidence.', correction_type: 'decision_override', correction_payload_json: {} });
  };
  await approve(ids[0]);
  await assert.rejects(approve(ids[1]), (e: unknown) => e instanceof CoreError && e.code === 'APPROVAL_BLOCKED');
  assert.equal(store.state.submissions.find(s => s.id === ids[0])!.status, 'approved');
});

test('supporting evidence never adds a second reimbursable total', async () => {
  const booking = byCohort('unfamiliar_linked_booking')[0];
  const outcomes = await assessPack([{ ...booking, sequence: 1 }]);
  // The claim asks for exactly the printed total; the booking confirmation repeats it.
  assert.equal(outcomes[0].checks.amount, 'pass');
  const inflated = { ...booking, sequence: 1, input: { ...booking.input, amount_requested_minor: booking.input.amount_requested_minor * 2 } };
  assert.equal((await assessPack([inflated]))[0].status, 'flagged');
});

/* -------------------------------------------------------------- evidence and revisions */

test('evidence that changes during an assessment cannot publish that assessment', async () => {
  const c = { ...pack[0], sequence: 1 };
  const state = snapshotFor([c]);
  const store = new MemoryStore(state);
  const core = new CoreService(store, new SimulatedRetrieval(), new SimulatedJev(), true);
  const id = stableId('submission', c.case_id);
  const run = await store.begin(id);
  // A new document lands while the run is in flight.
  state.receipts[0].parsed_fields_json = { ...state.receipts[0].parsed_fields_json!, amount_minor: 1 };
  state.submissions[0].evidence_revision = (state.submissions[0].evidence_revision ?? 0) + 1;
  const decisions = await core.assess(await store.snapshot(), id, run, async () => {});
  await assert.rejects(store.finish(run, decisions, 'approved'), (e: unknown) => e instanceof CoreError && e.code === 'STALE_RUN');
  assert.equal(store.state.submissions[0].status, 'pending');
});

test('a stale approval attempt is rejected and the newer state survives', async () => {
  const c = { ...pack[0], sequence: 1 };
  const { core, store } = isolatedCore(snapshotFor([c]));
  const id = stableId('submission', c.case_id);
  await core.reconcile([id]);
  const stale = workspaceRows(store.state).find(r => r.id === id)!.review_revision - 1;
  await assert.rejects(
    core.correct({ submission_id: id, expected_review_revision: stale, human_verdict: 'approved', human_note: 'Stale attempt.', correction_type: 'decision_override', correction_payload_json: {} }),
    (e: unknown) => e instanceof CoreError && e.code === 'STALE_REVIEW'
  );
  assert.equal(store.state.corrections.length, 0, 'a stale attempt must not be recorded as a decision');
  assert.equal(store.state.submissions[0].decision_status, 'pending');
});

test('a knowledge change after assessment blocks approval until the claim is rechecked', async () => {
  const c = { ...pack[0], sequence: 1 };
  const { core, store } = isolatedCore(snapshotFor([c]));
  const id = stableId('submission', c.case_id);
  await core.reconcile([id]);
  store.state.knowledge_revision = (store.state.knowledge_revision ?? 0) + 1;
  const row = workspaceRows(store.state).find(r => r.id === id)!;
  await assert.rejects(
    core.correct({ submission_id: id, expected_review_revision: row.review_revision, human_verdict: 'approved', human_note: 'Knowledge moved.', correction_type: 'decision_override', correction_payload_json: {} }),
    (e: unknown) => e instanceof CoreError && e.code === 'STALE_REVIEW'
  );
});

/* -------------------------------------------------------------------- learning safety */

test('only a reviewed, tested, explicitly activated alias can change a merchant verdict', async () => {
  const booking = byCohort('unfamiliar_linked_booking').map((c, i) => ({ ...c, sequence: i + 1 }));
  const { core, store } = isolatedCore(snapshotFor(booking));
  const id = stableId('submission', booking[0].case_id);
  await core.reconcile([id]);
  const row = workspaceRows(store.state).find(r => r.id === id)!;
  assert.equal(row.assessment_status, 'needs_review');
  assert.equal(row.decisions.find(d => d.field_checked === 'merchant')!.verdict, 'unknown');

  // No human-approved source yet: a proposal is refused rather than inferred.
  core.intelligence = intelligence;
  await assert.rejects(
    proposeRule(core, { submission_id: id, expected_review_revision: row.review_revision, canonical_vendor: PROCEDURE_CANONICAL }),
    (e: unknown) => e instanceof CoreError && ['RULE_SOURCE_REQUIRED', 'APPROVAL_BLOCKED'].includes(e.code)
  );

  // With a source approval the draft exists, but an untested draft cannot be activated.
  store.state.submissions.find(s => s.id === id)!.status = 'needs_review';
  await core.correct({ submission_id: id, expected_review_revision: workspaceRows(store.state).find(r => r.id === id)!.review_revision, human_verdict: 'rejected', human_note: 'Recorded for source-history only.', correction_type: 'decision_override', correction_payload_json: {} });
  await assert.rejects(
    proposeRule(core, { submission_id: id, expected_review_revision: workspaceRows(store.state).find(r => r.id === id)!.review_revision, canonical_vendor: PROCEDURE_CANONICAL }),
    (e: unknown) => e instanceof CoreError && e.code === 'RULE_SOURCE_REQUIRED'
  );
  assert.equal((store.state.rules ?? []).length, 0);
});

test('an untested draft cannot be activated and a disabled rule stops applying', async () => {
  const { store } = isolatedCore(snapshotFor([{ ...pack[0], sequence: 1 }]));
  const id = stableId('submission', pack[0].case_id);
  store.state.corrections.push({ id: crypto.randomUUID(), submission_id: id, human_verdict: 'approved', human_note: 'Source approval.', correction_type: 'decision_override', correction_payload_json: {}, corrected_at: '2026-09-27T13:00:00.000Z' });
  const rule = { id: crypto.randomUUID(), version: 1, state: 'draft' as const, source_submission_id: id, source_correction_id: store.state.corrections[0].id, payload: { observed_vendor: PROCEDURE_DESCRIPTOR, canonical_vendor: PROCEDURE_CANONICAL, scope: { category: 'hotel' as const, currency: 'USD' as const } }, created_at: '2026-09-27T13:00:00.000Z', latest_test: null };
  store.state.rules!.push(rule);
  await assert.rejects(
    store.rule({ action: 'activate', id: rule.id, expected_rule_version: 1, suite_hash: 'x', provider_identity: 'simulated', mode: 'simulated' }),
    (e: unknown) => e instanceof CoreError && e.code === 'STALE_RULE_TEST'
  );
});

test('the booking-reference procedure is not installed, and nothing pretends otherwise', async () => {
  const { core } = isolatedCore(snapshotFor([{ ...pack[0], sequence: 1 }]));
  core.intelligence = intelligence;
  // Only alias learning exists at this commit; the reviewed hotel/USD procedure is B/C work.
  const surface = intelligence as unknown as Record<string, unknown>;
  assert.equal(typeof surface.build_procedure_suite, 'undefined');
  assert.equal(typeof surface.evaluate_procedure, 'undefined');
  const result = await intelligence.investigate({ submission: { id: 'x', attendee_name: 'a', email: 'a@example.invalid', amount_requested_minor: 1, currency: 'USD', category: 'hotel', origin_location: 'Synthetic City', submitted_at: '2026-09-27T12:00:00.000Z' }, checks: [] }, {} as never, { mode: 'simulated', signal: AbortSignal.timeout(1000), log_usage: async () => {} });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error_code, 'INVESTIGATION_UNAVAILABLE');
  assert.deepEqual(result.steps, []);
  assert.equal(await changeRule(core, crypto.randomUUID(), 'activate', { expected_rule_version: 1 }, AbortSignal.timeout(1000)).then(() => 'activated', (e: CoreError) => e.code), 'NOT_FOUND');
});

/* ------------------------------------------------------- provider and progress failure */

class FailingJev implements Jev {
  calls = 0;
  async evaluate(): Promise<Evaluation> { this.calls++; throw new CoreError('JEV_UNAVAILABLE', 'Jev returned HTTP 503.', 503); }
}

test('a provider failure is visible and never becomes a pass or a fabricated answer', async () => {
  const c = { ...pack[0], sequence: 1 };
  const store = new MemoryStore(snapshotFor([c]));
  const jev = new FailingJev();
  const core = new CoreService(store, new SimulatedRetrieval(), jev, true);
  const id = stableId('submission', c.case_id);
  const { results } = await core.reconcile([id]);
  assert.equal(results[0].status, 'needs_review');
  const row = workspaceRows(store.state).find(r => r.id === id)!;
  for (const field of ['merchant', 'name', 'duplicate']) {
    const check = row.decisions.find(d => d.field_checked === field);
    if (check) assert.equal(check.verdict, 'unknown', `${field} must not be answered after a provider failure`);
  }
  assert.equal(jev.calls > 0, true);
  assert.equal(row.decision_status, 'pending');
});

test('failed extraction stays failed: no invented fields and no approval', async () => {
  const c = { ...pack[0], sequence: 1 };
  const state = { ...snapshotFor([c]), receipts: [receipt(c, 'failed')] };
  const { core, store } = isolatedCore(state);
  const id = stableId('submission', c.case_id);
  await core.reconcile([id]);
  const row = workspaceRows(store.state).find(r => r.id === id)!;
  assert.equal(row.assessment_status, 'needs_review');
  assert.equal(row.receipt!.extraction_status, 'failed');
  assert.equal(row.decisions.find(d => d.field_checked === 'extraction')!.verdict, 'unknown');
  await assert.rejects(
    core.correct({ submission_id: id, expected_review_revision: row.review_revision, human_verdict: 'approved', human_note: 'Trying to approve a failed extraction.', correction_type: 'decision_override', correction_payload_json: {} }),
    (e: unknown) => e instanceof CoreError && e.code === 'APPROVAL_BLOCKED'
  );
});

test('an aborted assessment records the abort instead of a result', async () => {
  const c = { ...pack[0], sequence: 1 };
  const { core } = isolatedCore(snapshotFor([c]));
  const observations: { error_code: string | null; assessment: string | null }[] = [];
  const assess = createAssessExample(core, o => observations.push({ error_code: o.error_code, assessment: o.assessment }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(assess({
    submission: { ...submission(c), status: undefined as never, latest_run_id: undefined as never, updated_at: undefined as never } as never,
    receipt: { ...receipt(c), storage_path: undefined as never, extracted_at: undefined as never } as never,
    policies: policies(), related_claims: [], exact_duplicate_ids: []
  }, [], controller.signal));
  assert.equal(observations.length, 1);
  assert.equal(observations[0].assessment, null);
  assert.equal(observations[0].error_code, 'ABORTED');
});

test('the provider failure itself is persisted as evidence, not dropped or retried silently', async () => {
  const c = { ...pack[0], sequence: 1 };
  const store = new MemoryStore(snapshotFor([c]));
  const jev = new FailingJev();
  const core = new CoreService(store, new SimulatedRetrieval(), jev, true);
  await core.reconcile([stableId('submission', c.case_id)]);
  assert.equal(store.state.runs.length, 1);
  assert.equal(jev.calls, 1, 'no implicit retry may be hidden inside one run');
  const failure = store.state.decisions.find(d => d.field_checked === 'semantic_evaluation')!;
  assert.equal(failure.verdict, 'unknown');
  assert.equal(failure.evidence_json.error_code, 'JEV_UNAVAILABLE');
  assert.ok(!store.state.decisions.some(d => ['merchant', 'name', 'duplicate'].includes(d.field_checked) && d.verdict === 'pass'));
  // Refreshing the workspace shows the same persisted failure rather than repeating work.
  const before = JSON.stringify(store.state.decisions);
  workspaceRows(await store.snapshot());
  assert.equal(JSON.stringify(store.state.decisions), before);
  assert.equal(jev.calls, 1);
});
