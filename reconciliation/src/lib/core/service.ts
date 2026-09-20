import { boundedEvidence, applicableProcedures, itineraryIdentity } from './evidence';
import type { CorrectionInput, DecisionSummary, ReconcileResult, ReviewsResponse, SubmissionStatus } from '../contracts';
import { decision, deterministic, overall } from './checks';
import type { Jev, SemanticField } from './jev';
import type { Justification, Justifier, JustificationRequest, ReviewOverride } from './justification';
import { deterministicJustification, SimulatedJustifier } from './justification';
import type { Retrieval } from './retrieval';
import type { IntelligencePort } from '../review-contracts';
import { confirmedDuplicates, latestCorrection } from './safety';
import type { Snapshot, Store } from './store';
import type { RuleCommand } from './rule-state';
import { CoreError, parsedReceipt, aliasPayload, normalize } from './validation';
import { publicEvidence } from './projection';
type AbortableJev = {evaluate(state:Parameters<Jev['evaluate']>[0],runId:string,log:Parameters<Jev['evaluate']>[2],signal?:AbortSignal):ReturnType<Jev['evaluate']>};
export class CoreService {
  constructor(public store: Store, private retrieval: Retrieval, private jev: AbortableJev, public demoMode: boolean, public readonly execution?: { decisions: string; retrieval: string; storage: string; justification?: string; investigation?:string }, private justifier: Justifier = new SimulatedJustifier(), public intelligence?:IntelligencePort, public investigationMode:'disabled'|'simulated'|'live'='disabled') {}
  /** Concurrent read-only projections share one in-flight read instead of queuing a full
   * snapshot each. A read requested after any write started cannot join a snapshot that began
   * before it, so a reviewer never sees pre-write state after their own write completed. */
  private pending: { snapshot: Promise<Snapshot>; epoch: number } | null = null;
  private epoch = 0;
  /** Every write bumps the epoch on both sides, so reads started during it cannot be shared
   * with reads requested after it finished. */
  async mutate<T>(operation: () => Promise<T>): Promise<T> {
    this.epoch++; this.pending = null;
    try { return await operation(); } finally { this.epoch++; this.pending = null; }
  }
  readSnapshot(): Promise<Snapshot> {
    if (this.pending?.epoch === this.epoch) return this.pending.snapshot;
    const epoch = this.epoch;
    const snapshot = this.store.snapshot().finally(() => { if (this.pending?.snapshot === snapshot) this.pending = null; });
    this.pending = { snapshot, epoch };
    return snapshot;
  }
  async reconcile(ids: string[]): Promise<{ results: ReconcileResult[] }> {
    // Three workers; stop launching work before the route's five-minute deadline.
    const results: ReconcileResult[] = new Array(ids.length); let next = 0;
    const started = Date.now();
    const worker = async () => {
      while (next < ids.length) {
        const index = next++;
        results[index] = Date.now() - started > 180000
          ? { submission_id: ids[index], run_id: null, status: 'pending', error: 'Batch time budget reached; retry this submission.' }
          : await this.run(ids[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
    return { results };
  }
  private async run(id: string): Promise<ReconcileResult> {
    let run: string | null = null;
    try {
      run = await this.mutate(() => this.store.begin(id));
      const state = await this.store.snapshot(); const s = state.submissions.find(s => s.id === id)!;
      const r = state.receipts.find(r => r.submission_id === id) || null;
      const ds = await this.assess(state,id,run,call=>this.store.usage(call));
      const status = overall(ds);
      const justification = await this.narrate({ submission: s, receipt: r?.parsed_fields_json ?? null, decisions: ds, status }, run);
      ds.push(decision(s, run, 'overall_status', status === 'approved' ? 'pass' : status === 'flagged' ? 'fail' : 'unknown', status, status === 'approved' ? 'All required checks passed.' : ds.filter(d => d.verdict !== 'pass').map(d => `${d.field_checked}: ${d.verdict}`).join('; '), { simulated: this.demoMode, decision_ids: ds.map(d => d.id), justification }));
      await this.mutate(() => this.store.finish(run!, ds, status));
      return { submission_id: id, run_id: run, status };
    } catch (error) {
      const message = error instanceof CoreError ? error.message : 'Reconciliation failed; review required.';
      if (run) await this.mutate(() => this.store.fail(run!, message)).catch(() => undefined);
      const state = await this.store.snapshot().catch(() => null);
      const current = state?.submissions.find(s => s.id === id);
      // Preserve reviewer status when a run was invalidated. All other errors are non-approvals.
      const status = error instanceof CoreError && error.code === 'STALE_RUN' ? current?.status || 'needs_review' : 'needs_review';
      return { submission_id: id, run_id: run, status, error: message };
    }
  }
  /** Shared read-only computation. Evaluation supplies its entire isolated snapshot. */
  async assess(state:Snapshot,id:string,run:string,log:(call:import('../contracts').ModelCall)=>Promise<void>,signal?:AbortSignal,onError?:(error:unknown)=>void){
    const s=state.submissions.find(s=>s.id===id)!;const r=state.receipts.find(r=>r.submission_id===id)??null;
    const ds = deterministic(s, r, state.policies, run);
      for (const d of ds) d.state_snapshot_json = { submission: s, receipt: r?.parsed_fields_json ?? null, policies: state.policies };
      signal?.throwIfAborted();
      if (r?.extraction_status === 'succeeded' && parsedReceipt(r.parsed_fields_json)) {
        try {
          const evidence = await this.retrieval.retrieve(s, r.parsed_fields_json, state);
          const supporting=boundedEvidence(state,id),procedures=applicableProcedures(state,id),identity=itineraryIdentity(state,id);
          const semanticState = { submission: s, receipt: r.parsed_fields_json, evidence: {...evidence,...supporting,procedure_matches:procedures.map(p=>({procedure_id:p.procedure.id,reference:p.reference,canonical_vendor:p.procedure.trigger_scope.canonical_vendor,evidence_refs:p.refs})),identity_evidence_refs:identity??[]} };
          signal?.throwIfAborted();
          const evaluation = await this.jev.evaluate(semanticState, run, call => log(call), signal);
          signal?.throwIfAborted();
          const confirmed=confirmedDuplicates(state,s.id);
          for (const field of ['merchant', 'name', 'duplicate'] as SemanticField[]) {
            const a = evaluation.answers[field];
            const missingEvidence = (field === 'name' && !r.parsed_fields_json.names.some(n => n.trim())&&!identity) || (field === 'merchant' && !r.parsed_fields_json.vendor?.trim());
            const conflictingAliases = field === 'merchant' && new Set([...evidence.aliases.map(c => normalize(aliasPayload(c.correction_payload_json).canonical_vendor)),...procedures.map(p=>normalize(p.procedure.trigger_scope.canonical_vendor))]).size > 1;
            const exactName=field==='name'&&(r.parsed_fields_json.names.some(n=>normalize(n)===normalize(s.attendee_name))||!!identity);
            const procedureMatch=field==='merchant'&&procedures.length>0&&!conflictingAliases;
            const verdict = field==='duplicate'&&confirmed.length?'fail':missingEvidence||conflictingAliases?'unknown':procedureMatch||exactName?'pass':a.confidence < .7 || a.probabilities[a.choice] < .85 ? 'unknown' : a.choice;
            const unknown_reason=verdict!=='unknown'?null:missingEvidence?'missing_evidence':conflictingAliases?'conflicting_aliases':a.confidence<.7?'confidence_threshold':a.probabilities[a.choice]<.85?'chosen_probability_threshold':'provider_unknown';
            const d = decision(s, run, field, verdict, a.choice, `${evaluation.simulated ? 'SIMULATED fixture' : 'Jev'} ${field} assessment: ${verdict}. ${field === 'merchant' ? `${evidence.aliases.length} scoped alias records supplied.` : field === 'duplicate' ? `${evidence.candidates.length} prior receipt candidates supplied.` : `${r.parsed_fields_json.names.length} receipt names supplied.`}`, { ...evidence, unknown_reason, chosen_answer:a.choice,chosen_probability:a.probabilities[a.choice], procedure_ids:procedureMatch?procedures.map(p=>p.procedure.id):[], evidence_refs:procedureMatch?procedures.flatMap(p=>p.refs):exactName?(identity??[{kind:'receipt',id:r.id}]):[], exact_method:procedureMatch?'booking_reference_identity':exactName?'exact_claimant_identity':null, confirmed_duplicates:field==='duplicate'?confirmed:[],comparison_method:field==='duplicate'?'exact bytes or corroborated receipt identity; remaining candidates are possible':null, simulated: evaluation.simulated, provider_answer: a, probability_label: 'Probability the check passes (true)', probability_option: 'pass', provider_response: evaluation.raw });
            Object.assign(d, { check_method: 'jev', question_type: 'choice', probability: evaluation.simulated ? null : a.probabilities.pass, confidence_score: evaluation.simulated ? null : a.confidence, model_used: evaluation.model, state_snapshot_json: semanticState }); ds.push(d);
          }
        } catch (error) {
          onError?.(error);
          ds.push(decision(s, run, 'semantic_evaluation', 'unknown', null, 'Semantic evaluation or mandatory evidence retrieval was unavailable; human review required.', { error_code: error instanceof CoreError ? error.code : 'SERVICE_UNAVAILABLE', simulated: this.demoMode }));
        }
      }
    const confirmed=confirmedDuplicates(state,s.id);
    if(confirmed.length&&!ds.some(d=>d.field_checked==='duplicate'))ds.push(decision(s,run,'duplicate','fail',false,'A prior claim contains this exact purchase.',{confirmed_duplicates:confirmed}));
    return ds;
  }
  get providerIdentity(){return this.demoMode?'simulated:fixture-v1':`live:${process.env.TYPESAFE_API_KEY||process.env.JEV_API_KEY?'typesafe':'gateway'}:${process.env.JEV_MODEL||(process.env.TYPESAFE_API_KEY||process.env.JEV_API_KEY?'jev-latest':'typesafe-ai/jev')}`;}
  /** Narration never changes an outcome: provider failure degrades to the deterministic summary. */
  private async narrate(request: JustificationRequest, runId: string | null): Promise<Justification> {
    try { return await this.justifier.explain(request, runId, call => this.store.usage(call)); }
    catch (error) { return deterministicJustification(request, error instanceof CoreError ? error.code : 'JUSTIFICATION_UNAVAILABLE'); }
  }
  /** On-demand narrative for the latest completed run. Read-only apart from usage logging. */
  async justify(id: string): Promise<{ submission_id: string; run_id: string; status: SubmissionStatus; justification: Justification }> {
    const state = await this.store.snapshot();
    const s = state.submissions.find(x => x.id === id);
    if (!s) throw new CoreError('NOT_FOUND', 'Submission not found.', 404);
    const run = state.runs.find(r => r.id === s.latest_run_id && r.status === 'completed');
    if (!run) throw new CoreError('NO_COMPLETED_RUN', 'Reconcile this submission before requesting a justification.', 409);
    const runDecisions = state.decisions.filter(d => d.run_id === run.id);
    const decisions = runDecisions.filter(d => d.field_checked !== 'overall_status' && d.check_method !== 'human');
    // A human override owns the status; the machine checks explain the run, not the outcome.
    const correction=latestCorrection(state,id);
    const human=correction?state.decisions.find(d=>d.check_method==='human'&&d.evidence_json.correction_id===correction.id):undefined;
    const machine = runDecisions.find(d => d.field_checked === 'overall_status' && d.check_method !== 'human');
    const override: ReviewOverride | null = human ? { verdict: s.status === 'rejected' ? 'rejected' : 'approved', note: human.rationale_text, machine_status: (machine?.answer_json.value as SubmissionStatus | undefined) ?? null } : null;
    const receipt = state.receipts.find(r => r.submission_id === id)?.parsed_fields_json ?? null;
    const request: JustificationRequest = { submission: s, receipt, decisions, status: s.status, override };
    return { submission_id: id, run_id: run.id, status: s.status, justification: await this.narrate(request, run.id) };
  }
  correct(input: CorrectionInput) { return this.mutate(() => this.store.correct(input)); }
  rule(command: RuleCommand) { return this.mutate(() => this.store.rule(command)); }
  async reviews(): Promise<ReviewsResponse> {
    const state = await this.readSnapshot();
    const rows = state.submissions.map(s => {
      const receipt = state.receipts.find(r => r.submission_id === s.id);
      const run = state.runs.find(r => r.id === s.latest_run_id && r.status === 'completed');
      const runDecisions = run ? state.decisions.filter(d => d.run_id === run.id) : [];
      const correction=latestCorrection(state,s.id);
      const latestHuman=correction?state.decisions.find(d=>d.check_method==='human'&&d.evidence_json.correction_id===correction.id):undefined;
      const decisions: DecisionSummary[] = [...runDecisions.filter(d => d.check_method !== 'human'),...(latestHuman?[latestHuman]:[])].map(({ id, field_checked, check_method, verdict, answer_json, probability, confidence_score, rationale_text, evidence_json }) => ({ id, field_checked, check_method, verdict, answer_json, probability, confidence_score, rationale_text, evidence_json:publicEvidence(evidence_json) }));
      return { ...s, receipt: receipt ? { id: receipt.id, file_type: receipt.file_type, extraction_status: receipt.extraction_status, parsed_fields_json: receipt.parsed_fields_json } : null, decisions };
    });
    const reviewed = rows.filter(s => s.status !== 'pending'); const flags = reviewed.filter(s => ['flagged', 'needs_review'].includes(s.status));
    const reasons = new Map<string, number>();
    for (const s of flags) { const fields = new Set(s.decisions.filter(d => d.field_checked !== 'overall_status' && d.verdict !== 'pass').map(d => d.field_checked)); if (!fields.size) fields.add('review_required'); for (const reason of fields) reasons.set(reason, (reasons.get(reason) || 0) + 1); }
    return { submissions: rows, summary: { approved_amount_minor: rows.filter(s => latestCorrection(state,s.id)?.human_verdict==='approved').reduce((n, s) => n + s.amount_requested_minor, 0), flag_rate: reviewed.length ? flags.length / reviewed.length : 0, top_flag_reasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)) }, demo_mode: this.demoMode, execution: this.execution };
  }
}
