import type { InvestigationRun } from '../review-contracts';
import { beforeAssessment, pendingClaim, type StoredDocument, type SupportingCommand, type InvestigationCommand } from './investigation-state';
import { mutateProcedure, invalidateProcedures, type StoredProcedure, type ProcedureAttempt, type ProcedureCommand } from './procedure-state';
import type { Correction, CorrectionInput, Decision, ModelCall, PolicyRule, Receipt, ReconciliationRun, Submission, SubmissionStatus } from '../contracts';
import { CoreError, correctionInput, isUUID, parsedReceipt, categories } from './validation';
import { decision, deterministic } from './checks';
import { workspaceRows } from './projection';
import { assertApprovable, confirmedDuplicates, latestCorrection, reviewRevision, samePurchase } from './safety';
import { activeAliases, invalidateSource, mutateRule, type StoredRule, type RuleAttempt, type RuleCommand } from './rule-state';
export interface Snapshot { supporting_documents?:StoredDocument[]; investigations?:InvestigationRun[]; procedures?:StoredProcedure[]; procedure_history?:StoredProcedure[]; procedure_tests?:ProcedureAttempt[]; knowledge_revision?: number; rules?: StoredRule[]; rule_history?: StoredRule[]; rule_tests?: RuleAttempt[]; extraction_history?: Receipt[]; submissions: Submission[]; receipts: Receipt[]; policies: PolicyRule[]; decisions: Decision[]; corrections: Correction[]; runs: ReconciliationRun[] }
export interface Store { supporting(command:SupportingCommand):Promise<{document:StoredDocument;lease:string}>; investigation(command:InvestigationCommand):Promise<InvestigationRun>; procedure(command:ProcedureCommand):Promise<{procedure:StoredProcedure;knowledge_revision:number}>; snapshot(): Promise<Snapshot>; begin(id: string): Promise<string>; finish(run: string, ds: Decision[], status: SubmissionStatus): Promise<void>; fail(run: string, message: string): Promise<void>; correct(input: CorrectionInput): Promise<{ correction_id: string; status: SubmissionStatus }>; usage(call: ModelCall): Promise<void>; rule(command: RuleCommand): Promise<{rule:StoredRule;knowledge_revision:number}>; beginExtraction(id:string, revision:number):Promise<string>; finishExtraction(lease:string, receipt:Receipt):Promise<void>; receiptHash(id:string, hash:string):Promise<void> }
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
    state.supporting_documents??=[];state.investigations??=[];state.procedures??=[];state.procedure_history??=[];state.procedure_tests??=[];state.knowledge_revision??=0;state.rules??=[];state.rule_history??=[];state.rule_tests??=[];state.extraction_history??=[];
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
    for(const r of this.state.runs.filter(r=>r.submission_id===id&&r.status==='running'&&Date.now()-Date.parse(r.started_at)>300000))await this.fail(r.id,'Run lease expired.');
    if (this.state.runs.some(r => r.submission_id === id && r.status === 'running')) throw new CoreError('RUN_ACTIVE', 'A run is already active.', 409);
    const run: ReconciliationRun = { review_revision:reviewRevision(this.state,id),evidence_revision:s.evidence_revision??0,knowledge_revision:this.state.knowledge_revision??0,evidence_snapshot:structuredClone(this.evidence()),operation:'assessment', id: crypto.randomUUID(), submission_id: id, status: 'running', started_at: new Date().toISOString(), completed_at: null, error: null };
    this.state.runs.push(run); return run.id;
  }
  async finish(id: string, ds: Decision[], status: SubmissionStatus) {
    const run = this.state.runs.find(r => r.id === id);
    if (!run || run.status !== 'running') throw new CoreError('STALE_RUN', 'Run was superseded by reviewer action.', 409);
    const s=this.state.submissions.find(s=>s.id===run.submission_id)!;
    if(run.review_revision!==reviewRevision(this.state,s.id)||run.evidence_revision!==(s.evidence_revision??0)||run.knowledge_revision!==this.state.knowledge_revision||JSON.stringify(run.evidence_snapshot)!==JSON.stringify(this.evidence()))throw new CoreError('STALE_RUN','Evidence or knowledge changed during assessment.',409);
    if (!['assessment','investigation'].includes(run.operation??'assessment')||ds.some(d=>d.check_method==='human')||!ds.some(d => d.field_checked === 'overall_status' && d.answer_json.value === status) || ds.some(d => d.run_id !== id || d.submission_id !== run.submission_id)) throw new CoreError('INVALID_DECISIONS', 'Invalid decision batch.');
    this.state.decisions.push(...structuredClone(ds)); run.status = 'completed'; run.completed_at = new Date().toISOString();
    Object.assign(this.state.submissions.find(s => s.id === run.submission_id)!, { latest_run_id: id, status:s.decision_status!=='pending'?s.decision_status:status,review_revision:reviewRevision(this.state,s.id)+1,updated_at: run.completed_at });
  }
  async fail(id: string, message: string) {
    const run = this.state.runs.find(r => r.id === id);
    if (run?.status === 'running') { run.status = 'failed'; run.error = message; run.completed_at = new Date().toISOString(); const s = this.state.submissions.find(s => s.id === run.submission_id)!; if(run.operation!=='investigation')s.status = s.decision_status!=='pending'?s.decision_status!:'needs_review'; s.updated_at = run.completed_at; const inv=this.state.investigations?.find(x=>x.run_id===id);if(inv){inv.status='failed';inv.error=message;inv.completed_at=run.completed_at;inv.outcome=null;inv.after_assessment=null;for(const step of inv.steps)if(step.status==='running'){step.status='failed';step.error=message;step.completed_at=run.completed_at;}} }
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
  private evidence(){return {supporting_documents:this.state.supporting_documents,active_procedures:this.state.procedures?.filter(p=>p.state==='active'),active_aliases:activeAliases(this.state),check_configuration:'mandatory-v1',receipts:this.state.receipts,policies:this.state.policies,claims:this.state.submissions.map(({id,attendee_name,amount_requested_minor,currency,category,submitted_at})=>({id,attendee_name,amount_requested_minor,currency,category,submitted_at}))};}
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

  async supporting(cmd:SupportingCommand){
    if(cmd.action==='start'){
      const s=pendingClaim(this.state,cmd.claim_id,cmd.expected_review_revision),docs=this.state.supporting_documents!;
      if(docs.filter(d=>d.claim_id===s.id).length>=8)throw new CoreError('DOCUMENT_LIMIT','A claim supports at most eight documents.',409);
      if(docs.some(d=>d.claim_id===s.id&&d.sha256===cmd.document.sha256))throw new CoreError('DOCUMENT_EXISTS','These bytes are already attached to this claim.',409);
      const lease=await this.begin(s.id),run=this.state.runs.find(r=>r.id===lease)!;
      run.operation='supporting_document';docs.push(structuredClone(cmd.document));
      invalidateSource(this.state,s.id);s.evidence_revision=(s.evidence_revision??0)+1;s.review_revision=(s.review_revision??0)+1;s.updated_at=new Date().toISOString();
      Object.assign(run,{evidence_revision:s.evidence_revision,review_revision:s.review_revision,knowledge_revision:this.state.knowledge_revision,evidence_snapshot:structuredClone(this.evidence())});
      return {document:structuredClone(cmd.document),lease};
    }
    const run=this.state.runs.find(r=>r.id===cmd.lease),s=this.state.submissions.find(s=>s.id===run?.submission_id),doc=this.state.supporting_documents!.find(d=>d.id===cmd.document.id);
    if(!run||!s||!doc||run.status!=='running'||run.operation!=='supporting_document'||doc.claim_id!==s.id||run.review_revision!==s.review_revision||run.evidence_revision!==s.evidence_revision||run.knowledge_revision!==this.state.knowledge_revision||JSON.stringify(run.evidence_snapshot)!==JSON.stringify(this.evidence()))throw new CoreError('STALE_RUN','Supporting evidence changed before publication.',409);
    if(doc.sha256!==cmd.document.sha256||doc.storage_path!==cmd.document.storage_path||doc.file_type!==cmd.document.file_type||doc.kind!==cmd.document.kind||doc.created_at!==cmd.document.created_at||doc.claim_id!==cmd.document.claim_id)throw new CoreError('DOCUMENT_CONFLICT','Supporting document identity changed.',409);
    Object.assign(doc,structuredClone(cmd.document));invalidateSource(this.state,s.id);s.evidence_revision=(s.evidence_revision??0)+1;s.review_revision=(s.review_revision??0)+1;s.updated_at=new Date().toISOString();
    run.status=doc.extraction_status==='failed'?'failed':'completed';run.error=doc.extraction_error;run.completed_at=s.updated_at;
    return {document:structuredClone(doc),lease:run.id};
  }
  async investigation(cmd:InvestigationCommand):Promise<InvestigationRun>{
    if(cmd.action==='start'){
      const s=pendingClaim(this.state,cmd.claim_id,cmd.expected_review_revision),before=beforeAssessment(this.state,s.id);
      if(!before.assessment_status)throw new CoreError('ASSESSMENT_REQUIRED','Assess this claim before investigation.',409);
      if(before.checks.some(d=>d.verdict==='fail'&&['currency','amount','policy','receipt_date','policy_cap','duplicate'].includes(d.field_checked)))throw new CoreError('INVESTIGATION_NOT_NEEDED','A known mandatory failure already blocks this claim.',409);
      const id=await this.begin(s.id);this.state.runs.find(r=>r.id===id)!.operation='investigation';
      const run:InvestigationRun={run_id:id,claim_id:s.id,trigger:cmd.trigger,status:'running',outcome:null,headline:'Investigating stored evidence',summary:'Investigation started.',unresolved_question:null,findings:[],before_assessment:before,after_assessment:null,proposed_learning:null,steps:[],started_at:new Date().toISOString(),completed_at:null,mode:cmd.mode,model:null,error:null};this.state.investigations!.push(run);return structuredClone(run);
    }
    const inv=this.state.investigations!.find(r=>r.run_id===cmd.run_id),run=this.state.runs.find(r=>r.id===cmd.run_id);
    if(!inv||!run)throw new CoreError('NOT_FOUND','Investigation not found.',404);
    if(cmd.action==='fail'){
      if(inv.status==='running'){
        await this.fail(run.id,cmd.error);inv.status=cmd.superseded?'superseded':'failed';run.status=inv.status;inv.outcome=null;inv.after_assessment=null;inv.error=cmd.error;inv.completed_at=new Date().toISOString();
      }return structuredClone(inv);
    }
    if(inv.status!=='running'||run.status!=='running')throw new CoreError('STALE_RUN','Investigation is no longer active.',409);
    if(cmd.action==='step'){
      const step=cmd.step;if(step.run_id!==run.id)throw new CoreError('INVALID_INPUT','Foreign tool step.');
      const prior=inv.steps.find(s=>s.id===step.id);
      if(prior){if(prior.status!=='running'||step.sequence!==prior.sequence||step.tool!==prior.tool)throw new CoreError('STALE_RUN','Tool step already completed.',409);Object.assign(prior,structuredClone(step));}
      else {if(step.status!=='running'||step.sequence!==inv.steps.length+1||step.sequence>6)throw new CoreError('BUDGET_EXHAUSTED','Tool execution budget exhausted.',409);inv.steps.push(structuredClone(step));}
      return structuredClone(inv);
    }
    const status=cmd.decisions.find(d=>d.field_checked==='overall_status')?.answer_json.value as SubmissionStatus;
    await this.finish(run.id,cmd.decisions,status);
    Object.assign(inv,{status:'completed',outcome:status==='approved'?'resolved':status==='flagged'?'discrepancy_found':'needs_human',headline:cmd.result.headline,summary:cmd.result.summary,unresolved_question:cmd.result.unresolved_question,findings:structuredClone(cmd.result.findings),proposed_learning:structuredClone(cmd.result.proposed_learning),model:cmd.result.model,completed_at:run.completed_at,error:null,after_assessment:beforeAssessment(this.state,inv.claim_id)});
    return structuredClone(inv);
  }
  async procedure(cmd:ProcedureCommand){return mutateProcedure(this.state,cmd);}

  async usage(call: ModelCall) { this.calls.push(structuredClone(call)); }
}
export class SupabaseStore implements Store {
  constructor(private url: string, private key: string) {}
  async assertSchema() {
    if (await this.request('rpc/core_platform_version', {}) !== 3) throw new CoreError('SCHEMA_MISMATCH', 'Apply the reviewed platform migration before using this app.', 503);
  }
  /** Reads and the schema probe are idempotent, so an overload response is retried rather than
   * surfaced as an outage. Writes are sent once: only the database knows whether they applied. */
  private static readonly retryable = [408, 429, 500, 502, 503, 504, 544];
  private async send(path: string, body?: unknown): Promise<Response> {
    const idempotent = path === 'rpc/core_snapshot' || path === 'rpc/core_platform_version';
    const attempts = idempotent ? 3 : 1;
    let last: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      try {
        const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/${path}`, { method: 'POST', headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...(path.startsWith('rpc/') ? {} : { Prefer: 'return=minimal' }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(idempotent ? 45000 : 15000), cache: 'no-store' });
        if (res.ok || !SupabaseStore.retryable.includes(res.status) || attempt === attempts - 1) return res;
        last = res; await res.body?.cancel().catch(() => {});
      } catch (error) { last = error; }
    }
    if (last instanceof Response) return last;
    throw new CoreError('DATABASE_ERROR', 'Reimbursement storage request failed.', 503);
  }
  private async request(path: string, body?: unknown) {
    // Check every operation: an earlier successful request cannot authorize an older schema.
    if (path !== 'rpc/core_platform_version') await this.assertSchema();
    const res = await this.send(path, body);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      if (path === 'rpc/core_platform_version' && ['PGRST202', '42883'].includes(e.code)) throw new CoreError('SCHEMA_MISMATCH', 'Apply the reviewed platform migration before using this app.', 503);
      const known: Record<string, [string, number]> = { 'RUN_ACTIVE': ['A run is already active.', 409], 'STALE_RUN': ['Run was superseded by reviewer action.', 409], 'NOT_FOUND': ['Submission not found.', 404], 'STALE_DECISION': ['Decision is stale or belongs to another submission.', 409], 'INVALID_SCOPE': ['Alias scope does not match receipt.', 400] };
      const key = typeof e.message === 'string' ? e.message : '';
      for(const code of ['STALE_REVIEW','STALE_RULE','STALE_RULE_TEST','APPROVAL_BLOCKED','RULE_CONFLICT','RULE_SOURCE_REQUIRED','RETRY_BLOCKED','RECEIPT_CONFLICT','REVIEW_LIMIT','INVALID_INPUT','LEGACY_ALIAS_DISABLED','STALE_RUN','DOCUMENT_EXISTS','DOCUMENT_LIMIT','DOCUMENT_CONFLICT','EVIDENCE_LOCKED','ASSESSMENT_REQUIRED','INVESTIGATION_NOT_NEEDED','PROCEDURE_SOURCE_REQUIRED','INVESTIGATION_LIMIT'])known[code]=[code==='LEGACY_ALIAS_DISABLED'?'Use the reviewed /api/rules workflow.':code.replaceAll('_',' '),code==='LEGACY_ALIAS_DISABLED'?410:code==='INVALID_INPUT'?400:409];
      if (known[key]) throw new CoreError(key, known[key][0], known[key][1]);
      throw new CoreError('DATABASE_ERROR', 'Reimbursement storage request failed.', 503);
    }
    const text = await res.text(); return text ? JSON.parse(text) : undefined;
  }
  supporting(command:SupportingCommand){return this.request('rpc/core_supporting',{p_input:command});}
  investigation(command:InvestigationCommand){return this.request('rpc/core_investigation',{p_input:command});}
  procedure(command:ProcedureCommand){return this.request('rpc/core_procedure',{p_input:command});}
  /** One transactional projection: rules, knowledge revision and review revisions must be read together. */
  snapshot(): Promise<Snapshot> { return this.request('rpc/core_snapshot', {}); }
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
