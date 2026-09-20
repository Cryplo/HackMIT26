import { inboxSamples } from '@/lib/inbox/samples';
import { json } from '@/lib/core/http';
export function GET(request: Request) {
  const name = new URL(request.url).searchParams.get('name');
  const samples = inboxSamples();
  if (!name) return json({ samples: samples.map(s => ({ name: s.name, url: `/api/inbox/samples?name=${encodeURIComponent(s.name)}` })) });
  const sample = samples.find(s => s.name === name);
  if (!sample) return json({ error: { message: 'Sample not found.' } }, 404);
  return new Response(new Uint8Array(sample.bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${sample.name}"`, 'Cache-Control': 'no-store' } });
}
