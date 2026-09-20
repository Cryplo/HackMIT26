import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inboxSamples } from './samples';
import { caseSummary, clarificationDraft, defaultDraft, requestCents } from './presentation';
import type { InboxDocument } from './schema';
const docs = () => inboxSamples().map(s => ({ id: randomUUID(), filename: s.name, file_type: 'application/pdf', sha256: '', evidence: s.evidence, error: null, provenance: 'fixture', latency_ms: null } satisfies InboxDocument));
test('case summaries preserve request/receipt differences, unknowns, and conflicting emails', () => {
  const [receipt, booking, email] = docs();
  const unknown = defaultDraft(receipt, [booking]);
  assert.equal(unknown.amount, '');
  assert.equal(caseSummary(receipt, [booking], unknown, []).state, 'attention');
  const draft = defaultDraft(receipt, [booking, email]);
  const mismatch = caseSummary(receipt, [booking, email], draft, []);
  assert.equal(mismatch.delta, 1000); assert.equal(mismatch.label, 'Amount differs');
  const corrected = { ...draft, amount: '180.00' };
  assert.equal(caseSummary(receipt, [booking], corrected, []).label, 'Ready to confirm');
  const conflicting = structuredClone(email); conflicting.evidence.request.amount_requested_minor = 17500;
  assert.equal(defaultDraft(receipt, [email, conflicting]).amount, '');
  assert.equal(caseSummary(receipt, [email, conflicting], draft, []).amountConflict, true);
  assert.equal(requestCents('1.999'), null); assert.equal(requestCents('1e3'), null); assert.equal(requestCents('0'), 0);
});
test('clarification draft names only the actual candidate sources and receipt identifiers', () => {
  const source = docs();
  const draft = clarificationDraft(source[5], source.slice(3, 5));
  assert.match(draft, /MR-90A/); assert.match(draft, /MR-90B/); assert.match(draft, /\$120.00/);
  assert.doesNotMatch(draft, /HH-901|approved|sent successfully/);
});
