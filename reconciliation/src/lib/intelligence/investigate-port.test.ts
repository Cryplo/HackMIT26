import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { InvestigationInput, InvestigationTools, ProviderOptions, SupportingDocument, UsageRecord } from '../review-contracts';
import { deriveCandidate } from '../core/evidence';
import { CoreService } from '../core/service';
import { MemoryStore } from '../core/store';
import { DatabaseRetrieval } from '../core/retrieval';
import { SimulatedJev } from '../core/jev';
import { investigateClaim } from '../core/investigations';
import { investigationConfig } from '../core/investigation-config';
import { workspaceRows } from '../core/projection';
import { changeProcedure, proposeProcedure } from '../core/procedures';
import { evidenceState } from '../core/tests/investigation-fixtures';
import { intelligence } from './index';
import { investigate } from './investigate-port';

function setup(mode: ProviderOptions['mode'] = 'simulated') {
  const state = evidenceState(), reads: string[] = [], usage: UsageRecord[] = [];
  const { storage_path: _receiptPath, extracted_at: _extractedAt, ...r } = state.receipts[0];
  const receipt = { ...r, sha256: r.sha256 ?? null };
  const documents: SupportingDocument[] = state.supporting_documents.map(({ storage_path: _path, ...d }) => d);
  const input: InvestigationInput = { submission: state.submissions[0], checks: [] };
  const controller = new AbortController();
  const options: ProviderOptions = { mode, signal: controller.signal, log_usage: async call => { usage.push(call); } };
  const tools: InvestigationTools = {
    async read_receipt(...args) { assert.equal(args.length, 0); reads.push('read_receipt'); return receipt; },
    async read_supporting_documents(...args) { assert.equal(args.length, 0); reads.push('read_supporting_documents'); return documents; },
    async read_policy(...args) { assert.equal(args.length, 0); reads.push('read_policy'); return state.policies; },
    async find_related_claims() { assert.fail('Unrequested related-claim read'); },
    async read_active_aliases() { assert.fail('Unrequested alias read'); },
  };
  return { state, receipt, documents, input, options, controller, tools, reads, usage };
}

function configureAzure(t: TestContext) {
  const env = { AZURE_OPENAI_ENDPOINT: 'https://offline.openai.azure.com', AZURE_OPENAI_API_KEY: 'offline-test-key', AZURE_OPENAI_DEPLOYMENT: 'offline-deployment' };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
const calls = (...names: string[]) => Response.json({ status: 'completed', model: 'mock-planner', output: names.map((name, i) => ({ type: 'function_call', name, call_id: `call-${i}`, arguments: '{}' })) });
const complete = (value: unknown) => Response.json({ status: 'completed', model: 'mock-planner', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

test('public live adapter uses Azure configuration and bound reads, retaining shared result types and actual usage', async t => {
  configureAzure(t);
  const h = setup('live'), requests: Record<string, unknown>[] = [];
  const candidate = deriveCandidate(h.state, h.input.submission.id)!;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, 'https://offline.openai.azure.com/openai/v1/responses');
    assert.equal(new Headers(init?.headers).get('api-key'), 'offline-test-key');
    assert.ok(init?.signal instanceof AbortSignal);
    requests.push(JSON.parse(String(init.body)));
    if (requests.length === 1) return calls('read_receipt', 'read_supporting_documents', 'read_policy');
    return complete({ summary: 'Stored receipt and booking evidence share a reference.', next_action: 'human_review', findings: [{ check: 'merchant', statement: 'Matching booking reference observed.', evidence_refs: candidate.source_evidence_refs }], unresolved_question: null, proposed_learning: candidate });
  });
  assert.equal(intelligence.investigate, investigate);
  const result = await intelligence.investigate(h.input, h.tools, h.options);
  assert.equal(result.status, 'completed'); assert.equal(result.mode, 'live'); assert.equal(result.model, 'mock-planner');
  assert.deepEqual(result.proposed_learning, candidate);
  assert.deepEqual(result.steps.map(s => s.tool), h.reads);
  assert.deepEqual(h.reads, ['read_receipt', 'read_supporting_documents', 'read_policy']);
  assert.equal(requests.length, 2); assert.equal(h.usage.length, 2);
  assert.equal(h.usage[0].input_tokens, null); assert.equal(h.usage[0].estimated_cost_usd, null);
  const history = requests[1].input as { type: string; call_id: string; output: string }[];
  assert.deepEqual(history.filter(x => x.type === 'function_call_output').map(x => x.call_id), ['call-0', 'call-1', 'call-2']);
  assert.equal(JSON.parse(history.find(x => x.type === 'function_call_output' && x.call_id === 'call-1')!.output)[0].id, h.documents[0].id);
  assert.ok(!('assessment_status' in result)); assert.ok(!('outcome' in result));
});

test('pre-aborted live and simulated calls do not read, configure a provider, or log fictional usage', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected HTTP'));
  for (const mode of ['live', 'simulated'] as const) {
    const h = setup(mode); h.controller.abort();
    await assert.rejects(investigate(h.input, h.tools, h.options), { name: 'AbortError' });
    assert.deepEqual(h.reads, []); assert.deepEqual(h.usage, []);
  }
});

test('live provider errors, malformed output and failed bound tools reject without simulation fallback or retry', async t => {
  configureAzure(t);
  for (const scenario of ['provider', 'output', 'tool'] as const) {
    const h = setup('live'); let requests = 0;
    const mock = t.mock.method(globalThis, 'fetch', async () => {
      requests++;
      return scenario === 'provider' ? new Response('', { status: 503 }) : scenario === 'output' ? complete({ assessment_status: 'matched' }) : calls('read_receipt');
    });
    if (scenario === 'tool') h.tools.read_receipt = async () => { throw new Error('Stored read failed'); };
    await assert.rejects(investigate(h.input, h.tools, h.options), scenario === 'tool' ? /Stored read failed/ : { code: scenario === 'provider' ? 'PROVIDER_UNAVAILABLE' : 'INVALID_PROVIDER_OUTPUT' });
    assert.equal(requests, 1); assert.equal(h.usage.length, 1); assert.deepEqual(h.reads, []);
    mock.mock.restore();
  }
});

test('outer cancellation reaches actual transport and signal-bound no-argument tools and stops further reads', async t => {
  configureAzure(t);
  for (const phase of ['transport', 'tool'] as const) {
    const h = setup('live'); let requests = 0, pending = 0;
    const wait = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      pending++;
      signal.addEventListener('abort', () => { pending--; reject(signal.reason); }, { once: true });
      h.controller.abort();
    });
    const mock = t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      requests++;
      return phase === 'transport' ? wait(init!.signal!) : calls('read_receipt', 'read_supporting_documents');
    });
    if (phase === 'tool') h.tools.read_receipt = () => wait(h.options.signal);
    await assert.rejects(investigate(h.input, h.tools, h.options), { name: 'AbortError' });
    assert.equal(pending, 0); assert.equal(requests, 1); assert.equal(h.usage.length, 1); assert.deepEqual(h.reads, []);
    mock.mock.restore();
  }
});

test('explicit simulation derives findings from actual facts, records only executed reads, and makes no model calls', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Simulation must remain offline'));
  for (const scenario of ['supported', 'conflict', 'missing'] as const) {
    const h = setup();
    if (scenario === 'conflict') { h.documents[0].facts!.booking_reference = 'DIFFERENT-REFERENCE'; h.documents[0].extracted_text = h.documents[0].extracted_text!.replaceAll('TRIP-01', 'DIFFERENT-REFERENCE'); }
    if (scenario === 'missing') h.documents.length = 0;
    const result = await investigate(h.input, h.tools, h.options);
    assert.equal(result.status, 'completed'); assert.equal(result.mode, 'simulated'); assert.equal(result.model, null);
    assert.match(result.summary, /Simulated/); assert.deepEqual(h.usage, []);
    assert.deepEqual(result.steps.map(s => s.tool), h.reads); assert.equal(h.reads.length, 3);
    assert.equal(!!result.proposed_learning, scenario === 'supported');
    assert.equal(result.unresolved_question === null, scenario === 'supported');
    assert.equal(result.next_action, scenario === 'missing' ? 'request_document' : 'human_review');
    assert.ok(result.findings!.every(f => f.evidence_refs.every(r => result.evidence_refs.includes(r.id))));
    assert.ok(!('assessment_status' in result));
  }
});

test('simulated reads enforce ownership, evidence limits, and cancellation without scheduling subsequent tools', async () => {
  for (const scenario of ['ownership', 'limit', 'abort'] as const) {
    const h = setup();
    if (scenario === 'ownership') h.receipt.submission_id = crypto.randomUUID();
    if (scenario === 'limit') h.documents[0].extracted_text = 'x'.repeat(24001);
    if (scenario === 'abort') h.tools.read_receipt = async () => { h.controller.abort(); return h.receipt; };
    await assert.rejects(investigate(h.input, h.tools, h.options), scenario === 'abort' ? { name: 'AbortError' } : { code: scenario === 'ownership' ? 'INVALID_PROVIDER_OUTPUT' : 'EVIDENCE_LIMIT' });
    assert.ok(!h.reads.includes('read_policy')); assert.deepEqual(h.usage, []);
  }
});

test('simulation accepts policy-authorized itinerary identity without requesting booking confirmation', async () => {
  const h = setup();
  h.documents[0].kind = 'itinerary';
  h.state.policies.find(policy => policy.category === h.input.submission.category)!.claimant_identity_evidence = 'receipt_or_linked_itinerary';
  h.receipt.parsed_fields_json = { ...h.receipt.parsed_fields_json!, names: [] };
  const result = await investigate(h.input, h.tools, h.options);
  assert.equal(result.proposed_learning, null);
  assert.equal(result.next_action, 'human_review');
  assert.equal(result.unresolved_question, null);
  assert.ok(result.findings?.some(finding => finding.check === 'name'));
  assert.ok(result.findings?.every(finding => !finding.statement.includes('booking confirmation')));
});

test('core runs the public simulated port with real persisted steps and one final assessment, preserving human decisions', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Integration must remain offline'));
  for (const conflict of [false, true]) {
    const state = evidenceState();
    if (conflict) {
      state.supporting_documents[0].facts!.booking_reference = 'OTHER-BOOKING';
      state.supporting_documents[0].extracted_text = state.supporting_documents[0].extracted_text!.replaceAll('TRIP-01', 'OTHER-BOOKING');
    }
    const store = new MemoryStore(state);
    const core = new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), true, undefined, undefined, intelligence, 'simulated');
    const id = state.submissions[0].id;
    await core.reconcile([id]);
    const assess = t.mock.method(core, 'assess');
    const before = workspaceRows(await store.snapshot())[0];
    const out = await investigateClaim(core, id, { expected_review_revision: before.review_revision }, new AbortController().signal);
    assert.equal(out.run.status, 'completed'); assert.equal(out.run.mode, 'simulated'); assert.equal(out.run.model, null);
    assert.equal(assess.mock.callCount(), 1); assert.equal(store.state.runs.length, 2);
    assert.equal(out.run.before_assessment.assessment_status, before.assessment_status);
    assert.equal(out.run.after_assessment?.assessment_status, conflict ? 'needs_review' : 'matched');
    assert.equal(out.run.outcome, conflict ? 'needs_human' : 'resolved');
    assert.equal(!!out.run.proposed_learning, !conflict);
    assert.deepEqual(out.run.steps.map(s => [s.tool, s.status]), [['read_receipt', 'completed'], ['read_supporting_documents', 'completed'], ['read_policy', 'completed']]);
    assert.equal(out.row.decision_status, 'pending'); assert.equal(store.state.corrections.length, 0); assert.equal(store.state.procedures?.length, 0);
    assert.deepEqual(store.calls, []); assert.doesNotMatch(JSON.stringify(out), /storage_path|private-test-only/);
  }
});

test('default disabled runtime rejects before creating a run or invoking the newly wired port', async () => {
  assert.equal(investigationConfig({}), 'disabled');
  const state = evidenceState(), store = new MemoryStore(state);
  const core = new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), true, undefined, undefined, intelligence);
  await assert.rejects(investigateClaim(core, state.submissions[0].id, { expected_review_revision: 0 }, new AbortController().signal), { code: 'INVESTIGATION_UNAVAILABLE' });
  assert.equal(store.state.runs.length, 0); assert.equal(store.calls.length, 0);
});

test('public simulated port completes reviewed source learning and a separate later purchase through the real suite and core', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Lifecycle must remain offline'));
  const store = new MemoryStore(evidenceState());
  const core = new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), true, undefined, undefined, intelligence, 'simulated');
  const sourceId = store.state.submissions[0].id;
  const row = (id: string) => workspaceRows(store.state).find(r => r.id === id)!;
  const signal = () => new AbortController().signal;
  await core.reconcile([sourceId]);
  const investigated = await investigateClaim(core, sourceId, { expected_review_revision: row(sourceId).review_revision }, signal());
  assert.equal(investigated.run.outcome, 'resolved'); assert.equal(row(sourceId).decision_status, 'pending');
  assert.equal(investigated.run.before_assessment.assessment_status, 'matched'); // Evidence was already available; no invented accuracy gain.
  await core.correct({ submission_id: sourceId, expected_review_revision: row(sourceId).review_revision, human_verdict: 'approved', human_note: 'Reviewed synthetic original receipt and corroborating booking evidence.', correction_type: 'decision_override', correction_payload_json: {} });
  const { procedure } = await proposeProcedure(core, { run_id: investigated.run.run_id, expected_review_revision: row(sourceId).review_revision });
  await assert.rejects(changeProcedure(core, procedure.id, 'activate', { expected_procedure_version: procedure.version }, signal()), { code: 'STALE_RULE_TEST' });
  const report = await changeProcedure(core, procedure.id, 'test', { expected_procedure_version: procedure.version }, signal());
  assert.ok('passed' in report && report.passed, JSON.stringify(report));
  assert.equal(store.state.procedure_tests![0].observations.length, 24);
  assert.ok(report.applied_case_ids.includes('valid_a')); assert.equal(report.after.false_matches, 0);
  await changeProcedure(core, procedure.id, 'activate', { expected_procedure_version: procedure.version }, signal());
  assert.equal(store.state.procedures![0].state, 'active');

  const fresh = evidenceState(), s = fresh.submissions[0], r = fresh.receipts[0], d = fresh.supporting_documents[0];
  s.id = crypto.randomUUID(); s.attendee_name = 'Later Synthetic Guest'; s.email = 'later@example.test'; s.submitted_at = '2026-09-20T01:00:00.000Z'; s.updated_at = s.submitted_at; s.amount_requested_minor += 123;
  r.id = crypto.randomUUID(); r.submission_id = s.id; r.storage_path = `synthetic/${s.id}/${r.id}`;
  r.parsed_fields_json = { ...r.parsed_fields_json!, names: [s.attendee_name], amount_minor: s.amount_requested_minor, receipt_number: 'LATER-RECEIPT-02' };
  r.raw_extracted_text = `SYNTHETIC FIXTURE ONLY\nMerchant: ${r.parsed_fields_json.vendor}\nBooking reference: LATER-TRIP-02\nReceipt number: LATER-RECEIPT-02\nGuest: ${s.attendee_name}\nAmount minor: ${s.amount_requested_minor}`;
  r.sha256 = createHash('sha256').update(r.raw_extracted_text).digest('hex');
  d.id = crypto.randomUUID(); d.claim_id = s.id; d.storage_path = `synthetic/${s.id}/${d.id}`;
  d.facts = { ...d.facts, booking_reference: 'LATER-TRIP-02', names: [s.attendee_name], amount_minor: s.amount_requested_minor };
  d.extracted_text = `SYNTHETIC FIXTURE ONLY\n${d.facts.vendor}\nBooking reference: LATER-TRIP-02\nGuest: ${s.attendee_name}`;
  d.sha256 = createHash('sha256').update(d.extracted_text).digest('hex');
  await store.importIntakeRecord(s, r);
  const upload = await store.supporting({ action: 'start', claim_id: s.id, expected_review_revision: row(s.id).review_revision, document: d });
  await store.supporting({ action: 'finish', lease: upload.lease, document: d });
  const earlierInvestigations = store.state.investigations!.length;
  await core.reconcile([s.id]);
  const later = row(s.id), merchant = later.decisions.find(c => c.field_checked === 'merchant')!;
  assert.equal(later.assessment_status, 'matched'); assert.equal(later.decision_status, 'pending');
  assert.deepEqual(merchant.evidence_json.procedure_ids, [procedure.id]);
  assert.equal(merchant.evidence_json.exact_method, 'booking_reference_identity');
  const refs = merchant.evidence_json.evidence_refs as { kind: string; id: string }[];
  assert.ok(refs.some(ref => ref.kind === 'receipt' && ref.id === r.id));
  assert.ok(refs.some(ref => ref.kind === 'supporting_document' && ref.id === d.id));
  assert.ok(!refs.some(ref => ref.id === store.state.receipts[0].id));
  assert.equal(store.state.investigations!.length, earlierInvestigations); // No fabricated later investigation work.
  assert.equal(store.state.corrections.length, 1); assert.deepEqual(store.calls, []);
});
