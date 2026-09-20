import type { CorrectionInput, SubmissionStatus } from '../contracts';
import type { Snapshot } from './store';
import { CoreError } from './validation';
import { latestCorrection, reviewRevision } from './safety';
import { hasAutomaticApproval } from './automation';

/** Stored and reviewer-visible message. Transport credentials never belong here. */
export interface ClaimMessage {
  decision_source?: 'human' | 'automatic';
  automatic_decision_key?: string;
  decision_payload_hash?: string;
  id: string;
  claim_id: string;
  kind: 'approval' | 'rejection';
  intended_verdict: 'approved' | 'rejected';
  draft_revision: number;
  message_revision: number;
  source_review_revision: number;
  source_evidence_revision: number;
  source_knowledge_revision: number;
  assessment_run_id: string | null;
  reason_check_ids: string[];
  recipient: string;
  subject: string;
  body: string;
  original_generated_subject: string;
  original_generated_explanation: string;
  generation_error: string | null;
  generation_provenance: string;
  generation_model: string | null;
  correction_id: string | null;
  request_id: string | null;
  confirmation_payload_hash: string | null;
  mode: 'preview' | 'live' | null;
  from: string | null;
  reply_to: string | null;
  /** Fixed authoritative header, frozen on confirmation. body is editable explanation only. */
  outcome_header: string | null;
  rendered_text: string | null;
  rendered_html: string | null;
  status: 'draft' | 'previewed' | 'queued' | 'sending' | 'accepted' | 'failed' | 'delivery_unknown' | 'cancelled';
  provider_message_id: string | null;
  idempotency_key: string;
  first_attempt_at: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  notification_confirmed_at?: string | null;
}
export type StoredMessage = ClaimMessage;
export interface MessageDeliveryEvent { id: string; message_id: string; type: string; created_at: string; provider_event_id: string | null; error: string | null }
export type MessageCommand =
  | { action: 'draft'; message: ClaimMessage }
  | { action: 'publish_automatic'; message: ClaimMessage; mode: 'preview' | 'live'; from: string; reply_to: string | null }
  | { action: 'edit'; message_id: string; expected_draft_revision: number; subject: string; body: string }
  | { action: 'confirm'; message_id: string; expected_draft_revision: number; correction: CorrectionInput; request_id: string; payload_hash: string; mode: 'preview' | 'live'; from: string; reply_to: string | null }
  | { action: 'list'; claim_id: string }
  | { action: 'get'; message_id: string }
  | { action: 'outbox' }
  | { action: 'release_batch'; expected: Snapshot; messages: { id: string; revision: number }[]; confirmed: true; mode: 'preview' | 'live'; from: string; reply_to: string | null }
  | { action: 'retry'; message_id: string; expected_message_revision: number }
  | { action: 'lease'; message_id?: string }
  | { action: 'settle'; message_id: string; lease_token: string; outcome: 'accepted' | 'failed' | 'delivery_unknown'; provider_message_id?: string; error?: string; retry_after_seconds?: number };
export interface MessageResult { message: ClaimMessage | null; messages?: ClaimMessage[]; correction_id?: string; status?: SubmissionStatus }
const conflict = (code: string, text: string): never => { throw new CoreError(code, text, 409); };
const nowIso = () => new Date().toISOString();
function changed(message: ClaimMessage) { message.message_revision++; message.updated_at = nowIso(); }
function assertCurrent(state: Snapshot, message: ClaimMessage) {
  const s = state.submissions.find(s => s.id === message.claim_id);
  if (!s) throw new CoreError('NOT_FOUND', 'Claim not found.', 404);
  if (message.source_review_revision !== reviewRevision(state, s.id) || message.source_evidence_revision !== (s.evidence_revision ?? 0) || message.source_knowledge_revision !== (state.knowledge_revision ?? 0) || message.assessment_run_id !== s.latest_run_id || message.recipient !== s.email) conflict('STALE_MESSAGE', 'Claim evidence or knowledge changed. Generate a fresh message.');
  return s;
}
export function automaticNoticeKey(state: Snapshot, claimId: string): string | null {
  const submission=state.submissions.find(s=>s.id===claimId);
  const run=state.runs.find(r=>r.id===submission?.latest_run_id);
  const checks=state.decisions.filter(d=>d.run_id===run?.id);
  if(!hasAutomaticApproval(state,claimId,run,checks)) return null;
  const marker=checks.find(d=>d.field_checked==='overall_status'&&d.check_method!=='human')!.evidence_json.auto_approval as Record<string,unknown>;
  return `${marker.policy}/${marker.evidence_identity}/${marker.knowledge_revision}`;
}
function currentDecision(state: Snapshot, m: ClaimMessage) { return m.decision_source==='automatic' ? !!m.automatic_decision_key&&automaticNoticeKey(state,m.claim_id)===m.automatic_decision_key : !!m.correction_id&&latestCorrection(state, m.claim_id)?.id === m.correction_id; }
export function pendingNotice(state: Snapshot, m: ClaimMessage) {
  const s = state.submissions.find(s => s.id === m.claim_id);
  return (m.status === 'draft' || (['failed','delivery_unknown'].includes(m.status) && withinWindow(m) && m.attempt_count < 3))
    && !!m.outcome_header && !!s && m.recipient === s.email && currentDecision(state, m)
    && (m.decision_source === 'automatic'
      ? !state.decisions.some(d => d.run_id === m.assessment_run_id && d.evidence_json.demo_baseline === true)
      : latestCorrection(state, m.claim_id)?.correction_payload_json.demo_baseline !== true);
}
function withinWindow(m: ClaimMessage) { return !m.first_attempt_at || Date.now() - Date.parse(m.first_attempt_at) < 23 * 60 * 60 * 1000; }
function event(state: Snapshot, m: ClaimMessage, type: string) { state.message_delivery_events!.push({id:crypto.randomUUID(),message_id:m.id,type,created_at:nowIso(),provider_event_id:null,error:m.error}); }
export function guardCommunication(state: Snapshot, claimId: string) {
  if (state.claim_messages?.some(m => m.claim_id === claimId && m.status === 'sending' && Date.parse(m.lease_expires_at ?? '') > Date.now())) conflict('COMMUNICATION_IN_FLIGHT', 'An email attempt is in flight. Wait for its short lease before changing the decision.');
}
export function cancelObsoleteMessages(state: Snapshot, claimId: string, keepId?:string) {
  for (const m of state.claim_messages ?? []) if (m.claim_id === claimId && m.id !== keepId && ['draft','queued','failed','delivery_unknown','sending'].includes(m.status)) {
    m.status = 'cancelled'; m.next_attempt_at = null; m.lease_token = null; m.lease_expires_at = null; m.error = 'A later reviewer decision superseded this notice.'; changed(m); event(state, m, 'cancelled');
  }
}
/** Synchronous mutation: correction and immutable outbox publication cannot interleave. */
export function mutateMessages(state: Snapshot, cmd: MessageCommand, correct: (input: CorrectionInput, keepId?:string) => {correction_id:string;status:SubmissionStatus}): MessageResult {
  state.claim_messages ??= []; state.message_delivery_events ??= [];
  const messages = state.claim_messages;
  if (cmd.action === 'outbox') {
    if (messages.length > 1000) throw new CoreError('REVIEW_LIMIT', 'Too many notifications to list.', 503);
    return { message: null, messages: structuredClone(messages) };
  }
  if (cmd.action === 'release_batch') {
    if (cmd.confirmed !== true || !cmd.messages.length || cmd.messages.length > 1000 || new Set(cmd.messages.map(m => m.id)).size !== cmd.messages.length) throw new CoreError('INVALID_INPUT', 'Confirm a distinct notification batch.');
    if (JSON.stringify(state) !== JSON.stringify(cmd.expected)) conflict('STALE_MESSAGE', 'Claims changed. Review the notification batch again.');
    const batch = cmd.messages.map(item => {
      const m = messages.find(m => m.id === item.id);
      if (!m || !pendingNotice(state, m) || m.message_revision !== item.revision || m.mode !== cmd.mode || m.from !== cmd.from || m.reply_to !== cmd.reply_to) conflict('STALE_MESSAGE', 'Notifications changed. Review the batch again.');
      return m!;
    });
    for (const m of batch) {
      m.status = cmd.mode === 'live' ? 'queued' : 'previewed';
      m.notification_confirmed_at = nowIso(); m.next_attempt_at = cmd.mode === 'live' ? nowIso() : null;
      changed(m); event(state, m, m.status);
    }
    return { message: null, messages: structuredClone(batch) };
  }
  if (cmd.action === 'list') {
    if(!state.submissions.some(s=>s.id===cmd.claim_id))throw new CoreError('NOT_FOUND','Claim not found.',404);
    return {message:null,messages:structuredClone(messages.filter(m => m.claim_id === cmd.claim_id))};
  }
  if (cmd.action === 'publish_automatic') {
    const m=structuredClone(cmd.message),s=assertCurrent(state,m);
    if(m.decision_source!=='automatic'||m.intended_verdict!=='approved'||m.kind!=='approval'||m.status!=='draft'||m.correction_id||m.request_id||!currentDecision(state,m)||m.mode!==cmd.mode) conflict('STALE_MESSAGE','The policy approval is no longer current.');
    const prior=messages.find(x=>x.claim_id===m.claim_id&&x.automatic_decision_key===m.automatic_decision_key);
    if(prior) return {message:structuredClone(prior)};
    guardCommunication(state,m.claim_id);validateText(m.subject,m.body);
    Object.assign(m,{from:cmd.from,reply_to:cmd.reply_to,outcome_header:`${s.attendee_name} — claim ${s.id} (${s.category}): Approved for reimbursement. ${s.currency} ${(s.amount_requested_minor/100).toFixed(2)} approved.`,status:'draft',confirmed_at:nowIso(),notification_confirmed_at:null,next_attempt_at:null});
    m.rendered_text=`${m.outcome_header}\n\n${m.body}`;m.rendered_html=`<div style="white-space:pre-wrap">${escapeHtml(m.rendered_text)}</div>`;
    messages.push(m);changed(m);event(state,m,m.status);return {message:structuredClone(m)};
  }
  if (cmd.action === 'draft') {
    const m = structuredClone(cmd.message); assertCurrent(state,m);
    if(messages.some(x => x.id === m.id)) conflict('MESSAGE_CONFLICT','Message already exists.');
    if(m.status !== 'draft' || m.correction_id || m.request_id || m.kind !== (m.intended_verdict === 'approved' ? 'approval' : 'rejection')) throw new CoreError('INVALID_INPUT','Invalid message draft.');
    validateText(m.subject,m.body); messages.push(m); return {message:structuredClone(m)};
  }
  if(cmd.action === 'confirm') {
    const prior = messages.find(m => m.request_id === cmd.request_id);
    if(prior) {
      if(prior.confirmation_payload_hash !== cmd.payload_hash || prior.id !== cmd.message_id || prior.claim_id !== cmd.correction.submission_id) conflict('MESSAGE_CONFLICT','This confirmation key was already used with different input.');
      return {message:structuredClone(prior),correction_id:prior.correction_id!,status:prior.intended_verdict};
    }
  }
  if(cmd.action === 'lease') {
    for(const m of messages) {
      if (cmd.message_id && m.id !== cmd.message_id) continue;
      if(m.status === 'sending' && Date.parse(m.lease_expires_at ?? '') <= Date.now()) {
        m.status = 'delivery_unknown'; m.error = 'The previous send lease expired without a confirmed outcome.'; m.lease_token=null;m.lease_expires_at=null;m.next_attempt_at=nowIso();changed(m);event(state,m,'delivery_unknown');
      }
      if(!m.notification_confirmed_at || m.mode !== 'live' || !['queued','failed','delivery_unknown'].includes(m.status) || !m.next_attempt_at || Date.parse(m.next_attempt_at)>Date.now()) continue;
      if(!currentDecision(state,m)) {m.status='cancelled';m.next_attempt_at=null;changed(m);event(state,m,'cancelled');continue;}
      if(!withinWindow(m) || m.attempt_count >= 3) {m.next_attempt_at=null;m.error='Automatic retry stopped. Reconcile any uncertain provider outcome before retrying.';changed(m);continue;}
      m.status='sending';m.attempt_count++;m.first_attempt_at??=nowIso();m.lease_token=crypto.randomUUID();m.lease_expires_at=new Date(Date.now()+30000).toISOString();m.next_attempt_at=null;changed(m);event(state,m,'attempt_started');
      return {message:structuredClone(m)};
    }
    return {message:null};
  }
  const m = messages.find(m => m.id === cmd.message_id);
  if(!m) throw new CoreError('NOT_FOUND','Message not found.',404);
  if(cmd.action === 'get') return {message:structuredClone(m)};
  if(cmd.action === 'edit') {
    if(m.status !== 'draft' || m.correction_id || m.automatic_decision_key) conflict('MESSAGE_ALREADY_CONFIRMED','Saved decision notices are immutable.');
    if(m.draft_revision !== cmd.expected_draft_revision) conflict('STALE_MESSAGE','This draft changed. Refresh it before editing.');
    assertCurrent(state,m);validateText(cmd.subject,cmd.body);m.subject=cmd.subject.trim();m.body=cmd.body.trim();m.draft_revision++;changed(m);
  } else if(cmd.action === 'confirm') {
    if(m.status !== 'draft' || m.correction_id) conflict('MESSAGE_ALREADY_CONFIRMED','This draft was already confirmed.');
    if(m.draft_revision !== cmd.expected_draft_revision) conflict('STALE_MESSAGE','This draft changed. Review the current draft.');
    const s=assertCurrent(state,m);
    if(m.mode !== cmd.mode) conflict('STALE_MESSAGE','Email mode changed. Generate and review a fresh draft.');
    if(cmd.correction.submission_id !== m.claim_id || cmd.correction.human_verdict !== m.intended_verdict || cmd.correction.expected_review_revision !== m.source_review_revision) conflict('STALE_MESSAGE','The decision does not match this draft.');
    validateText(m.subject,m.body);
    const result=correct(cmd.correction,m.id); // existing approval, duplicate, revision and active-operation guards
    Object.assign(m,{correction_id:result.correction_id,request_id:cmd.request_id,confirmation_payload_hash:cmd.payload_hash,mode:cmd.mode,from:cmd.from,reply_to:cmd.reply_to,outcome_header:`${s.attendee_name} — claim ${s.id} (${s.category}): ${m.intended_verdict === 'approved' ? 'Approved for reimbursement' : 'Rejected'}. ${s.currency} ${(s.amount_requested_minor/100).toFixed(2)} ${m.intended_verdict === 'approved' ? 'approved' : 'requested'}.`,status:'draft',confirmed_at:nowIso(),notification_confirmed_at:null,error:null,next_attempt_at:null});
    m.rendered_text=`${m.outcome_header}\n\n${m.body}`;m.rendered_html=`<div style="white-space:pre-wrap">${escapeHtml(m.rendered_text)}</div>`;
    changed(m);event(state,m,m.status);
    return {message:structuredClone(m),...result};
  } else if(cmd.action === 'retry') {
    if(m.message_revision !== cmd.expected_message_revision) conflict('STALE_MESSAGE','Message delivery status changed. Refresh it.');
    if(!['failed','delivery_unknown'].includes(m.status)||m.mode!=='live') conflict('RETRY_BLOCKED','Only failed or uncertain live messages can be retried.');
    if(!currentDecision(state,m)) conflict('STALE_MESSAGE','A later decision superseded this email.');
    if(!withinWindow(m)) conflict('DELIVERY_RECONCILIATION_REQUIRED','Provider idempotency may have expired. Reconcile provider records before another send.');
    // Three attempts total, including explicit retries; never erase delivery history to reset the budget.
    if(m.attempt_count>=3) conflict('DELIVERY_RECONCILIATION_REQUIRED','The three-attempt budget is exhausted. Reconcile provider records.');
    m.status='queued';m.next_attempt_at=nowIso();m.error=null;changed(m);event(state,m,'retry_queued');
  } else {
    if(m.status!=='sending'||m.lease_token!==cmd.lease_token) conflict('STALE_MESSAGE','This send lease was superseded.');
    if(cmd.outcome==='accepted'&&!cmd.provider_message_id)throw new CoreError('INVALID_INPUT','Provider acceptance requires an ID.');
    m.status=cmd.outcome;m.provider_message_id=cmd.provider_message_id??null;m.error=cmd.error?.slice(0,500)??null;m.lease_token=null;m.lease_expires_at=null;
    m.next_attempt_at=cmd.outcome!=='accepted'&&cmd.retry_after_seconds!==undefined&&m.attempt_count<3&&withinWindow(m)?new Date(Date.now()+Math.max(1,Math.min(3600,cmd.retry_after_seconds))*1000).toISOString():null;
    changed(m);event(state,m,cmd.outcome);
  }
  return {message:structuredClone(m)};
}
export function validateText(subject: string, body: string) {
  if(typeof subject!=='string'||subject.trim().length<1||subject.length>200||/[\r\n]/.test(subject)||typeof body!=='string'||body.trim().length<1||body.length>8000)throw new CoreError('INVALID_INPUT','Use a one-line subject up to 200 characters and message up to 8,000 characters.');
}

export type PublicClaimMessage = Omit<ClaimMessage, 'decision_payload_hash' | 'confirmation_payload_hash' | 'idempotency_key' | 'lease_token' | 'lease_expires_at'>;
export function publicMessage(message: ClaimMessage): PublicClaimMessage {
  const { decision_payload_hash, confirmation_payload_hash, idempotency_key, lease_token, lease_expires_at, ...visible } = message;
  void decision_payload_hash; void confirmation_payload_hash; void idempotency_key; void lease_token; void lease_expires_at;
  return visible;
}

function escapeHtml(value:string) { return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\"','&quot;').replaceAll("'",'&#39;'); }
