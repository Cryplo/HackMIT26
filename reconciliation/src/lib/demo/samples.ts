import { createHash } from 'node:crypto';
import type { ParsedReceipt } from '../contracts';
import { demoSnapshot } from '../core/fixtures';

/** Small, valid, uncompressed PDFs. These contain only invented demo evidence. */
export function receiptPdf(fields: ParsedReceipt): Buffer {
  const lines = ['SYNTHETIC RECEIPT - NOT VALID FOR PAYMENT', fields.vendor || 'Unknown merchant',
    `Date: ${fields.receipt_date || 'Unknown'}`, `Guest / traveler: ${fields.names.join(', ') || 'Not provided'}`,
    `Total: ${fields.currency || '?'} ${fields.amount_minor === null ? 'Unknown' : (fields.amount_minor / 100).toFixed(2)}`,
    `Receipt: ${fields.receipt_number || 'Unknown'}`, 'Hackathon demonstration only. All details are fictional.'];
  return textPdf(lines);
}

/** Shared minimal PDF writer for fictional, printable demo documents. */
export function textPdf(lines: string[]): Buffer {
  const escape = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&');
  const stream = `BT /F1 14 Tf 50 750 Td 24 TL ${lines.map((s, i) => `${i ? 'T* ' : ''}(${escape(s)}) Tj`).join('\n')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
export function sampleReceipts(): Record<string, ParsedReceipt> {
  const seed = demoSnapshot();
  return {
    train: { schema_version: 1, vendor: 'Synthetic Rail', receipt_date: '2026-09-18', amount_minor: 12345, currency: 'USD', names: ['Alex Demo'], receipt_number: 'SYN-TRAIN-UPLOAD-001' },
    ...Object.fromEntries(seed.receipts.map((r, i) => [`claim-${i + 1}`, r.parsed_fields_json!])),
  };
}
export function recognizedSample(bytes: Uint8Array): ParsedReceipt | null {
  const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
  const actual = hash(bytes);
  return Object.values(sampleReceipts()).find(fields => hash(receiptPdf(fields)) === actual) ?? null;
}
