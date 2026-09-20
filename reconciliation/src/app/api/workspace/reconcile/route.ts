import { getCore } from '../../../../lib/core/runtime';
import { workspaceRows } from '../../../../lib/core/workspace';
import { reconcileInput } from '../../../../lib/core/validation';
import { errorResponse,json,mutationBody } from '../../../../lib/core/http';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request){try{
 const core=getCore();const outcome=await core.reconcile(reconcileInput(await mutationBody(request)));const rows=workspaceRows(await core.store.snapshot());
 return json({results:outcome.results.map(r=>{const row=rows.find(s=>s.id===r.submission_id);return {...r,assessment_status:row?.assessment_status??null,decision_status:row?.decision_status??'pending',review_revision:row?.review_revision??0}})});
}catch(e){return errorResponse(e)}}
