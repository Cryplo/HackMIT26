import {getCore} from '@/lib/core/runtime';
import {changeProcedure} from '@/lib/core/procedures';
import {json,errorResponse,mutationBody} from '@/lib/core/http';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){try{const body=await mutationBody(request);return json(await changeProcedure(getCore(),(await ctx.params).id,'activate',body,request.signal));}catch(e){return errorResponse(e);}}
