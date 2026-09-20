import type { InboxDocument, InboxSuggestion, MatchCandidate } from './schema';

const normalize = (value: string | null) => (value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const same = (a: string | null, b: string | null) => !!normalize(a) && normalize(a) === normalize(b);

export function suggestLinks(documents: InboxDocument[]): InboxSuggestion[] {
  const receipts = documents.filter(d => !d.error && d.evidence?.document_kind === 'receipt');
  return documents.filter(d => !d.error && d.evidence && d.evidence.document_kind !== 'receipt').map(document => {
    const a = document.evidence!.facts;
    const candidates: MatchCandidate[] = [];
    for (const receipt of receipts) {
      const b = receipt.evidence!.facts;
      const name = a.names.some(n => b.names.some(m => same(n, m)));
      const conflictingName = a.names.length > 0 && b.names.length > 0 && !name;
      const reference = same(a.booking_reference, b.booking_reference);
      const receiptNumber = same(a.receipt_number, b.receipt_number) && same(a.vendor, b.vendor);
      const merchant = same(a.vendor, b.vendor);
      const date = !!a.purchase_date && a.purchase_date === b.purchase_date;
      const amount = a.amount_minor !== null && a.amount_minor === b.amount_minor && same(a.currency, b.currency);
      // ponytail: exact normalized identities only; add tested aliases if real imports need fuzzy matching.
      if (!(reference || receiptNumber || (name && merchant && date))) continue;
      const reasons = [reference && 'Same booking reference', receiptNumber && 'Same merchant and receipt number', name && 'Same traveler', merchant && 'Same merchant', date && 'Same purchase date', amount && 'Same amount and currency'].filter((v): v is string => !!v);
      const warnings: string[] = [];
      if (!reference && !receiptNumber && !amount) warnings.push('Traveler, merchant, and date agree, but no shared reference or matching total. Confirm manually.');
      if (conflictingName) warnings.push('Traveler names conflict. Confirm ownership before linking.');
      if (a.currency && b.currency && a.currency !== b.currency) warnings.push('Currencies differ.');
      if (a.amount_minor !== null && b.amount_minor !== null && a.amount_minor !== b.amount_minor) warnings.push('Document totals differ. Keep this discrepancy for review.');
      if (a.booking_reference && b.booking_reference && !reference) warnings.push('Booking references conflict.');
      if (document.evidence!.request.amount_requested_minor !== null && b.amount_minor !== null && document.evidence!.request.amount_requested_minor !== b.amount_minor) warnings.push('Requested amount differs from the receipt total.');
      candidates.push({ receipt_id: receipt.id, reasons, warnings, score: (reference || receiptNumber ? 10 : 0) + Number(name) * 3 + Number(merchant) + Number(date) + Number(amount) });
    }
    candidates.sort((a, b) => b.score - a.score || a.receipt_id.localeCompare(b.receipt_id));
    // No arbitrary tie-break assignment and no automatic link across conflicting identities/references.
    const top = candidates[0];
    const unsafe = top?.warnings.some(w => w.includes('names conflict') || w.includes('references conflict') || w.includes('Currencies differ'));
    return { document_id: document.id, suggested_receipt_id: top && top.score >= 6 && !unsafe && (candidates.length === 1 || top.score > candidates[1].score) ? top.receipt_id : null, candidates };
  });
}
