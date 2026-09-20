import { after } from 'next/server';
import { json, errorResponse, mutationBody } from '@/lib/core/http';
import { getCore } from '@/lib/core/runtime';
import { getStore } from '@/lib/intake/store';
import { getSupportingOriginals } from '@/lib/intake/supporting-originals';
import { confirmImport } from '@/lib/inbox/service';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    const body = await mutationBody(request), core = getCore();
    const result = await confirmImport(body, { core, intake: getStore(), originals: getSupportingOriginals() });
    if (core.automationEnabled) after(async () => {
      try { await core.reconcile([result.submission_id]); }
      catch { console.error('Imported claim saved; automatic checks could not complete. Retry from the review workspace.'); }
    });
    return json(result, 201);
  } catch (error) { return errorResponse(error); }
}
