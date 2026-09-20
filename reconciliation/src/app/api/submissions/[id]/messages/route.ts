import { getCore } from '@/lib/core/runtime';
import { listDecisionEmails } from '@/lib/core/email-actions';
import { errorResponse, json } from '@/lib/core/http';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return json(await listDecisionEmails(getCore(), (await context.params).id)); }
  catch (error) { return errorResponse(error); }
}
