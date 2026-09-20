import type { Correction, CorrectionInput, Decision, ModelCall, PolicyRule, Receipt, ReconciliationRun, Submission, SubmissionStatus } from '../contracts';
import { CoreError, aliasPayload, normalize, isUUID, parsedReceipt, categories } from './validation';
import { decision } from './checks';
export interface Snapshot { submissions: Submission[]; receipts: Receipt[]; policies: PolicyRule[]; decisions: Decision[]; corrections: Correction[]; runs: ReconciliationRun[] }
export interface Store { snapshot(): Promise<Snapshot>; begin(id: string): Promise<string>; finish(run: string, ds: Decision[], status: SubmissionStatus): Promise<void>; fail(run: string, message: string): Promise<void>; correct(input: CorrectionInput): Promise<{ correction_id: string; status: SubmissionStatus }>; usage(call: ModelCall): Promise<void> }
export function validateCorrectionContext(input: CorrectionInput, state: Snapshot) {
  const s = state.submissions.find(s => s.id === input.submission_id);
  if (!s) throw new CoreError('NOT_FOUND', 'Submission not found.', 404);
  if (input.decision_id && !state.decisions.some(d => d.id === input.decision_id && d.submission_id === s.id && d.run_id === s.latest_run_id)) throw new CoreError('STALE_DECISION', 'Decision must belong to the latest completed run of this submission.', 409);
  if (input.correction_type === 'vendor_alias') {
    const a = aliasPayload(input.correction_payload_json);
    const receipt = state.receipts.find(r => r.submission_id === s.id)?.parsed_fields_json;
    if (a.scope.category !== s.category || a.scope.currency !== s.currency || !receipt?.vendor || normalize(a.observed_vendor) !== normalize(receipt.vendor)) throw new CoreError('INVALID_SCOPE', 'Alias must match this receipt vendor, category, and currency.');
  }
  return s;
}
/** Single-process, synthetic-only adapter. Methods mutate synchronously before yielding. */
export class MemoryStore implements Store {
  calls: ModelCall[] = [];
  constructor(public state: Snapshot) {}
  /** Idempotent server-only metadata bridge. Bytes remain in Module 1's private LocalStore.
   * Reimports preserve core status/decisions; changed extraction requires a fresh run.
   */
  async importIntakeRecord(submission: Submission, receipt: Receipt): Promise<void> {
    if (!isUUID(submission.id) || !isUUID(receipt.id) || receipt.submission_id !== submission.id || submission.currency !== 'USD' || !categories.includes(submission.category) || !Number.isSafeInteger(submission.amount_requested_minor) || submission.amount_requested_minor < 0 || submission.amount_requested_minor > 2147483647 || receipt.storage_path !== `synthetic/${submission.id}/${receipt.id}` || !['pending','succeeded','failed'].includes(receipt.extraction_status) || (receipt.parsed_fields_json !== null && !parsedReceipt(receipt.parsed_fields_json))) throw new CoreError('INVALID_INTAKE_RECORD', 'Intake metadata does not match the synthetic receipt contract.');
    const existing = this.state.submissions.find(s => s.id === submission.id);
    const priorReceipt = this.state.receipts.find(r => r.submission_id === submission.id);
    if (this.state.receipts.some(r => r.id === receipt.id && r.submission_id !== submission.id) || (priorReceipt && priorReceipt.id !== receipt.id)) throw new CoreError('RECEIPT_CONFLICT', 'Only one receipt is supported per submission.', 409);
    if (existing) {
      const keys: (keyof Submission)[] = ['attendee_name','email','amount_requested_minor','currency','category','origin_location','submitted_at'];
      if (keys.some(k => existing[k] !== submission[k])) throw new CoreError('INTAKE_CONFLICT', 'Previously imported claim values cannot be changed.', 409);
    } else if (submission.status !== 'pending' || submission.latest_run_id !== null) throw new CoreError('INVALID_INTAKE_RECORD', 'New intake submissions must be pending without a run.');
    const changed = priorReceipt && JSON.stringify(priorReceipt) !== JSON.stringify(receipt);
    if (changed && this.state.runs.some(r => r.submission_id === submission.id && r.status === 'running')) throw new CoreError('RUN_ACTIVE', 'Retry receipt import after the active run completes.', 409);
    if (!existing) this.state.submissions.push(structuredClone(submission));
    if (priorReceipt) Object.assign(priorReceipt, structuredClone(receipt)); else this.state.receipts.push(structuredClone(receipt));
    if (changed && existing?.latest_run_id) { existing.status = 'needs_review'; existing.updated_at = new Date().toISOString(); }
  }
  async snapshot() { return structuredClone(this.state); }
  async begin(id: string) {
    const s = this.state.submissions.find(s => s.id === id);
    if (!s) throw new CoreError('NOT_FOUND', 'Submission not found.', 404);
    if (this.state.runs.some(r => r.submission_id === id && r.status === 'running')) throw new CoreError('RUN_ACTIVE', 'A run is already active.', 409);
    const run: ReconciliationRun = { id: crypto.randomUUID(), submission_id: id, status: 'running', started_at: new Date().toISOString(), completed_at: null, error: null };
    this.state.runs.push(run); return run.id;
  }
  async finish(id: string, ds: Decision[], status: SubmissionStatus) {
    const run = this.state.runs.find(r => r.id === id);
    if (!run || run.status !== 'running') throw new CoreError('STALE_RUN', 'Run was superseded by reviewer action.', 409);
    if (!ds.some(d => d.field_checked === 'overall_status' && d.answer_json.value === status) || ds.some(d => d.run_id !== id || d.submission_id !== run.submission_id)) throw new CoreError('INVALID_DECISIONS', 'Invalid decision batch.');
    this.state.decisions.push(...structuredClone(ds)); run.status = 'completed'; run.completed_at = new Date().toISOString();
    Object.assign(this.state.submissions.find(s => s.id === run.submission_id)!, { latest_run_id: id, status, updated_at: run.completed_at });
  }
  async fail(id: string, message: string) {
    const run = this.state.runs.find(r => r.id === id);
    if (run?.status === 'running') { run.status = 'failed'; run.error = message; run.completed_at = new Date().toISOString(); const s = this.state.submissions.find(s => s.id === run.submission_id)!; s.status = 'needs_review'; s.updated_at = run.completed_at; }
  }
  async correct(input: CorrectionInput) {
    const s = validateCorrectionContext(input, this.state); const now = new Date().toISOString();
    for (const r of this.state.runs.filter(r => r.submission_id === s.id && r.status === 'running')) Object.assign(r, { status: 'failed', error: 'Superseded by human correction.', completed_at: now });
    const correction: Correction = { ...structuredClone(input), id: crypto.randomUUID(), corrected_at: now };
    this.state.corrections.push(correction);
    if (!s.latest_run_id) { s.latest_run_id = crypto.randomUUID(); this.state.runs.push({ id: s.latest_run_id, submission_id: s.id, status: 'completed', started_at: now, completed_at: now, error: null }); }
    const d = decision(s, s.latest_run_id, 'overall_status', input.human_verdict === 'approved' ? 'pass' : 'fail', input.human_verdict, input.human_note, { correction_id: correction.id, correction_type: input.correction_type, one_time_override: true });
    d.check_method = 'human'; this.state.decisions.push(d); s.status = input.human_verdict; s.updated_at = now;
    return { correction_id: correction.id, status: s.status };
  }
  async usage(call: ModelCall) { this.calls.push(structuredClone(call)); }
}
export class SupabaseStore implements Store {
  constructor(private url: string, private key: string) {}
  private async request(path: string, body?: unknown) {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/${path}`, { method: 'POST', headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...(path.startsWith('rpc/') ? {} : { Prefer: 'return=minimal' }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const known: Record<string, [string, number]> = { 'RUN_ACTIVE': ['A run is already active.', 409], 'STALE_RUN': ['Run was superseded by reviewer action.', 409], 'NOT_FOUND': ['Submission not found.', 404], 'STALE_DECISION': ['Decision is stale or belongs to another submission.', 409], 'INVALID_SCOPE': ['Alias scope does not match receipt.', 400] };
      const key = typeof e.message === 'string' ? e.message : '';
      if (known[key]) throw new CoreError(key, known[key][0], known[key][1]);
      throw new CoreError('DATABASE_ERROR', 'Reimbursement storage request failed.', 503);
    }
    const text = await res.text(); return text ? JSON.parse(text) : undefined;
  }
  /** Audit-only column; reading it grows the snapshot by ~2 KB per decision and times the query out. */
  private static readonly decisionColumns = 'id,run_id,submission_id,field_checked,check_method,question_type,answer_json,probability,confidence_score,verdict,rationale_text,evidence_json,model_used,created_at';
  /** Reads are idempotent, so a pool timeout or gateway blip is retried rather than
   * surfaced as an outage; a rejected request is returned on the first attempt. */
  private async page(path: string, query: string, range: string): Promise<Response> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      try {
        const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/${path}?${query}`, { headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Range-Unit': 'items', Range: range }, signal: AbortSignal.timeout(45000), cache: 'no-store' });
        if (res.ok || ![408, 429, 500, 502, 503, 504, 544].includes(res.status)) return res;
        last = res; await res.body?.cancel().catch(() => {});
      } catch (error) { last = error; }
    }
    if (last instanceof Response) return last;
    throw new CoreError('DATABASE_ERROR', 'Reimbursement storage request failed.', 503);
  }
  private async select<T>(path: string, query: string): Promise<T[]> {
    const page = 1000; const rows: T[] = [];
    for (let from = 0; ; from += page) {
      const res = await this.page(path, query, `${from}-${from + page - 1}`);
      if (!res.ok) throw new CoreError('DATABASE_ERROR', 'Reimbursement storage request failed.', 503);
      const batch = (await res.json()) as T[];
      rows.push(...batch);
      if (batch.length < page) return rows;
    }
  }
  async snapshot(): Promise<Snapshot> {
    const [submissions, receipts, policies, decisions, corrections, runs] = await Promise.all([
      this.select<Submission>('submissions', 'select=*&order=submitted_at.asc,id.asc'),
      this.select<Receipt>('receipts', 'select=*&order=id.asc'),
      this.select<PolicyRule>('policy_rules', 'select=*&order=id.asc'),
      this.select<Decision>('decisions', `select=${SupabaseStore.decisionColumns}&order=created_at.asc,id.asc`),
      this.select<Correction>('corrections', 'select=*&order=corrected_at.asc,id.asc'),
      this.select<ReconciliationRun>('reconciliation_runs', 'select=*&order=id.asc')
    ]);
    return { submissions, receipts, policies, decisions, corrections, runs };
  }
  begin(id: string): Promise<string> { return this.request('rpc/core_begin_run', { p_submission: id }); }
  finish(id: string, ds: Decision[], status: SubmissionStatus) { return this.request('rpc/core_finish_run', { p_run: id, p_decisions: ds, p_status: status }); }
  fail(id: string, message: string) { return this.request('rpc/core_fail_run', { p_run: id, p_error: message }); }
  correct(input: CorrectionInput): Promise<{ correction_id: string; status: SubmissionStatus }> { return this.request('rpc/core_correct', { p_input: input }); }
  usage(call: ModelCall) { return this.request('model_calls', call); }
}
