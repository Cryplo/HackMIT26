import { getCore } from '@/lib/core/runtime';
import { draftDecisionEmail } from '@/lib/core/email-actions';
import { errorResponse, json, mutationBody } from '@/lib/core/http';
export const runtime = 'nodejs';
export const maxDuration = 40;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await mutationBody(request);
    return json(await draftDecisionEmail(getCore(), (await context.params).id, body, request.signal));
  } catch (error) { return errorResponse(error); }
}
