/** Eval-owned document rendering for the investigation development pack.
 *
 * `src/lib/demo/samples.ts` renders a fixed six-line receipt with no room for booking
 * references, itinerary links or payment identifiers, and production is outside this
 * assignment's ownership, so the same PDF structure is rebuilt here with free-form lines.
 * Every document is synthetic and invalid for payment. Rendering is pure: identical input
 * always produces identical bytes, with no clock, locale or random identifier.
 */
import { createHash } from 'node:crypto';

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/** Minimal single-page PDF with one text line per entry, in the order given. */
export function linesPdf(lines: string[]): Buffer {
  const escape = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&');
  const stream = `BT /F1 12 Tf 50 750 Td 20 TL ${lines.map((s, i) => `${i ? 'T* ' : ''}(${escape(s)}) Tj`).join('\n')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const money = (currency: string | null, minor: number | null) =>
  minor === null ? `${currency ?? '?'} not printed` : `${currency ?? '?'} ${(minor / 100).toFixed(2)}`;

export interface PrintedReceipt {
  vendor: string | null;
  legal_name?: string | null;
  receipt_date: string | null;
  amount_minor: number | null;
  currency: string | null;
  names: string[];
  receipt_number: string | null;
  booking_reference?: string | null;
  /** Short factual line such as a room/seat/fare description; never an instruction or verdict. */
  purchase_detail?: string | null;
}

const HEADER = 'SYNTHETIC DOCUMENT - NOT VALID FOR PAYMENT';
const FOOTER = 'Development fixture. Every merchant, person and reference is fictional.';

/** The original receipt for a claim: the only document that may carry the reimbursable total. */
export function receiptDocument(r: PrintedReceipt): Buffer {
  return linesPdf([
    HEADER,
    r.vendor || 'Unknown merchant',
    ...(r.legal_name ? [`Operated by: ${r.legal_name}`] : []),
    `Date: ${r.receipt_date || 'Unknown'}`,
    `Guest / traveler: ${r.names.join(', ') || 'Not provided'}`,
    `Total: ${money(r.currency, r.amount_minor)}`,
    `Receipt: ${r.receipt_number || 'Unknown'}`,
    ...(r.booking_reference ? [`Booking reference: ${r.booking_reference}`] : []),
    ...(r.purchase_detail ? [`Detail: ${r.purchase_detail}`] : []),
    FOOTER
  ]);
}

/** A second rendering of an already-claimed purchase: different bytes, same purchase identity. */
export function paymentConfirmation(r: PrintedReceipt): Buffer {
  return linesPdf([
    HEADER,
    'Payment confirmation',
    `Merchant: ${r.vendor || 'Unknown merchant'}`,
    `Charged on: ${r.receipt_date || 'Unknown'}`,
    `Cardholder: ${r.names.join(', ') || 'Not provided'}`,
    `Amount charged: ${money(r.currency, r.amount_minor)}`,
    `Merchant receipt number: ${r.receipt_number || 'Unknown'}`,
    ...(r.booking_reference ? [`Booking reference: ${r.booking_reference}`] : []),
    'Card ending 0000. This confirms an earlier charge; it is not a second purchase.',
    FOOTER
  ]);
}

export interface PrintedBooking {
  vendor: string;
  legal_name: string;
  booking_reference: string;
  guest: string;
  stay_dates: string;
  amount_minor: number;
  currency: string;
  detail: string;
}

/** Booking confirmation: establishes merchant identity for an unfamiliar billing descriptor. */
export function bookingConfirmation(b: PrintedBooking): Buffer {
  return linesPdf([
    HEADER,
    'Booking confirmation',
    `Property: ${b.legal_name}`,
    `Card descriptor shown on statements: ${b.vendor}`,
    `Booking reference: ${b.booking_reference}`,
    `Guest: ${b.guest}`,
    `Stay: ${b.stay_dates}`,
    `Booked total: ${money(b.currency, b.amount_minor)}`,
    `Detail: ${b.detail}`,
    'Payment is collected by the property; this confirmation is not itself a charge.',
    FOOTER
  ]);
}

export interface PrintedItinerary {
  carrier: string;
  trip_reference: string;
  traveler: string;
  segments: string[];
  purchase_date: string;
  receipt_number: string;
}

/** Itinerary: links a named traveler to a purchase whose receipt prints no traveler name. */
export function itinerary(i: PrintedItinerary): Buffer {
  return linesPdf([
    HEADER,
    'Travel itinerary',
    `Carrier: ${i.carrier}`,
    `Trip reference: ${i.trip_reference}`,
    `Traveler: ${i.traveler}`,
    ...i.segments.map((segment, n) => `Segment ${n + 1}: ${segment}`),
    `Purchased: ${i.purchase_date}`,
    `Related merchant receipt number: ${i.receipt_number}`,
    'Fares shown on segments are informational; the merchant receipt holds the charged total.',
    FOOTER
  ]);
}
