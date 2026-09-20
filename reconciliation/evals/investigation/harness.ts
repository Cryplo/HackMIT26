/** Offline harness: runs the real assessment engine over an isolated in-memory store.
 *
 * This is not a second verdict engine. `CoreService` with the production checks, retrieval
 * and the explicit simulated Jev fixture does the deciding; the harness only supplies an
 * isolated snapshot built from the pack and reads the result back. Extraction is the
 * offline double: printed facts are treated as an already-successful extraction, because
 * no provider may be called here.
 */
import { createHash } from 'node:crypto';
import type { Category, ParsedReceipt, PolicyRule, Receipt, Submission } from '../../src/lib/contracts';
import { CoreService } from '../../src/lib/core/service';
import { MemoryStore, type Snapshot } from '../../src/lib/core/store';
import { SimulatedRetrieval } from '../../src/lib/core/retrieval';
import { SimulatedJev } from '../../src/lib/core/jev';
import { workspaceRows } from '../../src/lib/core/projection';
import { CAPS, POLICY_WINDOW, type PackCase } from './pack';

/** Stable RFC-4122-shaped identifier derived from the case ID: no clock, no randomness. */
export function stableId(namespace: string, key: string): string {
  const h = createHash('sha256').update(`${namespace}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function policies(): PolicyRule[] {
  return (Object.keys(CAPS) as Category[]).map((category, i) => ({
    id: stableId('policy', category), category, region_or_route: '*', currency: 'USD' as const,
    max_amount_minor: CAPS[category], date_range_start: POLICY_WINDOW.start, date_range_end: POLICY_WINDOW.end,
    created_at: '2026-09-01T00:00:00.000Z'
  }));
}

const parsed = (c: PackCase): ParsedReceipt => ({
  schema_version: 1, vendor: c.printed.vendor, receipt_date: c.printed.receipt_date,
  amount_minor: c.printed.amount_minor, currency: c.printed.currency,
  names: [...c.printed.names], receipt_number: c.printed.receipt_number
});

export function submission(c: PackCase): Submission {
  const at = `2026-09-27T12:${String(c.sequence).padStart(2, '0')}:00.000Z`;
  return {
    id: stableId('submission', c.case_id), attendee_name: c.input.attendee_name, email: c.input.email,
    amount_requested_minor: c.input.amount_requested_minor, currency: 'USD', category: c.input.category,
    origin_location: c.input.origin_location, submitted_at: at, updated_at: at, status: 'pending', latest_run_id: null
  };
}

export function receipt(c: PackCase, extraction: 'succeeded' | 'failed' = 'succeeded'): Receipt {
  const submissionId = stableId('submission', c.case_id);
  const id = stableId('receipt', c.case_id);
  const original = c.documents.find(d => d.role === 'original_receipt')!;
  return {
    id, submission_id: submissionId, storage_path: `synthetic/${submissionId}/${id}`, file_type: 'application/pdf',
    raw_extracted_text: original.bytes.toString('latin1').includes('SYNTHETIC DOCUMENT') ? 'Synthetic document text held by intake.' : null,
    parsed_fields_json: extraction === 'succeeded' ? parsed(c) : null,
    extraction_status: extraction, extraction_error: extraction === 'failed' ? 'Extraction provider failed.' : null,
    extracted_at: extraction === 'succeeded' ? '2026-09-27T12:30:00.000Z' : null
  };
}

export function snapshotFor(pack: PackCase[]): Snapshot {
  return {
    submissions: pack.map(submission), receipts: pack.map(c => receipt(c)), policies: policies(),
    decisions: [], corrections: [], runs: []
  };
}

export function isolatedCore(state: Snapshot) {
  const store = new MemoryStore(state);
  return { store, core: new CoreService(store, new SimulatedRetrieval(), new SimulatedJev(), true) };
}

export interface CaseOutcome {
  case_id: string; submission_id: string;
  status: string;
  checks: Record<string, string>;
  duplicate_submission_ids: string[];
}

/** Assess every case in submission order, so a duplicate is only seen after its original. */
export async function assessPack(pack: PackCase[]): Promise<CaseOutcome[]> {
  const { core, store } = isolatedCore(snapshotFor(pack));
  const ordered = [...pack].sort((a, b) => a.sequence - b.sequence);
  for (const c of ordered) await core.reconcile([stableId('submission', c.case_id)]);
  const rows = workspaceRows(await store.snapshot());
  return ordered.map(c => {
    const id = stableId('submission', c.case_id);
    const row = rows.find(r => r.id === id)!;
    return {
      case_id: c.case_id, submission_id: id, status: row.assessment_status ?? 'none',
      checks: Object.fromEntries(row.decisions.filter(d => d.field_checked !== 'overall_status').map(d => [d.field_checked, d.verdict])),
      duplicate_submission_ids: row.duplicate_submission_ids
    };
  });
}

/** Contract statuses use `matched`; the pack labels use the same vocabulary. */
export const expectedStatus = (c: PackCase) => c.label.expected_assessment;
