import { getCore } from '../../../lib/core/runtime';
import { errorResponse, json, mutationBody } from '../../../lib/core/http';
import { correctionInput } from '../../../lib/core/validation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return json(await getCore().correct(correctionInput(await mutationBody(request)))); } catch (error) { return errorResponse(error); }
}
