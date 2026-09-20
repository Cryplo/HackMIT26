import { getCore } from '../../../../lib/core/runtime';
import { workspaceDecide } from '../../../../lib/core/workspace';
import { errorResponse,json,mutationBody } from '../../../../lib/core/http';
export const runtime='nodejs';
export async function POST(request:Request){try{return json(await workspaceDecide(getCore(),await mutationBody(request)))}catch(e){return errorResponse(e)}}
