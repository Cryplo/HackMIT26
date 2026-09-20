import {getCore} from '@/lib/core/runtime';
import {investigations} from '@/lib/core/investigations';
import {CoreError} from '@/lib/core/validation';
import {json,errorResponse} from '@/lib/core/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{const q=new URL(request.url).searchParams;if([...q.keys()].some(k=>k!=='claim_id')||q.getAll('claim_id').length>1)throw new CoreError('INVALID_INPUT','Only one claim_id query is supported.');return json(await investigations(getCore(),q.has('claim_id')?q.get('claim_id')!:undefined));}catch(e){return errorResponse(e);}}
