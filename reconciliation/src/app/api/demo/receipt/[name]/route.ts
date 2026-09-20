import { sampleReceipts, receiptPdf } from '@/lib/demo/samples';
export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const samples = sampleReceipts();
  if (!Object.hasOwn(samples, name)) return Response.json({ error: { code: 'NOT_FOUND', message: 'Receipt not found.' } }, { status: 404 });
  return new Response(new Uint8Array(receiptPdf(samples[name])), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="receipt-${name}.pdf"`, 'X-Content-Type-Options': 'nosniff' } });
}
