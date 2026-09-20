import { getCore } from '../../../lib/core/runtime';
import { errorResponse, json, mutationBody } from '../../../lib/core/http';
import { searchClaims, searchSnapshot } from '../../../lib/core/claim-search';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET() {
  try { const snapshot=searchSnapshot(await getCore().store.snapshot()); return json({...snapshot,search_mode:process.env.RECONCILIATION_MODE==='simulated'?'disabled':'live Jev'}); } catch(error) { return errorResponse(error); }
}
export async function POST(request:Request) {
  try { return json(await searchClaims(getCore().store,await mutationBody(request),AbortSignal.any([request.signal,AbortSignal.timeout(45000)]))); } catch(error) { return errorResponse(error); }
}
