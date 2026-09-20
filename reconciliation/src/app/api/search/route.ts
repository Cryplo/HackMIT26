import { getCore } from '../../../lib/core/runtime';
import { workspaceSearch } from '../../../lib/core/workspace';
import { errorResponse,json,mutationBody } from '../../../lib/core/http';
export const runtime='nodejs';export const maxDuration=60;
export async function POST(request:Request){try{return json(await workspaceSearch(getCore(),await mutationBody(request),AbortSignal.any([request.signal,AbortSignal.timeout(45000)])))}catch(e){return errorResponse(e)}}
