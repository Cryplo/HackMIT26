import { json, errorResponse, mutationBody } from '@/lib/core/http';
import { getCore } from '@/lib/core/runtime';
import { intakeMode } from '@/lib/intake/config';
import { IntakeError } from '@/lib/intake/schema';
import { getStore } from '@/lib/intake/store';
import { getSupportingOriginals } from '@/lib/intake/supporting-originals';
import { advanceSourceAudit, readSourceAudit } from '@/lib/inbox/audit';

export const runtime = 'nodejs';
export const maxDuration = 90;
const enabled = () => process.env.RECONCILIATION_SOURCE_AUDIT === 'true' && process.env.RECONCILIATION_SYNTHETIC_ONLY === 'true';
const view = (state: Awaited<ReturnType<typeof readSourceAudit>>) => ({ ...state, extractionMode: process.env.RECONCILIATION_EXTRACTION_MODE === 'live' ? 'live' : 'demo' });
export async function GET() {
  try { return json(enabled() ? view(await readSourceAudit()) : { enabled: false }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    await mutationBody(request);
    if (!enabled()) throw new IntakeError('sources_disabled', 'Sample-source audit is not enabled for this workspace.', 403);
    const mode = process.env.RECONCILIATION_EXTRACTION_MODE || intakeMode();
    intakeMode();
    if (mode !== 'demo' && mode !== 'live') throw new IntakeError('invalid_mode', 'Configure extraction as demo or live.', 503);
    return json(view(await advanceSourceAudit(request, mode, { core: getCore(), intake: getStore(), originals: getSupportingOriginals() })));
  } catch (error) { return errorResponse(error); }
}
