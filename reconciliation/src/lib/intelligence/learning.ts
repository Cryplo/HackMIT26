import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  ActiveAlias, AssessExample, Assessment, Category, EvaluationCase, EvaluationMetrics,
  MerchantRule, RuleEvaluationInput, RuleTestReport,
} from '../review-contracts';
import { aliasPayload, CoreError, isObject, isUUID, normalize } from '../core/validation';

const caps: Record<Category, number> = { flight: 50000, hotel: 25000, train: 20000, bus: 10000, other: 5000 };
const cases = [
  ['valid_a', 'matched'], ['valid_b', 'matched'], ['overclaim', 'flagged'],
  ['over_cap', 'flagged'], ['exact_duplicate', 'flagged'], ['other_category', 'needs_review'],
  ['eur_receipt', 'flagged'], ['missing_receipt', 'needs_review'],
  ['missing_name', 'needs_review'], ['unrelated_vendor', 'needs_review'],
] as const;
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function validatePayload(value: unknown) {
  const payload = aliasPayload(value);
  if (payload.canonical_vendor.trim().length > 120 ||
      normalize(payload.observed_vendor) === normalize(payload.canonical_vendor) ||
      typeof payload.scope.category !== 'string' || !Object.hasOwn(caps, payload.scope.category) ||
      Reflect.ownKeys(payload.scope).length !== 2 ||
      !Object.hasOwn(payload.scope, 'category') || !Object.hasOwn(payload.scope, 'currency')) {
    throw new CoreError('INVALID_ALIAS', 'Alias needs distinct vendor identities and an exact category/USD scope.');
  }
}

function validateRule(rule: MerchantRule) {
  if (!isObject(rule) || ![rule.id, rule.source_submission_id, rule.source_correction_id].every(isUUID) ||
      !Number.isSafeInteger(rule.version) || rule.version < 1 || !['draft', 'active', 'disabled'].includes(rule.state)) {
    throw new CoreError('INVALID_INPUT', 'Rule needs valid identifiers, version and state.');
  }
  validatePayload(rule.payload);
}

/** Synthetic activation fixtures only; independent of stored claims and the held-out benchmark. */
export function build_rule_suite(rule: MerchantRule): EvaluationCase[] {
  validateRule(rule);
  const category = rule.payload.scope.category;
  const otherCategory: Category = category === 'hotel' ? 'flight' : 'hotel';
  const amount = Math.min(10000, Math.floor(caps[category] / 2));
  // Version-8 UUIDs keep fixture identities deterministic and separate for each rule.
  const id = (kind: string, index: number) => {
    const h = hash(`alias-v1:${rule.id.toLowerCase()}:${kind}:${index}`);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  const policies = (Object.keys(caps) as Category[]).map((category, index) => ({
    id: id('policy', index), category, region_or_route: '*', currency: 'USD' as const,
    max_amount_minor: caps[category], date_range_start: '2026-09-01', date_range_end: '2026-09-30',
    created_at: '2026-09-01T00:00:00.000Z',
  }));
  let unrelatedVendor = 'SYN QXZ 731';
  while ([rule.payload.observed_vendor, rule.payload.canonical_vendor].some(v => normalize(v) === normalize(unrelatedVendor))) unrelatedVendor += ' X';

  const suite = cases.map(([caseId, expected_assessment], index): EvaluationCase => {
    const caseCategory = caseId === 'other_category' ? otherCategory : category;
    const requested = caseId === 'over_cap' ? caps[category] + 1 :
      caseId === 'other_category' ? Math.min(10000, Math.floor(caps[otherCategory] / 2)) : amount + index;
    const submission = {
      id: id('submission', index), attendee_name: `Synthetic Traveler ${index + 1}`,
      email: `activation${index + 1}@example.invalid`, amount_requested_minor: requested,
      currency: 'USD' as const, category: caseCategory, origin_location: 'Synthetic City',
      submitted_at: `2026-09-19T12:${String(index).padStart(2, '0')}:00.000Z`,
    };
    const parsed = {
      schema_version: 1 as const,
      vendor: caseId === 'unrelated_vendor' ? unrelatedVendor : rule.payload.observed_vendor,
      receipt_date: '2026-09-18', amount_minor: caseId === 'overclaim' ? requested - 1 : requested,
      currency: caseId === 'eur_receipt' ? 'EUR' : 'USD',
      names: caseId === 'missing_name' ? [] : [submission.attendee_name],
      receipt_number: `SYN-${rule.id.toLowerCase()}-${String(index + 1).padStart(2, '0')}`,
    };
    const text = `SYNTHETIC FIXTURE ONLY; no uploaded original.\n${JSON.stringify(parsed)}`;
    const receipt = {
      id: id('receipt', index), submission_id: submission.id, file_type: 'text/plain', sha256: hash(text),
      extraction_status: 'succeeded' as const, extraction_error: null,
      parsed_fields_json: parsed, raw_extracted_text: text,
    };
    const facts: EvaluationCase['facts'] = {
      submission, receipt: caseId === 'missing_receipt' ? null : receipt,
      policies: structuredClone(policies), related_claims: [], exact_duplicate_ids: [],
    };
    if (caseId === 'exact_duplicate') {
      const priorId = id('submission', cases.length);
      facts.related_claims = [{
        submission: { ...submission, id: priorId, submitted_at: '2026-09-19T11:00:00.000Z' },
        receipt: { ...structuredClone(receipt), id: id('receipt', cases.length), submission_id: priorId },
        decision_status: 'approved',
      }];
      facts.exact_duplicate_ids = [priorId];
    }
    return { id: caseId, facts, expected_assessment };
  });
  const submissionIds = suite.flatMap(({ facts }) => [facts.submission.id, ...facts.related_claims.map(c => c.submission.id)]);
  if (new Set(submissionIds).size !== submissionIds.length || submissionIds.includes(rule.source_submission_id.toLowerCase())) {
    throw new CoreError('INVALID_INPUT', 'Activation fixture identities must be unique and exclude the source claim.');
  }
  return suite;
}

/** Paired, read-only evaluation. B owns provider diagnostics, persistence and activation. */
export async function evaluate_rule(input: RuleEvaluationInput, assess: AssessExample): Promise<RuleTestReport> {
  const { rule, examples, signal } = input;
  const suite = build_rule_suite(rule);
  if (!rule.source_correction_id || rule.prepared_demo || rule.state !== 'draft' || !Number.isSafeInteger(input.knowledge_revision) || input.knowledge_revision < 0 ||
      !['live', 'simulated'].includes(input.mode) || !Array.isArray(input.active_aliases)) {
    throw new CoreError('INVALID_INPUT', 'Evaluation requires a draft rule, knowledge revision, provider mode and active aliases.');
  }
  // Enforce the frozen facts, truth, identities and order; callers cannot weaken the activation suite.
  if (!isDeepStrictEqual(examples, suite)) throw new CoreError('INVALID_INPUT', 'Evaluation requires the complete, unchanged alias-v1 suite.');
  const aliasIds = new Set<string>();
  for (const alias of input.active_aliases) {
    if (!isObject(alias) || !isUUID(alias.id) || !isUUID(alias.source_correction_id) ||
        alias.id.toLowerCase() === rule.id.toLowerCase() || aliasIds.has(alias.id.toLowerCase())) {
      throw new CoreError('INVALID_INPUT', 'Active alias identities must be valid, unique and exclude the candidate.');
    }
    validatePayload(alias.payload);
    aliasIds.add(alias.id.toLowerCase());
  }
  const beforeAliases = input.active_aliases;
  const afterAliases: ActiveAlias[] = [...beforeAliases, { id: rule.id, source_correction_id: rule.source_correction_id, payload: rule.payload }];
  const outcomes: { before: Assessment; after: Assessment }[] = new Array(examples.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  const validateAssessment = (value: unknown): Assessment => {
    if (value !== 'matched' && value !== 'flagged' && value !== 'needs_review') {
      throw new CoreError('INVALID_PROVIDER_OUTPUT', 'Assessor returned an invalid assessment.', 503);
    }
    return value;
  };
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (!failed && next < examples.length) {
      try {
        signal.throwIfAborted();
        const index = next++;
        const example = examples[index];
        const before = validateAssessment(await assess(example.facts, beforeAliases, signal));
        signal.throwIfAborted();
        if (failed) return;
        const after = validateAssessment(await assess(example.facts, afterAliases, signal));
        signal.throwIfAborted();
        outcomes[index] = { before, after };
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  }));
  if (failed) throw failure;
  signal.throwIfAborted();

  const metrics = (phase: 'before' | 'after'): EvaluationMetrics => ({
    total: outcomes.length,
    correct: outcomes.filter((outcome, i) => outcome[phase] === examples[i].expected_assessment).length,
    false_matches: outcomes.filter((outcome, i) => outcome[phase] === 'matched' && examples[i].expected_assessment !== 'matched').length,
    needs_review: outcomes.filter(outcome => outcome[phase] === 'needs_review').length,
  });
  const before = metrics('before');
  const after = metrics('after');
  const improved_case_ids = examples.filter((e, i) => outcomes[i].before !== e.expected_assessment && outcomes[i].after === e.expected_assessment).map(e => e.id);
  const regressed_case_ids = examples.filter((e, i) => outcomes[i].before === e.expected_assessment && outcomes[i].after !== e.expected_assessment).map(e => e.id);
  const newlyMatched = examples.some((e, i) => e.expected_assessment === 'matched' && outcomes[i].before !== 'matched' && outcomes[i].after === 'matched');
  const reasons: string[] = [];
  if (!newlyMatched) reasons.push('No valid purchase newly matched.');
  if (after.false_matches) reasons.push('The candidate produced unsafe matches.');
  if (regressed_case_ids.length) reasons.push('Previously correct cases regressed.');
  if (after.correct < before.correct) reasons.push('The correct assessment count decreased.');
  return {
    rule_id: rule.id, rule_version: rule.version, knowledge_revision: input.knowledge_revision,
    suite_version: 'alias-v1', mode: input.mode, tested_at: new Date().toISOString(),
    passed: reasons.length === 0, improved_case_ids, regressed_case_ids, reasons, before, after,
  };
}
