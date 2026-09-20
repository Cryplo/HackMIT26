import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,signal } from './investigation-fixtures';
import { investigateClaim,investigations } from '../investigations';
import { workspaceRows } from '../projection';
import { investigationConfig } from '../investigation-config';
import { responsesConfig } from '../../providers/responses';
const rev=(f:ReturnType<typeof fixture>)=>workspaceRows(f.store.state)[0].review_revision;
test('one persisted investigation reads stored tools, reassesses once, resolves without approval or knowledge writes',async()=>{
 const f=fixture();await f.core.reconcile([f.id]);assert.equal(workspaceRows(f.store.state)[0].assessment_status,'needs_review');
 const out=await investigateClaim(f.core,f.id,{expected_review_revision:rev(f)},signal());
 assert.equal(out.run.status,'completed');assert.equal(out.run.outcome,'resolved');assert.equal(out.run.before_assessment.assessment_status,'needs_review');assert.equal(out.run.after_assessment?.assessment_status,'matched');assert.equal(out.row.decision_status,'pending');assert.equal(out.run.steps.length,2);assert.equal(f.calls(),2);assert.equal(f.store.state.runs.length,2);assert.equal(f.store.state.corrections.length,0);assert.equal(f.store.state.procedures?.length,0);assert.equal(out.row.latest_investigation?.run_id,out.run.run_id);
 assert.ok(out.run.proposed_learning);assert.ok(out.run.findings.every(x=>/^[a-f0-9-]{36}$/.test(x.id)));assert.doesNotMatch(JSON.stringify(out),/storage_path|private-test-only|private_provider_payload/);
 assert.deepEqual((await investigations(f.core,f.id)).runs,[out.run]);
});
test('polling sees actual in-flight tools and one lease blocks approval, retry, upload and another investigation',async()=>{
 const f=fixture();await f.core.reconcile([f.id]);let release!:()=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);
 f.core.intelligence={...f.port,async investigate(input,tools,opts){await tools.read_receipt();started();await gate;return f.port.investigate(input,tools,opts);}};
 const active=investigateClaim(f.core,f.id,{expected_review_revision:rev(f)},signal());await ready;
 const snapshot=await investigations(f.core,f.id);assert.equal(snapshot.runs[0].status,'running');assert.equal(snapshot.runs[0].steps[0].status,'completed');
 await assert.rejects(f.store.begin(f.id),{code:'RUN_ACTIVE'});
 await assert.rejects(f.store.beginExtraction(f.id,rev(f)),{code:'RUN_ACTIVE'});
 await assert.rejects(investigateClaim(f.core,f.id,{expected_review_revision:rev(f)},signal()),{code:'RUN_ACTIVE'});
 await assert.rejects(f.core.correct({submission_id:f.id,expected_review_revision:rev(f),human_verdict:'rejected',human_note:'test',correction_type:'decision_override',correction_payload_json:{}}),{code:'RUN_ACTIVE'});
 release();assert.equal((await active).run.status,'completed');
});
test('provider failure, cancellation, evidence limit and forged references never publish successful assessments',async()=>{
 for(const scenario of ['failure','timeout','forged','limit','budget'] as const){
  const f=fixture();await f.core.reconcile([f.id]);const before=workspaceRows(f.store.state)[0];
  f.core.intelligence={...f.port,async investigate(input,tools,opts){
   if(scenario==='timeout')return await new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true}));
   if(scenario==='budget'){for(let i=0;i<7;i++)await tools.read_receipt();}
   if(scenario==='failure'){await tools.read_receipt();throw new Error('private secret failure');}
   const result=await f.port.investigate(input,tools,opts);if(scenario==='forged')result.findings![0].evidence_refs.push({kind:'receipt',id:crypto.randomUUID()});return result;
  }};
  if(scenario==='limit')f.store.state.receipts[0].raw_extracted_text='x'.repeat(12001);
  const keepAlive=setTimeout(()=>{},100);const out=await investigateClaim(f.core,f.id,{expected_review_revision:rev(f)},signal(),'manual',scenario==='timeout'?{totalMs:30,planningMs:5}:undefined);clearTimeout(keepAlive);
  assert.equal(out.run.status,'failed',scenario);assert.equal(out.run.outcome,null);assert.equal(out.run.after_assessment,null);assert.equal(out.row.assessment_status,before.assessment_status);assert.doesNotMatch(out.run.error!,/private secret/);
  assert.equal(f.calls(),1,scenario);assert.equal(out.row.decision_status,'pending');
 }
});
test('knowledge changes supersede publication; manual start validation does not create runs or spend',async()=>{
 const f=fixture();await f.core.reconcile([f.id]);f.core.intelligence={...f.port,async investigate(...args){const result=await f.port.investigate(...args);f.store.state.knowledge_revision!++;return result;}};
 const out=await investigateClaim(f.core,f.id,{expected_review_revision:rev(f)},signal());assert.equal(out.run.status,'superseded');assert.equal(out.run.after_assessment,null);assert.equal(f.store.state.decisions.filter(d=>d.run_id===out.run.run_id).length,0);
 f.core.investigationMode='disabled';const n=f.store.state.runs.length;await assert.rejects(investigateClaim(f.core,f.id,{expected_review_revision:rev(f)},signal()),{code:'INVESTIGATION_UNAVAILABLE'});assert.equal(f.store.state.runs.length,n);
 const g=fixture();g.store.state.submissions[0].amount_requested_minor++;await g.core.reconcile([g.id]);await assert.rejects(investigateClaim(g.core,g.id,{expected_review_revision:rev(g)},signal()),{code:'INVESTIGATION_NOT_NEEDED'});
});
test('configuration is opt-in, Azure-only for planning, and simulated storage must be isolated',()=>{
 assert.equal(investigationConfig({}),'disabled');assert.throws(()=>responsesConfig('investigation',{OPENAI_API_KEY:'test'}),/Azure/);
 assert.throws(()=>investigationConfig({RECONCILIATION_INVESTIGATION_MODE:'simulated',SUPABASE_URL:'test'}),{code:'CONFIG_ERROR'});
 assert.throws(()=>investigationConfig({RECONCILIATION_INVESTIGATION_MODE:'live'}),{code:'CONFIG_ERROR'});
 assert.equal(investigationConfig({RECONCILIATION_INVESTIGATION_MODE:'simulated',RECONCILIATION_MODE:'simulated',RECONCILIATION_INTAKE_MODE:'demo'}),'simulated');
});

test('missing evidence can complete with a useful question without inventing findings',async()=>{
 const f=fixture();await f.core.reconcile([f.id]);
 f.core.intelligence={...f.port,async investigate(_input,tools,options){await tools.read_receipt();return {status:'completed',mode:options.mode,model:'offline-mock',summary:'Booking evidence is insufficient.',next_action:'request_document',evidence_refs:[],steps:[],error_code:null,findings:[],proposed_learning:null,unresolved_question:'Can you supply the booking confirmation showing this booking reference?'};}};
 const out=await investigateClaim(f.core,f.id,{expected_review_revision:rev(f)},signal());
 assert.equal(out.run.status,'completed');assert.equal(out.run.outcome,'needs_human');assert.equal(out.run.findings.length,0);assert.match(out.run.unresolved_question!,/booking confirmation/);assert.equal(out.row.decision_status,'pending');
});

test('upstream Azure planner executes persisted core tools and reassesses once with mocked transport',async()=>{
 const {runInvestigationPlanner}=await import('../../intelligence/investigation');
 const {deriveCandidate}=await import('../evidence');
 const f=fixture();await f.core.reconcile([f.id]);f.core.investigationMode='live';let requests=0;
 const transport:typeof fetch=async()=>{
  requests++;
  if(requests===1)return Response.json({status:'completed',model:'mock-planner',usage:{input_tokens:10,output_tokens:5},output:['read_receipt','read_supporting_documents'].map((name,i)=>({type:'function_call',name,call_id:`call-${i}`,arguments:'{}'}))});
  f.setResolved(true);
  return Response.json({status:'completed',model:'mock-planner',usage:{input_tokens:20,output_tokens:10},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({summary:'Stored booking corroborates the original receipt.',next_action:'human_review',findings:[{check:'merchant',statement:'The stored records share TRIP-01.',evidence_refs:[{kind:'receipt',id:f.store.state.receipts[0].id},{kind:'supporting_document',id:f.store.state.supporting_documents![0].id}]}],unresolved_question:null,proposed_learning:null})}]}]});
 };
 f.core.intelligence={...f.port,investigate:async(input,tools,options)=>{const result=await runInvestigationPlanner(input,async(name,abort)=>{abort.throwIfAborted();return tools[name]();},options,{provider:'azure-openai',url:'https://offline.invalid/responses',key:'offline-test',model:'mock-planner'},transport);return {...result,proposed_learning:result.proposed_learning?deriveCandidate(f.store.state,f.id):null};}};
 const out=await investigateClaim(f.core,f.id,{expected_review_revision:rev(f)},signal());
 assert.equal(requests,2);assert.equal(f.store.calls.length,2);assert.equal(f.calls(),2);assert.equal(out.run.status,'completed');assert.equal(out.run.outcome,'resolved');assert.equal(out.run.steps.length,2);assert.equal(out.row.decision_status,'pending');assert.equal(out.run.model,'mock-planner');
});
