import { z } from 'zod';
import { getCore } from '../../../../lib/core/runtime';
import { resetSimulation } from '../../../../lib/core/demo-reset';
import { resetLiveDemo } from '../../../../lib/core/live-demo-reset';
import { errorResponse, json, mutationBody } from '../../../../lib/core/http';
import { CoreError } from '../../../../lib/core/validation';

export const runtime = 'nodejs';
export const maxDuration = 300;
const input = z.object({ snapshot_token: z.string().regex(/^[a-f0-9]{64}$/), confirmation: z.literal('reset-live-demo').optional() }).strict();
export async function POST(request: Request) {
  try {
    const parsed = input.safeParse(await mutationBody(request));
    if (!parsed.success) throw new CoreError('INVALID_INPUT', 'Provide the current snapshot token and valid reset confirmation.');
    const core = getCore();
    if (core.demoMode) return json(await resetSimulation(core, parsed.data.snapshot_token));
    if (parsed.data.confirmation !== 'reset-live-demo') throw new CoreError('RESET_CONFIRMATION_REQUIRED', 'Confirm that the live demo should be archived and reset.', 409);
    return json(await resetLiveDemo(core, parsed.data.snapshot_token));
  } catch (error) { return errorResponse(error); }
}
