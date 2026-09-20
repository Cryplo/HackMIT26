import type { Snapshot } from '../../src/lib/core/store';
import type { Receipt } from '../../src/lib/contracts';
import type { EvaluationCase, ReceiptEvidence } from '../../src/lib/review-contracts';
import { confirmedDuplicates } from '../../src/lib/core/safety';

/** Data adapter only. Production owns assessment and duplicate detection. */
export function factsFromSnapshot(state:Snapshot,id:string):EvaluationCase['facts'] {
  const evidence=(r:Receipt|undefined):ReceiptEvidence|null=>r?{...r,sha256:r.sha256??null}:null;
  const claim=(s:Snapshot['submissions'][number])=>{
    const {id,attendee_name,email,amount_requested_minor,currency,category,origin_location,submitted_at}=s;
    return {id,attendee_name,email,amount_requested_minor,currency,category,origin_location,submitted_at};
  };
  const s=state.submissions.find(s=>s.id===id);
  if(!s)throw new Error('Missing benchmark claim.');
  return {submission:claim(s),receipt:evidence(state.receipts.find(r=>r.submission_id===id)),policies:structuredClone(state.policies),
    related_claims:state.submissions.filter(s=>s.id!==id).map(s=>({submission:claim(s),receipt:evidence(state.receipts.find(r=>r.submission_id===s.id)),decision_status:'pending'})),
    exact_duplicate_ids:confirmedDuplicates(state,id).map(c=>c.submission_id)};
}
