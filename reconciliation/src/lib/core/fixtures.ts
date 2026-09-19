import type { Category } from '../contracts';
import type { Snapshot } from './store';
/** All people, merchants, receipts and locations below are synthetic. IDs match SQL seed. */
export const DEMO_IDS = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005'];
export function demoSnapshot(): Snapshot {
  const specs: { name: string; category: Category; vendor: string; amount: number; number: string }[] = [
    { name: 'Alex Demo', category: 'flight', vendor: 'Synthetic Sky Airlines', amount: 24000, number: 'SYN-FLIGHT-001' },
    { name: 'Alex Demo', category: 'flight', vendor: 'Synthetic Sky Airlines', amount: 24000, number: 'SYN-FLIGHT-001' },
    { name: 'Sam Example', category: 'hotel', vendor: 'SYN HBR 042', amount: 18000, number: 'SYN-HOTEL-003' },
    { name: 'Taylor Example', category: 'hotel', vendor: 'SYN HBR 042', amount: 19500, number: 'SYN-HOTEL-004' },
    { name: 'Jordan Example', category: 'flight', vendor: 'SYN HBR 042', amount: 21000, number: 'SYN-OTHER-005' },
  ];
  const submissions = specs.map((x,i) => ({ id: DEMO_IDS[i], attendee_name: x.name, email: `synthetic${i+1}@example.invalid`, amount_requested_minor: x.amount, currency: 'USD' as const, category: x.category, origin_location: 'Synthetic City', submitted_at: `2026-09-19T12:0${i}:00.000Z`, updated_at: `2026-09-19T12:0${i}:00.000Z`, status: 'pending' as const, latest_run_id: null }));
  const receipts = specs.map((x,i) => ({ id: `20000000-0000-4000-8000-00000000000${i+1}`, submission_id: DEMO_IDS[i], storage_path: `synthetic/${DEMO_IDS[i]}/20000000-0000-4000-8000-00000000000${i+1}`, file_type: 'text/plain', raw_extracted_text: 'SYNTHETIC FIXTURE ONLY; no uploaded file.', parsed_fields_json: { schema_version: 1 as const, vendor: x.vendor, receipt_date: '2026-09-18', amount_minor: x.amount, currency: 'USD', names: [x.name], receipt_number: x.number }, extraction_status: 'succeeded' as const, extraction_error: null, extracted_at: '2026-09-19T12:10:00.000Z' }));
  const policies = (['flight','hotel','train','bus','other'] as Category[]).map((category,i) => ({ id: `30000000-0000-4000-8000-00000000000${i+1}`, category, region_or_route: '*', currency: 'USD' as const, max_amount_minor: [50000,25000,20000,10000,5000][i], date_range_start: '2026-09-01', date_range_end: '2026-09-30', created_at: '2026-09-01T00:00:00.000Z' }));
  return { submissions, receipts, policies, decisions: [], corrections: [], runs: [] };
}
