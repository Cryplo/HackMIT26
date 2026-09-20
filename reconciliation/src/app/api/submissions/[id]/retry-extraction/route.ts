import { getCore } from '@/lib/core/runtime';
import { retryExtraction } from '@/lib/core/receipts';
import { getStore } from '@/lib/intake/store';
import { intakeMode } from '@/lib/intake/config';
import { extractReceipt } from '@/lib/intake/extract';
import { errorResponse,json,mutationBody } from '@/lib/core/http';
import { CoreError } from '@/lib/core/validation';
import { after } from 'next/server';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{
 const body=await mutationBody(request);const {id}=await context.params;const mode=process.env.RECONCILIATION_EXTRACTION_MODE||intakeMode();
 if(mode!=='demo'&&mode!=='live')throw new CoreError('CONFIG_ERROR','Invalid extraction mode.',503);
 const core=getCore(),result=await retryExtraction(core,id,body,getStore(),(bytes,type,id)=>extractReceipt(bytes,type,id,mode));
 if(core.automationEnabled&&result.row.receipt?.extraction_status==='succeeded')after(async()=>{try{await core.reconcile([id]);}catch{console.error('Automatic checks could not start after receipt reparse.');}});
 return json(result);
}catch(e){return errorResponse(e)}}
