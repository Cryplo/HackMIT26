import { z } from 'zod';
import { json, errorResponse, mutationBody } from '@/lib/core/http';
import { IntakeError } from '@/lib/intake/schema';
import { readInbox } from '@/lib/inbox/service';
import { suggestLinks } from '@/lib/inbox/matching';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const input = z.object({ document_ids: z.array(z.uuid()).max(12) }).strict().safeParse(await mutationBody(request));
    if (!input.success) throw new IntakeError('invalid_documents', 'Choose up to 12 imported documents.');
    const documents = await Promise.all([...new Set(input.data.document_ids)].map(id => readInbox(id)));
    return json({ suggestions: suggestLinks(documents) });
  } catch (error) { return errorResponse(error); }
}
