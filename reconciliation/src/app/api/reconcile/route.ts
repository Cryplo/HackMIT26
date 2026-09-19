import { getCore } from '../../../lib/core/runtime';
import { errorResponse, json, mutationBody } from '../../../lib/core/http';
import { reconcileInput } from '../../../lib/core/validation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function POST(request: Request) {
  try { return json(await getCore().reconcile(reconcileInput(await mutationBody(request)))); } catch (error) { return errorResponse(error); }
}
