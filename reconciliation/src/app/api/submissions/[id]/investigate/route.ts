import {getCore} from '@/lib/core/runtime';
import {investigateClaim} from '@/lib/core/investigations';
import {json,errorResponse,mutationBody} from '@/lib/core/http';
export const runtime='nodejs';export const maxDuration=100;
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){try{const body=await mutationBody(request);return json(await investigateClaim(getCore(),(await ctx.params).id,body,request.signal));}catch(e){return errorResponse(e);}}
