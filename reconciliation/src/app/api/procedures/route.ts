import {getCore} from '@/lib/core/runtime';
import {procedures,proposeProcedure} from '@/lib/core/procedures';
import {json,errorResponse,mutationBody} from '@/lib/core/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){try{return json(await procedures(getCore()));}catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{const body=await mutationBody(request);return json(await proposeProcedure(getCore(),body),201);}catch(e){return errorResponse(e);}}
