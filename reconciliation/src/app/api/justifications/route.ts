import { getCore } from '../../../lib/core/runtime';
import { errorResponse, json, mutationBody } from '../../../lib/core/http';
import { justificationInput } from '../../../lib/core/validation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  try { return json(await getCore().justify(justificationInput(await mutationBody(request)))); } catch (error) { return errorResponse(error); }
}
