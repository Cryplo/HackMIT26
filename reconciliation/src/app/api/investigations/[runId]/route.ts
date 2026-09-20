import {getCore} from '@/lib/core/runtime';
import {investigation} from '@/lib/core/investigations';
import {json,errorResponse} from '@/lib/core/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(_request:Request,ctx:{params:Promise<{runId:string}>}){try{return json(await investigation(getCore(),(await ctx.params).runId));}catch(e){return errorResponse(e);}}
