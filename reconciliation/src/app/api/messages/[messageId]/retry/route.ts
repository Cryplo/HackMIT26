import { getCore } from '@/lib/core/runtime';
import { retryDecisionEmail } from '@/lib/core/email-actions';
import { errorResponse, json, mutationBody } from '@/lib/core/http';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ messageId: string }> }) {
  try {
    const body = await mutationBody(request);
    return json(await retryDecisionEmail(getCore(), (await context.params).messageId, body));
  } catch (error) { return errorResponse(error); }
}
