import { invalidateProcedures } from './procedure-state';
import type { ActiveAlias, MerchantRule, RuleTestReport, ProviderMode } from '../review-contracts';
import type { EvaluationObservation } from './evaluation';
import type { Snapshot } from './store';
import { CoreError, normalize } from './validation';
import { latestCorrection, reviewRevision } from './safety';
export interface TestBinding { source_correction_id:string; source_review_revision:number; knowledge_revision:number; suite_hash:string; provider_identity:string; mode:ProviderMode }
export interface StoredRule extends MerchantRule { test_binding?:TestBinding|null; latest_attempt_id?:string|null }
export interface RuleAttempt { id:string; rule_id:string; rule_version:number; binding:TestBinding; status:'running'|'completed'|'failed'; report:RuleTestReport|null; error:string|null; observations:(EvaluationObservation & {phase?:'before'|'after';case_id?:string})[] }
export type RuleCommand =
 | {action:'propose';submission_id:string;expected_review_revision:number;canonical_vendor:string}
 | {action:'test';id:string;expected_rule_version:number;suite_hash:string;provider_identity:string;mode:ProviderMode}
 | {action:'tested';id:string;attempt_id:string;report:RuleTestReport|null;error:string|null;observations:(EvaluationObservation & {phase?:'before'|'after';case_id?:string})[]}
 | {action:'activate'|'disable';id:string;expected_rule_version:number;suite_hash?:string;provider_identity?:string;mode?:ProviderMode};
export function activeAliases(state:Snapshot):ActiveAlias[] {return (state.rules??[]).filter(r=>r.state==='active').map(r=>({id:r.id,source_correction_id:r.source_correction_id,payload:r.payload}));}
export function aliasCorrections(aliases:ActiveAlias[]) {return aliases.map(a=>({id:a.id,submission_id:a.source_correction_id,human_verdict:'approved' as const,human_note:'Tested active merchant identity.',correction_type:'vendor_alias' as const,correction_payload_json:a.payload as unknown as Record<string,unknown>,corrected_at:'1970-01-01T00:00:00.000Z'}));}
export function invalidateSource(state:Snapshot,id:string) {
 invalidateProcedures(state,id);
 let active=false;
 for(const rule of state.rules??[])if(rule.source_submission_id===id&&rule.state!=='disabled'){
  active ||= rule.state==='active';rule.state='disabled';rule.version++;rule.latest_test=null;rule.test_binding=null;rule.latest_test_error='Source approval changed.';state.rule_history!.push(structuredClone(rule));
 }
 if(active)state.knowledge_revision=(state.knowledge_revision??0)+1;
}
function source(state:Snapshot,rule:StoredRule){
 const c=latestCorrection(state,rule.source_submission_id);
 if(!c||c.id!==rule.source_correction_id||c.human_verdict!=='approved')throw new CoreError('STALE_RULE','Source approval changed. Propose a new rule.',409);
 return c;
}
export function mutateRule(state:Snapshot,cmd:RuleCommand) {
 state.rules??=[];state.rule_history??=[];state.rule_tests??=[];state.knowledge_revision??=0;
 let rule:StoredRule;
 if(cmd.action==='propose'){
  const s=state.submissions.find(s=>s.id===cmd.submission_id);if(!s)throw new CoreError('NOT_FOUND','Claim not found.',404);
  if(reviewRevision(state,s.id)!==cmd.expected_review_revision)throw new CoreError('STALE_REVIEW','Source review changed.',409);
  const c=latestCorrection(state,s.id),r=state.receipts.find(r=>r.submission_id===s.id);
  if(c?.human_verdict!=='approved'||r?.extraction_status!=='succeeded'||!r.parsed_fields_json?.vendor?.trim())throw new CoreError('RULE_SOURCE_REQUIRED','An approved source with an observed vendor is required.',409);
  if(!cmd.canonical_vendor.trim()||cmd.canonical_vendor.trim().length>120)throw new CoreError('INVALID_INPUT','Canonical vendor must contain 1–120 characters.');
  rule={id:crypto.randomUUID(),version:1,state:'draft',source_submission_id:s.id,source_correction_id:c.id,payload:{observed_vendor:r.parsed_fields_json.vendor.trim(),canonical_vendor:cmd.canonical_vendor.trim(),scope:{category:s.category,currency:s.currency}},created_at:new Date().toISOString(),latest_test:null,latest_test_error:null};state.rules.push(rule);
 }else{
  const found=state.rules.find(r=>r.id===cmd.id);if(!found)throw new CoreError('NOT_FOUND','Rule not found.',404);rule=found;
  if(cmd.action==='tested'){
   const attempt=state.rule_tests.find(t=>t.id===cmd.attempt_id&&t.rule_id===rule.id);if(!attempt)throw new CoreError('STALE_RULE_TEST','Test attempt not found.',409);
   attempt.observations=structuredClone(cmd.observations);attempt.report=structuredClone(cmd.report??attempt.report);attempt.error=cmd.error;attempt.status=cmd.error?'failed':'completed';
   const b=attempt.binding;
   const fresh=rule.state==='draft'&&rule.version===attempt.rule_version&&rule.latest_attempt_id===attempt.id&&b.knowledge_revision===state.knowledge_revision&&b.source_review_revision===reviewRevision(state,rule.source_submission_id)&&latestCorrection(state,rule.source_submission_id)?.id===b.source_correction_id;
   if(fresh){rule.latest_test_error=cmd.error;rule.latest_test=cmd.error?null:structuredClone(cmd.report);rule.test_binding=cmd.error?null:b;}
   else {attempt.status='failed';attempt.error='STALE_RULE_TEST';}
  }else{
   if(rule.version!==cmd.expected_rule_version)throw new CoreError('STALE_RULE','Rule changed. Refresh before continuing.',409);
   if(cmd.action==='disable'){
    if(rule.state==='disabled')throw new CoreError('STALE_RULE','Rule is already disabled.',409);
    if(rule.state==='active')state.knowledge_revision++;rule.state='disabled';rule.version++;rule.latest_test=null;rule.test_binding=null;
   }else{
    source(state,rule);if(rule.state!=='draft')throw new CoreError('STALE_RULE','Only draft rules can be tested or activated.',409);
    if(cmd.action==='test'){
     const binding:TestBinding={source_correction_id:rule.source_correction_id,source_review_revision:reviewRevision(state,rule.source_submission_id),knowledge_revision:state.knowledge_revision,suite_hash:cmd.suite_hash,provider_identity:cmd.provider_identity,mode:cmd.mode};
     const attempt:RuleAttempt={id:crypto.randomUUID(),rule_id:rule.id,rule_version:rule.version,binding,status:'running',report:null,error:null,observations:[]};state.rule_tests.push(attempt);rule.latest_attempt_id=attempt.id;rule.latest_test=null;rule.test_binding=null;rule.latest_test_error=null;
    }else{
     const b=rule.test_binding,t=rule.latest_test;
     if(!t?.passed||!b||t.rule_id!==rule.id||t.rule_version!==rule.version||t.suite_version!=='alias-v1'||t.knowledge_revision!==state.knowledge_revision||b.knowledge_revision!==state.knowledge_revision||b.source_review_revision!==reviewRevision(state,rule.source_submission_id)||b.mode!==cmd.mode||t.mode!==cmd.mode||b.provider_identity!==cmd.provider_identity||b.suite_hash!==cmd.suite_hash)throw new CoreError('STALE_RULE_TEST','Run a fresh successful test before activation.',409);
     if(state.rules.some(r=>r.state==='active'&&normalize(r.payload.observed_vendor)===normalize(rule.payload.observed_vendor)&&r.payload.scope.category===rule.payload.scope.category&&r.payload.scope.currency===rule.payload.scope.currency&&normalize(r.payload.canonical_vendor)!==normalize(rule.payload.canonical_vendor)))throw new CoreError('RULE_CONFLICT','An active rule supplies a different canonical identity for this scope.',409);
     rule.state='active';rule.version++;state.knowledge_revision++;
    }
   }
  }
 }
 state.rule_history.push(structuredClone(rule));
 return {rule:structuredClone(rule),knowledge_revision:state.knowledge_revision};
}
