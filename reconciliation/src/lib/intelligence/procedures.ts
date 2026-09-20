import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  AssessProcedureExample, Assessment, EvaluationMetrics, ProcedureAssessmentObservation,
  ProcedureEvaluationCase, ProcedureEvaluationInput, ProcedureTestReport, ResolutionProcedure,
} from '../review-contracts';
import { requiredChecks } from '../core/checks';
import { CUSTOM_FIELD } from '../core/custom-checks';
import { aliasPayload, CoreError, isObject, isUUID, normalize } from '../core/validation';

const cases = [
  ['valid_a', 'matched'], ['valid_b', 'matched'], ['missing_booking', 'needs_review'],
  ['conflicting_reference', 'needs_review'], ['unrelated_descriptor', 'needs_review'],
  ['missing_traveler', 'needs_review'], ['overclaim', 'flagged'], ['over_cap', 'flagged'],
  ['non_usd', 'flagged'], ['out_of_policy_date', 'flagged'], ['exact_duplicate', 'flagged'],
  ['wrong_category', 'matched'],
] as const;
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const invalid = (message: string): never => { throw new CoreError('INVALID_PROCEDURE_TEST', message, 503); };

function validateProcedure(p: ResolutionProcedure) {
  if (!isObject(p) || ![p.id, p.source_claim_id, p.source_run_id, p.source_correction_id].every(isUUID) ||
      !Number.isSafeInteger(p.version) || p.version < 1 || !['draft', 'active', 'disabled'].includes(p.state) ||
      p.kind !== 'booking_reference_identity' || !isObject(p.trigger_scope)) {
    invalid('A valid versioned booking-reference procedure is required.');
  }
  const s = p.trigger_scope;
  if (s.category !== 'hotel' || s.currency !== 'USD' || Reflect.ownKeys(s).length !== 4 ||
      [s.observed_vendor, s.canonical_vendor].some(v => typeof v !== 'string' || !v.trim() || v.length > 200) ||
      !isDeepStrictEqual(p.required_evidence, ['receipt', 'booking_confirmation']) ||
      !isDeepStrictEqual(p.matching_fields, ['booking_reference']) ||
      !Array.isArray(p.source_evidence_refs) || p.source_evidence_refs.length < 2 ||
      p.source_evidence_refs.some(r => !isObject(r) || !isUUID(r.id) || !['receipt', 'supporting_document'].includes(r.kind)) ||
      !['receipt', 'supporting_document'].every(kind => p.source_evidence_refs.some(r => r.kind === kind)) ||
      new Set(p.source_evidence_refs.map(r => r.id.toLowerCase())).size !== p.source_evidence_refs.length) {
    invalid('The procedure needs exact hotel/USD merchant scope and distinct receipt/booking source references.');
  }
}

/** Independent synthetic activation evidence; never reads source, demo or benchmark claims. */
export function build_procedure_suite(procedure: ResolutionProcedure): ProcedureEvaluationCase[] {
  validateProcedure(procedure);
  const id = (kind: string, index: number) => {
    const h = hash(`booking-reference-v1:${procedure.id.toLowerCase()}:${kind}:${index}`);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  const policies = (['hotel', 'flight'] as const).map((category, index) => ({
    id: id('policy', index), category, region_or_route: '*', currency: 'USD' as const,
    claimant_identity_evidence: 'receipt_only' as const, max_amount_minor: category === 'hotel' ? 25000 : 50000,
    date_range_start: '2026-09-01', date_range_end: '2026-09-30', created_at: '2026-09-01T00:00:00.000Z',
  }));
  let unrelated = 'SYN QXZ 731';
  while ([procedure.trigger_scope.observed_vendor, procedure.trigger_scope.canonical_vendor].some(v => normalize(v) === normalize(unrelated))) unrelated += ' X';
  const suite = cases.map(([caseId, expected_assessment], index): ProcedureEvaluationCase => {
    const wrongCategory = caseId === 'wrong_category';
    const requested = caseId === 'over_cap' ? 25001 : 10000 + index;
    const submission = {
      id: id('submission', index), attendee_name: `Synthetic Traveler ${index + 1}`,
      email: `booking${index + 1}@example.invalid`, amount_requested_minor: requested, currency: 'USD' as const,
      category: wrongCategory ? 'flight' as const : 'hotel' as const, origin_location: 'Synthetic City',
      submitted_at: `2026-09-19T12:${String(index).padStart(2, '0')}:00.000Z`,
    };
    const reference = `SYN-${procedure.id.toLowerCase()} / ${index + 1}`;
    const parsed = {
      schema_version: 1 as const,
      vendor: wrongCategory ? 'Synthetic Sky Airlines' : caseId === 'unrelated_descriptor' ? unrelated : procedure.trigger_scope.observed_vendor,
      receipt_date: caseId === 'out_of_policy_date' ? '2026-10-01' : '2026-09-18',
      amount_minor: caseId === 'overclaim' ? requested - 1 : requested,
      currency: caseId === 'non_usd' ? 'EUR' : 'USD',
      names: caseId === 'missing_traveler' ? [] : [submission.attendee_name],
      receipt_number: `SYN-RECEIPT-${procedure.id.toLowerCase()}-${index + 1}`,
    };
    const receiptText = `SYNTHETIC FIXTURE ONLY; no uploaded original.\nBooking reference: ${reference}\n${JSON.stringify(parsed)}`;
    const receipt = {
      id: id('receipt', index), submission_id: submission.id, file_type: 'text/plain', sha256: hash(receiptText),
      extraction_status: 'succeeded' as const, extraction_error: null, extraction_provenance: 'synthetic activation fixture',
      parsed_fields_json: parsed, raw_extracted_text: receiptText,
    };
    const bookingFacts = {
      vendor: wrongCategory ? 'Synthetic Sky Airlines' : caseId === 'unrelated_descriptor' ? unrelated : procedure.trigger_scope.canonical_vendor,
      booking_reference: caseId === 'conflicting_reference' ? `${reference}-OTHER` :
        caseId === 'valid_b' ? `  ${reference.toUpperCase().replace(' / ', '   /   ')}  ` : reference,
      receipt_number: null, names: [...parsed.names], purchase_date: parsed.receipt_date,
      currency: parsed.currency, amount_minor: parsed.amount_minor,
    };
    const bookingText = `SYNTHETIC FIXTURE ONLY; no uploaded original.\nMerchant: ${bookingFacts.vendor}\nBooking reference: ${bookingFacts.booking_reference}\nGuests: ${bookingFacts.names.join(', ')}\n${JSON.stringify(bookingFacts)}`;
    const facts: ProcedureEvaluationCase['facts'] = {
      submission, receipt, policies: structuredClone(policies), related_claims: [], exact_duplicate_ids: [],
      supporting_documents: caseId === 'missing_booking' ? [] : [{
        id: id('booking', index), claim_id: submission.id, kind: 'booking_confirmation', file_type: 'text/plain',
        sha256: hash(bookingText), created_at: '2026-09-19T10:00:00.000Z', extraction_status: 'succeeded',
        extraction_error: null, extraction_provenance: 'synthetic activation fixture', extracted_text: bookingText, facts: bookingFacts,
      }],
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
  const identities = [...policies.map(p => p.id), ...suite.flatMap(({ facts: f }) => [
    f.submission.id, f.receipt!.id, ...f.supporting_documents.map(d => d.id),
    ...f.related_claims.flatMap(c => [c.submission.id, c.receipt!.id]),
  ])];
  const source = [procedure.id, procedure.source_claim_id, procedure.source_run_id, procedure.source_correction_id,
    ...procedure.source_evidence_refs.map(r => r.id)].map(value => value.toLowerCase());
  if (new Set(identities).size !== identities.length || identities.some(value => source.includes(value))) {
    invalid('Activation identities must be unique and exclude all source evidence.');
  }
  return suite;
}

/** Calls only the injected production assessor; core owns persistence and activation. */
export async function evaluate_procedure(input: ProcedureEvaluationInput, assess: AssessProcedureExample): Promise<ProcedureTestReport> {
  const { procedure, examples, signal } = input;
  const suite = build_procedure_suite(procedure);
  if (procedure.state !== 'draft' || !Number.isSafeInteger(input.knowledge_revision) || input.knowledge_revision < 0 ||
      !['simulated', 'live'].includes(input.mode) || !Array.isArray(input.active_aliases) ||
      !Array.isArray(input.active_procedures) || typeof input.get_observations !== 'function') {
    invalid('Evaluation requires draft procedure, current knowledge, provider mode and actual scorer observations.');
  }
  if (!isDeepStrictEqual(examples, suite)) invalid('The complete, unchanged booking-reference-v1 suite is required.');
  const knowledgeIds = new Set([procedure.id.toLowerCase()]);
  for (const alias of input.active_aliases) {
    if (!isObject(alias) || !isUUID(alias.id) || !isUUID(alias.source_correction_id) || knowledgeIds.has(alias.id.toLowerCase())) {
      invalid('Active knowledge identities must be unique and exclude the candidate.');
    }
    const payload = aliasPayload(alias.payload);
    if (typeof payload.scope.category !== 'string' || Reflect.ownKeys(payload.scope).length !== 2) invalid('Active aliases require exact category/USD scope.');
    knowledgeIds.add(alias.id.toLowerCase());
  }
  for (const active of input.active_procedures) {
    validateProcedure(active);
    if (active.state !== 'active' || knowledgeIds.has(active.id.toLowerCase())) invalid('Only distinct active procedures may precede the candidate.');
    knowledgeIds.add(active.id.toLowerCase());
  }
  if (input.get_observations!().length) invalid('Procedure testing requires a fresh observation collection.');
  signal.throwIfAborted();
  const beforeProcedures = input.active_procedures;
  const afterProcedures: ResolutionProcedure[] = [...beforeProcedures, { ...procedure, state: 'active' }];
  const outcomes: { before: Assessment; after: Assessment }[] = new Array(examples.length);
  const assessment = (value: Assessment) => {
    if (!['matched', 'flagged', 'needs_review'].includes(value)) invalid('The assessor returned an invalid assessment.');
    return value;
  };
  let next = 0, failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (!failed && next < examples.length) {
      try {
        signal.throwIfAborted();
        const index = next++, { facts } = examples[index];
        const before = assessment(await assess(facts, input.active_aliases, beforeProcedures, signal));
        signal.throwIfAborted();
        if (failed) return;
        const after = assessment(await assess(facts, input.active_aliases, afterProcedures, signal));
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
  if (!isDeepStrictEqual(examples, suite)) invalid('Assessment changed the frozen procedure facts.');
  const observations = input.get_observations!();
  if (observations.length !== 24 || observations.some(o => o.error_code || !o.assessment || !Array.isArray(o.checks) || !o.checks.length)) {
    invalid('All 24 successful assessment observations are required.');
  }
  const observed = (e: ProcedureEvaluationCase, index: number, phase: 'before' | 'after'): ProcedureAssessmentObservation => {
    const matches = observations.filter(o => o.case_id === e.id && o.phase === phase);
    const o = matches[0];
    if (matches.length !== 1 || o.submission_id !== e.facts.submission.id || o.assessment !== outcomes[index][phase] ||
        !isDeepStrictEqual(o.alias_ids, input.active_aliases.map(a => a.id)) ||
        !isDeepStrictEqual(o.procedure_ids, (phase === 'before' ? beforeProcedures : afterProcedures).map(p => p.id)) ||
        o.checks.some(c => c.check_method === 'jev' && c.evidence_json.simulated !== (input.mode === 'simulated'))) {
      invalid('Each case needs one correctly bound, mode-consistent observation per phase.');
    }
    return o;
  };
  const applied_case_ids: string[] = [], regressed_case_ids: string[] = [];
  let protectedRegression = false;
  examples.forEach((e, index) => {
    const before = observed(e, index, 'before'), after = observed(e, index, 'after');
    if (before.assessment === e.expected_assessment && after.assessment !== e.expected_assessment) regressed_case_ids.push(e.id);
    if ([...requiredChecks, ...new Set([...before.checks, ...after.checks].map(c => c.field_checked).filter(f => CUSTOM_FIELD.test(f)))].some(field => (['pass', 'fail'] as const).some(verdict =>
      before.checks.some(c => c.field_checked === field && c.verdict === verdict) &&
      !after.checks.some(c => c.field_checked === field && c.verdict === verdict)))) protectedRegression = true;
    if (after.assessment === e.expected_assessment && after.checks.some(c => {
      const proof = c.evidence_json, refs = proof.evidence_refs;
      return c.field_checked === 'merchant' && c.verdict === 'pass' && proof.exact_method === 'booking_reference_identity' &&
        Array.isArray(proof.procedure_ids) && proof.procedure_ids.includes(procedure.id) && Array.isArray(refs) &&
        refs.some(r => isObject(r) && r.kind === 'receipt' && r.id === e.facts.receipt!.id) &&
        refs.some(r => isObject(r) && r.kind === 'supporting_document' && e.facts.supporting_documents.some(d => d.id === r.id)) &&
        refs.some(r => isObject(r) && r.kind === 'procedure' && r.id === procedure.id);
    })) applied_case_ids.push(e.id);
  });
  const metrics = (phase: 'before' | 'after'): EvaluationMetrics => ({
    total: outcomes.length, correct: outcomes.filter((o, i) => o[phase] === examples[i].expected_assessment).length,
    false_matches: outcomes.filter((o, i) => o[phase] === 'matched' && examples[i].expected_assessment !== 'matched').length,
    needs_review: outcomes.filter(o => o[phase] === 'needs_review').length,
  });
  const before = metrics('before'), after = metrics('after'), reasons: string[] = [];
  if (!applied_case_ids.some(id => ['valid_a', 'valid_b'].includes(id))) reasons.push('No independent valid purchase correctly used the procedure.');
  if (after.false_matches) reasons.push('The candidate produced unsafe matches.');
  if (regressed_case_ids.length) reasons.push('Previously correct cases regressed.');
  if (protectedRegression) reasons.push('A protected check regressed.');
  if (after.correct < before.correct) reasons.push('The correct assessment count decreased.');
  return {
    procedure_id: procedure.id, procedure_version: procedure.version, knowledge_revision: input.knowledge_revision,
    suite_version: 'booking-reference-v1', mode: input.mode, tested_at: new Date().toISOString(),
    passed: reasons.length === 0, applied_case_ids, regressed_case_ids, before, after, reasons,
  };
}
