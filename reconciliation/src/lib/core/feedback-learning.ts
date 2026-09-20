import type { CoreService } from './service';
import { changeProcedure } from './procedures';
import { classifyFeedback, feedbackVeto } from './feedback-learning-classifier';
import { feedbackCandidate, feedbackJob } from './feedback-learning-state';
import { latestCorrection } from './safety';
import { workspaceRows } from './projection';
import { CoreError, normalize } from './validation';

/** The queue is committed with the human correction; this worker never changes that decision. */
export async function processFeedbackLearning(core: CoreService, correctionId: string, signal = AbortSignal.timeout(600000)) {
  const started = await core.store.feedbackLearning({ action: 'start', correction_id: correctionId });
  if (!started.acquired || !started.job?.lease) return;
  const lease = started.job.lease;
  const finish = (status: 'active' | 'not_applicable' | 'needs_confirmation' | 'failed', summary: string) => core.store.feedbackLearning({ action: 'finish', correction_id: correctionId, lease, status, summary });
  try {
    const state = await core.store.snapshot(), correction = state.corrections.find(c => c.id === correctionId)!;
    const veto = feedbackVeto(correction.human_note);
    if (veto === 'policy_change') { await finish('needs_confirmation', 'This reason proposes a policy change. Administrator confirmation is required; no rule changed.'); return; }
    if (correction.human_verdict !== 'approved' || veto === 'one_time') { await finish('not_applicable', 'Saved as a decision for this claim only. No reusable rule was created.'); return; }
    const source = feedbackCandidate(state, correction);
    if (!source) { await finish('not_applicable', 'The current receipt and booking do not support a reusable identity check. Your decision is preserved.'); return; }
    const intent = await classifyFeedback(core, correction.human_note, source.candidate, signal);
    signal.throwIfAborted();
    if (intent !== 'booking_reference_identity') {
      await finish(intent === 'policy_change' ? 'needs_confirmation' : 'not_applicable', intent === 'policy_change' ? 'Policy changes require confirmation. No policy or rule changed.' : 'This reason does not establish a reusable booking-reference check. Your decision is preserved.'); return;
    }
    const proposed = await core.store.feedbackLearning({ action: 'propose', correction_id: correctionId, lease, mode: core.demoMode ? 'simulated' : 'live' });
    if (proposed.job?.status === 'active') return; // A current, equivalent tested procedure already exists.
    const id = proposed.job!.procedure_id!;
    const report = await changeProcedure(core, id, 'test', { expected_procedure_version: 1 }, signal);
    if (!('passed' in report) || !report.passed) { await finish('failed', 'The safety test did not pass. No check was activated; your decision is preserved.'); return; }
    signal.throwIfAborted();
    await changeProcedure(core, id, 'activate', { expected_procedure_version: 1 }, signal);
    // A knowledge change invalidates previous machine approvals globally. Recheck matching claims first,
    // then other undecided claims; never turn a human decision into machine feedback.
    const after = await core.store.snapshot();
    const ids = workspaceRows(after).filter(row => !latestCorrection(after, row.id) && row.processing_status !== 'running')
      .sort((a, b) => Number(normalize(b.receipt?.parsed_fields_json?.vendor ?? '') === normalize(source.candidate.trigger_scope.observed_vendor)) - Number(normalize(a.receipt?.parsed_fields_json?.vendor ?? '') === normalize(source.candidate.trigger_scope.observed_vendor))).map(row => row.id);
    for (const claimId of ids) {
      if (signal.aborted) break;
      const current = await core.store.snapshot();
      const owner = current.corrections.find(c => c.id === correctionId);
      if (!owner || latestCorrection(current, owner.submission_id)?.id !== correctionId || !current.procedures?.some(p => p.id === id && p.state === 'active')) break;
      if (latestCorrection(current, claimId) || current.runs.some(run => run.submission_id === claimId && run.status === 'running')) continue;
      await core.reconcile([claimId], signal);
    }
  } catch (error) {
    const status = feedbackJob((await core.store.snapshot()).corrections.find(c => c.id === correctionId));
    if (status?.status === 'active') return; // Activation is committed; remaining claims can be rechecked normally.
    await finish('failed', error instanceof CoreError && ['STALE_FEEDBACK', 'STALE_RULE', 'STALE_RULE_TEST'].includes(error.code)
      ? 'The review, evidence or saved rules changed. Review the saved evidence before retrying learning.'
      : 'Learning could not complete. No new check was activated. Retry learning after reviewing the saved evidence.').catch(() => undefined);
  }
}
