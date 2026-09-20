/** Deterministic, dependency-free PDF originals. Cached text comes from the same print calls. */
export type ShowcaseDocument = {
  category: 'flight' | 'hotel' | 'train' | 'bus' | 'other';
  vendor: string; name?: string; date: string; amount: number; number: string; reference?: string;
  origin: string; destination: string; travelDate: string; departure: string; arrival: string;
  service: string; seat: string; stayEnd?: string; room?: string;
  kind: 'receipt' | 'payment' | 'booking' | 'itinerary'; descriptor?: string;
};

export const showcaseMoney = (amount: number) => `USD ${(amount / 100).toFixed(2)}`;

export function showcaseDocument(d: ShowcaseDocument): { bytes: Buffer; text: string; lineItems: number[] } {
  const commands: string[] = [], printed: string[] = [];
  const ink = '0.10 0.16 0.22', muted = '0.36 0.42 0.47';
  const accent = d.category === 'hotel' ? '0.12 0.34 0.32' : d.category === 'flight' ? '0.10 0.25 0.46' : '0.43 0.28 0.16';
  const escape = (s: string) => s.replace(/[\\()]/g, '\\$&').replace(/—/g, '\\227');
  const box = (x: number, y: number, w: number, h: number, color: string) => commands.push(`${color} rg ${x} ${792 - y - h} ${w} ${h} re f`);
  const text = (value: string, x: number, y: number, size = 10, bold = false, color = ink) => {
    printed.push(value);
    commands.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg 1 0 0 1 ${x} ${792 - y} Tm (${escape(value)}) Tj ET`);
  };
  const rule = (y: number) => box(44, y, 524, 0.7, '0.83 0.87 0.88');
  const field = (label: string, value: string, x: number, y: number) => {
    text(label.toUpperCase(), x, y, 8, true, muted); text(value, x, y + 19, 11);
  };
  const supporting = d.kind === 'booking' || d.kind === 'itinerary';
  const title = d.kind === 'payment' ? 'Payment confirmation' : d.kind === 'booking' ? 'Booking confirmation' : d.kind === 'itinerary' ? 'Travel itinerary' : d.category === 'hotel' ? 'Guest folio' : d.category === 'flight' ? 'Passenger receipt' : 'Ticket receipt';
  box(0, 0, 612, 110, accent);
  // Original vector marks distinguish the fictional carriers and property.
  if (d.category === 'hotel') {
    commands.push('1 1 1 RG 1.5 w 45 746 21 26 re S 53 746 5 10 re S 49 760 3 5 re S 59 760 3 5 re S');
  } else if (d.category === 'train') {
    commands.push('1 1 1 RG 2 w 49 746 m 49 771 l S 62 746 m 62 771 l S 45 751 m 66 751 l S 45 759 m 66 759 l S 45 767 m 66 767 l S');
  } else if (d.category === 'bus') {
    commands.push('1 1 1 RG 1.5 w 45 750 22 18 re S 49 757 14 7 re S 1 1 1 rg 48 746 4 4 re f 60 746 4 4 re f');
  } else {
    commands.push('1 1 1 rg 44 748 m 55 770 l 66 748 l 55 754 l h f');
  }
  text(d.vendor, 78, 42, 20, true, '1 1 1');
  text(title.toUpperCase(), 44, 83, 10, true, '1 1 1');
  text(supporting ? 'RESERVATION DETAILS' : 'PURCHASE RECORD', 412, 83, 9, false, '1 1 1');
  text(`Receipt: ${d.number}`, 44, 142, 10, true);
  text(`Purchase date: ${d.date}`, 354, 142, 10);
  if (d.reference) text(`Booking reference: ${d.reference}`, 44, 164, 10);
  if (d.descriptor) text(`Statement descriptor: ${d.descriptor}`, 44, 185, 10);
  rule(204);

  if (d.kind === 'payment') {
    text('PAYMENT RECEIVED', 44, 237, 9, true, muted);
    text(showcaseMoney(d.amount), 44, 277, 32, true, accent);
    text('Card payment **** 4821', 354, 239, 11);
    text(`Charge date: ${d.date}`, 354, 262, 10);
    rule(302);
    field('Passenger', d.name ?? 'Not provided', 44, 333);
    field('Service', `${d.service} / Economy`, 354, 333);
    field('Route', `${d.origin} to ${d.destination}`, 44, 389);
    field('Travel date', d.travelDate, 354, 389);
    text(`Departure ${d.departure}  /  Arrival ${d.arrival} (local times)`, 44, 449, 10);
    text('This confirms the original charge shown on the merchant receipt.', 44, 482, 10, false, muted);
  } else if (d.category === 'hotel') {
    field('Guest', d.name ?? 'Not provided', 44, 237);
    field('Property location', d.destination, 354, 237);
    field('Check-in', `${d.travelDate} / 3:00 PM`, 44, 297);
    field('Check-out', `${d.stayEnd} / 11:00 AM`, 220, 297);
    field('Room / stay', `${d.room} / 1 night`, 420, 297);
    box(44, 346, 524, 48, '0.94 0.97 0.96');
    text('ACCOMMODATION', 58, 365, 8, true, muted);
    text('Standard queen room / 1 adult', 58, 384, 11);
    text(supporting ? 'Confirmed reservation' : 'Prepaid accommodation', 365, 378, 10, true, accent);
  } else if (d.category === 'train' || d.category === 'bus') {
    field('Passenger', d.name ?? 'Not provided', 44, 237);
    field('Service / seat', `${d.service} / ${d.seat}`, 354, 237);
    box(44, 282, 524, 140, '0.98 0.96 0.93');
    box(44, 282, 142, 140, accent);
    text('ONE WAY', 58, 311, 12, true, '1 1 1');
    text(d.travelDate, 58, 338, 12, true, '1 1 1');
    text('1 ADULT', 58, 390, 9, false, '1 1 1');
    text(`FROM  ${d.origin}`, 206, 313, 15, true, accent);
    text(`${d.departure} departure`, 206, 337, 10);
    text(`TO  ${d.destination}`, 206, 375, 15, true, accent);
    text(`${d.arrival} arrival / local times`, 206, 399, 10);
    commands.push(`0.70 0.65 0.59 RG [3 3] 0 d 186 370 m 186 510 l S [] 0 d`);
  } else {
    field('Passenger', d.name ?? 'Not provided', 44, 237);
    field(d.category === 'flight' ? 'Flight / cabin' : 'Service / seat', `${d.service} / ${d.category === 'flight' ? 'Economy' : d.seat}`, 354, 237);
    box(44, 282, 524, 118, d.category === 'flight' ? '0.94 0.96 0.99' : '0.98 0.96 0.93');
    text('FROM', 58, 303, 8, true, muted); text('TO', 335, 303, 8, true, muted);
    text(d.origin, 58, 329, 17, true, accent); text(d.destination, 335, 329, 17, true, accent);
    text(`${d.departure} departure`, 58, 353, 10); text(`${d.arrival} arrival`, 335, 353, 10);
    text(`Travel date: ${d.travelDate} / local times`, 58, 381, 9, false, muted);
    text(d.category === 'flight' ? `Seat: ${d.seat} / 1 cabin bag included` : 'One-way reserved service / 1 adult', 44, 425, 10);
  }

  // Split a tax-inclusive total using integer cents; the displayed rows always sum exactly.
  const tax = Math.round(d.amount * (d.category === 'hotel' ? 0.1495 / 1.1495 : d.category === 'flight' ? 0.12 : 0.03));
  const lineItems = [d.amount - tax, tax];
  const y = d.kind === 'payment' ? 517 : 462;
  text(d.category === 'hotel' ? 'FOLIO CHARGES' : 'FARE BREAKDOWN', 44, y, 9, true, muted);
  rule(y + 13);
  text('DESCRIPTION', 44, y + 34, 8, true, muted); text('AMOUNT (USD)', 455, y + 34, 8, true, muted);
  text(d.category === 'hotel' ? `Room charge / ${d.travelDate}` : 'Base fare / one-way', 44, y + 61, 11);
  text(showcaseMoney(lineItems[0]), 455, y + 61, 11);
  text(d.category === 'hotel' ? 'Occupancy taxes (14.95%)' : 'Taxes and carrier fees', 44, y + 88, 11);
  text(showcaseMoney(tax), 455, y + 88, 11);
  rule(y + 105);
  text(supporting ? 'BOOKED TOTAL' : 'TOTAL PAID', 44, y + 137, 10, true, accent);
  text(showcaseMoney(d.amount), 402, y + 141, 24, true, accent);
  if (supporting) {
    text('Supporting reservation record — not a payment receipt.', 44, y + 171, 10, false, muted);
  } else if (d.kind !== 'payment') {
    text('Payment: Card **** 4821', 44, y + 172, 10);
    text('Balance due: USD 0.00', 354, y + 172, 10);
  }
  rule(730);
  text('Fictional demo document — not valid for payment', 44, 753, 9, true, muted);
  text('All merchants, people and purchase references are fictional.', 44, 772, 8, false, muted);
  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { bytes: Buffer.from(pdf), text: printed.join('\n'), lineItems };
}
