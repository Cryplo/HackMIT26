import { getCore } from '@/lib/core/runtime';
import { editDecisionEmail } from '@/lib/core/email-actions';
import { errorResponse, json, mutationBody } from '@/lib/core/http';
export const runtime = 'nodejs';
export async function PATCH(request: Request, context: { params: Promise<{ messageId: string }> }) {
  try {
    const body = await mutationBody(request);
    return json(await editDecisionEmail(getCore(), (await context.params).messageId, body));
  } catch (error) { return errorResponse(error); }
}
