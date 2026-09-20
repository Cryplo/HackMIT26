import { getCore } from '@/lib/core/runtime';
import { scheduleFeedbackLearning } from '@/lib/core/feedback-learning-after';
import { latestCorrection } from '@/lib/core/safety';
import { workspaceRows } from '@/lib/core/projection';
import { CoreError, isObject } from '@/lib/core/validation';
import { errorResponse, json, mutationBody } from '@/lib/core/http';
export const runtime = 'nodejs';
export const maxDuration = 900;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await mutationBody(request);
    if (!isObject(body) || Object.keys(body).length !== 1 || !Number.isSafeInteger(body.expected_review_revision) || Number(body.expected_review_revision) < 0) throw new CoreError('INVALID_INPUT', 'The current review revision is required.');
    const core = getCore(), id = (await context.params).id;
    await core.store.feedbackLearning({ action: 'expire' });
    const correction = latestCorrection(await core.store.snapshot(), id);
    if (!correction) throw new CoreError('NOT_FOUND', 'Review feedback not found.', 404);
    await core.store.feedbackLearning({ action: 'retry', correction_id: correction.id, expected_review_revision: Number(body.expected_review_revision) });
    await scheduleFeedbackLearning(core, correction.id);
    return json({ row: workspaceRows(await core.store.snapshot()).find(row => row.id === id)! });
  } catch (error) { return errorResponse(error); }
}
