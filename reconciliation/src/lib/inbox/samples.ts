import { createHash } from 'node:crypto';
import { textPdf } from '../demo/samples';
import type { InboxEvidence } from './schema';

const emptyRequest = { attendee_name: null, email: null, amount_requested_minor: null, category: null, origin_location: null };
export function inboxSamples() {
  const ava = { vendor: 'Harbor Hotel', booking_reference: 'STAY-AVA-901', receipt_number: null, names: ['Ava Demo'], purchase_date: '2026-09-18', currency: 'USD', amount_minor: 18000 };
  const ben = { vendor: 'Maple Rail', booking_reference: null, receipt_number: null, names: ['Ben Demo'], purchase_date: '2026-09-18', currency: 'USD', amount_minor: 12000 };
  const specs: { name: string; evidence: Omit<InboxEvidence, 'raw_extracted_text'>; lines: string[] }[] = [
    { name: 'scan-017.pdf', evidence: { document_kind: 'receipt', facts: { ...ava, receipt_number: 'HH-901' }, request: emptyRequest }, lines: ['Harbor Hotel - paid guest folio', 'Guest: Ava Demo', 'Purchase date: 2026-09-18', 'Receipt number: HH-901', 'Booking reference: STAY-AVA-901', 'Total paid: USD 180.00'] },
    { name: 'reservation-final.pdf', evidence: { document_kind: 'booking_confirmation', facts: ava, request: emptyRequest }, lines: ['Harbor Hotel - booking confirmation', 'Guest: Ava Demo', 'Booking reference: STAY-AVA-901', 'Purchase date: 2026-09-18', 'Booking total: USD 180.00'] },
    { name: 'Fwd-weekend-expenses.pdf', evidence: { document_kind: 'email', facts: { ...ava, amount_minor: null }, request: { attendee_name: 'Ava Demo', email: 'ava@example.invalid', amount_requested_minor: 19000, category: 'hotel', origin_location: 'Providence' } }, lines: ['Exported email chain', 'From: Ava Demo <ava@example.invalid>', 'To: Travel desk <travel@example.invalid>', 'Subject: Hotel reimbursement - STAY-AVA-901', 'Sent: 2026-09-20', 'Please reimburse USD 190.00 for my Harbor Hotel stay.', 'I traveled from Providence. Category: hotel.', 'The attached receipt is from my purchase on 2026-09-18.', '--- Earlier message from travel desk ---', 'Please send the booking confirmation with your receipt.', 'This message requests reimbursement; it is not an approval.'] },
    ...['A', 'B'].map(letter => ({ name: `phone-photo-${letter}.pdf`, evidence: { document_kind: 'receipt' as const, facts: { ...ben, receipt_number: `MR-90${letter}` }, request: emptyRequest }, lines: ['Maple Rail - paid ticket receipt', 'Passenger: Ben Demo', 'Purchase date: 2026-09-18', `Receipt number: MR-90${letter}`, 'Route: New York to Boston', 'Total paid: USD 120.00'] })),
    { name: 'Re-train-tickets.pdf', evidence: { document_kind: 'email', facts: ben, request: { attendee_name: 'Ben Demo', email: 'ben@example.invalid', amount_requested_minor: 12000, category: 'train', origin_location: 'New York' } }, lines: ['Exported email chain', 'From: Ben Demo <ben@example.invalid>', 'Subject: My train reimbursement', 'Please reimburse USD 120.00 for one Maple Rail ticket.', 'Passenger: Ben Demo. Purchase date: 2026-09-18.', 'Ticket total: USD 120.00. Category: train.', 'Origin: New York. I uploaded two tickets; please ask which one.', '--- Earlier message ---', 'Travel desk: Please send your receipt.'] },
  ];
  return specs.map(spec => {
    const lines = ['SYNTHETIC PAPERWORK - NOT VALID FOR PAYMENT', ...spec.lines, 'Fictional hackathon demonstration only.'];
    return { name: spec.name, bytes: textPdf(lines), evidence: { ...spec.evidence, raw_extracted_text: lines.join('\n') } };
  });
}
export function recognizedInboxSample(bytes: Uint8Array): InboxEvidence | null {
  const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  const actual = hash(bytes);
  return inboxSamples().find(s => hash(s.bytes) === actual)?.evidence ?? null;
}
