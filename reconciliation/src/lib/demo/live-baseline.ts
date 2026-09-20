import { automaticApproval } from '../core/automation';
import { decision, overall } from '../core/checks';
import { SimulatedJev } from '../core/jev';
import { DatabaseRetrieval } from '../core/retrieval';
import { CoreService } from '../core/service';
import { MemoryStore, type Snapshot } from '../core/store';
import { LIVE_SHOWCASE_COUNT, showcaseFixture } from './showcase';

export const LIVE_UNCHECKED_NUMBERS = [1, 2, 5, 6, 7, 9, 10, 12, 13, 14];
export const BASELINE_PROVENANCE = 'Prepared demo history: authored fixture assessment; no live provider, investigation, reviewer, or email action occurred.';
const baselineId = (kind: number, n: number) => `${kind}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// JSONB emits UTC timestamps this way. Approval identity hashes must survive a SQL round trip.
function sqlTimestamp(value: string) {
  return new Date(value).toISOString().replace(/\.000Z$/, '+00:00').replace(/(\.\d*?[1-9])0*Z$/, '$1+00:00');
}

/** Builds historical demo outcomes offline; the remaining ten use normal live assessment. */
export async function liveBaseline(previous: Pick<Snapshot, 'submissions' | 'knowledge_revision'>) {
  const fixture = showcaseFixture(LIVE_SHOWCASE_COUNT), state = fixture.state;
  const revision = Math.max(0, ...previous.submissions.flatMap(s => [s.review_revision ?? 0, s.evidence_revision ?? 0])) + 1;
  state.knowledge_revision = (previous.knowledge_revision ?? 0) + 1;
  for (const s of state.submissions) {
    s.review_revision = s.evidence_revision = revision;
    s.submitted_at = sqlTimestamp(s.submitted_at); s.updated_at = sqlTimestamp(s.updated_at);
  }
  for (const r of state.receipts) {
    r.extracted_at = sqlTimestamp(r.extracted_at!);
    r.extraction_provenance = 'synthetic showcase: cached transcription of generated original; no extraction provider called';
  }
  for (const d of state.supporting_documents ?? []) {
    d.created_at = sqlTimestamp(d.created_at);
    d.extraction_provenance = 'synthetic showcase: cached transcription of generated original; no extraction provider called';
  }
  for (const p of state.policies) p.created_at = sqlTimestamp(p.created_at);
  const store = new MemoryStore(state);
  const core = new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), true);
  for (const [index, s] of state.submissions.entries()) {
    if (LIVE_UNCHECKED_NUMBERS.includes(index + 1)) continue;
    const started = await store.begin(s.id), runId = baselineId(71, index + 1);
    state.runs.find(r => r.id === started)!.id = runId;
    const checks = await core.assess(await store.snapshot(), s.id, runId, async () => { throw new Error('Prepared history must not log provider usage.'); });
    const status = overall(checks);
    const approval = automaticApproval(state, s.id, runId, checks, true);
    checks.push(decision(s, runId, 'overall_status', status === 'approved' ? 'pass' : status === 'flagged' ? 'fail' : 'unknown', status,
      BASELINE_PROVENANCE, { ...(approval ? { auto_approval: approval } : {}) }));
    for (const [offset, check] of checks.entries()) {
      check.id = baselineId(72, index * 10 + offset + 1);
      check.evidence_json = { ...check.evidence_json, demo_baseline: true, simulated: true, provenance: BASELINE_PROVENANCE };
      check.rationale_text = `Prepared demo check: ${check.rationale_text}`;
      check.probability = check.confidence_score = null;
    }
    await store.finish(runId, checks, status);
    const run = state.runs.find(r => r.id === runId)!;
    run.evidence_snapshot = { ...run.evidence_snapshot, demo_baseline: true, provenance: BASELINE_PROVENANCE };
    if (status !== 'flagged') continue;
    // Authored rejection examples are records, not calls to the human-review/learning/email workflow.
    const reason = checks.find(d => d.verdict === 'fail')!;
    const note = `Prepared demo decision: reject because ${reason.field_checked === 'amount' ? 'the requested amount differs from the receipt total' : 'the claim exceeds the category policy cap'}. No real reviewer action occurred.`;
    const correctionId = baselineId(73, index + 1);
    state.corrections.push({ id: correctionId, submission_id: s.id, decision_id: reason.id,
      human_verdict: 'rejected', human_note: note, correction_type: 'decision_override',
      correction_payload_json: { demo_baseline: true, provenance: BASELINE_PROVENANCE },
      corrected_at: run.completed_at!, review_revision: (s.review_revision ?? 0) + 1 });
    const human = decision(s, runId, 'overall_status', 'fail', 'rejected', note,
      { correction_id: correctionId, demo_baseline: true, simulated: true, provenance: BASELINE_PROVENANCE });
    human.id = baselineId(72, index * 10 + 10); human.check_method = 'human'; state.decisions.push(human);
    s.status = s.decision_status = 'rejected'; s.review_revision = (s.review_revision ?? 0) + 1;
  }
  return fixture;
}
