import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import type { Category, ParsedReceipt, Submission } from '../src/lib/contracts';
import { demoSnapshot } from '../src/lib/core/fixtures';
import { SimulatedJev } from '../src/lib/core/jev';
import { DatabaseRetrieval } from '../src/lib/core/retrieval';
import { CoreService } from '../src/lib/core/service';
import { MemoryStore, type Snapshot } from '../src/lib/core/store';
import { parsedReceipt } from '../src/lib/core/validation';
import { receiptPdf } from '../src/lib/demo/samples';

const marker = 'SIMULATED/FIXTURE: synthetic rehearsal evidence authored by the seed; no live OCR was performed.';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function rehearsal(): Snapshot {
  const state = demoSnapshot();
  const add = (n: number, name: string, category: Category, amount: number, vendor: string, patch: Partial<ParsedReceipt> = {}) => {
    const suffix = String(n).padStart(12, '0');
    const id = `11000000-0000-4000-8000-${suffix}`;
    const receiptId = `21000000-0000-4000-8000-${suffix}`;
    const timestamp = new Date(Date.UTC(2026, 8, 19, 13, n)).toISOString();
    state.submissions.push({ id, attendee_name: name, email: `rehearsal-${n}@example.invalid`, category,
      amount_requested_minor: amount, currency: 'USD', origin_location: 'Synthetic City',
      submitted_at: timestamp, updated_at: timestamp, status: 'pending', latest_run_id: null });
    state.receipts.push({ id: receiptId, submission_id: id, storage_path: `synthetic/${id}/${receiptId}`,
      file_type: 'application/pdf', raw_extracted_text: marker,
      parsed_fields_json: { schema_version: 1, vendor, receipt_date: '2026-09-18', amount_minor: amount,
        currency: 'USD', names: [name], receipt_number: `SYN-REHEARSAL-${String(n).padStart(3, '0')}`, ...patch },
      extraction_status: 'succeeded', extraction_error: null, extracted_at: timestamp });
  };
  add(6, 'Casey Example', 'train', 9900, 'Synthetic Rail');
  add(7, 'Robin Example', 'bus', 4500, 'Synthetic Coach');
  add(8, 'Drew Example', 'hotel', 22000, 'Synthetic Harbor Hotel');
  add(9, 'Quinn Example', 'flight', 31000, 'Synthetic Sky Airlines');
  add(10, 'Avery Example', 'train', 7200, 'Synthetic Rail');
  add(11, 'Morgan Example', 'bus', 6250, 'Synthetic Coach');
  add(12, 'Riley Example', 'hotel', 14500, 'Synthetic Harbor Hotel');
  add(13, 'Jamie Example', 'hotel', 20500, 'SYN HBR 042');
  add(14, 'Skyler Example', 'train', 8800, 'Synthetic Rail', { amount_minor: 6800 });
  add(15, 'Cameron Example', 'flight', 65000, 'Synthetic Sky Airlines');
  add(16, 'Parker Example', 'hotel', 18000, 'Synthetic Harbor Hotel', { currency: 'EUR' });
  add(17, 'Casey Example', 'train', 9900, 'Synthetic Rail', state.receipts[5].parsed_fields_json!);
  add(18, 'Drew Example', 'hotel', 22000, 'Synthetic Harbor Hotel', state.receipts[7].parsed_fields_json!);
  add(19, 'Finley Example', 'hotel', 16000, 'Synthetic Harbor Hotel', { amount_minor: null });
  add(20, 'Reese Example', 'train', 5600, 'Synthetic Rail', { names: [] });
  // Original IDs and receipt details stay compatible with seed.sql and its correction example.
  for (const receipt of state.receipts) {
    receipt.file_type = 'application/pdf';
    receipt.raw_extracted_text = `${marker}\n${JSON.stringify(receipt.parsed_fields_json)}`;
  }
  return state;
}

async function check() {
  const state = rehearsal();
  assert.equal(state.submissions.length, 20);
  assert.equal(new Set(state.submissions.map(s => s.id)).size, 20);
  assert.equal(new Set(state.receipts.map(r => r.id)).size, 20);
  assert(state.receipts.every(r => parsedReceipt(r.parsed_fields_json)));
  assert(state.submissions.every(s => s.status === 'pending' && s.latest_run_id === null));
  const hashes = state.receipts.map(r => hash(receiptPdf(r.parsed_fields_json!)));
  assert.equal(new Set(hashes).size, 17);
  for (const [source, copy] of [[0, 1], [5, 16], [7, 17]]) assert.equal(hashes[source], hashes[copy]);
  const store = new MemoryStore(state);
  const core = new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), true);
  const result = await core.reconcile(state.submissions.map(s => s.id));
  assert.deepEqual(result.results.map(r => r.status), [
    'approved', 'flagged', 'needs_review', 'needs_review', 'needs_review',
    'approved', 'approved', 'approved', 'approved', 'approved', 'approved', 'approved',
    'needs_review', 'flagged', 'flagged', 'flagged', 'flagged', 'flagged', 'needs_review', 'needs_review',
  ]);
  assert.equal(store.calls.length, 0);
  const existing = demoSnapshot();
  existing.submissions[0].status = 'flagged';
  validateExisting(existing, rehearsal());
  const extra = { ...existing.submissions[0], id: '19000000-0000-4000-8000-000000000001' };
  const extraReceipt = { ...existing.receipts[0], id: '29000000-0000-4000-8000-000000000001', submission_id: extra.id };
  extraReceipt.storage_path = `synthetic/${extra.id}/${extraReceipt.id}`;
  existing.submissions.push(extra); existing.receipts.push(extraReceipt);
  validateExisting(existing, rehearsal());
  extra.email = 'not-a-reserved-test-address@example.com';
  assert.throws(() => validateExisting(existing, rehearsal()), /lacks explicit synthetic evidence/);
  extra.email = 'synthetic@example.invalid';
  existing.submissions[0].amount_requested_minor++;
  assert.throws(() => validateExisting(existing, rehearsal()), /No overwrite allowed/);
  console.log('Offline check passed: 20 claims, 17 distinct PDFs, 3 exact duplicate copies; simulated outcomes 8 approved / 6 flagged / 6 needs_review. No network or provider calls.');
}

const claimFields: (keyof Submission)[] = ['id', 'attendee_name', 'email', 'category', 'amount_requested_minor', 'currency', 'origin_location'];
function validateExisting(existing: Snapshot, desired: Snapshot) {
  for (const submission of existing.submissions) {
    const expected = desired.submissions.find(s => s.id === submission.id);
    if (!expected) {
      const receipt = existing.receipts.find(r => r.submission_id === submission.id);
      assert(submission.email.endsWith('@example.invalid') && receipt &&
        receipt.storage_path === `synthetic/${submission.id}/${receipt.id}` &&
        /synthetic|fictional|fixture/i.test(receipt.raw_extracted_text || ''),
      'An unrelated claim lacks explicit synthetic evidence; review the database before seeding.');
      continue;
    }
    assert(claimFields.every(k => submission[k] === expected[k]) && Date.parse(submission.submitted_at) === Date.parse(expected.submitted_at), `Existing rehearsal claim changed: ${submission.id}. No overwrite allowed.`);
  }
  for (const receipt of existing.receipts) {
    const expected = desired.receipts.find(r => r.id === receipt.id);
    if (!expected && !desired.submissions.some(s => s.id === receipt.submission_id)) continue;
    assert(expected && receipt.submission_id === expected.submission_id && receipt.storage_path === expected.storage_path &&
      isDeepStrictEqual(receipt.parsed_fields_json, expected.parsed_fields_json) && receipt.extraction_status === 'succeeded' &&
      ['text/plain', 'application/pdf'].includes(receipt.file_type), `Existing receipt differs from its fixture: ${receipt.id}. No overwrite allowed.`);
  }
  for (const policy of existing.policies) {
    const expected = desired.policies.find(p => p.id === policy.id);
    assert(expected && Object.keys(expected).every(k => k === 'created_at' || policy[k as keyof typeof policy] === expected[k as keyof typeof expected]), 'Existing policies differ from the demo policies; review them before seeding.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.length <= 1 && args.every(a => ['--check', '--apply'].includes(a)), 'Usage: seed-rehearsal.ts [--check | --apply]. No argument audits without writing.');
  if (args[0] === '--check') return check();
  assert(process.env.RECONCILIATION_SYNTHETIC_ONLY === 'true', 'Enable RECONCILIATION_SYNTHETIC_ONLY=true first.');
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  assert(url && key, 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } });
  const desired = rehearsal();
  const bucketName = process.env.SUPABASE_RECEIPTS_BUCKET || 'receipts';
  const bucket = client.storage.from(bucketName);
  const schema: Record<string, string> = {
    submissions: Object.keys(desired.submissions[0]).join(','), receipts: Object.keys(desired.receipts[0]).join(','),
    policy_rules: Object.keys(desired.policies[0]).join(','), reconciliation_runs: 'id,submission_id,status,started_at,completed_at,error',
    decisions: 'id,run_id,submission_id,field_checked,check_method,question_type,answer_json,probability,confidence_score,verdict,rationale_text,evidence_json,state_snapshot_json,model_used,created_at',
    corrections: 'id,submission_id,decision_id,human_verdict,human_note,correction_type,correction_payload_json,corrected_at',
    model_calls: 'id,run_id,receipt_id,provider,model,input_tokens,output_tokens,latency_ms,estimated_cost_usd,created_at',
  };
  const counts: Record<string, number> = {};
  for (const [table, columns] of Object.entries(schema)) {
    const result = await client.from(table).select(columns, { count: 'exact', head: true });
    assert(!result.error, `Cannot read required ${table} schema (${result.error?.code || result.status}). Check the Supabase key and migration; this script does not apply migrations.`);
    counts[table] = result.count!;
  }
  const snapshot = async () => {
    const result = await client.rpc('core_snapshot');
    assert(!result.error && result.data, 'core_snapshot is unavailable. Check the key/schema; no migrations are applied by this script.');
    return result.data as Snapshot;
  };
  const before = await snapshot();
  for (const [table, field] of Object.entries({ submissions: 'submissions', receipts: 'receipts', policy_rules: 'policies', decisions: 'decisions', corrections: 'corrections', reconciliation_runs: 'runs' } as const)) {
    assert.equal(before[field].length, counts[table], 'Snapshot counts changed or are incomplete; retry the audit.');
  }
  validateExisting(before, desired);
  const info = await client.storage.getBucket(bucketName);
  assert(!info.error && info.data && !info.data.public, 'The receipts bucket must already exist and be private. No bucket configuration is changed.');
  const files = await Promise.allSettled(desired.receipts.map(async receipt => {
    const bytes = receiptPdf(receipt.parsed_fields_json!);
    const folder = receipt.storage_path.slice(0, receipt.storage_path.lastIndexOf('/'));
    const listed = await bucket.list(folder, { limit: 100, search: receipt.id });
    assert(!listed.error, `Cannot inspect fixture storage for ${receipt.id}.`);
    const exists = listed.data.some(file => file.name === receipt.id);
    if (exists) {
      const downloaded = await bucket.download(receipt.storage_path);
      assert(!downloaded.error && downloaded.data, `Cannot verify existing PDF ${receipt.id}.`);
      assert.equal(hash(new Uint8Array(await downloaded.data.arrayBuffer())), hash(bytes), `Existing PDF differs: ${receipt.id}. No overwrite allowed.`);
    }
    return { receipt, bytes, exists };
  }));
  const checkedFiles = files.map(result => { if (result.status === 'rejected') throw result.reason; return result.value; });
  const submissions = desired.submissions.filter(s => !before.submissions.some(old => old.id === s.id));
  const receipts = desired.receipts.filter(r => !before.receipts.some(old => old.id === r.id));
  const policies = desired.policies.filter(p => !before.policies.some(old => old.id === p.id));
  const legacyMime = before.receipts.filter(r => desired.receipts.some(expected => expected.id === r.id) && r.file_type === 'text/plain');
  const extraSubmissions = before.submissions.filter(s => !desired.submissions.some(expected => expected.id === s.id));
  const extraReceipts = before.receipts.filter(r => !desired.receipts.some(expected => expected.id === r.id));
  console.log(JSON.stringify({ mode: args[0] === '--apply' ? 'apply' : 'audit-only', before: counts,
    insert: { submissions: submissions.length, receipts: receipts.length, policies: policies.length },
    uploadMissingPDFs: checkedFiles.filter(f => !f.exists).length, promoteLegacyReceiptMime: legacyMime.length,
    managedCohort: 20, preservedOtherClaims: extraSubmissions.length, expectedTotalClaims: 20 + extraSubmissions.length,
    rehearsalClaimIds: desired.submissions.map(s => s.id) }, null, 2));
  if (args[0] !== '--apply') return;
  // No reset, deletes, replacements, provider calls, or fabricated review/usage records.
  // Partial failures are safe to rerun: rows ignore existing IDs; objects are never overwritten.
  for (const file of checkedFiles.filter(f => !f.exists)) {
    const uploaded = await bucket.upload(file.receipt.storage_path, file.bytes, { contentType: 'application/pdf', upsert: false });
    assert(!uploaded.error, `PDF upload failed for ${file.receipt.id}; rerun the audit before retrying.`);
  }
  const inserts: [string, object[]][] = [['policy_rules', policies], ['submissions', submissions], ['receipts', receipts]];
  for (const [table, rows] of inserts) {
    if (!rows.length) continue;
    const result = await client.from(table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    assert(!result.error, `Insert failed for ${table}; existing data was not replaced. Rerun the audit.`);
  }
  for (const receipt of legacyMime) {
    const result = await client.from('receipts').update({ file_type: 'application/pdf' }).eq('id', receipt.id).eq('file_type', 'text/plain').eq('storage_path', receipt.storage_path);
    assert(!result.error, `PDF MIME promotion failed for ${receipt.id}; rerun the audit.`);
  }
  const after = await snapshot();
  validateExisting(after, desired);
  assert.equal(after.submissions.length, 20 + extraSubmissions.length);
  assert.equal(after.receipts.length, 20 + extraReceipts.length);
  assert.equal(after.policies.length, 5);
  for (const field of ['submissions', 'receipts', 'policies', 'runs', 'decisions', 'corrections'] as const) {
    for (const row of before[field]) {
      const actual = after[field].find(r => r.id === row.id);
      const expected = field === 'receipts' && legacyMime.some(r => r.id === row.id) ? { ...row, file_type: 'application/pdf' } : row;
      assert(isDeepStrictEqual(actual, expected), `Existing ${field} record changed during the seed; inspect concurrent activity.`);
    }
  }
  console.log(`Seed complete: 20 managed synthetic claims and 20 PDF objects; ${after.submissions.length} total claims. Existing claims and review history preserved. Run the audit again to verify zero pending changes. No live OCR, Jev, or human approvals were created.`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Seed failed.'); process.exitCode = 1; });
