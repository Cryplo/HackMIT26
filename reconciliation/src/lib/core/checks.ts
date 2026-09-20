import type { Decision, PolicyRule, Receipt, Submission, SubmissionStatus, Verdict } from '../contracts';
import { parsedReceipt } from './validation';
export function decision(s: Submission, runId: string, field: string, verdict: Verdict, value: unknown, rationale: string, evidence: Record<string, unknown> = {}): Decision {
  return { id: crypto.randomUUID(), run_id: runId, submission_id: s.id, field_checked: field, check_method: 'deterministic', question_type: 'rule', answer_json: { value }, probability: null, confidence_score: null, verdict, rationale_text: rationale, evidence_json: evidence, state_snapshot_json: { submission: s }, model_used: null, created_at: new Date().toISOString() };
}
export function deterministic(s: Submission, r: Receipt | null, policies: PolicyRule[], runId: string): Decision[] {
  const d = (f: string, v: Verdict, value: unknown, why: string, e: Record<string, unknown> = {}) => decision(s, runId, f, v, value, why, e);
  if (!r || r.extraction_status !== 'succeeded' || !parsedReceipt(r.parsed_fields_json)) return [d('extraction', 'unknown', null, 'Receipt extraction is missing, failed, or invalid.')];
  const p = r.parsed_fields_json;
  const eligible = policies.filter(x => x.category === s.category && x.currency === s.currency && x.region_or_route === '*');
  const applicable = p.receipt_date ? eligible.filter(x => x.date_range_start <= p.receipt_date! && x.date_range_end >= p.receipt_date!) : [];
  const checks = [
    d('currency', p.currency === null ? 'unknown' : p.currency === 'USD' ? 'pass' : 'fail', p.currency, p.currency === 'USD' ? 'Receipt currency is USD.' : 'Receipt currency is missing or is not USD.'),
    d('amount', p.amount_minor === null ? 'unknown' : p.amount_minor === s.amount_requested_minor ? 'pass' : 'fail', p.amount_minor === null ? null : p.amount_minor === s.amount_requested_minor, 'Requested and receipt amounts must match exactly in integer cents.', { requested_minor: s.amount_requested_minor, receipt_minor: p.amount_minor }),
    d('policy', applicable.length === 1 ? 'pass' : 'unknown', applicable.length, 'Exactly one policy must cover this category, currency, and receipt date.', { policies: applicable }),
    d('receipt_date', !p.receipt_date || eligible.length === 0 ? 'unknown' : applicable.length ? 'pass' : 'fail', p.receipt_date, 'Receipt date must fall within a configured policy date range.', { policies: eligible }),
  ];
  if (applicable.length === 1) checks.push(d('policy_cap', s.amount_requested_minor <= applicable[0].max_amount_minor ? 'pass' : 'fail', s.amount_requested_minor <= applicable[0].max_amount_minor, 'Requested amount must not exceed the reimbursement cap.', { maximum_minor: applicable[0].max_amount_minor, requested_minor: s.amount_requested_minor }));
  return checks;
}
export const requiredChecks = ['currency','amount','policy','receipt_date','policy_cap','merchant','name','duplicate'];
export function overall(ds: Pick<Decision, 'field_checked' | 'verdict'>[], required: readonly string[] = requiredChecks): SubmissionStatus {
  if (ds.some(d => d.verdict === 'fail')) return 'flagged';
  if (ds.some(d => d.verdict === 'unknown') || required.some(f => !ds.some(d => d.field_checked === f && d.verdict === 'pass'))) return 'needs_review';
  return 'approved';
}
