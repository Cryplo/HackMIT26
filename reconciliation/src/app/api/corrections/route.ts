import { scheduleFeedbackLearning } from '../../../lib/core/feedback-learning-after';
import { getCore } from '../../../lib/core/runtime';
import { errorResponse, json, mutationBody } from '../../../lib/core/http';
import { correctionInput } from '../../../lib/core/validation';
export const runtime = 'nodejs';
export const maxDuration = 900;
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { const core = getCore(); const result = await core.correct(correctionInput(await mutationBody(request))); await scheduleFeedbackLearning(core, result.correction_id); return json(result); } catch (error) { return errorResponse(error); }
}
