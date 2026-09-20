import { getCore } from '@/lib/core/runtime';
import { changeRule } from '@/lib/core/rules';
import { errorResponse,json,mutationBody } from '@/lib/core/http';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const body=await mutationBody(request);const {id}=await context.params;return json(await changeRule(getCore(),id,'disable',body,request.signal))}catch(e){return errorResponse(e)}}
