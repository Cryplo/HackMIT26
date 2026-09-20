import { getCore } from '@/lib/core/runtime';
import { retryExtraction } from '@/lib/core/receipts';
import { getStore } from '@/lib/intake/store';
import { intakeMode } from '@/lib/intake/config';
import { extractReceipt } from '@/lib/intake/extract';
import { errorResponse,json,mutationBody } from '@/lib/core/http';
import { CoreError } from '@/lib/core/validation';
export const runtime='nodejs';export const maxDuration=90;
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{
 const body=await mutationBody(request);const {id}=await context.params;const mode=process.env.RECONCILIATION_EXTRACTION_MODE||intakeMode();
 if(mode!=='demo'&&mode!=='live')throw new CoreError('CONFIG_ERROR','Invalid extraction mode.',503);
 return json(await retryExtraction(getCore(),id,body,getStore(),(bytes,type,id)=>extractReceipt(bytes,type,id,mode)));
}catch(e){return errorResponse(e)}}
