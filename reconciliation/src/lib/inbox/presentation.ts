import type { InboxDocument, MatchCandidate } from './schema';

export type Draft = { attendee_name: string; email: string; amount: string; category: string; origin_location: string };
export function uniqueValue<T>(values: (T | null | undefined)[]): T | undefined {
  const valuesFound = [...new Set(values.filter((value): value is T => value != null && value !== ''))];
  return valuesFound.length === 1 ? valuesFound[0] : undefined;
}
export function requestCents(amount: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction = ''] = amount.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= 2147483647 ? cents : null;
}
export function defaultDraft(receipt: InboxDocument, supporting: InboxDocument[]): Draft {
  const requests = [...supporting, receipt].flatMap(d => d.evidence ? [d.evidence.request] : []);
  const amount = uniqueValue(requests.map(r => r.amount_requested_minor));
  const names = requests.map(r => r.attendee_name).filter(Boolean);
  return {
    attendee_name: uniqueValue(names.length ? names : receipt.evidence?.facts.names || []) || '',
    email: uniqueValue(requests.map(r => r.email)) || '',
    amount: amount == null ? '' : (amount / 100).toFixed(2),
    category: uniqueValue(requests.map(r => r.category)) || '',
    origin_location: uniqueValue(requests.map(r => r.origin_location)) || '',
  };
}
export const money = (cents: number, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
export function caseSummary(receipt: InboxDocument, supporting: InboxDocument[], draft: Draft, candidates: MatchCandidate[]) {
  const requested = requestCents(draft.amount), facts = receipt.evidence?.facts;
  const missing = [!draft.attendee_name.trim() && 'traveler', !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email) && 'email', requested === null && 'requested amount', !draft.category && 'category', !draft.origin_location.trim() && 'travel origin'].filter((v): v is string => !!v);
  const amountConflict = new Set([...supporting, receipt].map(d => d.evidence?.request.amount_requested_minor).filter(a => a != null)).size > 1;
  const delta = requested !== null && facts?.amount_minor != null && facts.currency === 'USD' ? requested - facts.amount_minor : null;
  const warnings = [...new Set(candidates.flatMap(c => c.warnings))];
  if (delta !== null && delta !== 0) return { state: 'issue' as const, label: 'Amount differs', explanation: `${money(requested!)} requested · ${money(facts!.amount_minor!)} on the receipt`, missing, delta, amountConflict, warnings };
  if (amountConflict || warnings.length) return { state: 'attention' as const, label: 'Check evidence', explanation: amountConflict ? 'Linked requests disagree on the amount.' : warnings[0], missing, delta, amountConflict, warnings };
  if (missing.length) return { state: 'attention' as const, label: 'Needs details', explanation: `Confirm ${missing.join(', ')}.`, missing, delta, amountConflict, warnings };
  if (!facts?.vendor || !facts.purchase_date || facts.amount_minor === null || facts.currency !== 'USD' || !facts.names.length) return { state: 'attention' as const, label: 'Check evidence', explanation: 'Some receipt facts are missing or need review.', missing, delta, amountConflict, warnings };
  return { state: 'ready' as const, label: 'Ready to confirm', explanation: 'Request details are complete. Policy and duplicate checks run after confirmation.', missing, delta, amountConflict, warnings };
}
export function clarificationDraft(document: InboxDocument, receipts: InboxDocument[]) {
  const request = document.evidence?.request;
  const person = request?.attendee_name || document.evidence?.facts.names[0] || 'there';
  const choices = receipts.map((receipt, index) => {
    const facts = receipt.evidence?.facts;
    return `${index + 1}. ${receipt.filename}${facts?.receipt_number ? ` (receipt ${facts.receipt_number})` : ''}${facts?.amount_minor != null ? ` — ${money(facts.amount_minor, facts.currency || 'USD')}` : ''}`;
  }).join('\n');
  return `Hi ${person},\n\nWe found more than one possible receipt for your reimbursement request. Which of these should we use?\n\n${choices}\n\nPlease confirm the receipt number or resend the correct receipt. We will keep the request pending until you confirm.\n\nThank you!`;
}
