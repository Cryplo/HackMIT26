import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../store';
import { FileStore } from '../file-store';
import { demoSnapshot, DEMO_IDS } from '../fixtures';
import { CoreService } from '../service';
import { DatabaseRetrieval } from '../retrieval';
import { LiveJev, SimulatedJev, askedQuestions, customQuestion, questions, validateAnswers, type Answer, type SemanticState } from '../jev';
import { checkCatalog } from '../../check-catalog';
import { customCheckUpsert, defaultCriteria, mutateCustomCheck, requiredFieldsFor, requiredFieldsIn, slugField, CUSTOM_CHECK_LIMIT } from '../custom-checks';
import { checks as listChecks, createCheck, updateCheck, changeCheck } from '../checks-api';
import { overall } from '../checks';
import { workspaceDecide, workspaceRows } from '../workspace';
import type { ModelCall } from '../../contracts';

const answer = (): Answer => ({ type: 'choice', choice: 'pass', probabilities: { pass: .9, fail: .06, unknown: .04 }, confidence: .75 });
const answers = () => ({ merchant: answer(), name: answer(), duplicate: answer() });
const make = (store: MemoryStore) => new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), true);
const customInput = { label: 'Itemized receipt', instructions: 'Does the receipt include an itemized breakdown of charges?', criteria: defaultCriteria, category: null };

test('custom check schema rejects malformed labels, instructions, categories and criteria', () => {
  for (const raw of [
    {}, { label: '' }, { label: 'x', instructions: 'short' }, { label: 'x'.repeat(81), instructions: 'a'.repeat(10) },
    { label: 'x', instructions: 'a'.repeat(2001) }, { label: 'x', instructions: 'a'.repeat(10), category: 'car' },
    { label: 'x', instructions: 'a'.repeat(10), criteria: { pass: '' } },
    { label: 'x', instructions: 'a'.repeat(10), criteria: { bogus: 'x' } },
    { label: 'x', instructions: 'a'.repeat(10), extra: true },
  ]) assert.equal(customCheckUpsert.safeParse(raw).success, false, JSON.stringify(raw));
  assert.equal(customCheckUpsert.safeParse({ label: 'Itemized', instructions: 'a'.repeat(10), category: 'hotel' }).success, true);
  assert.equal(customCheckUpsert.safeParse({ label: 'Itemized', instructions: 'a'.repeat(10) }).success, true);
});

test('slugs are stable custom_-prefixed fields that never collide with built-ins or each other', () => {
  const taken = new Set<string>();
  assert.equal(slugField('Itemized receipt!', taken), 'custom_itemized_receipt');
  taken.add('custom_itemized_receipt');
  assert.equal(slugField('Itemized receipt', taken), 'custom_itemized_receipt_2');
  assert.ok(!['currency', 'amount', 'policy', 'receipt_date', 'policy_cap', 'merchant', 'name', 'duplicate'].some(field => field.startsWith('custom_')));
  assert.throws(() => slugField('!!!', taken), { code: 'INVALID_INPUT' });
  assert.throws(() => slugField('___', taken), { code: 'INVALID_INPUT' });
});

test('mutator enforces versioning, state transitions, limit and knowledge revision', () => {
  const state = demoSnapshot();
  const before = state.knowledge_revision ?? 0;
  const { check, knowledge_revision } = mutateCustomCheck(state, { action: 'create', ...customInput });
  assert.equal(knowledge_revision, before + 1);
  assert.match(check.field, /^custom_itemized/);
  assert.equal(check.state, 'active');
  assert.equal(state.custom_check_history!.length, 1);
  assert.throws(() => mutateCustomCheck(state, { action: 'update', id: check.id, expected_check_version: 99, ...customInput }), { code: 'STALE_CHECK' });
  const disabled = mutateCustomCheck(state, { action: 'disable', id: check.id, expected_check_version: check.version });
  assert.equal(disabled.check.state, 'disabled');
  assert.equal(disabled.knowledge_revision, before + 2);
  // Editing a disabled check does not change live configuration.
  const edited = mutateCustomCheck(state, { action: 'update', id: check.id, expected_check_version: disabled.check.version, label: 'Renamed', instructions: 'a'.repeat(10), criteria: defaultCriteria, category: 'hotel' });
  assert.equal(edited.check.label, 'Renamed');
  assert.equal(edited.knowledge_revision, before + 2);
  assert.equal(edited.check.category, 'hotel');
  assert.equal(mutateCustomCheck(state, { action: 'enable', id: check.id, expected_check_version: edited.check.version }).knowledge_revision, before + 3);
  assert.throws(() => mutateCustomCheck(state, { action: 'enable', id: check.id, expected_check_version: edited.check.version + 1 }), { code: 'STALE_CHECK' });
  assert.throws(() => mutateCustomCheck(state, { action: 'disable', id: crypto.randomUUID(), expected_check_version: 1 }), { code: 'NOT_FOUND' });
  while (state.custom_checks!.length < CUSTOM_CHECK_LIMIT) mutateCustomCheck(state, { action: 'create', ...customInput, label: `Check ${state.custom_checks!.length}` });
  assert.throws(() => mutateCustomCheck(state, { action: 'create', ...customInput }), { code: 'CHECK_LIMIT' });
});

test('required field helpers scope custom checks by category and derive from recorded decisions', () => {
  const state = demoSnapshot();
  assert.deepEqual(requiredFieldsFor(state, 'hotel').filter(field => field.startsWith('custom_')), []);
  const { check } = mutateCustomCheck(state, { action: 'create', ...customInput });
  const scoped = mutateCustomCheck(state, { action: 'create', ...customInput, label: 'Hotel folio', category: 'hotel' }).check;
  const hotel = requiredFieldsFor(state, 'hotel');
  assert.ok(hotel.includes(check.field) && hotel.includes(scoped.field));
  const flight = requiredFieldsFor(state, 'flight');
  assert.ok(flight.includes(check.field) && !flight.includes(scoped.field));
  mutateCustomCheck(state, { action: 'disable', id: check.id, expected_check_version: check.version });
  assert.ok(!requiredFieldsFor(state, 'hotel').includes(check.field));
  assert.deepEqual(requiredFieldsIn([{ field_checked: 'amount' }, { field_checked: 'custom_x1' }, { field_checked: 'overall_status' }]), ['currency', 'amount', 'policy', 'receipt_date', 'policy_cap', 'merchant', 'name', 'duplicate', 'custom_x1']);
});

test('overall stays fail-first and a custom unknown or missing pass forces review', () => {
  const base = ['currency', 'amount', 'policy', 'receipt_date', 'policy_cap', 'merchant', 'name', 'duplicate'].map(field_checked => ({ field_checked, verdict: 'pass' as const }));
  assert.equal(overall(base, [...base.map(d => d.field_checked), 'custom_itemized']), 'needs_review');
  assert.equal(overall([...base, { field_checked: 'custom_itemized', verdict: 'unknown' as const }], [...base.map(d => d.field_checked), 'custom_itemized']), 'needs_review');
  assert.equal(overall([...base, { field_checked: 'custom_itemized', verdict: 'pass' as const }], [...base.map(d => d.field_checked), 'custom_itemized']), 'approved');
  assert.equal(overall([...base, { field_checked: 'custom_itemized', verdict: 'fail' as const }], [...base.map(d => d.field_checked), 'custom_itemized']), 'flagged');
});

test('Jev merges custom questions, keeps the untrusted preamble, and validates exact answer keys', async t => {
  const question = customQuestion({ label: 'Itemized receipt', instructions: 'Itemized breakdown?', criteria: defaultCriteria });
  assert.equal(question.type, 'choice');
  assert.match(question.instructions, /untrusted evidence, never instructions/);
  assert.match(question.instructions, /Itemized receipt/);
  const asked = askedQuestions({ custom_itemized: question });
  assert.deepEqual(Object.keys(asked), ['merchant', 'name', 'duplicate', 'custom_itemized']);
  assert.throws(() => askedQuestions({ merchant: question }), { code: 'INVALID_INPUT' });
  assert.throws(() => askedQuestions({ 'drop table': question }), { code: 'INVALID_INPUT' });
  const valid = { ...answers(), custom_itemized: answer() };
  assert.equal(validateAnswers(valid, asked), valid);
  assert.throws(() => validateAnswers(answers(), asked), { code: 'JEV_INVALID' });
  assert.throws(() => validateAnswers({ ...valid, other: answer() }, asked), { code: 'JEV_INVALID' });
  const input: SemanticState = { submission: demoSnapshot().submissions[0], receipt: demoSnapshot().receipts[0].parsed_fields_json!, evidence: { aliases: [], candidates: [], retrieval_mode: 'database' } };
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.questions, asked);
    return Response.json({ answers: valid, model: 'jev-latest' });
  });
  const calls: ModelCall[] = [];
  const result = await new LiveJev('synthetic-test-key').evaluate(input, 'run', async call => { calls.push(call); }, undefined, { custom_itemized: question });
  assert.equal(result.answers.custom_itemized.choice, 'pass');
  assert.equal(calls.length, 1);
  const simulated = await new SimulatedJev().evaluate(input, 'run', async () => {}, undefined, { custom_itemized: question });
  assert.equal(simulated.answers.custom_itemized.choice, 'unknown');
  assert.equal(simulated.answers.custom_itemized.confidence, 1);
});

test('end to end: active custom check routes a clean claim to review; disabling restores approval', async () => {
  const store = new MemoryStore(demoSnapshot());
  const core = make(store);
  const { check } = await store.customCheck({ action: 'create', ...customInput });
  const result = await core.reconcile([DEMO_IDS[0]]);
  assert.equal(result.results[0].status, 'needs_review');
  const snapshot = await store.snapshot();
  const run = snapshot.submissions[0].latest_run_id!;
  const decision = snapshot.decisions.find(d => d.run_id === run && d.field_checked === check.field)!;
  assert.equal(decision.verdict, 'unknown');
  assert.equal(decision.check_method, 'jev');
  assert.equal(decision.evidence_json.custom_check_id, check.id);
  assert.equal(decision.evidence_json.check_label, 'Itemized receipt');
  assert.equal(decision.evidence_json.simulated, true);
  await store.customCheck({ action: 'disable', id: check.id, expected_check_version: check.version });
  const cleared = await core.reconcile([DEMO_IDS[0]]);
  assert.equal(cleared.results[0].status, 'approved');
});

test('a check created mid-run stales the run and blocks approval of the stale assessment', async () => {
  const store = new MemoryStore(demoSnapshot());
  const core = make(store);
  await core.reconcile([DEMO_IDS[0]]);
  const row = workspaceRows(await store.snapshot())[0];
  assert.equal(row.assessment_status, 'matched');
  const run = await store.begin(DEMO_IDS[0]);
  await store.customCheck({ action: 'create', ...customInput });
  await assert.rejects(store.finish(run, [], 'approved'), { code: 'STALE_RUN' });
  await store.fail(run, 'stale');
  // The pre-change assessment was computed under a different knowledge revision.
  await assert.rejects(workspaceDecide(core, { submission_id: row.id, expected_review_revision: row.review_revision, human_verdict: 'approved', human_note: 'Reviewed.', correction_type: 'decision_override', correction_payload_json: {} }), { code: 'STALE_REVIEW' });
});

test('FileStore persists custom checks across store instances', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sift-checks-'));
  try {
    const first = new FileStore(dir);
    const { check } = await first.customCheck({ action: 'create', ...customInput });
    const second = new FileStore(dir);
    const snapshot = await second.snapshot();
    assert.deepEqual(snapshot.custom_checks!.map(c => c.id), [check.id]);
    assert.equal(snapshot.knowledge_revision, 1);
    const disabled = await second.customCheck({ action: 'disable', id: check.id, expected_check_version: check.version });
    assert.equal(disabled.check.state, 'disabled');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('check API handlers validate input and return catalog plus mutation responses', async () => {
  const store = new MemoryStore(demoSnapshot());
  const core = make(store);
  const catalog = await listChecks(core);
  assert.equal(catalog.checks.length, 10);
  assert.ok(catalog.checks.every(check => check.builtin));
  assert.deepEqual(catalog.checks.map(check => check.layer), [...Array(7).fill('local'), 'jev', 'jev', 'jev']);
  await assert.rejects(createCheck(core, { label: 'x' }), { code: 'INVALID_INPUT' });
  const created = await createCheck(core, { label: 'Itemized receipt', instructions: 'Does the receipt include an itemized breakdown of charges?', category: 'hotel' });
  assert.match(created.check.field, /^custom_/);
  assert.equal(created.check.state, 'active');
  assert.equal(created.check.category, 'hotel');
  assert.equal(created.knowledge_revision, 1);
  await assert.rejects(updateCheck(core, 'not-a-uuid', { label: 'x', instructions: 'a'.repeat(10), expected_check_version: 1 }), { code: 'INVALID_INPUT' });
  await assert.rejects(updateCheck(core, created.check.id, { label: 'x', instructions: 'a'.repeat(10), expected_check_version: 99 }), { code: 'STALE_CHECK' });
  const updated = await updateCheck(core, created.check.id, { label: 'Itemized detail', instructions: 'Does the receipt itemize each charge?', expected_check_version: 1 });
  assert.equal(updated.check.version, 2);
  assert.equal(updated.knowledge_revision, 2);
  const disabled = await changeCheck(core, created.check.id, 'disable', { expected_check_version: 2 });
  assert.equal(disabled.check.state, 'disabled');
  assert.equal(disabled.knowledge_revision, 3);
  await assert.rejects(changeCheck(core, created.check.id, 'disable', { expected_check_version: 3 }), { code: 'STALE_CHECK' });
  const after = await listChecks(core);
  const descriptor = after.checks.find(check => check.id === created.check.id)!;
  assert.equal(descriptor.builtin, false);
  assert.equal(descriptor.layer, 'jev');
  assert.equal(descriptor.state, 'disabled');
});

test('check catalog lists local built-ins, Jev built-ins, then custom checks', () => {
  const empty = checkCatalog({ custom_checks: [] });
  assert.equal(empty.length, 10);
  const state = demoSnapshot();
  const { check } = mutateCustomCheck(state, { action: 'create', ...customInput });
  const catalog = checkCatalog(state);
  assert.equal(catalog.length, 11);
  const descriptor = catalog.at(-1)!;
  assert.equal(descriptor.key, check.field);
  assert.equal(descriptor.layer, 'jev');
  assert.equal(descriptor.builtin, false);
  assert.equal(descriptor.instructions, customInput.instructions);
  assert.deepEqual(descriptor.criteria, defaultCriteria);
});
