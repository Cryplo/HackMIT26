import { errorResponse } from '@/lib/core/http';
import { inboxOriginal } from '@/lib/inbox/service';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { bytes, document } = await inboxOriginal((await context.params).id);
    return new Response(new Uint8Array(bytes), { headers: {
      'Content-Type': document.file_type, 'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename="document.${document.file_type === 'application/pdf' ? 'pdf' : document.file_type === 'image/png' ? 'png' : document.file_type === 'image/jpeg' ? 'jpg' : 'txt'}"`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox", 'Referrer-Policy': 'no-referrer',
    } });
  } catch (error) { return errorResponse(error); }
}
