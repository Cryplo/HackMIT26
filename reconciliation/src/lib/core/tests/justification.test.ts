import test from 'node:test';
import assert from 'node:assert/strict';
import { demoSnapshot, DEMO_IDS } from '../fixtures';
import { MemoryStore } from '../store';
import { SimulatedRetrieval } from '../retrieval';
import { CoreService } from '../service';
import { SimulatedJev } from '../jev';
import { OpenAiJustifier, SimulatedJustifier, evidenceLines, validateNarrative } from '../justification';
import type { Justification, Justifier } from '../justification';
import { justificationInput, CoreError } from '../validation';
const narrative = { summary: 'The claim was approved.', reasons: ['amount: pass — cents matched'], next_step: 'No reviewer action is required.' };
const body = (text: string, status = 'completed') => ({ ok: true, status: 200, json: async () => ({ status, model: 'gpt-4.1-mini-2026', usage: { input_tokens: 120, output_tokens: 40 }, output: [{ content: [{ type: 'output_text', text }] }] }) }) as unknown as Response;
const transport = (response: Response | Error, seen: Request[] = []) => (async (url: string | URL | Request, init?: RequestInit) => { seen.push(new Request(String(url), init)); if (response instanceof Error) throw response; return response; }) as unknown as typeof fetch;
function setup(justifier: Justifier = new SimulatedJustifier()) { const store = new MemoryStore(demoSnapshot()); return { store, core: new CoreService(store, new SimulatedRetrieval(), new SimulatedJev(), true, undefined, justifier) }; }
test('every completed run carries a justification that restates, never changes, the outcome', async () => {
  const { core, store } = setup();
  await core.reconcile([DEMO_IDS[0], DEMO_IDS[1]]);
  for (const id of [DEMO_IDS[0], DEMO_IDS[1]]) {
    const status = store.state.submissions.find(s => s.id === id)!.status;
    const overall = store.state.decisions.filter(d => d.field_checked === 'overall_status').find(d => store.state.runs.find(r => r.id === d.run_id)!.submission_id === id)!;
    const justification = overall.evidence_json.justification as Justification;
    assert.ok(justification.summary.includes(status === 'approved' ? 'approved for reimbursement' : status === 'flagged' ? 'flagged' : 'review'));
    assert.ok(justification.reasons.length); assert.equal(justification.simulated, true); assert.equal(justification.error, null);
  }
  assert.equal(store.calls.length, 0);
});
test('live justifier sends only decision evidence and records usage', async () => {
  const seen: Request[] = [];
  const { core, store } = setup(new OpenAiJustifier('test-key', 'gpt-4.1-mini', transport(body(JSON.stringify(narrative)), seen)));
  const result = await core.reconcile([DEMO_IDS[0]]);
  assert.equal(result.results[0].status, 'approved');
  const sent = JSON.parse(await seen[0].text()!);
  assert.equal(sent.store, false); assert.equal(sent.text.format.strict, true);
  assert.match(sent.instructions, /Never re-decide/);
  assert.match(sent.input[0].content[0].text, /Outcome: approved for reimbursement/);
  assert.doesNotMatch(JSON.stringify(sent), /test-key/);
  assert.equal(store.calls.length, 1); assert.equal(store.calls[0].provider, 'openai'); assert.equal(store.calls[0].input_tokens, 120);
  const overall = store.state.decisions.find(d => d.field_checked === 'overall_status')!;
  const justification = overall.evidence_json.justification as Justification;
  assert.equal(justification.summary, narrative.summary); assert.equal(justification.simulated, false); assert.equal(justification.model, 'gpt-4.1-mini-2026');
});
test('provider failure degrades to the deterministic summary without touching the status', async () => {
  for (const response of [new Error('network down'), body('not json'), body(JSON.stringify(narrative), 'incomplete'), { ok: false, status: 500, json: async () => ({}) } as unknown as Response]) {
    const { core, store } = setup(new OpenAiJustifier('test-key', 'gpt-4.1-mini', transport(response)));
    assert.equal((await core.reconcile([DEMO_IDS[0]])).results[0].status, 'approved');
    const justification = store.state.decisions.find(d => d.field_checked === 'overall_status')!.evidence_json.justification as Justification;
    assert.equal(justification.simulated, true); assert.ok(justification.error); assert.ok(justification.reasons.length);
  }
});
test('on-demand justification requires a completed run and reports the stored outcome', async () => {
  const { core } = setup();
  await assert.rejects(core.justify(DEMO_IDS[0]), (e: CoreError) => e.code === 'NO_COMPLETED_RUN' && e.status === 409);
  await assert.rejects(core.justify('11111111-1111-4111-8111-111111111111'), (e: CoreError) => e.code === 'NOT_FOUND');
  await core.reconcile([DEMO_IDS[1]]);
  const result = await core.justify(DEMO_IDS[1]);
  assert.equal(result.status, 'flagged'); assert.ok(result.justification.summary.includes('flagged'));
  assert.ok(result.justification.reasons.some(r => r.startsWith('duplicate')));
});
test('narratives are validated and unknown receipt fields are never invented', () => {
  assert.deepEqual(validateNarrative(narrative), narrative);
  for (const bad of [null, { ...narrative, reasons: [] }, { ...narrative, summary: ' ' }, { ...narrative, reasons: ['x'.repeat(501)] }, { summary: 'a', next_step: 'b' }]) assert.throws(() => validateNarrative(bad), (e: CoreError) => e.code === 'JUSTIFICATION_INVALID');
  const state = demoSnapshot();
  const lines = evidenceLines({ submission: state.submissions[0], receipt: { schema_version: 1, vendor: null, receipt_date: null, amount_minor: null, currency: null, names: [], receipt_number: null }, decisions: [], status: 'needs_review' });
  assert.match(lines[1], /vendor unknown/); assert.match(lines[1], /amount unknown/);
  assert.throws(() => justificationInput({ submission_id: 'nope' }), (e: CoreError) => e.code === 'INVALID_INPUT');
  assert.equal(justificationInput({ submission_id: DEMO_IDS[0] }), DEMO_IDS[0]);
});
