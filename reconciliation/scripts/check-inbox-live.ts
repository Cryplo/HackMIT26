/** Opt-in paid smoke check: three synthetic PDFs; no claim or database writes. */
import { extractReceipt } from '../src/lib/intake/extract';
import { inboxSamples } from '../src/lib/inbox/samples';
import { suggestLinks } from '../src/lib/inbox/matching';
import type { InboxDocument } from '../src/lib/inbox/schema';
import { randomUUID } from 'node:crypto';

async function main() {
  const documents: InboxDocument[] = [];
  const samples = inboxSamples().slice(0, 3);
  for (let offset = 0; offset < samples.length; offset += 2) {
    const results = await Promise.all(samples.slice(offset, offset + 2).map(async sample => {
      const id = randomUUID();
      const result = await extractReceipt(sample.bytes, 'application/pdf', id, 'live', fetch, { inbox: true });
      console.log(JSON.stringify({ file: sample.name, error: result.error, provider: result.usage?.provider, model: result.usage?.model, latency_ms: result.usage?.latency_ms, kind: result.inbox?.document_kind, amount: result.inbox?.facts.amount_minor, requested: result.inbox?.request.amount_requested_minor, facts: result.inbox?.facts }));
      return { id, filename: sample.name, file_type: 'application/pdf', sha256: '', evidence: result.inbox ?? null, error: result.error, provenance: 'live smoke check', latency_ms: result.usage?.latency_ms ?? null };
    }));
    documents.push(...results);
  }
  const suggestions = suggestLinks(documents);
  const passed = documents.every(d => !d.error && d.evidence)
    && documents[0].evidence?.facts.amount_minor === 18000
    && documents[0].evidence?.request.amount_requested_minor === null
    && documents[2].evidence?.request.amount_requested_minor === 19000
    && suggestions.length === 2 && suggestions.every(s => s.suggested_receipt_id === documents[0].id);
  console.log(JSON.stringify({ passed, suggestions }));
  if (!passed) process.exitCode = 1;
}
main().catch(() => { console.error('Live inbox smoke check failed.'); process.exitCode = 1; });
