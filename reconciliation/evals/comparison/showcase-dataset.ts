import type { SubmissionStatus } from '../../src/lib/contracts';
import { showcaseFixture } from '../../src/lib/demo/showcase';
import type { Cohort, Dataset, EvalCase } from './dataset';

/** Expected assessment for each showcase claim when neither arm receives supporting documents or learned procedures.
 * Keyed by the fixture's case title so a fixture reorder fails loudly instead of silently relabeling. */
const LABELS: Record<string, { cohort: Cohort; expected: SubmissionStatus; duplicate_of?: number; note: string }> = {
  'Ordinary flight': { cohort: 'valid', expected: 'approved', note: 'Familiar airline, complete receipt, within cap and window.' },
  'Ordinary train / lookalike A': { cohort: 'valid', expected: 'approved', note: 'Familiar rail operator; a later distinct purchase shares its date and amount.' },
  'Hotel learning source': { cohort: 'corroboration', expected: 'needs_review', note: 'Billing descriptor "Harbor Reservations" is not itself a hotel; production requires a matching booking confirmation, which this benchmark does not supply.' },
  'Later hotel / learned procedure': { cohort: 'corroboration', expected: 'needs_review', note: 'Same descriptor; approvable only through a learned booking-reference procedure that is not active here.' },
  'Conflicting hotel confirmations': { cohort: 'corroboration', expected: 'needs_review', note: 'Two conflicting confirmations exist in the app; identity is unresolved.' },
  'Hotel booking missing': { cohort: 'corroboration', expected: 'needs_review', note: 'Descriptor with no booking evidence at all.' },
  'Traveler missing / receipt-only policy': { cohort: 'incomplete', expected: 'needs_review', note: 'No traveler name on the receipt and hotel policy accepts receipt evidence only.' },
  'Policy-authorized itinerary identity': { cohort: 'incomplete', expected: 'needs_review', note: 'No traveler name on the receipt; the linked itinerary that would satisfy flight policy is not supplied to either arm.' },
  'Overclaim / receipt total differs': { cohort: 'violation', expected: 'flagged', note: 'Requested $190.00 against a $180.00 receipt.' },
  'Hotel policy cap exceeded': { cohort: 'violation', expected: 'flagged', note: '$275.00 against the $250.00 hotel cap.' },
  'First claim for a purchase': { cohort: 'valid', expected: 'approved', note: 'Original flight receipt, later re-claimed with a payment document.' },
  'Same purchase / different document': { cohort: 'duplicate', expected: 'flagged', duplicate_of: 11, note: 'Payment confirmation for the same purchase: different bytes, same receipt number, traveler, amount and date.' },
  'Distinct lookalike train B': { cohort: 'valid', expected: 'approved', note: 'Same traveler, operator, date and amount as case 2 but a different receipt number and service; must not be treated as a duplicate.' },
  'Unassessed bus claim': { cohort: 'valid', expected: 'approved', note: 'Ordinary bus fare not yet assessed in the app.' },
};

/** The 14 seeded showcase claims (the same originals loaded into Supabase by the demo seed), in submission order. */
export function showcase(): Dataset {
  const fixture = showcaseFixture();
  const scored: EvalCase[] = fixture.cases.map((c, i) => {
    const label = LABELS[c.title];
    if (!label) throw new Error(`No benchmark label for showcase case "${c.title}".`);
    const submission = fixture.state.submissions[i];
    const original = fixture.originals[i];
    if (submission.id !== c.id || original.receipt.submission_id !== c.id) throw new Error('Showcase fixture order drifted.');
    return {
      case_id: `case-${String(i + 1).padStart(2, '0')}`,
      cohort: label.cohort, expected: label.expected, note: `${c.title}. ${label.note}`,
      duplicate_of: label.duplicate_of ? `case-${String(label.duplicate_of).padStart(2, '0')}` : null,
      input: { attendee_name: submission.attendee_name, email: submission.email, amount_requested_minor: submission.amount_requested_minor, currency: 'USD', category: submission.category, origin_location: submission.origin_location },
      fields: structuredClone(original.receipt.parsed_fields_json!),
      pdf: original.bytes,
    };
  });
  if (scored.length !== Object.keys(LABELS).length) throw new Error('Showcase label count drifted.');
  const alias = { observed_vendor: 'Harbor Reservations', canonical_vendor: 'Harbor Hotel', scope: { category: 'hotel' as const, currency: 'USD' as const } };
  const source = { ...scored[2], case_id: 'source-01', note: 'Copy of case-03, the showcase learning source; written for parity with generated datasets and never scored.' };
  return { seed: 0, alias, source, scored, rehearsal: [], rehearsal_alias: alias };
}

export const showcasePolicies = () => showcaseFixture().state.policies;

export interface SupabaseVerification {
  status: 'verified' | 'mismatch' | 'skipped';
  project: string | null;
  checked_at: string;
  matched: number;
  expected: number;
  submissions_in_backend: number | null;
  mismatches: { case_id: string; submission_id: string; reason: string }[];
}

/** Confirms the frozen showcase PDFs are byte-identical to the receipts the backend holds. Reads only; never a secret in output. */
export async function verifyAgainstSupabase(dataset: Dataset, env: Record<string, string | undefined> = process.env, transport: typeof fetch = fetch): Promise<SupabaseVerification> {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  const checked_at = new Date().toISOString();
  if (!url || !key) return { status: 'skipped', project: null, checked_at, matched: 0, expected: dataset.scored.length, submissions_in_backend: null, mismatches: [] };
  const project = new URL(url).host;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' };
  const receipts = await transport(`${url}/rest/v1/receipts?select=submission_id,sha256,extraction_status`, { headers });
  if (!receipts.ok) throw new Error(`Supabase receipts query failed: HTTP ${receipts.status}`);
  const rows: { submission_id: string; sha256: string; extraction_status: string }[] = await receipts.json();
  const submissions = await transport(`${url}/rest/v1/submissions?select=id`, { headers: { ...headers, Range: '0-0' } });
  const total = submissions.headers.get('content-range')?.split('/')[1];
  const fixture = showcaseFixture();
  const mismatches: SupabaseVerification['mismatches'] = [];
  dataset.scored.forEach((c, i) => {
    const original = fixture.originals[i];
    const row = rows.find(r => r.submission_id === original.receipt.submission_id);
    if (!row) mismatches.push({ case_id: c.case_id, submission_id: original.receipt.submission_id, reason: 'no receipt row in backend' });
    else if (row.sha256 !== original.receipt.sha256) mismatches.push({ case_id: c.case_id, submission_id: original.receipt.submission_id, reason: 'backend receipt bytes differ from the frozen PDF' });
  });
  const matched = dataset.scored.length - mismatches.length;
  return { status: mismatches.length ? 'mismatch' : 'verified', project, checked_at, matched, expected: dataset.scored.length, submissions_in_backend: total && total !== '*' ? Number(total) : null, mismatches };
}
