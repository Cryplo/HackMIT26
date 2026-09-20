import { getCore } from '@/lib/core/runtime';
import { listWorkspaceNotifications, sendWorkspaceNotifications } from '@/lib/core/notifications';
import { errorResponse, json, mutationBody } from '@/lib/core/http';

export const runtime = 'nodejs';
export const maxDuration = 900;
export async function GET() {
  try { return json(await listWorkspaceNotifications(getCore())); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { return json(await sendWorkspaceNotifications(getCore(), await mutationBody(request), { signal: request.signal })); }
  catch (error) { return errorResponse(error); }
}
