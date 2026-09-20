import type { AssessExample, AssessProcedureExample, Assessment, Check } from '../review-contracts';
import type { ModelCall } from '../contracts';
import type { CoreService } from './service';
import { CoreError } from './validation';
import { overall } from './checks';
import { requiredFieldsIn } from './custom-checks';
import type { Snapshot } from './store';
export interface EvaluationObservation {
  procedure_ids?:string[];
  submission_id: string; alias_ids: string[]; assessment: Assessment | null;
  checks: Check[]; model_calls: ModelCall[]; latency_ms: number;
  error_code: string | null;
}
export function createAssessExample(core: CoreService, observe?: (result: EvaluationObservation) => void): AssessExample {
 const assess=createAssessProcedureExample(core,observe);return (facts,aliases,signal)=>assess({...facts,supporting_documents:[]},aliases,[],signal);
}
export function createAssessProcedureExample(core:CoreService,observe?:(result:EvaluationObservation)=>void):AssessProcedureExample {
  return async (facts,aliases,procedures,signal) => {
    const started=Date.now();const calls:ModelCall[]=[];let checks:Check[]=[];let assessment:Assessment|null=null;let error:unknown;let failed=false;
    try {
      signal.throwIfAborted();
      const claim=(s:typeof facts.submission)=>({...s,status:'pending' as const,latest_run_id:null,updated_at:s.submitted_at});
      const receipt=(r:NonNullable<typeof facts.receipt>)=>({...r,storage_path:'',extracted_at:null});
      const state:Snapshot={supporting_documents:facts.supporting_documents.map(d=>({...structuredClone(d),storage_path:''})),procedures:procedures.map(p=>({...structuredClone(p),source_evidence_revision:0,source_fingerprint:''})),submissions:[claim(facts.submission),...facts.related_claims.filter(c=>c.submission.id!==facts.submission.id).map(c=>claim(c.submission))],receipts:[...(facts.receipt?[receipt(facts.receipt)]:[]),...facts.related_claims.filter(c=>c.submission.id!==facts.submission.id&&c.receipt).map(c=>receipt(c.receipt!))],policies:structuredClone(facts.policies),decisions:[],corrections:[],runs:[],rules:aliases.map(a=>({...a,version:1,state:'active',source_submission_id:a.source_correction_id,created_at:'1970-01-01T00:00:00.000Z',latest_test:null}))};
      checks=await core.assess(state,facts.submission.id,crypto.randomUUID(),async call=>{const logged={...call,run_id:null,receipt_id:null};await core.store.usage(logged);calls.push(logged);},signal,e=>{error=e;failed=true;});
      signal.throwIfAborted();if(failed)throw error;
      const result=overall(checks,requiredFieldsIn(checks));assessment=result==='approved'?'matched':result as Assessment;
      return assessment;
    } catch(e){error=e;failed=true;throw e;}
    finally {observe?.({submission_id:facts.submission.id,alias_ids:aliases.map(a=>a.id),procedure_ids:procedures.map(p=>p.id),assessment,checks,model_calls:calls,latency_ms:Date.now()-started,error_code:failed?error instanceof CoreError?error.code:signal.aborted?'ABORTED':'PROVIDER_UNAVAILABLE':null});}
  };
}
