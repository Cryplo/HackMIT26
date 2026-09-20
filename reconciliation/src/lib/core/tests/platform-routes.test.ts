import test, { beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { POST as correct } from '../../../app/api/corrections/route';
import { GET as listRules, POST as proposeRule } from '../../../app/api/rules/route';
import { POST as testRule } from '../../../app/api/rules/[id]/test/route';
import { POST as activateRule } from '../../../app/api/rules/[id]/activate/route';
import { POST as disableRule } from '../../../app/api/rules/[id]/disable/route';
import { GET as reviews } from '../../../app/api/workspace/reviews/route';
import { POST as exportReviews } from '../../../app/api/workspace/export/route';
import { POST as retry } from '../../../app/api/submissions/[id]/retry-extraction/route';
import { CoreService } from '../service';
import { FileStore } from '../file-store';
import { DatabaseRetrieval } from '../retrieval';
import { SimulatedJev } from '../jev';
import { DEMO_IDS } from '../fixtures';
import { intelligence } from '../../intelligence';
import type { ReviewRow, ReviewsResponse, RuleResponse, RuleTestReport } from '../../review-contracts';

const origin = 'http://localhost:3000';
const global = globalThis as typeof globalThis & { reimbursementCore?: CoreService };
let core: CoreService;
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (endpoint: string, body: unknown, headers: Record<string, string> = {}) => new Request(`${origin}/api/${endpoint}`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
}
async function snapshot(): Promise<ReviewsResponse> {
  const response = await reviews();
  assert.equal(response.status, 200);
  return response.json();
}
async function approvedSource(): Promise<ReviewRow> {
  await core.reconcile([DEMO_IDS[2]]);
  const source = (await snapshot()).submissions[2];
  const response = await correct(request('corrections', {
    submission_id: source.id, expected_review_revision: source.review_revision, human_verdict: 'approved',
    human_note: 'Checked the synthetic original.', correction_type: 'decision_override', correction_payload_json: {},
  }));
  assert.equal(response.status, 200);
  return (await snapshot()).submissions[2];
}
async function draft(): Promise<RuleResponse> {
  const source = await approvedSource();
  const response = await proposeRule(request('rules', { submission_id: source.id, expected_review_revision: source.review_revision, canonical_vendor: 'Synthetic Harbor Hotel' }));
  assert.equal(response.status, 201);
  return response.json();
}

// Each handler uses the real local core and intelligence port; no live transport is allowed.
beforeEach(async context => {
  const t = context as TestContext;
  const dir = await mkdtemp(path.join(tmpdir(), 'sift-platform-routes-'));
  const previousCore = global.reimbursementCore;
  const environment = {
    RECONCILIATION_SYNTHETIC_ONLY: 'true', RECONCILIATION_APP_ORIGIN: origin,
    RECONCILIATION_MODE: 'simulated', RECONCILIATION_INTAKE_MODE: 'demo',
    RECONCILIATION_EXTRACTION_MODE: 'demo', RECONCILIATION_INTAKE_DEMO_DIR: dir,
  };
  const previous = Object.keys(environment).map(key => [key, process.env[key]] as const);
  Object.assign(process.env, environment);
  core = new CoreService(new FileStore(dir), new DatabaseRetrieval(), new SimulatedJev(), true, undefined, undefined, intelligence);
  global.reimbursementCore = core;
  const transport = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Offline route test attempted network access.'); });
  t.after(async () => {
    if (previousCore) global.reimbursementCore = previousCore; else delete global.reimbursementCore;
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(dir, { recursive: true, force: true });
    assert.equal(transport.mock.callCount(), 0);
  });
});

test('all platform mutations enforce origin and the exact synthetic-only gate; GET stays read-only', async () => {
  const mutations = [
    (r: Request) => correct(r), (r: Request) => proposeRule(r),
    (r: Request) => testRule(r, context(DEMO_IDS[0])), (r: Request) => activateRule(r, context(DEMO_IDS[0])),
    (r: Request) => disableRule(r, context(DEMO_IDS[0])), (r: Request) => exportReviews(r),
    (r: Request) => retry(r, context(DEMO_IDS[0])),
  ];
  for (const mutate of mutations) {
    await error(await mutate(request('rules', {}, { origin: 'https://other.invalid' })), 403, 'INVALID_ORIGIN');
    const missingOrigin = request('rules', {}); missingOrigin.headers.delete('origin');
    await error(await mutate(missingOrigin), 403, 'INVALID_ORIGIN');
    await error(await mutate(request('rules', {}, { 'sec-fetch-site': 'cross-site' })), 403, 'INVALID_ORIGIN');
  }
  for (const value of [undefined, 'false', '1']) {
    if (value === undefined) delete process.env.RECONCILIATION_SYNTHETIC_ONLY; else process.env.RECONCILIATION_SYNTHETIC_ONLY = value;
    for (const mutate of mutations) await error(await mutate(request('rules', {})), 403, 'SYNTHETIC_ONLY');
  }
  const response = await listRules();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { rules: [], knowledge_revision: 0 });
  assert.equal((await core.store.snapshot()).corrections.length, 0);
});

test('rule proposal accepts only source, revision and trimmed canonical vendor, deriving scope from the approved source', async () => {
  const source = (await snapshot()).submissions[2];
  const input = { submission_id: source.id, expected_review_revision: source.review_revision, canonical_vendor: 'Synthetic Harbor Hotel' };
  await error(await proposeRule(request('rules', input)), 409, 'RULE_SOURCE_REQUIRED');
  for (const invalid of [
    {}, { ...input, submission_id: 'invalid' }, { ...input, expected_review_revision: undefined },
    { ...input, expected_review_revision: -1 }, { ...input, expected_review_revision: 1.5 },
    { ...input, canonical_vendor: '  ' }, { ...input, canonical_vendor: 'x'.repeat(121) },
    { ...input, observed_vendor: 'Caller supplied' }, { ...input, scope: { category: 'flight', currency: 'USD' } },
  ]) await error(await proposeRule(request('rules', invalid)), 400, 'INVALID_INPUT');
  await error(await proposeRule(request('rules', { ...input, submission_id: crypto.randomUUID() })), 404, 'NOT_FOUND');
  const approved = await approvedSource();
  await error(await proposeRule(request('rules', input)), 409, 'STALE_REVIEW');
  const response = await proposeRule(request('rules', { ...input, expected_review_revision: approved.review_revision, canonical_vendor: '  Synthetic Harbor Hotel  ' }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body: RuleResponse = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['knowledge_revision', 'rule']);
  assert.equal(body.knowledge_revision, 0);
  assert.equal(body.rule.state, 'draft');
  assert.equal(body.rule.version, 1);
  assert.equal(body.rule.source_submission_id, source.id);
  assert.ok(body.rule.source_correction_id);
  assert.equal(body.rule.latest_test, null);
  assert.deepEqual(body.rule.payload, { observed_vendor: 'SYN HBR 042', canonical_vendor: 'Synthetic Harbor Hotel', scope: { category: 'hotel', currency: 'USD' } });
  assert.deepEqual(await (await listRules()).json(), { rules: [body.rule], knowledge_revision: 0 });
});

test('rule mutations require only the current version, return the test report directly, and expose version conflicts', async () => {
  const { rule } = await draft();
  const handlers = { test: testRule, activate: activateRule, disable: disableRule };
  for (const [action, handler] of Object.entries(handlers)) {
    for (const invalid of [
      {}, { expected_rule_version: 0 }, { expected_rule_version: 1.5 }, { expected_rule_version: '1' },
      { expected_rule_version: 1, passed: true }, { expected_rule_version: 1, report: { passed: true } },
    ]) await error(await handler(request(`rules/${rule.id}/${action}`, invalid), context(rule.id)), 400, 'INVALID_INPUT');
    await error(await handler(request('rules/invalid', { expected_rule_version: 1 }), context('invalid')), 400, 'INVALID_INPUT');
    await error(await handler(request('rules/missing', { expected_rule_version: 1 }), context(crypto.randomUUID())), 404, 'NOT_FOUND');
    await error(await handler(request(`rules/${rule.id}/${action}`, { expected_rule_version: 2 }), context(rule.id)), 409, 'STALE_RULE');
  }
  await error(await activateRule(request(`rules/${rule.id}/activate`, { expected_rule_version: 1 }), context(rule.id)), 409, 'STALE_RULE_TEST');
  const tested = await testRule(request(`rules/${rule.id}/test`, { expected_rule_version: 1 }), context(rule.id));
  assert.equal(tested.status, 200);
  assert.equal(tested.headers.get('cache-control'), 'no-store');
  const report: RuleTestReport = await tested.json();
  assert.equal(report.rule_id, rule.id);
  assert.equal(report.rule_version, 1);
  assert.equal(report.suite_version, 'alias-v1');
  assert.equal(report.mode, 'simulated');
  assert.equal(report.passed, true);
  assert.equal(report.before.total, 10);
  assert.equal(report.after.total, 10);
  assert.equal('rule' in report, false);
  const listed = await (await listRules()).json();
  assert.deepEqual(listed.rules[0].latest_test, report);
  assert.equal('test_binding' in listed.rules[0], false);
  assert.equal('latest_attempt_id' in listed.rules[0], false);
  const active = await activateRule(request(`rules/${rule.id}/activate`, { expected_rule_version: 1 }), context(rule.id));
  assert.equal(active.status, 200);
  const activeBody: RuleResponse = await active.json();
  assert.equal(activeBody.rule.state, 'active');
  assert.equal(activeBody.rule.version, 2);
  assert.equal(activeBody.knowledge_revision, 1);
  await error(await disableRule(request(`rules/${rule.id}/disable`, { expected_rule_version: 1 }), context(rule.id)), 409, 'STALE_RULE');
  const disabled = await disableRule(request(`rules/${rule.id}/disable`, { expected_rule_version: 2 }), context(rule.id));
  assert.equal(disabled.status, 200);
  const disabledBody: RuleResponse = await disabled.json();
  assert.equal(disabledBody.rule.state, 'disabled');
  assert.equal(disabledBody.rule.version, 3);
  assert.equal(disabledBody.rule.latest_test, null);
  assert.equal(disabledBody.knowledge_revision, 2);
  await error(await activateRule(request(`rules/${rule.id}/activate`, { expected_rule_version: 3 }), context(rule.id)), 409, 'STALE_RULE');
});

test('missing intelligence returns unavailable while rule history remains readable and disable works', async () => {
  const { rule } = await draft();
  core.intelligence = undefined;
  const source = (await snapshot()).submissions[2];
  await error(await proposeRule(request('rules', { submission_id: source.id, expected_review_revision: source.review_revision, canonical_vendor: 'Synthetic Harbor Hotel' })), 503, 'RULE_LEARNING_UNAVAILABLE');
  for (const handler of [testRule, activateRule]) await error(await handler(request('rules', { expected_rule_version: 1 }), context(rule.id)), 503, 'RULE_LEARNING_UNAVAILABLE');
  assert.equal((await listRules()).status, 200);
  assert.equal((await disableRule(request('rules', { expected_rule_version: 1 }), context(rule.id))).status, 200);
});

test('export downloads only selected snapshot rows with exact CSV headers and rejects invalid, foreign and stale selections', async () => {
  const current = await snapshot();
  const input = { snapshot_token: current.snapshot_token, submission_ids: [DEMO_IDS[3], DEMO_IDS[0]] };
  const response = await exportReviews(request('workspace/export', input));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="sift-reviews.csv"');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const csv = await response.text(), lines = csv.split('\r\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0], 'claim_id,attendee_name,category,currency,requested_amount_minor,receipt_amount_minor,assessment_status,decision_status,processing_status,review_revision,assessment_knowledge_revision,knowledge_revision,assessment_stale,failed_checks,unknown_checks,duplicate_claim_ids,latest_reviewer_note,receipt_id');
  assert.ok(lines[1].startsWith(`"${DEMO_IDS[3]}","Taylor Example","hotel","USD","19500","19500",`));
  assert.ok(lines[2].startsWith(`"${DEMO_IDS[0]}","Alex Demo","flight","USD","24000","24000",`));
  assert.equal(lines[3], '');
  for (const id of [DEMO_IDS[1], DEMO_IDS[2], DEMO_IDS[4]]) assert.equal(csv.includes(id), false);
  assert.doesNotMatch(csv, /storage_path|provider_response|https?:/);
  for (const invalid of [
    {}, { ...input, snapshot_token: 'invalid' }, { ...input, submission_ids: [] },
    { ...input, submission_ids: ['invalid'] }, { ...input, submission_ids: [DEMO_IDS[0], DEMO_IDS[0]] },
    { ...input, submission_ids: Array.from({ length: 1001 }, () => crypto.randomUUID()) }, { ...input, include_possible_matches: true },
  ]) await error(await exportReviews(request('workspace/export', invalid)), 400, 'INVALID_INPUT');
  await error(await exportReviews(request('workspace/export', { ...input, submission_ids: [DEMO_IDS[0], crypto.randomUUID()] })), 409, 'STALE_SNAPSHOT');
  await core.reconcile([DEMO_IDS[0]]);
  await error(await exportReviews(request('workspace/export', input)), 409, 'STALE_SNAPSHOT');
});

test('HTTP parsing accepts a 1000-ID export body and caps declared or streamed bodies at 64 KiB', async () => {
  const current = await snapshot();
  const body = { snapshot_token: current.snapshot_token, submission_ids: Array.from({ length: 1000 }, () => crypto.randomUUID()) };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 8192);
  await error(await exportReviews(request('workspace/export', body)), 409, 'STALE_SNAPSHOT');
  await error(await proposeRule(request('rules', {}, { 'content-length': '65537' })), 413, 'BODY_TOO_LARGE');
  await error(await proposeRule(request('rules', 'x'.repeat(65534))), 400, 'INVALID_INPUT'); // JSON quotes bring this to exactly 64 KiB.
  await error(await proposeRule(request('rules', 'x'.repeat(65535))), 413, 'BODY_TOO_LARGE');
  await error(await proposeRule(request('rules', {}, { 'content-type': 'text/plain' })), 415, 'INVALID_CONTENT_TYPE');
  await error(await proposeRule(new Request(`${origin}/api/rules`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{' })), 400, 'INVALID_JSON');
});

test('retry requires a current numeric revision, rejects reviewed claims and returns the same claim and receipt in demo mode', async () => {
  await core.reconcile([DEMO_IDS[0]]);
  const source = (await snapshot()).submissions[0];
  for (const invalid of [
    {}, { expected_review_revision: -1 }, { expected_review_revision: 1.5 },
    { expected_review_revision: String(source.review_revision) }, { expected_review_revision: source.review_revision, receipt_id: source.receipt!.id },
  ]) await error(await retry(request('submissions/retry-extraction', invalid), context(source.id)), 400, 'INVALID_INPUT');
  await error(await retry(request('submissions/retry-extraction', { expected_review_revision: 0 }), context('invalid')), 400, 'INVALID_INPUT');
  await error(await retry(request('submissions/retry-extraction', { expected_review_revision: 0 }), context(crypto.randomUUID())), 404, 'NOT_FOUND');
  await error(await retry(request('submissions/retry-extraction', { expected_review_revision: source.review_revision - 1 }), context(source.id)), 409, 'STALE_REVIEW');
  const response = await retry(request(`submissions/${source.id}/retry-extraction`, { expected_review_revision: source.review_revision }), context(source.id));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body: { row: ReviewRow } = await response.json();
  assert.deepEqual(Object.keys(body), ['row']);
  assert.equal(body.row.id, source.id);
  assert.equal(body.row.receipt!.id, source.receipt!.id);
  assert.equal(body.row.receipt!.sha256, source.receipt!.sha256);
  assert.equal(body.row.receipt!.extraction_status, 'succeeded');
  assert.equal(body.row.decision_status, 'pending');
  assert.equal(body.row.assessment_status, null);
  assert.ok(body.row.review_revision > source.review_revision);
  const approved = await approvedSource();
  await error(await retry(request(`submissions/${approved.id}/retry-extraction`, { expected_review_revision: approved.review_revision }), context(approved.id)), 409, 'RETRY_BLOCKED');
});
