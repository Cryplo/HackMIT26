import {getCore} from '@/lib/core/runtime';
import {supportingOriginal} from '@/lib/intake/supporting-documents';
import {getSupportingOriginals} from '@/lib/intake/supporting-originals';
import {errorResponse} from '@/lib/core/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(_request:Request,ctx:{params:Promise<{id:string;documentId:string}>}){try{const {id,documentId}=await ctx.params,{document,bytes}=await supportingOriginal(getCore(),id,documentId,getSupportingOriginals());const ext=document.file_type==='application/pdf'?'pdf':document.file_type==='image/png'?'png':'jpg';return new Response(Buffer.from(bytes),{headers:{'Content-Type':document.file_type,'Content-Disposition':`inline; filename="supporting-${document.id}.${ext}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});}catch(e){return errorResponse(e);}}
