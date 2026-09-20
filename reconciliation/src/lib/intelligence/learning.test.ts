import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setImmediate as tick, setTimeout as delay } from 'node:timers/promises';
import type { Correction, Receipt, Submission } from '../contracts';
import type { ActiveAlias, AssessExample, Assessment, Category, EvaluationCase, MerchantRule, RuleEvaluationInput } from '../review-contracts';
import { deterministic } from '../core/checks';
import { applicableAliases } from '../core/retrieval';
import { isUUID, normalize } from '../core/validation';
import { intelligence } from './index';
import { build_rule_suite, evaluate_rule } from './learning';
import { search } from './search';

const rule = (): MerchantRule => ({
  id: '40000000-0000-4000-8000-000000000001', version: 1, state: 'draft',
  source_submission_id: '10000000-0000-4000-8000-000000000003',
  source_correction_id: '40000000-0000-4000-8000-000000000002',
  payload: { observed_vendor: 'SYN HBR 042', canonical_vendor: 'Synthetic Harbor Hotel', scope: { category: 'hotel', currency: 'USD' } },
  created_at: '2026-09-20T00:00:00.000Z', latest_test: null,
});
const input = (candidate = rule()): RuleEvaluationInput => ({
  rule: candidate, active_aliases: [], knowledge_revision: 4, examples: build_rule_suite(candidate),
  mode: 'simulated', signal: new AbortController().signal,
});
const asAlias = (candidate: MerchantRule): ActiveAlias => ({ id: candidate.id, source_correction_id: candidate.source_correction_id, payload: candidate.payload });
const legacySubmission = (facts: EvaluationCase['facts']): Submission => ({ ...facts.submission, updated_at: facts.submission.submitted_at, status: 'pending', latest_run_id: null });
const legacyReceipt = (facts: EvaluationCase['facts']): Receipt => ({ ...facts.receipt!, storage_path: 'synthetic-fixture-only', extracted_at: '2026-09-19T12:00:00.000Z' });
const correction = (candidate: MerchantRule): Correction => ({
  id: candidate.id, submission_id: candidate.source_submission_id,
  human_verdict: 'approved', human_note: 'Synthetic descriptor reviewed.', correction_type: 'vendor_alias',
  correction_payload_json: { ...candidate.payload }, corrected_at: candidate.created_at,
});

// Facts-only test double, not a provider or a production assessor. It never reads case IDs/truth.
const assess: AssessExample = async (facts, aliases, signal) => {
  signal.throwIfAborted();
  const { submission: s, receipt: r } = facts;
  const p = r?.parsed_fields_json;
  if (!r || r.extraction_status !== 'succeeded' || !p) return 'needs_review';
  const policies = facts.policies.filter(policy => policy.category === s.category && policy.currency === s.currency);
  const policy = policies.find(policy => p.receipt_date && policy.date_range_start <= p.receipt_date && policy.date_range_end >= p.receipt_date);
  if ((p.currency !== null && p.currency !== 'USD') || (p.amount_minor !== null && p.amount_minor !== s.amount_requested_minor) ||
      (policy && s.amount_requested_minor > policy.max_amount_minor) || (p.receipt_date && policies.length && !policy) || facts.exact_duplicate_ids.length) return 'flagged';
  if (!policy || p.amount_minor === null || p.currency === null || !p.names.some(name => normalize(name) === normalize(s.attendee_name))) return 'needs_review';
  const applicable = aliases.filter(a => a.payload.scope.category === s.category && a.payload.scope.currency === s.currency && p.vendor && normalize(a.payload.observed_vendor) === normalize(p.vendor));
  return applicable.length === 1 ? 'matched' : 'needs_review';
};

function freeze(value: unknown) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
}

test('alias-v1 is repeatable, isolated, source-free and contains exactly the required facts/truth', () => {
  const candidate = rule();
  const original = structuredClone(candidate);
  freeze(candidate);
  const suite = build_rule_suite(candidate);
  assert.deepEqual(suite, build_rule_suite(candidate));
  assert.deepEqual(candidate, original);
  assert.deepEqual(suite.map(e => [e.id, e.expected_assessment]), [
    ['valid_a', 'matched'], ['valid_b', 'matched'], ['overclaim', 'flagged'], ['over_cap', 'flagged'],
    ['exact_duplicate', 'flagged'], ['other_category', 'needs_review'], ['eur_receipt', 'flagged'],
    ['missing_receipt', 'needs_review'], ['missing_name', 'needs_review'], ['unrelated_vendor', 'needs_review'],
  ]);
  const ids = suite.flatMap(({ facts }) => [facts.submission.id, ...facts.related_claims.map(c => c.submission.id)]);
  assert.equal(new Set(ids).size, 11);
  assert.ok(ids.every(isUUID));
  assert.ok(!ids.includes(candidate.source_submission_id));
  assert.equal(new Set(suite.flatMap(e => e.facts.receipt ? [e.facts.receipt.id] : [])).size, 9);
  for (const { facts } of suite) {
    assert.ok(Number.isSafeInteger(facts.submission.amount_requested_minor));
    assert.equal(facts.submission.currency, 'USD');
    assert.ok(!/"(?:expected_assessment|valid_a|overclaim|exact_duplicate)"|should fail/.test(JSON.stringify(facts)));
    if (facts.receipt) {
      assert.ok(isUUID(facts.receipt.id));
      assert.equal(facts.receipt.submission_id, facts.submission.id);
      assert.ok(Number.isSafeInteger(facts.receipt.parsed_fields_json!.amount_minor));
      assert.equal(facts.receipt.parsed_fields_json!.receipt_date, '2026-09-18');
      assert.equal(facts.receipt.sha256, createHash('sha256').update(facts.receipt.raw_extracted_text!, 'utf8').digest('hex'));
      assert.match(facts.receipt.raw_extracted_text!, /SYNTHETIC FIXTURE ONLY/);
    }
    assert.deepEqual(facts.policies.map(p => [p.category, p.max_amount_minor]), [['flight', 50000], ['hotel', 25000], ['train', 20000], ['bus', 10000], ['other', 5000]]);
    for (const policy of facts.policies) {
      assert.equal(policy.region_or_route, '*'); assert.equal(policy.currency, 'USD');
      assert.equal(policy.date_range_start, '2026-09-01'); assert.equal(policy.date_range_end, '2026-09-30');
    }
  }
  const [a, b, overclaim, cap, duplicate, other, eur, missing, unnamed, unrelated] = suite.map(e => e.facts);
  for (const field of ['attendee_name', 'amount_requested_minor'] as const) assert.notEqual(a.submission[field], b.submission[field]);
  assert.notEqual(a.receipt!.sha256, b.receipt!.sha256);
  assert.notEqual(a.receipt!.parsed_fields_json!.receipt_number, b.receipt!.parsed_fields_json!.receipt_number);
  assert.equal(overclaim.submission.amount_requested_minor, overclaim.receipt!.parsed_fields_json!.amount_minor! + 1);
  assert.equal(cap.submission.amount_requested_minor, 25001);
  assert.equal(cap.receipt!.parsed_fields_json!.amount_minor, 25001);
  const prior = duplicate.related_claims[0];
  assert.deepEqual(duplicate.exact_duplicate_ids, [prior.submission.id]);
  assert.equal(duplicate.receipt!.sha256, prior.receipt!.sha256);
  assert.equal(duplicate.receipt!.raw_extracted_text, prior.receipt!.raw_extracted_text);
  assert.deepEqual(duplicate.receipt!.parsed_fields_json, prior.receipt!.parsed_fields_json);
  assert.ok(prior.submission.submitted_at < duplicate.submission.submitted_at);
  assert.notEqual(other.submission.category, 'hotel');
  assert.ok(other.policies.some(p => p.category === other.submission.category));
  assert.equal(eur.receipt!.parsed_fields_json!.currency, 'EUR');
  assert.equal(missing.receipt, null);
  assert.deepEqual(unnamed.receipt!.parsed_fields_json!.names, []);
  assert.notEqual(normalize(unrelated.receipt!.parsed_fields_json!.vendor!), normalize(candidate.payload.observed_vendor));
});

test('all category scopes have valid distinct purchases and their own policy', async () => {
  for (const category of ['flight', 'hotel', 'train', 'bus', 'other'] as Category[]) {
    const candidate = rule(); candidate.payload.scope.category = category;
    const suite = build_rule_suite(candidate);
    assert.equal(suite.length, 10);
    assert.notEqual(suite[5].facts.submission.category, category);
    for (const example of suite) assert.equal(await assess(example.facts, [asAlias(candidate)], new AbortController().signal), example.expected_assessment);
  }
});

test('existing retrieval applies the descriptor only within exact normalized hotel/USD scope', () => {
  const candidate = rule(); const facts = build_rule_suite(candidate)[0].facts;
  const s = legacySubmission(facts); const p = facts.receipt!.parsed_fields_json!; const c = correction(candidate);
  assert.equal(applicableAliases(s, { ...p, vendor: '  syn   HBR 042  ' }, [c]).length, 1);
  assert.equal(applicableAliases(s, { ...p, vendor: 'SYN HBR 042 annex' }, [c]).length, 0);
  assert.equal(applicableAliases({ ...s, category: 'flight' }, p, [c]).length, 0);
  assert.equal(applicableAliases(s, p, [{ ...c, correction_payload_json: { ...candidate.payload, scope: { category: 'hotel', currency: 'EUR' } } }]).length, 0);
});

test('out-of-policy date remains a failed financial check outside the ten-case denominator', () => {
  const suite = build_rule_suite(rule()); const facts = structuredClone(suite[0].facts);
  facts.receipt!.parsed_fields_json!.receipt_date = '2026-10-01';
  const checks = deterministic(legacySubmission(facts), legacyReceipt(facts), facts.policies, 'synthetic-run');
  assert.equal(checks.find(c => c.field_checked === 'receipt_date')!.verdict, 'fail');
  assert.equal(suite.length, 10);
  assert.equal(suite[0].facts.receipt!.parsed_fields_json!.receipt_date, '2026-09-18');
});

test('invalid rule identity, version, scope and indistinguishable merchants are rejected', () => {
  const changes: ((r: MerchantRule) => void)[] = [
    r => { r.id = 'bad'; }, r => { r.source_submission_id = ''; }, r => { r.source_correction_id = 'bad'; },
    r => { r.version = 0; }, r => { r.version = 1.5; }, r => { r.version = Infinity; },
    r => { r.payload.observed_vendor = ' '; }, r => { r.payload.canonical_vendor = ''; },
    r => { r.payload.canonical_vendor = ' syn  hbr 042 '; }, r => { r.payload.canonical_vendor = 'x'.repeat(121); },
    r => { Object.assign(r.payload.scope, { category: 'meal' }); }, r => { Object.assign(r.payload.scope, { category: ['hotel'] }); },
    r => { Object.assign(r.payload.scope, { currency: 'EUR' }); },
    r => { Object.assign(r.payload.scope, { region: '*' }); }, r => { Object.assign(r.payload, { scope: null }); },
  ];
  for (const change of changes) { const candidate = rule(); change(candidate); assert.throws(() => build_rule_suite(candidate)); }
  const candidate = rule(); candidate.source_submission_id = build_rule_suite(candidate)[0].facts.submission.id;
  assert.throws(() => build_rule_suite(candidate), /exclude the source/);
});

test('paired gate makes 20 facts-only calls, preserves references/order, caps concurrency and reports actual metrics', async () => {
  const value = input();
  const unrelated = rule(); unrelated.id = '40000000-0000-4000-8000-000000000099'; unrelated.payload.observed_vendor = 'SYN ABC 902';
  value.active_aliases = [asAlias(unrelated)];
  const original = JSON.stringify(value);
  freeze(value.rule); freeze(value.examples); freeze(value.active_aliases);
  const calls: { facts: EvaluationCase['facts']; aliases: ActiveAlias[] }[] = [];
  const phaseByFacts = new Map<EvaluationCase['facts'], string[]>();
  let running = 0; let peak = 0;
  const started = Date.now();
  const report = await evaluate_rule(value, async (facts, aliases, signal) => {
    assert.equal(signal, value.signal);
    assert.ok(value.examples.some(e => e.facts === facts));
    assert.ok(!Object.hasOwn(facts, 'expected_assessment'));
    const phase = aliases.length === 1 ? 'before' : 'after';
    if (phase === 'before') assert.equal(aliases, value.active_aliases);
    else {
      assert.notEqual(aliases, value.active_aliases);
      assert.equal(aliases[0], value.active_aliases[0]);
      assert.deepEqual(aliases[1], asAlias(value.rule));
      assert.equal(aliases[1].payload, value.rule.payload);
    }
    phaseByFacts.set(facts, [...(phaseByFacts.get(facts) ?? []), phase]);
    calls.push({ facts, aliases }); running++; peak = Math.max(peak, running);
    await delay(facts === value.examples[0].facts ? 5 : 1);
    running--;
    return assess(facts, aliases, signal);
  });
  assert.equal(calls.length, 20); assert.equal(peak, 3); assert.equal(running, 0);
  assert.ok(calls.indexOf(calls.find(c => c.facts === value.examples[1].facts && c.aliases.length === 2)!) < 10);
  for (const example of value.examples) assert.deepEqual(phaseByFacts.get(example.facts), ['before', 'after']);
  assert.equal(JSON.stringify(value), original);
  assert.equal(report.passed, true); assert.equal(report.mode, 'simulated');
  assert.equal(report.rule_id, value.rule.id); assert.equal(report.rule_version, 1);
  assert.equal(report.knowledge_revision, 4); assert.equal(report.suite_version, 'alias-v1');
  assert.ok(Date.parse(report.tested_at) >= started && Date.parse(report.tested_at) <= Date.now());
  assert.deepEqual(report.before, { total: 10, correct: 8, false_matches: 0, needs_review: 6 });
  assert.deepEqual(report.after, { total: 10, correct: 10, false_matches: 0, needs_review: 4 });
  assert.deepEqual(report.improved_case_ids, ['valid_a', 'valid_b']);
  assert.deepEqual(report.regressed_case_ids, []); assert.deepEqual(report.reasons, []);
});

test('unsafe duplicate match blocks activation and retains false-match/regression counts', async () => {
  const report = await evaluate_rule(input(), async (facts, aliases, signal) => aliases.length && facts.exact_duplicate_ids.length ? 'matched' : assess(facts, aliases, signal));
  assert.equal(report.passed, false); assert.equal(report.after.false_matches, 1);
  assert.deepEqual(report.regressed_case_ids, ['exact_duplicate']);
  assert.ok(report.reasons.some(reason => reason.includes('unsafe')));
});

test('unchanged, all-unknown, ambiguity-only improvement and safely wrong labels cannot pass', async () => {
  const unchanged = await evaluate_rule(input(), (facts, _aliases, signal) => assess(facts, [], signal));
  assert.equal(unchanged.passed, false); assert.deepEqual(unchanged.improved_case_ids, []);
  const unknown = await evaluate_rule(input(), async () => 'needs_review');
  assert.equal(unknown.passed, false); assert.equal(unknown.after.correct, 4); assert.equal(unknown.after.needs_review, 10);
  const ambiguity = await evaluate_rule(input(), async (facts, aliases, signal) => !facts.receipt && !aliases.length ? 'flagged' : assess(facts, [], signal));
  assert.equal(ambiguity.passed, false); assert.deepEqual(ambiguity.improved_case_ids, ['missing_receipt']);
  const wrong = await evaluate_rule(input(), async (facts, aliases, signal) => aliases.length && facts.receipt?.parsed_fields_json?.currency === 'EUR' ? 'needs_review' : assess(facts, aliases, signal));
  assert.equal(wrong.passed, false); assert.equal(wrong.after.false_matches, 0); assert.equal(wrong.after.correct, 9);
  assert.deepEqual(wrong.regressed_case_ids, ['eur_receipt']);
  const worse = await evaluate_rule(input(), async (facts, aliases, signal) => aliases.length ? 'needs_review' : assess(facts, aliases, signal));
  assert.equal(worse.passed, false); assert.ok(worse.after.correct < worse.before.correct);
  assert.ok(worse.reasons.some(reason => reason.includes('decreased')));
});

test('input mode is retained without claiming the fake is live verification', async () => {
  const value = input(); value.mode = 'live';
  assert.equal((await evaluate_rule(value, assess)).mode, 'live');
});

test('malformed snapshots, altered truth/facts, missing/duplicate cases and alias identities fail before assessment', async () => {
  const changes: ((v: RuleEvaluationInput) => void)[] = [
    v => { v.knowledge_revision = -1; }, v => { v.knowledge_revision = 1.5; }, v => { v.knowledge_revision = NaN; },
    v => { Object.assign(v, { mode: 'auto' }); }, v => { v.rule.state = 'active'; },
    v => { v.examples.pop(); }, v => { v.examples.push(v.examples[0]); }, v => { v.examples[1] = v.examples[0]; },
    v => { v.examples.reverse(); }, v => { v.examples[0].id = ''; },
    v => { v.examples[2].expected_assessment = 'matched'; }, v => { v.examples[0].facts.submission.id = 'bad'; },
    v => { v.examples[1].facts.submission.id = v.examples[0].facts.submission.id; },
    v => { v.examples[0].facts.submission.amount_requested_minor = .5; },
    v => { v.active_aliases = [asAlias(v.rule)]; },
    v => { v.active_aliases = [{ ...asAlias(v.rule), id: 'bad' }]; },
    v => { v.active_aliases = [{ ...asAlias(v.rule), id: '40000000-0000-4000-8000-000000000099', source_correction_id: 'bad' }]; },
    v => { const a = { ...asAlias(v.rule), id: 'aaaaaaaa-0000-4000-8000-000000000099' }; v.active_aliases = [a, { ...a, id: a.id.toUpperCase() }]; },
  ];
  for (const change of changes) {
    const value = input(); change(value); let calls = 0;
    await assert.rejects(evaluate_rule(value, async () => { calls++; return 'matched'; }));
    assert.equal(calls, 0);
  }
});

test('invalid assessor labels, exceptions (including falsy throws) and timeouts reject without partial reports', async () => {
  for (const invalid of [undefined, null, 'approved', {}, 1]) {
    await assert.rejects(evaluate_rule(input(), async () => invalid as Assessment), { code: 'INVALID_PROVIDER_OUTPUT' });
  }
  for (const error of [new Error('Provider unavailable'), new DOMException('Provider timed out', 'TimeoutError'), undefined, null]) {
    let calls = 0; let running = 0;
    const value = input();
    let rejected = false;
    try {
      await evaluate_rule(value, async (facts, aliases, signal) => {
        calls++; const call = calls; running++;
        try {
          if (call === 4) throw error;
          await delay(call === 1 ? 1 : 5);
          return assess(facts, aliases, signal);
        } finally { running--; }
      });
    } catch (caught) { rejected = true; assert.equal(caught, error); }
    assert.equal(rejected, true); assert.equal(running, 0); assert.equal(calls, 4);
  }
});

test('cancellation before, between and at completion discards late results and awaits started work', async () => {
  for (const abortAt of [0, 1, 20]) {
    const controller = new AbortController(); const value = input(); value.signal = controller.signal;
    let calls = 0; let running = 0;
    if (abortAt === 0) controller.abort();
    await assert.rejects(evaluate_rule(value, async (facts, aliases, signal) => {
      calls++; const call = calls; running++;
      try {
        await tick();
        const result = await assess(facts, aliases, signal);
        if (call === abortAt) controller.abort();
        return result;
      } finally { running--; }
    }), { name: 'AbortError' });
    assert.equal(running, 0);
    assert.equal(calls, abortAt === 0 ? 0 : abortAt === 1 ? 3 : 20);
  }
});

test('full intelligence port retains existing search and alias evaluation implementations', () => {
  assert.equal(intelligence.search, search); assert.equal(intelligence.build_rule_suite, build_rule_suite); assert.equal(intelligence.evaluate_rule, evaluate_rule);
});
