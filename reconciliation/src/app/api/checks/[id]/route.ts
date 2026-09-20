import { getCore } from '@/lib/core/runtime';
import { updateCheck } from '@/lib/core/checks-api';
import { errorResponse, json, mutationBody } from '@/lib/core/http';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { try { const body = await mutationBody(request); const { id } = await context.params; return json(await updateCheck(getCore(), id, body)); } catch (e) { return errorResponse(e); } }
