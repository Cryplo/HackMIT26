import type { Correction, CorrectionInput, Decision, ModelCall, PolicyRule, Receipt, ReconciliationRun, Submission, SubmissionStatus } from '../contracts';
import { CoreError, correctionInput, isUUID, parsedReceipt, categories } from './validation';
import { decision, deterministic } from './checks';
import { workspaceRows } from './projection';
import { assertApprovable, confirmedDuplicates, latestCorrection, reviewRevision, samePurchase } from './safety';
import { activeAliases, invalidateSource, mutateRule, type StoredRule, type RuleAttempt, type RuleCommand } from './rule-state';
export interface Snapshot { knowledge_revision?: number; rules?: StoredRule[]; rule_history?: StoredRule[]; rule_tests?: RuleAttempt[]; extraction_history?: Receipt[]; submissions: Submission[]; receipts: Receipt[]; policies: PolicyRule[]; decisions: Decision[]; corrections: Correction[]; runs: ReconciliationRun[] }
export interface Store { snapshot(): Promise<Snapshot>; begin(id: string): Promise<string>; finish(run: string, ds: Decision[], status: SubmissionStatus): Promise<void>; fail(run: string, message: string): Promise<void>; correct(input: CorrectionInput): Promise<{ correction_id: string; status: SubmissionStatus }>; usage(call: ModelCall): Promise<void>; rule(command: RuleCommand): Promise<{rule:StoredRule;knowledge_revision:number}>; beginExtraction(id:string, revision:number):Promise<string>; finishExtraction(lease:string, receipt:Receipt):Promise<void>; receiptHash(id:string, hash:string):Promise<void> }
export function validateCorrectionContext(input: CorrectionInput, state: Snapshot) {
  const s = state.submissions.find(s => s.id === input.submission_id);
  if (!s) throw new CoreError('NOT_FOUND', 'Submission not found.', 404);
  if (input.decision_id && !state.decisions.some(d => d.id === input.decision_id && d.submission_id === s.id && d.run_id === s.latest_run_id)) throw new CoreError('STALE_DECISION', 'Decision must belong to the latest completed run of this submission.', 409);
  return s;
}
/** Single-process, synthetic-only adapter. Methods mutate synchronously before yielding. */
export class MemoryStore implements Store {
  calls: ModelCall[] = [];
  constructor(public state: Snapshot) {
    state.knowledge_revision??=0;state.rules??=[];state.rule_history??=[];state.rule_tests??=[];state.extraction_history??=[];
    for(const s of state.submissions){s.review_revision??=reviewRevision(state,s.id);s.evidence_revision??=0;s.decision_status??=latestCorrection(state,s.id)?.human_verdict??'pending';}
  }
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
    if (!existing) this.state.submissions.push({...structuredClone(submission),review_revision:0,evidence_revision:0,decision_status:'pending'});
    if(changed){this.state.extraction_history!.push(structuredClone(priorReceipt!));invalidateSource(this.state,submission.id);}
    if (priorReceipt) Object.assign(priorReceipt, structuredClone(receipt)); else this.state.receipts.push(structuredClone(receipt));
    if (changed && existing) {existing.evidence_revision=(existing.evidence_revision??0)+1;existing.review_revision=(existing.review_revision??0)+1;existing.status=existing.decision_status!=='pending'?existing.decision_status!:'needs_review';existing.updated_at=new Date().toISOString();}
  }
  async snapshot() { return structuredClone(this.state); }
  async begin(id: string) {
    const s = this.state.submissions.find(s => s.id === id);
    if (!s) throw new CoreError('NOT_FOUND', 'Submission not found.', 404);
    if (this.state.runs.some(r => r.submission_id === id && r.status === 'running')) throw new CoreError('RUN_ACTIVE', 'A run is already active.', 409);
    const run: ReconciliationRun = { review_revision:reviewRevision(this.state,id),evidence_revision:s.evidence_revision??0,knowledge_revision:this.state.knowledge_revision??0,evidence_snapshot:structuredClone(this.evidence()),operation:'assessment', id: crypto.randomUUID(), submission_id: id, status: 'running', started_at: new Date().toISOString(), completed_at: null, error: null };
    this.state.runs.push(run); return run.id;
  }
  async finish(id: string, ds: Decision[], status: SubmissionStatus) {
    const run = this.state.runs.find(r => r.id === id);
    if (!run || run.status !== 'running') throw new CoreError('STALE_RUN', 'Run was superseded by reviewer action.', 409);
    const s=this.state.submissions.find(s=>s.id===run.submission_id)!;
    if(run.review_revision!==reviewRevision(this.state,s.id)||run.evidence_revision!==(s.evidence_revision??0)||run.knowledge_revision!==this.state.knowledge_revision||JSON.stringify(run.evidence_snapshot)!==JSON.stringify(this.evidence()))throw new CoreError('STALE_RUN','Evidence or knowledge changed during assessment.',409);
    if (run.operation==='extraction'||ds.some(d=>d.check_method==='human')||!ds.some(d => d.field_checked === 'overall_status' && d.answer_json.value === status) || ds.some(d => d.run_id !== id || d.submission_id !== run.submission_id)) throw new CoreError('INVALID_DECISIONS', 'Invalid decision batch.');
    this.state.decisions.push(...structuredClone(ds)); run.status = 'completed'; run.completed_at = new Date().toISOString();
    Object.assign(this.state.submissions.find(s => s.id === run.submission_id)!, { latest_run_id: id, status:s.decision_status!=='pending'?s.decision_status:status,review_revision:reviewRevision(this.state,s.id)+1,updated_at: run.completed_at });
  }
  async fail(id: string, message: string) {
    const run = this.state.runs.find(r => r.id === id);
    if (run?.status === 'running') { run.status = 'failed'; run.error = message; run.completed_at = new Date().toISOString(); const s = this.state.submissions.find(s => s.id === run.submission_id)!; s.status = s.decision_status!=='pending'?s.decision_status!:'needs_review'; s.updated_at = run.completed_at; }
  }
  async correct(raw: CorrectionInput) {
    const input=correctionInput(raw);const s=validateCorrectionContext(input,this.state);
    if(reviewRevision(this.state,s.id)!==input.expected_review_revision)throw new CoreError('STALE_REVIEW','This claim changed. Review the updated evidence.',409);
    if(this.state.runs.some(r=>r.submission_id===s.id&&r.status==='running'))throw new CoreError('RUN_ACTIVE','An operation is already active.',409);
    if(input.human_verdict==='approved'){
      assertApprovable(workspaceRows(this.state).find(r=>r.id===s.id)!,this.state.knowledge_revision);
      const receipt=this.state.receipts.find(r=>r.submission_id===s.id);
      if(deterministic(s,receipt??null,this.state.policies,'approval').some(d=>d.verdict!=='pass'))throw new CoreError('APPROVAL_BLOCKED','Current financial evidence must pass.',409);
      if(confirmedDuplicates(this.state,s.id).length||this.state.submissions.some(x=>x.id!==s.id&&latestCorrection(this.state,x.id)?.human_verdict==='approved'&&samePurchase(receipt,this.state.receipts.find(r=>r.submission_id===x.id))))throw new CoreError('APPROVAL_BLOCKED','This purchase has already been claimed.',409);
    }
    const now=new Date().toISOString();const correction:Correction={...structuredClone(input),review_revision:reviewRevision(this.state,s.id)+1,id:crypto.randomUUID(),corrected_at:now};
    invalidateSource(this.state,s.id);this.state.corrections.push(correction);
    if(!s.latest_run_id){s.latest_run_id=crypto.randomUUID();this.state.runs.push({id:s.latest_run_id,submission_id:s.id,status:'completed',started_at:now,completed_at:now,error:null,evidence_revision:s.evidence_revision});}
    const d=decision(s,s.latest_run_id,'overall_status',input.human_verdict==='approved'?'pass':'fail',input.human_verdict,input.human_note,{correction_id:correction.id,correction_type:input.correction_type,one_time_override:true});d.check_method='human';this.state.decisions.push(d);
    s.status=input.human_verdict;s.decision_status=input.human_verdict;s.updated_at=now;s.review_revision=(s.review_revision??0)+1;
    return {correction_id:correction.id,status:s.status};
  }
  private evidence(){return {active_aliases:activeAliases(this.state),check_configuration:'mandatory-v1',receipts:this.state.receipts,policies:this.state.policies,claims:this.state.submissions.map(({id,attendee_name,amount_requested_minor,currency,category,submitted_at})=>({id,attendee_name,amount_requested_minor,currency,category,submitted_at}))};}
  async rule(command:RuleCommand){return mutateRule(this.state,command);}
  async beginExtraction(id:string,revision:number){
    const s=this.state.submissions.find(s=>s.id===id);if(!s)throw new CoreError('NOT_FOUND','Claim not found.',404);
    if(reviewRevision(this.state,id)!==revision)throw new CoreError('STALE_REVIEW','Claim changed.',409);
    if(latestCorrection(this.state,id))throw new CoreError('RETRY_BLOCKED','Only pending human decisions can retry extraction.',409);
    const receipt=this.state.receipts.find(r=>r.submission_id===id);if(!receipt)throw new CoreError('NOT_FOUND','Original receipt not found.',404);
    if(receipt.extraction_status==='pending'&&Date.now()-Date.parse(s.submitted_at)<300000)throw new CoreError('RUN_ACTIVE','Initial extraction is still in progress.',409);
    const lease=await this.begin(id);this.state.runs.find(r=>r.id===lease)!.operation='extraction';return lease;
  }
  async finishExtraction(lease:string,receipt:Receipt){
    const run=this.state.runs.find(r=>r.id===lease);const s=this.state.submissions.find(s=>s.id===run?.submission_id);
    if(!run||!s||run.status!=='running'||run.operation!=='extraction'||run.review_revision!==s.review_revision)throw new CoreError('STALE_REVIEW','Extraction operation expired or changed.',409);
    const old=this.state.receipts.find(r=>r.submission_id===s.id)!;
    if(old.id!==receipt.id||old.storage_path!==receipt.storage_path||(old.sha256&&old.sha256!==receipt.sha256))throw new CoreError('RECEIPT_CONFLICT','Original receipt identity changed.',409);
    this.state.extraction_history!.push(structuredClone(old));Object.assign(old,structuredClone(receipt));s.evidence_revision=(s.evidence_revision??0)+1;s.review_revision=(s.review_revision??0)+1;s.status='needs_review';s.updated_at=new Date().toISOString();
    run.status=receipt.extraction_status==='failed'?'failed':'completed';run.error=receipt.extraction_error;run.completed_at=s.updated_at;
  }
  async receiptHash(id:string,hash:string){
    if(!/^[a-f0-9]{64}$/.test(hash))throw new CoreError('INVALID_INPUT','Invalid receipt hash.');
    const r=this.state.receipts.find(r=>r.id===id);if(!r)throw new CoreError('NOT_FOUND','Receipt not found.',404);
    if(r.sha256&&r.sha256!==hash)throw new CoreError('RECEIPT_CONFLICT','Stored receipt hash differs from the original.',409);
    if(!r.sha256){invalidateSource(this.state,r.submission_id);r.sha256=hash;const s=this.state.submissions.find(s=>s.id===r.submission_id)!;s.evidence_revision=(s.evidence_revision??0)+1;s.review_revision=(s.review_revision??0)+1;}
  }
  async usage(call: ModelCall) { this.calls.push(structuredClone(call)); }
}
export class SupabaseStore implements Store {
  constructor(private url: string, private key: string) {}
  async assertSchema() {
    if (await this.request('rpc/core_platform_version', {}) !== 2) throw new CoreError('SCHEMA_MISMATCH', 'Apply the reviewed platform migration before using this app.', 503);
  }
  private async request(path: string, body?: unknown) {
    // Check every operation: an earlier successful request cannot authorize an older schema.
    if (path !== 'rpc/core_platform_version') await this.assertSchema();
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/${path}`, { method: 'POST', headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...(path.startsWith('rpc/') ? {} : { Prefer: 'return=minimal' }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      if (path === 'rpc/core_platform_version' && ['PGRST202', '42883'].includes(e.code)) throw new CoreError('SCHEMA_MISMATCH', 'Apply the reviewed platform migration before using this app.', 503);
      const known: Record<string, [string, number]> = { 'RUN_ACTIVE': ['A run is already active.', 409], 'STALE_RUN': ['Run was superseded by reviewer action.', 409], 'NOT_FOUND': ['Submission not found.', 404], 'STALE_DECISION': ['Decision is stale or belongs to another submission.', 409], 'INVALID_SCOPE': ['Alias scope does not match receipt.', 400] };
      const key = typeof e.message === 'string' ? e.message : '';
      for(const code of ['STALE_REVIEW','STALE_RULE','STALE_RULE_TEST','APPROVAL_BLOCKED','RULE_CONFLICT','RULE_SOURCE_REQUIRED','RETRY_BLOCKED','RECEIPT_CONFLICT','REVIEW_LIMIT','INVALID_INPUT','LEGACY_ALIAS_DISABLED'])known[code]=[code==='LEGACY_ALIAS_DISABLED'?'Use the reviewed /api/rules workflow.':code.replaceAll('_',' '),code==='LEGACY_ALIAS_DISABLED'?410:code==='INVALID_INPUT'?400:409];
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
    // Direct table reads bypass request(), so the schema gate is applied here too.
    await this.assertSchema();
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
  rule(command:RuleCommand){return this.request('rpc/core_rule',{p_input:command});}
  beginExtraction(id:string,revision:number):Promise<string>{return this.request('rpc/core_begin_extraction',{p_submission:id,p_revision:revision});}
  finishExtraction(lease:string,receipt:Receipt){return this.request('rpc/core_finish_extraction',{p_run:lease,p_receipt:receipt});}
  receiptHash(id:string,hash:string){return this.request('rpc/core_receipt_hash',{p_receipt:id,p_hash:hash});}
}
