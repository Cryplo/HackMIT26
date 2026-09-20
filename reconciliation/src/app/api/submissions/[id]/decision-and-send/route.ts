import { getCore } from '@/lib/core/runtime';
import { confirmDecisionEmail } from '@/lib/core/email-actions';
import { errorResponse, json, mutationBody } from '@/lib/core/http';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await mutationBody(request);
    return json(await confirmDecisionEmail(getCore(), (await context.params).id, body));
  } catch (error) { return errorResponse(error); }
}
