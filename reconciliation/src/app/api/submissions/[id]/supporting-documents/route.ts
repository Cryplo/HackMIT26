import {getCore} from '@/lib/core/runtime';
import {supportingDocuments,parseSupportingUpload,uploadSupporting} from '@/lib/intake/supporting-documents';
import {getSupportingOriginals} from '@/lib/intake/supporting-originals';
import {extractSupportingDocument} from '@/lib/intake/extract';
import {intakeMode} from '@/lib/intake/config';
import {json,errorResponse} from '@/lib/core/http';
import {after} from 'next/server';
export const runtime='nodejs';export const maxDuration=300;export const dynamic='force-dynamic';
export async function GET(_request:Request,ctx:{params:Promise<{id:string}>}){try{return json(await supportingDocuments(getCore(),(await ctx.params).id));}catch(e){return errorResponse(e);}}
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){try{
 const upload=await parseSupportingUpload(request),mode=intakeMode(),core=getCore(),{id}=await ctx.params;
 const result=await uploadSupporting(core,id,upload,getSupportingOriginals(),(b,t,id,signal)=>extractSupportingDocument(b,t,id,mode,signal),AbortSignal.any([request.signal,AbortSignal.timeout(85000)]));
 if(core.automationEnabled&&result.document.extraction_status==='succeeded')after(async()=>{try{await core.reconcile([id]);}catch{console.error('Automatic checks could not start after document upload.');}});
 return json(result,201);
}catch(e){return errorResponse(e);}}
