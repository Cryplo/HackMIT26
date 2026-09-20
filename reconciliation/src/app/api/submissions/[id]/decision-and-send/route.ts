import { scheduleFeedbackLearning } from '@/lib/core/feedback-learning-after';
import { getCore } from '@/lib/core/runtime';
import { confirmDecisionEmail } from '@/lib/core/email-actions';
import { errorResponse, json, mutationBody } from '@/lib/core/http';
export const runtime = 'nodejs';
export const maxDuration = 900;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await mutationBody(request);
    const core = getCore();
    const result = await confirmDecisionEmail(core, (await context.params).id, body);
    const correctionId = result.correction_id;
    if (correctionId) await scheduleFeedbackLearning(core, correctionId);
    return json(result);
  } catch (error) { return errorResponse(error); }
}
