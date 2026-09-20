import type { Correction } from '../contracts';
import type { LearningFeedback } from '../review-contracts';
import type { Snapshot } from './store';
import type { StoredProcedure } from './procedure-state';
import { sourceFingerprint } from './procedure-state';
import { deriveCandidate } from './evidence';
import { deterministic } from './checks';
import { confirmedDuplicates, latestCorrection, reviewRevision } from './safety';
import { CoreError, isObject, normalize } from './validation';

export const FEEDBACK_LEASE_MS = 15 * 60 * 1000;
export interface FeedbackJob extends LearningFeedback {
  source_review_revision: number; source_evidence_revision: number; source_fingerprint: string;
  lease?: string; lease_expires_at: string; mode?: 'live' | 'simulated';
}
export type FeedbackCommand =
  | { action: 'enqueue'; correction_id: string }
  | { action: 'expire' }
  | { action: 'start'; correction_id: string }
  | { action: 'retry'; correction_id: string; expected_review_revision: number }
  | { action: 'propose'; correction_id: string; lease: string; mode: 'live' | 'simulated' }
  | { action: 'finish'; correction_id: string; lease: string; status: 'active' | 'not_applicable' | 'needs_confirmation' | 'failed'; summary: string };
export interface FeedbackResult { job: FeedbackJob | null; acquired?: boolean }
export function feedbackJob(correction?: Correction): FeedbackJob | null {
  const value = correction?.correction_payload_json.feedback_learning;
  return isObject(value) && typeof value.status === 'string' ? value as unknown as FeedbackJob : null;
}
export function publicLearning(state: Snapshot, correction?: Correction): LearningFeedback | undefined {
  const job = feedbackJob(correction);
  if (!job) return;
  const { status, summary, procedure_id, updated_at } = job;
  if (status === 'active' && (latestCorrection(state, correction!.submission_id)?.id !== correction!.id || state.submissions.find(s => s.id === correction!.submission_id)?.evidence_revision !== job.source_evidence_revision || !state.procedures?.some(p => p.id === procedure_id && p.state === 'active' && latestCorrection(state, p.source_claim_id)?.id === p.source_correction_id && state.submissions.find(s => s.id === p.source_claim_id)?.evidence_revision === p.source_evidence_revision))) {
    return { status: 'failed', summary: 'The saved check or its source changed. Retry learning after reviewing the saved evidence.', updated_at };
  }
  if (['queued', 'checking', 'testing'].includes(status) && Date.parse(job.lease_expires_at) <= Date.now()) {
    return { status: 'failed', summary: 'Learning was interrupted. Retry learning after reviewing the saved evidence.', updated_at };
  }
  return { status, summary, ...(procedure_id ? { procedure_id } : {}), updated_at };
}
export function feedbackSourceCurrent(state: Snapshot, correction: Correction, job: FeedbackJob, requireReviewRevision = true) {
  const s = state.submissions.find(s => s.id === correction.submission_id);
  return !!s && latestCorrection(state, s.id)?.id === correction.id && (!requireReviewRevision || s.review_revision === job.source_review_revision)
    && (s.evidence_revision ?? 0) === job.source_evidence_revision && sourceFingerprint(state, s.id) === job.source_fingerprint;
}
export function guardFeedbackLease(state: Snapshot, correction: Correction, job: FeedbackJob, lease: string) {
  if (job.lease !== lease || !['checking', 'testing'].includes(job.status) || Date.parse(job.lease_expires_at) <= Date.now() || !feedbackSourceCurrent(state, correction, job)) {
    throw new CoreError('STALE_FEEDBACK', 'Review feedback changed or its processing lease expired.', 409);
  }
}
export function feedbackCandidate(state: Snapshot, correction: Correction) {
  const s = state.submissions.find(s => s.id === correction.submission_id), receipt = state.receipts.find(r => r.submission_id === correction.submission_id);
  if (!s || correction.human_verdict !== 'approved' || s.decision_status !== 'approved' || latestCorrection(state, s.id)?.id !== correction.id
    || !receipt?.parsed_fields_json?.names.some(name => normalize(name) === normalize(s.attendee_name))
    || receipt.extraction_status !== 'succeeded' || deterministic(s, receipt, state.policies, 'feedback').some(d => d.verdict !== 'pass')
    || confirmedDuplicates(state, s.id).length) return null;
  const run = state.runs.find(r => r.id === s.latest_run_id && r.status === 'completed' && r.evidence_revision === s.evidence_revision);
  if (!run) return null;
  const checks = state.decisions.filter(d => d.run_id === run.id && d.check_method !== 'human' && d.field_checked !== 'overall_status');
  if (checks.some(d => d.verdict === 'fail') || ['currency', 'amount', 'policy', 'receipt_date', 'policy_cap', 'duplicate', 'name'].some(field => !checks.some(d => d.field_checked === field && d.verdict === 'pass'))) return null;
  const candidate = deriveCandidate(state, s.id);
  return candidate && normalize(candidate.trigger_scope.observed_vendor) !== normalize(candidate.trigger_scope.canonical_vendor) ? { candidate, run } : null;
}
export function mutateFeedback(state: Snapshot, command: FeedbackCommand): FeedbackResult {
  const now = new Date().toISOString();
  if (command.action === 'expire') {
    for (const correction of state.corrections) {
      const job = feedbackJob(correction);
      if (job && ((['queued', 'checking', 'testing'].includes(job.status) && (Date.parse(job.lease_expires_at) <= Date.now() || !feedbackSourceCurrent(state, correction, job))) || (job.status === 'active' && publicLearning(state, correction)?.status !== 'active'))) {
        Object.assign(job, { status: 'failed', summary: 'Learning was interrupted or the source changed. Retry learning after reviewing the saved evidence.', updated_at: now });
      }
    }
    return { job: null };
  }
  const correction = state.corrections.find(c => c.id === command.correction_id);
  if (!correction) throw new CoreError('NOT_FOUND', 'Review feedback not found.', 404);
  let job = feedbackJob(correction);
  if (command.action === 'enqueue') {
    if (job) return { job: structuredClone(job) };
    if (latestCorrection(state, correction.submission_id)?.id !== correction.id) throw new CoreError('STALE_FEEDBACK', 'A newer review replaced this feedback.', 409);
    job = { status: 'queued', summary: 'Review reason saved. Checking for a reusable evidence rule.', updated_at: now,
      source_review_revision: reviewRevision(state, correction.submission_id), source_evidence_revision: state.submissions.find(s => s.id === correction.submission_id)!.evidence_revision ?? 0,
      source_fingerprint: sourceFingerprint(state, correction.submission_id), lease_expires_at: new Date(Date.now() + FEEDBACK_LEASE_MS).toISOString() };
    correction.correction_payload_json.feedback_learning = job;
  } else {
    if (!job) throw new CoreError('NOT_FOUND', 'Review feedback was not queued.', 404);
    if (command.action === 'retry') {
      if (job.status !== 'failed' || reviewRevision(state, correction.submission_id) !== command.expected_review_revision || !feedbackSourceCurrent(state, correction, job, false)) throw new CoreError('STALE_FEEDBACK', 'Only failed, unchanged review feedback can be retried.', 409);
      job = { status: 'queued', summary: 'Review reason queued for another learning attempt.', updated_at: now,
        source_review_revision: command.expected_review_revision, source_evidence_revision: job.source_evidence_revision, source_fingerprint: job.source_fingerprint,
        lease_expires_at: new Date(Date.now() + FEEDBACK_LEASE_MS).toISOString() };
      correction.correction_payload_json.feedback_learning = job;
      return { job: structuredClone(job) };
    }
    if (command.action === 'start') {
      if (job.status !== 'queued') return { job: structuredClone(job), acquired: false };
      if (!feedbackSourceCurrent(state, correction, job) || Date.parse(job.lease_expires_at) <= Date.now()) {
        Object.assign(job, { status: 'failed', summary: 'Learning was interrupted or the source changed. Retry learning after reviewing the saved evidence.', updated_at: now });
        return { job: structuredClone(job), acquired: false };
      }
      Object.assign(job, { status: 'checking', summary: 'Checking whether the review reason supports a narrow evidence rule.', lease: crypto.randomUUID(), updated_at: now, lease_expires_at: new Date(Date.now() + FEEDBACK_LEASE_MS).toISOString() });
      return { job: structuredClone(job), acquired: true };
    }
    guardFeedbackLease(state, correction, job, command.lease);
    if (command.action === 'propose') {
      if (job.status !== 'checking' || job.procedure_id) throw new CoreError('STALE_FEEDBACK', 'Feedback has already proposed a check.', 409);
      const source = feedbackCandidate(state, correction);
      if (!source) throw new CoreError('PROCEDURE_SOURCE_REQUIRED', 'Current approval and matching purchase evidence are required.', 409);
      const reusable = state.procedures?.find(p => p.state === 'active' && p.latest_test?.passed && p.latest_test.mode === command.mode
        && Object.entries(source.candidate.trigger_scope).every(([key, value]) => normalize(String(p.trigger_scope[key as keyof typeof p.trigger_scope])) === normalize(value))
        && latestCorrection(state, p.source_claim_id)?.id === p.source_correction_id && latestCorrection(state, p.source_claim_id)?.human_verdict === 'approved'
        && sourceFingerprint(state, p.source_claim_id) === p.source_fingerprint);
      if (reusable) {
        Object.assign(job, { status: 'active', summary: 'An existing tested booking-reference check already covers this evidence. No duplicate rule was created.', procedure_id: reusable.id, mode: command.mode, updated_at: now });
        return { job: structuredClone(job) };
      }
      const procedure: StoredProcedure = { ...source.candidate, id: crypto.randomUUID(), version: 1, state: 'draft', source_kind: 'review_feedback',
        source_claim_id: correction.submission_id, source_run_id: source.run.id, source_correction_id: correction.id,
        source_evidence_revision: job.source_evidence_revision, source_fingerprint: job.source_fingerprint, feedback_lease: command.lease,
        created_at: now, latest_test: null, latest_test_error: null };
      (state.procedures ??= []).push(procedure); (state.procedure_history ??= []).push(structuredClone(procedure));
      Object.assign(job, { status: 'testing', summary: `${command.mode === 'simulated' ? 'Simulated' : 'Live'} safety test running on twelve cases.`, procedure_id: procedure.id, mode: command.mode });
    } else {
      if (command.status === 'active' && !state.procedures?.some(p => p.id === job!.procedure_id && p.source_correction_id === correction.id && p.state === 'active')) throw new CoreError('STALE_FEEDBACK', 'No active tested check exists for this feedback.', 409);
      if (!command.summary.trim() || command.summary.length > 500) throw new CoreError('INVALID_INPUT', 'A bounded feedback status is required.');
      Object.assign(job, { status: command.status, summary: command.summary });
    }
    job.updated_at = now;
  }
  return { job: structuredClone(job) };
}
