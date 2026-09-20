import {getCore} from '@/lib/core/runtime';
import {supportingDocuments,parseSupportingUpload,uploadSupporting} from '@/lib/intake/supporting-documents';
import {getSupportingOriginals} from '@/lib/intake/supporting-originals';
import {extractSupportingDocument} from '@/lib/intake/extract';
import {intakeMode} from '@/lib/intake/config';
import {json,errorResponse} from '@/lib/core/http';
export const runtime='nodejs';export const maxDuration=90;export const dynamic='force-dynamic';
export async function GET(_request:Request,ctx:{params:Promise<{id:string}>}){try{return json(await supportingDocuments(getCore(),(await ctx.params).id));}catch(e){return errorResponse(e);}}
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){try{const upload=await parseSupportingUpload(request),mode=intakeMode();return json(await uploadSupporting(getCore(),(await ctx.params).id,upload,getSupportingOriginals(),(b,t,id,signal)=>extractSupportingDocument(b,t,id,mode,signal),AbortSignal.any([request.signal,AbortSignal.timeout(85000)])),201);}catch(e){return errorResponse(e);}}
