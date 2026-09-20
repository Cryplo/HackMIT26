import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import manifest from './fixtures/manifest.json';
import { InboxExtraction } from './schema';
import type { InboxEvidence } from './schema';

// Authored extraction fixtures are only used in explicitly simulated mode.
export function inboxSamples() {
  return manifest.map(sample => ({
    name: sample.name,
    source: sample.file_type === 'text/csv' ? 'forms' as const : sample.evidence.document_kind === 'email' ? 'email' as const : 'dropbox' as const,
    file_type: sample.file_type as 'application/pdf' | 'image/png' | 'text/csv',
    bytes: readFileSync(join(process.cwd(), 'src/lib/inbox/fixtures', sample.asset)),
    evidence: InboxExtraction.parse(sample.evidence),
  }));
}

export function recognizedInboxSample(bytes: Uint8Array): InboxEvidence | null {
  const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
  const actual = hash(bytes);
  return inboxSamples().find(sample => hash(sample.bytes) === actual)?.evidence ?? null;
}
