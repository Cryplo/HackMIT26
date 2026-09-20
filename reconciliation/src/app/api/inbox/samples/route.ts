import { inboxSamples } from '@/lib/inbox/samples';
import { createHash } from 'node:crypto';
import { json } from '@/lib/core/http';
export function GET(request: Request) {
  const name = new URL(request.url).searchParams.get('name');
  const samples = inboxSamples(true);
  if (!name) return json({ samples: samples.map(s => ({ name: s.name, sha256: createHash('sha256').update(s.bytes).digest('hex'), file_type: s.file_type, source: s.source, preview: s.evidence.raw_extracted_text, url: `/api/inbox/samples?name=${encodeURIComponent(s.name)}` })) });
  const sample = samples.find(s => s.name === name);
  if (!sample) return json({ error: { message: 'Sample not found.' } }, 404);
  return new Response(new Uint8Array(sample.bytes), { headers: { 'Content-Type': sample.file_type, 'Content-Disposition': `inline; filename="${sample.name}"`, 'Cache-Control': 'no-store' } });
}
