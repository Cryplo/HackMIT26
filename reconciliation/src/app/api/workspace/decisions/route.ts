import { scheduleFeedbackLearning } from '../../../../lib/core/feedback-learning-after';
import { getCore } from '../../../../lib/core/runtime';
import { workspaceDecide } from '../../../../lib/core/workspace';
import { errorResponse,json,mutationBody } from '../../../../lib/core/http';
export const runtime='nodejs';
export const maxDuration=900;
export async function POST(request:Request){try{const core=getCore();const result=await workspaceDecide(core,await mutationBody(request));await scheduleFeedbackLearning(core,result.correction_id);return json(result)}catch(e){return errorResponse(e)}}
