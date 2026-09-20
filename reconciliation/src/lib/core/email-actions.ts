import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { CoreService } from './service';
import type { StoredMessage, MessageResult } from './communications-state';
import { publicMessage } from './communications-state';
import { composeApplicantMessage } from './applicant-message';
import { emailConfig, assertEmailRecipient } from '../email/config';
import { CoreError } from './validation';
import { workspaceRows } from './projection';
import { assertApprovable } from './safety';
import { emailInput, emailIdentifier, emailDraftSchema, emailEditSchema, emailConfirmationSchema, emailRetrySchema } from './email-validation';

function requireMessage(result: MessageResult): StoredMessage {
  if (!result.message) throw new CoreError('NOT_FOUND', 'Message not found.', 404);
  return result.message;
}

export async function draftDecisionEmail(core: CoreService, claimId: string, raw: unknown, signal?: AbortSignal) {
  emailIdentifier(claimId);
  const input = emailInput(emailDraftSchema, raw);
  const config = emailConfig();
  const state = await core.store.snapshot();
  const submission = state.submissions.find(value => value.id === claimId);
  const row = workspaceRows(state).find(value => value.id === claimId);
  if (!submission || !row) throw new CoreError('NOT_FOUND', 'Claim not found.', 404);
  assertEmailRecipient(config, submission.email);
  if (row.review_revision !== input.expected_review_revision) throw new CoreError('STALE_REVIEW', 'This claim changed. Refresh before drafting a message.', 409);
  if (row.processing_status === 'running') throw new CoreError('RUN_ACTIVE', 'Wait for the current operation before drafting a decision.', 409);
  if (input.kind === 'approval') assertApprovable(row, state.knowledge_revision ?? 0);
  const checks = row.decisions.filter(check => check.check_method !== 'human' && check.field_checked !== 'overall_status');
  if (input.reason_check_ids.some(id => !checks.some(check => check.id === id))) throw new CoreError('STALE_MESSAGE', 'Select reasons from the current assessment.', 409);
  if (input.kind === 'rejection' && !input.applicant_reason && !checks.some(check => input.reason_check_ids.includes(check.id) && check.verdict === 'fail')) {
    throw new CoreError('INVALID_INPUT', 'Provide an applicant-facing reason when rejecting without a selected failed check.');
  }
  const generated = await composeApplicantMessage({
    submission: {id:submission.id,attendee_name:submission.attendee_name,email:submission.email,amount_requested_minor:submission.amount_requested_minor,currency:submission.currency,category:submission.category,origin_location:submission.origin_location,submitted_at:submission.submitted_at},
    checks, kind: input.kind, reason_check_ids: input.reason_check_ids, applicant_reason: input.applicant_reason,
  }, {signal,log: call => core.store.usage(call)});
  if (signal?.aborted) throw new CoreError('REQUEST_ABORTED', 'Draft generation was interrupted. Refresh message history before generating again.', 409);
  const now = new Date().toISOString();
  const id = randomUUID();
  const message: StoredMessage = {
    id, claim_id: claimId, kind: input.kind, intended_verdict: input.kind === 'approval' ? 'approved' : 'rejected',
    draft_revision: 1, message_revision: 1,
    source_review_revision: row.review_revision, source_evidence_revision: submission.evidence_revision ?? 0,
    source_knowledge_revision: state.knowledge_revision ?? 0, assessment_run_id: submission.latest_run_id,
    reason_check_ids: input.reason_check_ids, recipient: submission.email,
    subject: generated.subject, body: generated.body,
    original_generated_subject: generated.original_generated_subject, original_generated_explanation: generated.original_generated_explanation,
    generation_error: generated.generation_error, generation_provenance: generated.generation_provider, generation_model: generated.generation_model,
    correction_id: null, request_id: null, confirmation_payload_hash: null,
    mode: config.mode === 'live' ? 'live' : 'preview', from: null, reply_to: null, outcome_header: null, rendered_text: null, rendered_html: null,
    status: 'draft', provider_message_id: null, idempotency_key: `sift-message/${id}`,
    first_attempt_at: null, attempt_count: 0, next_attempt_at: null, lease_token: null, lease_expires_at: null,
    error: null, created_at: now, updated_at: now, confirmed_at: null,
  };
  // The store rechecks all source revisions after the bounded model call.
  const saved = requireMessage(await core.store.messages({ action: 'draft', message }));
  return {message: publicMessage(saved), generation_error: generated.generation_error};
}

export async function editDecisionEmail(core: CoreService, messageId: string, raw: unknown) {
  emailIdentifier(messageId);
  const input = emailInput(emailEditSchema, raw);
  const existing = requireMessage(await core.store.messages({action:'get', message_id:messageId}));
  assertEmailRecipient(emailConfig(), existing.recipient);
  const saved = requireMessage(await core.store.messages({action:'edit', message_id:messageId, ...input}));
  return {message:publicMessage(saved)};
}

export async function listDecisionEmails(core: CoreService, claimId: string) {
  emailIdentifier(claimId);
  const result = await core.store.messages({action:'list', claim_id:claimId});
  return {messages:(result.messages ?? []).map(publicMessage)};
}

export async function confirmDecisionEmail(core: CoreService, claimId: string, raw: unknown) {
  emailIdentifier(claimId);
  const input = emailInput(emailConfirmationSchema, raw);
  // Stable field order binds retries to exactly the same reviewer-confirmed input.
  const payloadHash = createHash('sha256').update(JSON.stringify({claim_id:claimId,...input})).digest('hex');
  const existing = requireMessage(await core.store.messages({action:'get',message_id:input.message_id}));
  if (existing.claim_id !== claimId) throw new CoreError('NOT_FOUND', 'Message does not belong to this claim.', 404);
  const replay = existing.request_id === input.request_id && existing.confirmation_payload_hash === payloadHash;
  const config = replay ? null : emailConfig();
  // A successful confirmation is recoverable even if sending was subsequently disabled or misconfigured.
  if (config) {
    assertEmailRecipient(config, existing.recipient);
    if (existing.mode !== config.mode) throw new CoreError('STALE_MESSAGE', 'Email mode changed. Generate and review a fresh draft before confirmation.', 409);
  }
  const result = await core.store.messages({
    action:'confirm', message_id:input.message_id, expected_draft_revision:input.expected_draft_revision,
    correction:{submission_id:claimId,expected_review_revision:input.expected_review_revision,human_verdict:input.human_verdict,human_note:input.human_note,correction_type:'decision_override',correction_payload_json:{}},
    request_id:input.request_id,payload_hash:payloadHash,
    mode:config ? config.mode === 'live' ? 'live' : 'preview' : existing.mode === 'live' ? 'live' : 'preview',
    from:config ? config.from : existing.from!,reply_to:config ? config.replyTo : existing.reply_to,
  });
  const message = requireMessage(result);
  // The decision has committed. A projection read failure must not turn it into a failed decision.
  try {
    const row = workspaceRows(await core.store.snapshot()).find(value => value.id === claimId);
    return {row,correction_id:result.correction_id,message:publicMessage(message),refresh_required:!row};
  } catch {
    return {correction_id:result.correction_id,message:publicMessage(message),refresh_required:true};
  }
}

export async function retryDecisionEmail(core: CoreService, messageId: string, raw: unknown) {
  emailIdentifier(messageId);
  const input = emailInput(emailRetrySchema, raw);
  const config = emailConfig();
  if (config.mode !== 'live') throw new CoreError('EMAIL_UNAVAILABLE', 'Enable live email delivery before retrying an existing message.', 503);
  const existing = requireMessage(await core.store.messages({action:'get',message_id:messageId}));
  assertEmailRecipient(config, existing.recipient);
  const message = requireMessage(await core.store.messages({action:'retry',message_id:messageId,...input}));
  return {message:publicMessage(message)};
}
