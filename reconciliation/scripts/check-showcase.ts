import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seedShowcase } from './seed-showcase';
import { FileStore } from '../src/lib/core/file-store';
import { LocalStore } from '../src/lib/intake/store';
import { LocalSupportingOriginals } from '../src/lib/intake/supporting-originals';
import { recognizedShowcaseReceipt, showcaseFixture } from '../src/lib/demo/showcase';
import { bookingLink, itineraryIdentity } from '../src/lib/core/evidence';
import { confirmedDuplicates } from '../src/lib/core/safety';
import { workspaceRows } from '../src/lib/core/projection';
import { Fields } from '../src/lib/intake/schema';
import { SupportingFactsSchema } from '../src/lib/intake/supporting-schema';
import { showcaseMoney } from '../src/lib/demo/showcase-documents';

// Read our uncompressed PDF text operators independently of the renderer's cached text.
function printedText(bytes: Uint8Array) {
  return [...Buffer.from(bytes).toString().matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
    .map(match => match[1].replace(/\\227/g, '—').replace(/\\([\\()])/g, '$1')).join('\n');
}
function checkItemTotals(text: string, total: number) {
  const amounts = [...text.slice(text.indexOf('DESCRIPTION')).matchAll(/USD (\d+)\.(\d{2})/g)]
    .map(match => Number(match[1]) * 100 + Number(match[2]));
  assert.equal(amounts[0] + amounts[1], total, 'Printed itemized amounts sum to the stored total.');
  assert.equal(amounts[2], total);
}


async function main() {
  globalThis.fetch = async () => { throw new Error('This check must never call a provider or shared database.'); };
  const root = await mkdtemp(path.join(tmpdir(), 'sift-showcase-check-'));
  try {
    const result = await seedShowcase(path.join(root, 'claims'));
    const state = await new FileStore(result.directory).snapshot();
    assert.equal(state.submissions.length, 14);
    assert.equal(state.receipts.length, 14);
    assert.equal(state.supporting_documents!.length, 8);
    const rows = workspaceRows(state);
    const fixture = showcaseFixture();
    assert.deepEqual(showcaseFixture(), fixture, 'PDF bytes, hashes and facts are deterministic.');
    assert.equal(state.submissions.reduce((sum, claim) => sum + claim.amount_requested_minor, 0), 270500);
    assert.equal(state.receipts.reduce((sum, receipt) => sum + receipt.parsed_fields_json!.amount_minor!, 0), 269500);
    assert(new Set(state.receipts.map(r => r.parsed_fields_json!.receipt_date)).size >= 10);
    const origins = state.submissions.map(s => s.origin_location);
    assert(new Set(origins).size >= 6 && new Set(origins).size < origins.length);
    assert(new Set(state.submissions.map(s => s.submitted_at.slice(0, 10))).size >= 3);
    assert(state.receipts.every(r => r.id.startsWith('62000000-')));
    assert(state.supporting_documents!.every(d => d.id.startsWith('64000000-')));

    assert.equal(result.results.length, 14);
    assert.equal(state.runs.length, 16);
    assert.equal(state.runs.filter(r => r.operation === 'assessment').length, 14);
    assert.equal(state.runs.filter(r => r.operation === 'investigation').length, 2);
    assert(state.runs.every(r => r.status === 'completed'));
    assert.deepEqual(result.counts, { approved: 8, pending: 6, investigations: 2 });
    assert.equal(rows.filter(r => r.decision_status === 'approved' && r.decision_source === 'automatic').length, 8);
    assert.equal(rows.filter(r => r.decision_status === 'pending' && r.decision_source === null).length, 6);
    assert(state.submissions.every(s => s.decision_status === 'pending'), 'Automatic approvals do not overwrite the human decision column.');
    assert.equal(state.corrections.length, 0);
    assert.equal(state.rules!.length + state.procedures!.length, 0);
    assert(state.decisions.every(d => d.check_method !== 'human'));
    const originals = new LocalStore(result.directory), supporting = new LocalSupportingOriginals(result.directory);
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    for (const receipt of state.receipts) {
      const fields = Fields.parse(receipt.parsed_fields_json);
      const claim = state.submissions.find(s => s.id === receipt.submission_id)!;
      assert(fields.receipt_date! >= '2026-09-01' && fields.receipt_date! <= '2026-09-30');
      assert(claim.submitted_at.slice(0, 10) > fields.receipt_date!);
      assert(claim.submitted_at <= '2026-09-20T09:00:00.000Z');

      const saved = await originals.read(receipt.id);
      assert(saved && Buffer.from(saved.bytes).subarray(0, 5).toString() === '%PDF-');
      assert.equal(hash(saved.bytes), receipt.sha256);
      const text = printedText(saved.bytes);
      assert.equal(text, receipt.raw_extracted_text, 'Cached transcription is exactly the printed PDF text.');
      for (const fact of [fields.vendor!, fields.receipt_date!, fields.receipt_number!, showcaseMoney(fields.amount_minor!), ...fields.names]) assert(text.includes(fact));
      assert(text.includes('Fictional demo document — not valid for payment'));
      assert(!text.includes('SIMULATED cached transcription'));
      checkItemTotals(text, fields.amount_minor!);
      if (claim.category !== 'hotel') assert(text.includes(claim.origin_location!) && text.includes('Boston'));
      if (!fields.names.length) {
        for (const name of claim.attendee_name.split(' ')) assert(!text.toLowerCase().includes(name.toLowerCase()), 'A missing traveler cannot leak through references or payment details.');
      }

      assert.equal(receipt.storage_path, `synthetic/${receipt.submission_id}/${receipt.id}`);
      assert.deepEqual(recognizedShowcaseReceipt(saved.bytes), { fields: receipt.parsed_fields_json, raw: receipt.raw_extracted_text });
      assert.equal(receipt.extracted_at, showcaseFixture().state.receipts.find(r => r.id === receipt.id)!.extracted_at);
    }
    for (const document of state.supporting_documents!) {
      SupportingFactsSchema.parse(document.facts);
      const bytes = await supporting.read(document);
      assert(bytes && Buffer.from(bytes).subarray(0, 5).toString() === '%PDF-');
      assert.equal(hash(bytes), document.sha256);
      const text = printedText(bytes), facts = document.facts!;
      assert.equal(text, document.extracted_text);
      for (const fact of [facts.vendor!, facts.booking_reference!, facts.receipt_number!, facts.purchase_date!, showcaseMoney(facts.amount_minor!), ...facts.names]) assert(text.includes(fact));
      assert(text.includes('not a payment receipt'));
      checkItemTotals(text, facts.amount_minor!);
      const receipt = state.receipts.find(r => r.submission_id === document.claim_id)!.parsed_fields_json!;
      assert.equal(facts.purchase_date, receipt.receipt_date);
      assert.equal(facts.receipt_number, receipt.receipt_number);
      assert.equal(facts.amount_minor, receipt.amount_minor);
      assert.equal(facts.currency, receipt.currency);

    }
    assert.equal(recognizedShowcaseReceipt(Buffer.from('different original')), null);
    const claim = (index: number) => state.submissions[index - 1];
    const check = (index: number, field: string) => rows[index - 1].decisions.find(d => d.field_checked === field)!.verdict;
    assert.deepEqual(state.investigations!.map(r => r.claim_id).sort(), [claim(5).id, claim(7).id].sort());
    assert(state.investigations!.every(r => r.trigger === 'recoverable_uncertainty' && r.status === 'completed' && r.outcome === 'needs_human'));
    const source = bookingLink(state, claim(3).id), later = bookingLink(state, claim(4).id);
    assert(source && later && source.reference !== later.reference);
    assert.equal(bookingLink(state, claim(5).id), null);
    assert.equal(bookingLink(state, claim(6).id), null);
    assert.equal(check(7, 'name'), 'unknown');
    assert(itineraryIdentity(state, claim(8).id));
    assert.equal(check(8, 'name'), 'pass');
    assert.equal(check(9, 'amount'), 'fail');
    assert.equal(check(10, 'policy_cap'), 'fail');
    assert.notEqual(state.receipts[10].sha256, state.receipts[11].sha256);
    assert.deepEqual(state.receipts[10].parsed_fields_json, state.receipts[11].parsed_fields_json);
    assert.equal(claim(11).origin_location, claim(12).origin_location);
    assert.notEqual(claim(11).submitted_at, claim(12).submitted_at);
    for (const routeFact of ['Seattle (SEA)', 'Boston (BOS)', '2026-09-17', 'NS 318']) {
      assert(state.receipts[10].raw_extracted_text!.includes(routeFact));
      assert(state.receipts[11].raw_extracted_text!.includes(routeFact));
    }
    const lookalikeA = state.receipts[1].parsed_fields_json!, lookalikeB = state.receipts[12].parsed_fields_json!;
    assert.deepEqual({ ...lookalikeA, receipt_number: null }, { ...lookalikeB, receipt_number: null });
    assert.notEqual(lookalikeA.receipt_number, lookalikeB.receipt_number);

    assert.equal(confirmedDuplicates(state, claim(12).id)[0]?.method, 'receipt_identity');
    assert.equal(check(12, 'duplicate'), 'fail');
    assert.equal(check(13, 'duplicate'), 'pass');
    assert.equal(rows[3].decision_source, 'automatic');
    assert.equal(rows[13].decision_source, 'automatic');
    const before = await readFile(path.join(result.directory, 'core-state.json'), 'utf8');
    await assert.rejects(seedShowcase(result.directory), { code: 'EEXIST' });
    assert.equal(await readFile(path.join(result.directory, 'core-state.json'), 'utf8'), before);
    await mkdir(path.join(root, 'public'));
    await assert.rejects(seedShowcase(path.join(root, 'public', 'claims')), /outside public/);
    console.log('Showcase integrity passed: 14 private originals, 8 supporting PDFs, 14 assessments, 2 automatic investigations, 8 automatic approvals, 6 pending, zero human corrections or learned rules, diverse dates/origins, printed-text and item-total agreement, financial guards and fresh-directory isolation.');
  } finally { await rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
