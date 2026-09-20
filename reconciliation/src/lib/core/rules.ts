import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CoreService } from './service';
import type { MerchantRule, RuleTestReport } from '../review-contracts';
import { CoreError } from './validation';
import { activeAliases, type RuleAttempt } from './rule-state';
import { createAssessExample, type EvaluationObservation } from './evaluation';
const proposal=z.object({submission_id:z.uuid(),expected_review_revision:z.number().int().nonnegative(),canonical_vendor:z.string().trim().min(1).max(120)}).strict();
const mutation=z.object({expected_rule_version:z.number().int().positive()}).strict();
function parsed<T>(schema:z.ZodType<T>,raw:unknown){const p=schema.safeParse(raw);if(!p.success)throw new CoreError('INVALID_INPUT','Invalid rule request.');return p.data;}
function port(core:CoreService){if(!core.intelligence)throw new CoreError('RULE_LEARNING_UNAVAILABLE','Rule testing is not installed.',503);return core.intelligence;}
export function publicRule(rule:MerchantRule):MerchantRule{const {id,version,state,source_submission_id,source_correction_id,payload,created_at,latest_test,latest_test_error}=rule;return {id,version,state,source_submission_id,source_correction_id,payload,created_at,latest_test,latest_test_error};}
export async function rules(core:CoreService){const state=await core.store.snapshot();return {rules:(state.rules??[]).map(publicRule),knowledge_revision:state.knowledge_revision??0};}
export async function proposeRule(core:CoreService,raw:unknown){port(core);const result=await core.store.rule({action:'propose',...parsed(proposal,raw)});return {...result,rule:publicRule(result.rule)};}
export async function changeRule(core:CoreService,id:string,action:'test'|'activate'|'disable',raw:unknown,signal:AbortSignal){
 if(!z.uuid().safeParse(id).success)throw new CoreError('INVALID_INPUT','Rule ID must be a UUID.');
 const {expected_rule_version}=parsed(mutation,raw);
 if(action==='disable'){const result=await core.store.rule({action,id,expected_rule_version});return {...result,rule:publicRule(result.rule)};}
 const intelligence=port(core);const state=await core.store.snapshot();const rule=(state.rules??[]).find(r=>r.id===id);
 if(!rule)throw new CoreError('NOT_FOUND','Rule not found.',404);
 const examples=intelligence.build_rule_suite(rule),suite_hash=createHash('sha256').update(JSON.stringify(examples)).digest('hex');
 const mode=core.providerIdentity.startsWith('live:')?'live':'simulated';
 const binding={suite_hash,provider_identity:core.providerIdentity,mode} as const;
 if(action==='activate'){const result=await core.store.rule({action,id,expected_rule_version,...binding});return {...result,rule:publicRule(result.rule)};}
 signal.throwIfAborted();
 const started=await core.store.rule({action:'test',id,expected_rule_version,...binding});
 const attempt_id=started.rule.latest_attempt_id!;const observations:RuleAttempt['observations']=[];
 try{
  // The atomic test start binds knowledge. Use that same revision's active aliases.
  const current=await core.store.snapshot();if((current.knowledge_revision??0)!==started.knowledge_revision)throw new CoreError('STALE_RULE_TEST','Knowledge changed before testing.',409);
  const report=await intelligence.evaluate_rule({rule:publicRule(started.rule),active_aliases:activeAliases(current),knowledge_revision:started.knowledge_revision,examples,mode,signal},createAssessExample(core,o=>observations.push({...o,phase:o.alias_ids.includes(rule.id)?'after':'before',case_id:examples.find(e=>e.facts.submission.id===o.submission_id)?.id})));
  validateReport(report,started.rule,started.knowledge_revision,mode,observations);
  const saved=await core.store.rule({action:'tested',id,attempt_id,report,error:null,observations});
  if(saved.rule.latest_attempt_id!==attempt_id||!saved.rule.latest_test)throw new CoreError('STALE_RULE_TEST','The test was superseded; run it again.',409);
  return saved.rule.latest_test;
 }catch(error){
  await core.store.rule({action:'tested',id,attempt_id,report:null,error:error instanceof CoreError?error.code:signal.aborted?'ABORTED':'RULE_TEST_FAILED',observations});
  throw error instanceof CoreError?error:new CoreError('RULE_TEST_FAILED','Rule test did not complete. No activation proof was saved.',503);
 }
}
function validateReport(r:RuleTestReport,rule:MerchantRule,revision:number,mode:string,observations:EvaluationObservation[]){
 if(r.rule_id!==rule.id||r.rule_version!==rule.version||r.knowledge_revision!==revision||r.suite_version!=='alias-v1'||r.mode!==mode||r.before.total!==10||r.after.total!==10||observations.length!==20||observations.some(o=>o.error_code||o.assessment===null||o.checks.some(c=>c.check_method==='jev'&&c.evidence_json.simulated!==(mode==='simulated'))))throw new CoreError('INVALID_RULE_TEST','Evaluator did not produce a complete compatible activation report.',503);
 if(r.passed&&(!r.improved_case_ids.length||r.regressed_case_ids.length||r.after.false_matches!==0||r.after.correct<r.before.correct))throw new CoreError('INVALID_RULE_TEST','Activation safety criteria were not met.',503);
}
