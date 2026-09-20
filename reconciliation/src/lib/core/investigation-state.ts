import type { Decision } from '../contracts';
import type { InvestigationRun, InvestigationRunStep, SupportingDocument, ProviderMode } from '../review-contracts';
import type { Snapshot } from './store';
import { workspaceRows } from './projection';
import { CoreError } from './validation';
import { reviewRevision } from './safety';
export interface StoredDocument extends SupportingDocument {storage_path:string}
export type SupportingCommand=
 |{action:'start';claim_id:string;expected_review_revision:number;document:StoredDocument}
 |{action:'finish';lease:string;document:StoredDocument};
export type InvestigationCommand=
 |{action:'start';claim_id:string;expected_review_revision:number;trigger:InvestigationRun['trigger'];mode:ProviderMode}
 |{action:'step';run_id:string;step:InvestigationRunStep}
 |{action:'finish';run_id:string;result:InvestigationRun;decisions:Decision[]}
 |{action:'fail';run_id:string;error:string;superseded?:boolean};
export function beforeAssessment(state:Snapshot,id:string){
 const row=workspaceRows(state).find(r=>r.id===id)!;
 return {assessment_status:row.assessment_status,checks:row.decisions.filter(d=>d.check_method!=='human'&&d.field_checked!=='overall_status'),review_revision:reviewRevision(state,id),evidence_revision:state.submissions.find(s=>s.id===id)?.evidence_revision??0,knowledge_revision:state.knowledge_revision??0};
}
export function pendingClaim(state:Snapshot,id:string,revision:number){
 const s=state.submissions.find(s=>s.id===id);if(!s)throw new CoreError('NOT_FOUND','Claim not found.',404);
 if(reviewRevision(state,id)!==revision)throw new CoreError('STALE_REVIEW','Claim changed. Refresh its evidence.',409);
 if(s.decision_status!=='pending')throw new CoreError('EVIDENCE_LOCKED','Only pending claims can change evidence or be investigated.',409);
 return s;
}
