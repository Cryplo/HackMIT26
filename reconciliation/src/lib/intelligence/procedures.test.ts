import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { build_procedure_suite, evaluate_procedure } from './procedures';
import { createAssessProcedureExample } from '../core/evaluation';
import { validateProcedureReport } from '../core/procedures';
import { CoreService } from '../core/service';
import { MemoryStore } from '../core/store';
import { DatabaseRetrieval } from '../core/retrieval';
import { SimulatedJev } from '../core/jev';
import { demoSnapshot } from '../core/fixtures';
import { isUUID, normalize } from '../core/validation';
import type { ProcedureAttempt } from '../core/procedure-state';
import type { AssessProcedureExample, ProcedureEvaluationInput, ProcedureFacts, ResolutionProcedure } from '../review-contracts';

function candidate(): ResolutionProcedure {
  return {
    id: '40000000-0000-4000-8000-000000000001', version: 1, state: 'draft',
    source_claim_id: '10000000-0000-4000-8000-000000000003',
    source_run_id: '50000000-0000-4000-8000-000000000001',
    source_correction_id: '60000000-0000-4000-8000-000000000001',
    kind: 'booking_reference_identity', trigger_scope: {
      category: 'hotel', currency: 'USD', observed_vendor: 'SYN HBR 042', canonical_vendor: 'Synthetic Harbor Hotel',
    }, required_evidence: ['receipt', 'booking_confirmation'], matching_fields: ['booking_reference'],
    source_evidence_refs: [{ kind: 'receipt', id: '20000000-0000-4000-8000-000000000003' },
      { kind: 'supporting_document', id: '70000000-0000-4000-8000-000000000001' }],
    created_at: '2026-09-20T00:00:00.000Z', latest_test: null, latest_test_error: null,
  };
}

function setup() {
  const procedure = candidate(), examples = build_procedure_suite(procedure);
  const store = new MemoryStore(demoSnapshot());
  const core = new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), true);
  const observations: ProcedureAttempt['observations'] = [];
  const controller = new AbortController();
  const input: ProcedureEvaluationInput = {
    procedure, examples, active_aliases: [], active_procedures: [], knowledge_revision: 0,
    mode: 'simulated', signal: controller.signal, get_observations: () => structuredClone(observations),
  };
  const assess = createAssessProcedureExample(core, o => observations.push({
    ...o, case_id: examples.find(e => e.facts.submission.id === o.submission_id)?.id,
    phase: o.procedure_ids?.includes(procedure.id) ? 'after' : 'before',
  }));
  return { procedure, examples, store, core, observations, controller, input, assess };
}

function freeze(value: unknown) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const v of Object.values(value)) freeze(v); }
}

test('booking-reference-v1 freezes twelve independent facts, policy, original bytes and evaluator-only truth', () => {
  const p = candidate(); freeze(p);
  const suite = build_procedure_suite(p);
  assert.deepEqual(suite, build_procedure_suite(p));
  assert.deepEqual(suite.map(e => [e.id, e.expected_assessment]), [
    ['valid_a', 'matched'], ['valid_b', 'matched'], ['missing_booking', 'needs_review'],
    ['conflicting_reference', 'needs_review'], ['unrelated_descriptor', 'needs_review'], ['missing_traveler', 'needs_review'],
    ['overclaim', 'flagged'], ['over_cap', 'flagged'], ['non_usd', 'flagged'], ['out_of_policy_date', 'flagged'],
    ['exact_duplicate', 'flagged'], ['wrong_category', 'matched'],
  ]);
  const ids = suite.flatMap(e => [e.facts.submission.id, ...e.facts.related_claims.map(c => c.submission.id)]);
  assert.equal(new Set(ids).size, 13);
  assert.ok(ids.every(id => isUUID(id) && id[14] === '8' && id !== p.source_claim_id));
  for (const { facts: f } of suite) {
    assert.ok(!JSON.stringify(f).includes('expected_assessment'));
    assert.ok(!JSON.stringify(f).includes('valid_a'));
    assert.equal(f.receipt!.submission_id, f.submission.id);
    assert.equal(f.receipt!.sha256, createHash('sha256').update(f.receipt!.raw_extracted_text!).digest('hex'));
    assert.match(f.receipt!.raw_extracted_text!, /SYNTHETIC FIXTURE ONLY/);
    assert.ok(f.policies.some(policy => policy.category === f.submission.category));
    assert.ok(f.policies.every(policy => policy.claimant_identity_evidence === 'receipt_only'));
    for (const d of f.supporting_documents) {
      assert.equal(d.claim_id, f.submission.id);
      assert.equal(d.sha256, createHash('sha256').update(d.extracted_text!).digest('hex'));
      assert.equal(d.facts!.amount_minor, f.receipt!.parsed_fields_json!.amount_minor);
    }
  }
  const [a, b, missing, conflicting, unrelated, traveler, overclaim, cap, eur, date, duplicate, category] = suite.map(e => e.facts);
  assert.notEqual(a.submission.attendee_name, b.submission.attendee_name);
  assert.notEqual(a.submission.amount_requested_minor, b.submission.amount_requested_minor);
  assert.notEqual(a.receipt!.sha256, b.receipt!.sha256);
  assert.notEqual(a.supporting_documents[0].facts!.booking_reference, b.supporting_documents[0].facts!.booking_reference);
  assert.equal(missing.supporting_documents.length, 0);
  assert.match(conflicting.supporting_documents[0].facts!.booking_reference!, /-OTHER$/);
  assert.notEqual(normalize(unrelated.receipt!.parsed_fields_json!.vendor!), normalize(p.trigger_scope.observed_vendor));
  assert.deepEqual(traveler.receipt!.parsed_fields_json!.names, []);
  assert.deepEqual(traveler.supporting_documents[0].facts!.names, []);
  assert.equal(overclaim.submission.amount_requested_minor, overclaim.receipt!.parsed_fields_json!.amount_minor! + 1);
  assert.equal(cap.submission.amount_requested_minor, 25001);
  assert.equal(eur.receipt!.parsed_fields_json!.currency, 'EUR');
  assert.equal(date.receipt!.parsed_fields_json!.receipt_date, '2026-10-01');
  assert.equal(duplicate.receipt!.sha256, duplicate.related_claims[0].receipt!.sha256);
  assert.ok(duplicate.related_claims[0].submission.submitted_at < duplicate.submission.submitted_at);
  assert.deepEqual(duplicate.exact_duplicate_ids, [duplicate.related_claims[0].submission.id]);
  assert.equal(category.submission.category, 'flight');
  assert.equal(category.receipt!.parsed_fields_json!.vendor, 'Synthetic Sky Airlines');
});

test('real assessor proves application, preserves financial failures, pairs identical facts and leaves state untouched', async () => {
  const f = setup(), state = await f.store.snapshot();
  freeze(f.examples); freeze(f.procedure); freeze(f.input.active_aliases);
  let running = 0, peak = 0;
  const phases = new Map<ProcedureFacts, string[]>();
  const report = await evaluate_procedure(f.input, async (facts, aliases, procedures, signal) => {
    assert.ok(f.examples.some(e => e.facts === facts));
    assert.equal(aliases, f.input.active_aliases);
    assert.equal(signal, f.input.signal);
    const phase = procedures.some(p => p.id === f.procedure.id) ? 'after' : 'before';
    phases.set(facts, [...(phases.get(facts) ?? []), phase]);
    running++; peak = Math.max(peak, running);
    try { await delay(1); return await f.assess(facts, aliases, procedures, signal); }
    finally { running--; }
  });
  assert.equal(peak, 3); assert.equal(running, 0);
  assert.ok([...phases.values()].every(order => order.join(',') === 'before,after'));
  assert.equal(f.observations.length, 24);
  assert.deepEqual(report.before, { total: 12, correct: 12, false_matches: 0, needs_review: 4 });
  assert.deepEqual(report.after, { total: 12, correct: 12, false_matches: 0, needs_review: 4 });
  assert.equal(report.passed, true);
  assert.deepEqual(report.regressed_case_ids, []);
  assert.ok(['valid_a', 'valid_b'].every(id => report.applied_case_ids.includes(id)));
  assert.ok(!report.applied_case_ids.includes('wrong_category'));
  validateProcedureReport(report, f.procedure, 0, 'simulated', f.examples, f.observations);
  const expectedFailures = { overclaim: 'amount', over_cap: 'policy_cap', non_usd: 'currency', out_of_policy_date: 'receipt_date', exact_duplicate: 'duplicate' };
  for (const [id, field] of Object.entries(expectedFailures)) {
    for (const phase of ['before', 'after']) assert.ok(f.observations.find(o => o.case_id === id && o.phase === phase)!.checks.some(c => c.field_checked === field && c.verdict === 'fail'));
  }
  assert.deepEqual(await f.store.snapshot(), state);
  assert.equal(f.store.calls.length, 0);
});

test('correctness ties pass with genuine check evidence from a different positive purchase', async () => {
  const f = setup();
  f.input.active_procedures = [{ ...candidate(), id: '40000000-0000-4000-8000-000000000002', state: 'active' }];
  const report = await evaluate_procedure(f.input, f.assess);
  assert.equal(report.passed, true);
  assert.equal(report.before.correct, 12);
  assert.deepEqual(report.before, report.after);
  assert.ok(report.applied_case_ids.includes('valid_b'));
  validateProcedureReport(report, f.procedure, 0, 'simulated', f.examples, f.observations);
});

test('actual application requires nonempty exact references and consistent descriptor, canonical identity and names', async () => {
  const f = setup(), active = { ...f.procedure, state: 'active' as const };
  const changes: ((facts: ProcedureFacts) => void)[] = [
    facts => { facts.supporting_documents = []; },
    facts => { facts.supporting_documents[0].facts!.booking_reference = ''; },
    facts => { facts.supporting_documents[0].facts!.booking_reference = ''; facts.receipt!.raw_extracted_text = 'Booking reference: '; },
    facts => { facts.supporting_documents[0].facts!.booking_reference = facts.supporting_documents[0].facts!.booking_reference!.replace(' / ', ' - '); },
    facts => { facts.supporting_documents[0].facts!.vendor = 'Another Hotel'; },
    facts => { facts.supporting_documents[0].facts!.names = ['Another Traveler']; },
    facts => { facts.receipt!.parsed_fields_json!.vendor += ' Annex'; },
  ];
  for (const [index, change] of changes.entries()) {
    const facts = structuredClone(f.examples[0].facts); change(facts);
    assert.equal(await f.assess(facts, [], [active], f.input.signal), index === changes.length - 1 ? 'matched' : 'needs_review');
    assert.ok(!f.observations.at(-1)!.checks.some(c => c.evidence_json.exact_method === 'booking_reference_identity'));
  }
  const absentName = structuredClone(f.examples[0].facts);
  absentName.receipt!.parsed_fields_json!.names = [];
  assert.equal(await f.assess(absentName, [], [active], f.input.signal), 'needs_review');
  const conflictingName = structuredClone(f.examples[0].facts);
  conflictingName.receipt!.parsed_fields_json!.names = ['Another Traveler'];
  assert.equal(await f.assess(conflictingName, [], [active], f.input.signal), 'flagged');
});

test('malformed scope, source leakage, duplicate identities and altered suites reject before scoring', async () => {
  const changes: ((p: ResolutionProcedure) => void)[] = [
    p => { p.id = 'bad'; }, p => { p.source_run_id = ''; }, p => { p.version = 0; },
    p => { p.trigger_scope.observed_vendor = ' '; }, p => { p.trigger_scope.canonical_vendor = ''; },
    p => { Object.assign(p.trigger_scope, { category: 'flight' }); },
    p => { Object.assign(p.trigger_scope, { currency: 'EUR' }); },
    p => { Object.assign(p.trigger_scope, { region: '*' }); },
    p => { p.required_evidence = ['receipt'] as never; }, p => { p.matching_fields = [] as never; },
    p => { p.source_evidence_refs = []; }, p => { p.source_evidence_refs[1] = p.source_evidence_refs[0]; },
  ];
  for (const change of changes) { const p = candidate(); change(p); assert.throws(() => build_procedure_suite(p)); }
  for (const kind of ['claim', 'receipt', 'booking'] as const) {
    const p = candidate(), facts = build_procedure_suite(p)[0].facts;
    if (kind === 'claim') p.source_claim_id = facts.submission.id.toUpperCase();
    else p.source_evidence_refs[kind === 'receipt' ? 0 : 1].id = kind === 'receipt' ? facts.receipt!.id : facts.supporting_documents[0].id;
    assert.throws(() => build_procedure_suite(p), /exclude all source evidence/);
  }
  const mutations: ((input: ProcedureEvaluationInput) => void)[] = [
    input => { input.examples.pop(); }, input => { input.examples.reverse(); },
    input => { input.examples[0].expected_assessment = 'needs_review'; },
    input => { input.examples[1].facts.submission.id = input.examples[0].facts.submission.id; },
    input => { input.examples[0].facts.supporting_documents = []; },
    input => { input.procedure.state = 'active'; }, input => { input.knowledge_revision = -1; },
    input => { input.active_procedures = [{ ...input.procedure, state: 'active' }]; },
    input => { input.active_procedures = [{ ...input.procedure, id: '40000000-0000-4000-8000-000000000002' }]; },
    input => { input.active_aliases = [{ id: input.procedure.id, source_correction_id: input.procedure.source_correction_id, payload: { observed_vendor: 'SYN', canonical_vendor: 'Hotel', scope: { category: 'hotel', currency: 'USD' } } }]; },
    input => { input.get_observations = undefined; },
  ];
  for (const change of mutations) {
    const f = setup(); change(f.input);
    await assert.rejects(evaluate_procedure(f.input, f.assess));
    assert.equal(f.observations.length, 0);
  }
});

test('a blanket alias produces real unsafe matches and cannot obtain passing procedure proof', async () => {
  const f = setup();
  f.input.active_aliases = [{
    id: '80000000-0000-4000-8000-000000000001', source_correction_id: '60000000-0000-4000-8000-000000000002',
    payload: { observed_vendor: f.procedure.trigger_scope.observed_vendor, canonical_vendor: 'Synthetic Harbor Hotel', scope: { category: 'hotel', currency: 'USD' } },
  }];
  const report = await evaluate_procedure(f.input, f.assess);
  assert.equal(report.passed, false);
  assert.equal(report.after.false_matches, 2);
  assert.ok(report.reasons.some(r => r.includes('unsafe matches')));
  validateProcedureReport(report, f.procedure, 0, 'simulated', f.examples, f.observations);
});

test('incomplete, duplicate, foreign, mismatched and provider-error observations never produce a report', async () => {
  const mutations: ((rows: ProcedureAttempt['observations']) => void)[] = [
    rows => { rows.pop(); }, rows => { rows.push(rows[0]); },
    rows => { rows[0].case_id = 'foreign'; }, rows => { rows[0].phase = 'after'; },
    rows => { rows[0].submission_id = candidate().source_claim_id; }, rows => { rows[0].assessment = null; },
    rows => { rows[0].assessment = 'flagged'; }, rows => { rows[0].error_code = 'JEV_UNAVAILABLE'; },
    rows => { rows[0].checks = []; }, rows => { rows[0].procedure_ids = [candidate().id]; },
    rows => { rows[0].checks.find(c => c.check_method === 'jev')!.evidence_json.simulated = false; },
  ];
  for (const change of mutations) {
    const f = setup();
    f.input.get_observations = () => { const rows = structuredClone(f.observations); if (rows.length) change(rows); return rows; };
    await assert.rejects(evaluate_procedure(f.input, f.assess), { code: 'INVALID_PROCEDURE_TEST' });
    assert.equal(f.observations.length, 24);
  }
});

test('scorer input IDs alone and foreign supporting references are insufficient application proof', async () => {
  for (const foreign of [false, true]) {
    const f = setup();
    f.input.get_observations = () => structuredClone(f.observations).map(o => ({ ...o, checks: o.checks.map(c => {
      if (foreign) c.evidence_json.evidence_refs = [{ kind: 'supporting_document', id: candidate().source_evidence_refs[1].id }];
      else delete c.evidence_json.exact_method;
      return c;
    }) }));
    const report = await evaluate_procedure(f.input, f.assess);
    assert.equal(report.passed, false);
    assert.deepEqual(report.applied_case_ids, []);
  }
});

test('protected pass or fail loss blocks a correctness tie', async () => {
  for (const caseId of ['valid_a', 'overclaim']) {
    const f = setup();
    f.input.get_observations = () => structuredClone(f.observations).map(o => o.phase === 'after' && o.case_id === caseId ?
      { ...o, checks: o.checks.filter(c => c.field_checked !== 'amount') } : o);
    const report = await evaluate_procedure(f.input, f.assess);
    assert.equal(report.passed, false);
    assert.ok(report.reasons.some(r => r.includes('protected check')));
  }
});

test('provider failure stops scheduling and awaits every started real assessment observation', async () => {
  const f = setup(), expected = new Error('Provider unavailable');
  let started = 0, completed = 0;
  const jev = new SimulatedJev();
  const core = new CoreService(f.store, new DatabaseRetrieval(), { async evaluate(state, run, log, signal) {
    const index = started++;
    try { await delay(index === 0 ? 1 : 15); if (index === 0) throw expected; return await jev.evaluate(state, run, log, signal); }
    finally { completed++; }
  } }, true);
  const assess = createAssessProcedureExample(core, o => f.observations.push(o));
  await assert.rejects(evaluate_procedure(f.input, assess), error => error === expected);
  assert.equal(started, 3); assert.equal(completed, 3); assert.equal(f.observations.length, 3);
  assert.equal(f.observations.filter(o => o.error_code).length, 1);
});

test('cancellation is propagated and awaits started work without launching further phases', async () => {
  const f = setup(); let calls = 0, finished = 0;
  const assess: AssessProcedureExample = async (facts, aliases, procedures, signal) => {
    calls++;
    try { await delay(5); return await f.assess(facts, aliases, procedures, signal); }
    finally { finished++; }
  };
  f.controller.abort();
  await assert.rejects(evaluate_procedure(f.input, assess), { name: 'AbortError' });
  assert.equal(calls, 0);
  const active = setup();
  const work = evaluate_procedure(active.input, async (...args) => {
    calls++;
    try { await delay(10); return await active.assess(...args); }
    finally { finished++; }
  });
  active.controller.abort();
  await assert.rejects(work, { name: 'AbortError' });
  assert.equal(calls, 3); assert.equal(finished, 3); assert.equal(active.observations.length, 3);
  assert.ok(active.observations.every(o => o.error_code === 'ABORTED'));
});
