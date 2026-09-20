import { after } from 'next/server';
import type { CoreService } from './service';
import { processFeedbackLearning } from './feedback-learning';

/** A scheduling failure must never turn a committed human decision into an HTTP failure. */
export async function scheduleFeedbackLearning(core: CoreService, correctionId: string) {
  const failedToStart = async () => {
    try {
      const result = await core.store.feedbackLearning({ action: 'start', correction_id: correctionId });
      if (result.acquired && result.job?.lease) await core.store.feedbackLearning({ action: 'finish', correction_id: correctionId, lease: result.job.lease, status: 'failed', summary: 'Learning could not start. Your decision is saved; retry learning when ready.' });
    } catch { /* The queued job expires visibly if storage is also unavailable. */ }
  };
  try { after(() => processFeedbackLearning(core, correctionId).catch(failedToStart)); }
  catch { await failedToStart(); }
}
