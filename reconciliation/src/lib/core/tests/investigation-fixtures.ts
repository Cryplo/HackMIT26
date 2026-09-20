import { CoreService } from '../service';
import { MemoryStore } from '../store';
import { demoSnapshot } from '../fixtures';
import { DatabaseRetrieval } from '../retrieval';
import { intelligence } from '../../intelligence';
import type { IntelligencePort, ProcedureCandidate, ProcedureFacts } from '../../review-contracts';
import { deriveCandidate } from '../evidence';
import { workspaceRows } from '../projection';
export const signal=()=>new AbortController().signal;
export function evidenceState(){
 const state=demoSnapshot();state.submissions=state.submissions.slice(2,3);state.receipts=state.receipts.slice(2,3);
 const s=state.submissions[0],r=state.receipts[0];r.raw_extracted_text=`Merchant: ${r.parsed_fields_json!.vendor}\nBooking reference: TRIP-01\nGuest: ${s.attendee_name}`;
 return {...state,supporting_documents:[{id:crypto.randomUUID(),claim_id:s.id,kind:'booking_confirmation' as const,file_type:'application/pdf',sha256:'b'.repeat(64),storage_path:'private-test-only',created_at:'2026-09-20T00:00:00Z',extraction_status:'succeeded' as const,extraction_error:null,extraction_provenance:'simulated fixture',extracted_text:`Synthetic Harbor Hotel\nBooking reference: TRIP-01\nGuest: ${s.attendee_name}`,facts:{vendor:'Synthetic Harbor Hotel',booking_reference:'TRIP-01',receipt_number:null,names:[s.attendee_name],purchase_date:r.parsed_fields_json!.receipt_date,currency:'USD',amount_minor:r.parsed_fields_json!.amount_minor}}]};
}
export function fixture(){
 const store=new MemoryStore(evidenceState());let resolved=false,assessCalls=0;
 const port:IntelligencePort={...intelligence,async investigate(input,tools,options){
  options.signal.throwIfAborted();const receipt=await tools.read_receipt(),docs=await tools.read_supporting_documents();resolved=true;
  return {status:'completed',mode:options.mode,model:'offline-mock',summary:'The stored booking corroborates this descriptor.',next_action:'human_review',evidence_refs:[],steps:[],error_code:null,findings:[{id:'provider-local-id',check:'merchant',statement:'Receipt and booking share the same reference.',evidence_refs:[{kind:'receipt',id:receipt!.id},{kind:'supporting_document',id:docs[0].id}]}],proposed_learning:deriveCandidate(store.state,input.submission.id),unresolved_question:null};
 }};
 const core=new CoreService(store,new DatabaseRetrieval(),{async evaluate(_state,_run,_log,sig){sig?.throwIfAborted();assessCalls++;return {answers:Object.fromEntries(['merchant','name','duplicate'].map(field=>[field,{type:'choice' as const,choice:field==='merchant'&&!resolved?'unknown' as const:'pass' as const,confidence:1,probabilities:field==='merchant'&&!resolved?{pass:0,fail:0,unknown:1}:{pass:1,fail:0,unknown:0}}])) as never,model:'offline-mock',simulated:true,raw:{private_provider_payload:true}};}},true,undefined,undefined,port,'simulated');
 return {core,store,id:store.state.submissions[0].id,port,calls:()=>assessCalls,setResolved:(v:boolean)=>{resolved=v;}};
}
export async function approve(core:CoreService,id:string){const row=workspaceRows(await core.store.snapshot()).find(r=>r.id===id)!;return core.correct({submission_id:id,expected_review_revision:row.review_revision,human_verdict:'approved',human_note:'Reviewed stored synthetic receipt and booking.',correction_type:'decision_override',correction_payload_json:{}});}
export function procedureFacts(state:ReturnType<typeof evidenceState>):ProcedureFacts{
 const s=state.submissions[0],r=state.receipts[0];return {submission:s,receipt:{...r,sha256:r.sha256??null},policies:state.policies,related_claims:[],exact_duplicate_ids:[],supporting_documents:state.supporting_documents};
}
