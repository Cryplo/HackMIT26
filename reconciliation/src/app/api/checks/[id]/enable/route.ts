import { getCore } from '@/lib/core/runtime';
import { changeCheck } from '@/lib/core/checks-api';
import { errorResponse, json, mutationBody } from '@/lib/core/http';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { try { const body = await mutationBody(request); const { id } = await context.params; return json(await changeCheck(getCore(), id, 'enable', body)); } catch (e) { return errorResponse(e); } }
