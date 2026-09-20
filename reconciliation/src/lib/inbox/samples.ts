import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import manifest from './fixtures/manifest.json';
import { InboxExtraction } from './schema';
import type { InboxEvidence } from './schema';
import { spreadsheetRows, spreadsheetResponse } from './source-preview';

function responseSamples(sample: { name: string; bytes: Buffer; file_type: string }) {
  return spreadsheetRows(sample.bytes.toString()).slice(1).map((row, index) => {
    const [name, email, category, origin, vendor, date, reference, receiptNumber, amount, currency] = row;
    const text = spreadsheetResponse(sample.bytes.toString(), index);
    return { ...sample, name: index === 0 ? 'Ava-response.csv' : `event-form-response-row-${index + 1}.csv`, source: 'forms' as const,
      file_type: 'text/csv' as const, bytes: Buffer.from(text), evidence: InboxExtraction.parse({ document_kind: 'other',
        facts: { vendor, booking_reference: reference || null, receipt_number: receiptNumber || null, names: [name], purchase_date: date, currency, amount_minor: null },
        request: { attendee_name: name, email, category, origin_location: origin, amount_requested_minor: Math.round(Number(amount) * 100) }, raw_extracted_text: text }) };
  });
}

// Authored extraction fixtures are only used in explicitly simulated mode.
export function inboxSamples(includeSpreadsheetBatch = false) {
  return manifest.flatMap(sample => {
    const entry = {
    name: sample.name,
    source: sample.file_type === 'text/csv' ? 'forms' as const : sample.evidence.document_kind === 'email' ? 'email' as const : 'dropbox' as const,
    file_type: sample.file_type as 'application/pdf' | 'image/png' | 'text/csv' | 'message/rfc822',
    bytes: readFileSync(join(process.cwd(), 'src/lib/inbox/fixtures', sample.asset)),
    evidence: InboxExtraction.parse(sample.evidence),
    };
    if (entry.file_type !== 'text/csv') return [entry];
    const firstResponse = responseSamples(entry)[0];
    return includeSpreadsheetBatch ? [entry, firstResponse] : [firstResponse];
  });
}

export function recognizedInboxSample(bytes: Uint8Array): InboxEvidence | null {
  const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
  const actual = hash(bytes);
  const samples = inboxSamples(true);
  const singleResponses = samples.filter(sample => sample.file_type === 'text/csv' && spreadsheetRows(sample.bytes.toString()).length > 2).flatMap(responseSamples);
  return [...samples.filter(sample => sample.file_type !== 'text/csv' || spreadsheetRows(sample.bytes.toString()).length === 2), ...singleResponses].find(sample => hash(sample.bytes) === actual)?.evidence ?? null;
}
