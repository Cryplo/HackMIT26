import { intakeMode } from '@/lib/intake/config';
import { IntakeError } from '@/lib/intake/schema';
import { json, errorResponse } from '@/lib/core/http';
import { stageUpload } from '@/lib/inbox/service';
export const runtime = 'nodejs';
export const maxDuration = 90;
export async function POST(request: Request) {
  try {
    const mode = process.env.RECONCILIATION_EXTRACTION_MODE || intakeMode();
    intakeMode();
    if (mode !== 'demo' && mode !== 'live') throw new IntakeError('invalid_mode', 'Configure extraction as demo or live.', 503);
    return json(await stageUpload(request, mode), 201);
  } catch (error) { return errorResponse(error); }
}
