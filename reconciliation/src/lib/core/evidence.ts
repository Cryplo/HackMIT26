import type { EvidenceRef, ProcedureCandidate, ResolutionProcedure, SupportingDocument } from '../review-contracts';
import type { Snapshot } from './store';
import { CoreError, normalize } from './validation';

export const RECEIPT_TEXT_LIMIT=12000, SUPPORTING_TEXT_LIMIT=24000;
export function supportingFor(state:Snapshot,id:string):SupportingDocument[]{
 return (state.supporting_documents??[]).filter(d=>d.claim_id===id).map(({storage_path:_private,...d})=>structuredClone(d));
}
export function boundedEvidence(state:Snapshot,id:string){
 const receipt=state.receipts.find(r=>r.submission_id===id);
 const documents=supportingFor(state,id);
 if((receipt?.raw_extracted_text?.length??0)>RECEIPT_TEXT_LIMIT||documents.reduce((n,d)=>n+(d.extracted_text?.length??0),0)>SUPPORTING_TEXT_LIMIT)throw new CoreError('EVIDENCE_LIMIT','Stored text exceeds the evidence limit; obtain focused evidence before resolving this claim.',409);
 return {receipt_text:receipt?.raw_extracted_text??null,supporting_documents:documents,policies:state.policies.filter(p=>p.category===state.submissions.find(s=>s.id===id)?.category)};
}
/** Only explicitly labelled booking/trip references; receipt numbers are never substituted. */
export function bookingReferences(text:string|null):string[]{
 return [...new Set(Array.from((text??'').matchAll(/(?:^|\n)\s*(?:booking|reservation|trip)\s+(?:reference|ref(?:erence)?\.?|confirmation(?:\s+(?:number|code))?)\s*[:#]\s*([^\r\n]+)/gi),m=>normalize(m[1])))].filter(Boolean);
}
function contains(text:string|null,value:string|null){return !!value?.trim()&&normalize(text??'').includes(normalize(value));}
/** Code establishes only a relationship between two stored documents, never financial permission. */
export function bookingLink(state:Snapshot,id:string){
 const s=state.submissions.find(s=>s.id===id),r=state.receipts.find(r=>r.submission_id===id);
 if(!s||s.category!=='hotel'||s.currency!=='USD'||r?.extraction_status!=='succeeded'||!r.parsed_fields_json?.vendor?.trim())return null;
 const evidence=boundedEvidence(state,id),p=r.parsed_fields_json,refs=bookingReferences(r.raw_extracted_text);
 if(refs.length!==1)return null;
 const bookings=evidence.supporting_documents.filter(d=>d.kind==='booking_confirmation');
 if(!bookings.length||bookings.some(d=>d.extraction_status!=='succeeded'||!d.facts))return null;
 const docs=evidence.supporting_documents.filter(d=>d.extraction_status==='succeeded'&&d.facts);
 for(const d of docs){const f=d.facts!;
  if((f.booking_reference?.trim()&&normalize(f.booking_reference)!==refs[0])||(f.amount_minor!==null&&f.amount_minor!==p.amount_minor)||(f.currency!==null&&f.currency!==p.currency)||(f.purchase_date!==null&&f.purchase_date!==p.receipt_date))return null;
 }
 // Every available booking must corroborate the same identity. Never pick one while ignoring a conflict.
 for(const d of bookings){const f=d.facts!;
  if(!f.booking_reference?.trim()||normalize(f.booking_reference)!==refs[0]||!contains(d.extracted_text,f.booking_reference)||!f.vendor?.trim()||!contains(d.extracted_text,f.vendor))return null;
  if((f.amount_minor!==null&&f.amount_minor!==p.amount_minor)||(f.currency!==null&&f.currency!==p.currency)||(f.purchase_date!==null&&f.purchase_date!==p.receipt_date))return null;
  if(f.names.length&&p.names.length&&!f.names.some(n=>p.names.some(q=>normalize(n)===normalize(q))))return null;
 }
 if(new Set(bookings.map(d=>normalize(d.facts!.vendor!))).size!==1)return null;
 const canonical=bookings[0].facts!.vendor!.trim();
 const refsOut:EvidenceRef[]=[{kind:'receipt',id:r.id},...bookings.map(d=>({kind:'supporting_document' as const,id:d.id}))];
 return {reference:refs[0],canonical_vendor:canonical,observed_vendor:p.vendor!.trim(),evidence_refs:refsOut};
}
export function deriveCandidate(state:Snapshot,id:string):ProcedureCandidate|null{
 const link=bookingLink(state,id);return link?{kind:'booking_reference_identity',trigger_scope:{category:'hotel',currency:'USD',observed_vendor:link.observed_vendor,canonical_vendor:link.canonical_vendor},required_evidence:['receipt','booking_confirmation'],matching_fields:['booking_reference'],source_evidence_refs:link.evidence_refs}:null;
}
export function applicableProcedures(state:Snapshot,id:string):{procedure:ResolutionProcedure;refs:EvidenceRef[];reference:string}[]{
 const link=bookingLink(state,id);if(!link)return [];
 return (state.procedures??[]).filter(p=>p.state==='active'&&p.kind==='booking_reference_identity'&&p.trigger_scope.category==='hotel'&&p.trigger_scope.currency==='USD'&&normalize(p.trigger_scope.observed_vendor)===normalize(link.observed_vendor)&&normalize(p.trigger_scope.canonical_vendor)===normalize(link.canonical_vendor)).map(procedure=>({procedure,reference:link.reference,refs:[...link.evidence_refs,{kind:'procedure',id:procedure.id}]}));
}
export function itineraryIdentity(state:Snapshot,id:string):EvidenceRef[]|null{
 const s=state.submissions.find(s=>s.id===id)!,r=state.receipts.find(r=>r.submission_id===id),p=r?.parsed_fields_json;
 if(!p||!r||r.extraction_status!=='succeeded')return null;
 const policies=state.policies.filter(x=>x.category===s.category&&x.currency===s.currency&&x.region_or_route==='*'&&p.receipt_date&&x.date_range_start<=p.receipt_date&&x.date_range_end>=p.receipt_date);
 if(policies.length!==1||policies[0].claimant_identity_evidence!=='receipt_or_linked_itinerary')return null;
 const refs=bookingReferences(r.raw_extracted_text);if(refs.length!==1)return null;
 const itineraries=supportingFor(state,id).filter(d=>d.kind==='itinerary');if(!itineraries.length||itineraries.some(d=>d.extraction_status!=='succeeded'))return null;
 for(const d of itineraries){const f=d.facts;
  if(!f||!f.booking_reference?.trim()||normalize(f.booking_reference)!==refs[0]||!contains(d.extracted_text,f.booking_reference)||!f.names.some(n=>normalize(n)===normalize(s.attendee_name)&&contains(d.extracted_text,n)))return null;
  if((f.currency!==null&&f.currency!==p.currency)||(f.amount_minor!==null&&f.amount_minor!==p.amount_minor)||(f.purchase_date!==null&&f.purchase_date!==p.receipt_date)||(p.names.length&&!p.names.some(n=>normalize(n)===normalize(s.attendee_name))))return null;
 }
 return [{kind:'receipt',id:r.id},{kind:'policy',id:policies[0].id},...itineraries.map(d=>({kind:'supporting_document' as const,id:d.id}))];
}
