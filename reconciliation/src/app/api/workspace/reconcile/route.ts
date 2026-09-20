import { getCore } from '../../../../lib/core/runtime';
import { workspaceSnapshot } from '../../../../lib/core/workspace';
import { reconcileInput } from '../../../../lib/core/validation';
import { errorResponse,json,mutationBody } from '../../../../lib/core/http';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request){try{
 const core=getCore();const outcome=await core.reconcile(reconcileInput(await mutationBody(request)),request.signal);
 const state=await core.store.snapshot(),snapshot=workspaceSnapshot(state),rows=snapshot.rows;
 return json({rows,snapshot_token:snapshot.token,knowledge_revision:state.knowledge_revision??0,results:outcome.results.map(r=>{const row=rows.find(s=>s.id===r.submission_id);return {...r,assessment_status:row?.assessment_status??null,decision_status:row?.decision_status??'pending',review_revision:row?.review_revision??0}})});
}catch(e){return errorResponse(e)}}
