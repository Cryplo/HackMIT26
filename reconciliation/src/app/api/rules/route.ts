import { getCore } from '@/lib/core/runtime';
import { rules,proposeRule } from '@/lib/core/rules';
import { errorResponse,json,mutationBody } from '@/lib/core/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){try{return json(await rules(getCore()))}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{const body=await mutationBody(request);return json(await proposeRule(getCore(),body),201)}catch(e){return errorResponse(e)}}
