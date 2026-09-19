import { CoreError } from './validation';
export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function errorResponse(error: unknown) { return error instanceof CoreError ? json({ error: { code: error.code, message: error.message } }, error.status) : json({ error: { code: 'INTERNAL_ERROR', message: 'Request failed; please retry.' } }, 500); }
export async function mutationBody(request: Request): Promise<unknown> {
  const origin = request.headers.get('origin');
  const expected = process.env.RECONCILIATION_APP_ORIGIN || new URL(request.url).origin;
  if (!origin || origin !== expected || request.headers.get('sec-fetch-site') === 'cross-site') throw new CoreError('INVALID_ORIGIN', 'Same-origin requests are required.', 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new CoreError('INVALID_CONTENT_TYPE', 'Expected application/json.', 415);
  if (Number(request.headers.get('content-length') || 0) > 32768) throw new CoreError('BODY_TOO_LARGE', 'Request body exceeds 32 KiB.', 413);
  const reader = request.body?.getReader(); if (!reader) throw new CoreError('INVALID_JSON', 'JSON body required.');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 32768) { await reader.cancel(); throw new CoreError('BODY_TOO_LARGE', 'Request body exceeds 32 KiB.', 413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new CoreError('INVALID_JSON', 'Request body must be valid JSON.'); }
}
