import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inboxFileType } from './file-types';
import { inboxSamples } from './samples';
import { suggestLinks } from './matching';
import { confirmImport, stageUpload, inboxOriginal } from './service';
import { CoreService } from '../core/service';
import { FileStore } from '../core/file-store';
import { LocalStore } from '../intake/store';
import { LocalSupportingOriginals } from '../intake/supporting-originals';
import { DatabaseRetrieval } from '../core/retrieval';
import { SimulatedJev } from '../core/jev';
import { workspaceRows } from '../core/projection';
import { extractReceipt } from '../intake/extract';
import type { InboxDocument } from './schema';
import { advanceSourceAudit, readSourceAudit } from './audit';

function request(bytes: Uint8Array, name = 'unlinked.pdf', origin = 'http://localhost:3199') {
  const body = new FormData();
  body.set('file', new File([new Uint8Array(bytes)], name, { type: name.endsWith('.eml') ? 'message/rfc822' : name.endsWith('.csv') ? 'text/csv' : bytes[0] === 137 ? 'image/png' : 'application/pdf' }));
  return new Request('http://localhost:3199/api/inbox', { method: 'POST', headers: { origin }, body });
}
const sampleDocs = (): InboxDocument[] => inboxSamples().map(s => ({ id: randomUUID(), filename: s.name, evidence: s.evidence, file_type: 'application/pdf', sha256: '', error: null, provenance: 'simulated', latency_ms: null }));

test('matching preserves conflicts and abstains on ambiguous equal candidates', () => {
  const docs = sampleDocs();
  const suggestions = suggestLinks(docs);
  assert.equal(suggestions.find(s => s.document_id === docs[1].id)!.suggested_receipt_id, docs[0].id);
  const email = suggestions.find(s => s.document_id === docs[2].id)!;
  assert.equal(email.suggested_receipt_id, docs[0].id);
  assert.match(email.candidates[0].warnings.join(' '), /Requested amount differs/);
  const ambiguous = suggestions.find(s => s.document_id === docs[5].id)!;
  assert.equal(ambiguous.suggested_receipt_id, null);
  assert.equal(ambiguous.candidates.length, 2);
  docs[1].evidence!.facts.names = ['Different Traveler'];
  assert.equal(suggestLinks(docs).find(s => s.document_id === docs[1].id)!.suggested_receipt_id, null);
  docs[1].evidence!.facts.names = ['Ava Demo'];
  docs[1].evidence!.facts.amount_minor = 9999;
  const conflict = suggestLinks(docs).find(s => s.document_id === docs[1].id)!;
  assert.equal(conflict.suggested_receipt_id, docs[0].id);
  assert.match(conflict.candidates[0].warnings.join(' '), /totals differ/);
  docs[5].evidence!.facts.amount_minor = null;
  const weak = suggestLinks(docs).find(s => s.document_id === docs[5].id)!;
  assert.equal(weak.suggested_receipt_id, null);
  assert.equal(weak.candidates.length, 2);
  assert.match(weak.candidates[0].warnings.join(' '), /Confirm manually/);
  docs[5].evidence!.facts.names = [];
  assert.equal(suggestLinks(docs).find(s => s.document_id === docs[5].id)!.candidates.length, 0, 'equal price alone is not a match');
});

test('real private upload → match → confirm → review preserves discrepancy, originals, and retry identity', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sift-inbox-test-'));
  const beforeOrigin = process.env.RECONCILIATION_APP_ORIGIN;
  process.env.RECONCILIATION_APP_ORIGIN = 'http://localhost:3199';
  try {
    const staged: InboxDocument[] = [];
    for (const sample of inboxSamples()) staged.push(await stageUpload(request(sample.bytes, sample.name), 'demo', path.join(dir, 'inbox')));
    assert.ok(staged.every(s => !s.error && s.evidence));
    assert.equal(staged[0].evidence!.request.amount_requested_minor, null, 'receipt total must not fabricate requested amount');
    assert.deepEqual((await inboxOriginal(staged[0].id, path.join(dir, 'inbox'))).bytes, inboxSamples()[0].bytes);
    assert.equal((await stat(path.join(dir, 'inbox', `${staged[0].id}.bin`))).mode & 0o777, 0o600);
    const core = new CoreService(new FileStore(path.join(dir, 'claims')), new DatabaseRetrieval(), new SimulatedJev(), true);
    const dependencies = { core, intake: new LocalStore(path.join(dir, 'claims')), originals: new LocalSupportingOriginals(path.join(dir, 'claims')), dir: path.join(dir, 'inbox') };
    const body = { receipt_id: staged[0].id, supporting_ids: [staged[1].id, staged[2].id], submission: { attendee_name: 'Ava Demo', email: 'ava@example.invalid', amount_requested_minor: '19000', currency: 'USD', category: 'hotel', origin_location: 'Providence' }, confirmed: true };
    const result = await confirmImport(body, dependencies);
    assert.equal(result.supporting_count, 2);
    const beforeCount = (await core.store.snapshot()).submissions.length;
    assert.deepEqual(await confirmImport(body, dependencies), result, 'retry returns the original successful result');
    assert.equal((await core.store.snapshot()).submissions.length, beforeCount);
    await assert.rejects(confirmImport({ ...body, submission: { ...body.submission, amount_requested_minor: '18000' } }, dependencies), { code: 'already_confirmed' });
    await assert.rejects(confirmImport({ ...body, receipt_id: staged[3].id }, dependencies), { code: 'document_used' });
    await core.reconcile([result.submission_id]);
    const state = await core.store.snapshot(), row = workspaceRows(state).find(r => r.id === result.submission_id)!;
    assert.equal(row.amount_requested_minor, 19000);
    assert.equal(state.receipts.find(r => r.id === result.receipt_id)!.parsed_fields_json!.amount_minor, 18000);
    assert.equal(row.decisions.find(d => d.field_checked === 'amount')!.verdict, 'fail');
    assert.equal(row.decision_status, 'pending');
    assert.equal(state.supporting_documents!.filter(d => d.claim_id === result.submission_id).length, 2);
    assert.deepEqual((await dependencies.intake.read(result.receipt_id))!.bytes, new Uint8Array(inboxSamples()[0].bytes));
    const restarted = new CoreService(new FileStore(path.join(dir, 'claims')), new DatabaseRetrieval(), new SimulatedJev(), true);
    assert.equal((await restarted.store.snapshot()).submissions.filter(s => s.id === result.submission_id).length, 1);
    await assert.rejects(stageUpload(request(Buffer.from('not a pdf')), 'demo', dependencies.dir), { code: 'unsupported_file' });
    await assert.rejects(stageUpload(request(inboxSamples()[0].bytes, 'x.pdf', 'https://evil.invalid'), 'demo', dependencies.dir), { code: 'origin_rejected' });
    const unknown = await stageUpload(request(Buffer.from('%PDF-1.4 unknown')), 'demo', dependencies.dir);
    assert.ok(unknown.error);
    await assert.rejects(confirmImport({ ...body, receipt_id: unknown.id, supporting_ids: [] }, dependencies), { code: 'unreadable_document' });
    // A failed save reserves the attempt: a retry cannot silently create a second claim.
    const failureBody = { ...body, receipt_id: staged[4].id, supporting_ids: [] };
    const broken = { ...dependencies, intake: { ...dependencies.intake, create: async () => { throw new Error('disk unavailable'); }, finish: dependencies.intake.finish.bind(dependencies.intake), usage: dependencies.intake.usage.bind(dependencies.intake), read: dependencies.intake.read.bind(dependencies.intake) } };
    await assert.rejects(confirmImport(failureBody, broken), { code: 'partial_import' });
    await assert.rejects(confirmImport(failureBody, dependencies), { code: 'already_confirmed' });
    assert.equal(JSON.parse(await readFile(path.join(dir, 'inbox', `${staged[4].id}.confirmation.json`), 'utf8')).status, 'failed');
    const partialBody = { ...body, receipt_id: staged[3].id, supporting_ids: [staged[5].id] };
    const failingOriginals = { put: async () => { throw new Error('supporting storage unavailable'); }, read: async () => null };
    await assert.rejects(confirmImport(partialBody, { ...dependencies, originals: failingOriginals }), { code: 'partial_import' });
    const partial = JSON.parse(await readFile(path.join(dir, 'inbox', `${staged[3].id}.confirmation.json`), 'utf8'));
    const partialReceipt = (await core.store.snapshot()).receipts.find(r => r.submission_id === partial.submission_id)!;
    assert.equal(partialReceipt.extraction_status, 'failed', 'support failure must not strand a pending receipt');
    const fresh = await stageUpload(request(inboxSamples()[0].bytes), 'demo', dependencies.dir);
    const concurrentBody = { ...body, receipt_id: fresh.id, supporting_ids: [] };
    const count = (await core.store.snapshot()).submissions.length;
    const attempts = await Promise.allSettled([confirmImport(concurrentBody, dependencies), confirmImport(concurrentBody, dependencies)]);
    assert.ok(attempts.some(a => a.status === 'fulfilled'));
    assert.equal((await core.store.snapshot()).submissions.length, count + 1, 'concurrent confirmations create one claim');

  } finally {
    if (beforeOrigin === undefined) delete process.env.RECONCILIATION_APP_ORIGIN; else process.env.RECONCILIATION_APP_ORIGIN = beforeOrigin;
    await rm(dir, { recursive: true, force: true });
  }
});

test('live extraction uses inbox schema, keeps request amount separate, and exposes provider failure', async () => {
  const keys = ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_DEPLOYMENT'] as const;
  const prior = keys.map(k => process.env[k]);
  Object.assign(process.env, { AZURE_OPENAI_ENDPOINT: 'https://mock.openai.azure.com', AZURE_OPENAI_API_KEY: 'fake', AZURE_OPENAI_DEPLOYMENT: 'mock' });
  try {
    let calls = 0;
    const sample = inboxSamples()[2];
    const result = await extractReceipt(sample.bytes, 'application/pdf', randomUUID(), 'live', async (_url, init) => {
      calls++;
      const payload = JSON.parse(String(init?.body));
      assert.ok(payload.text.format.schema.properties.request.properties.amount_requested_minor);
      assert.match(payload.instructions, /NEVER copy a receipt total/);
      return Response.json({ status: 'completed', model: 'mock', usage: { input_tokens: 10, output_tokens: 20 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify(sample.evidence) }] }] });
    }, { inbox: true });
    assert.equal(calls, 1); assert.equal(result.inbox!.request.amount_requested_minor, 19000); assert.equal(result.inbox!.facts.amount_minor, null);
    const csv = inboxSamples().find(sample => sample.file_type === 'text/csv')!;
    const text = await extractReceipt(csv.bytes, 'text/csv', randomUUID(), 'live', async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.input[0].content[1].type, 'input_text');
      assert.equal(payload.input[0].content[1].text, csv.bytes.toString());
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(csv.evidence) }] }] });
    }, { inbox: true });
    assert.equal(text.inbox!.request.amount_requested_minor, 19000);
    assert.equal(text.inbox!.facts.amount_minor, null);
    const failed = await extractReceipt(sample.bytes, 'application/pdf', randomUUID(), 'live', async () => Response.json({}, { status: 503 }), { inbox: true });
    assert.ok(failed.error); assert.equal(failed.inbox, undefined);
  } finally { keys.forEach((k, i) => { if (prior[i] === undefined) delete process.env[k]; else process.env[k] = prior[i]; }); }
});

test('text sources validate UTF-8, size, and email headers before extraction', () => {
  assert.equal(inboxFileType(Buffer.from('Name,Amount\nAva,190'), 'application/octet-stream', 'response.csv'), 'text/csv');
  assert.equal(inboxFileType(Buffer.from('From: ava@example.invalid\nSubject: Receipt\n\nPlease reimburse 190 USD.'), '', 'thread.eml'), 'message/rfc822');
  assert.equal(inboxFileType(Buffer.from('Travel note'), '', 'note.txt'), 'text/plain');
  for (const [bytes, name] of [[Buffer.from([255, 0]), 'a.csv'], [Buffer.from('x'.repeat(100001)), 'a.txt'], [Buffer.from('No mail headers'), 'a.eml'], [Buffer.from('PK binary'), 'a.zip']] as const) assert.throws(() => inboxFileType(bytes, '', name), { code: 'unsupported_file' });
});

test('source audit reads mixed originals once, queues complete requests, and holds uncertain evidence', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sift-source-audit-'));
  const prior = process.env.RECONCILIATION_APP_ORIGIN;
  process.env.RECONCILIATION_APP_ORIGIN = 'http://localhost:3199';
  try {
    const core = new CoreService(new FileStore(path.join(dir, 'claims')), new DatabaseRetrieval(), new SimulatedJev(), true);
    const deps = { core, intake: new LocalStore(path.join(dir, 'claims')), originals: new LocalSupportingOriginals(path.join(dir, 'claims')), dir: path.join(dir, 'inbox') };
    let batch = await readSourceAudit(deps.dir);
    assert.equal(batch.documents.length, 0);
    for (let i = 0; i <= inboxSamples().length; i++) batch = await advanceSourceAudit(request(Buffer.from('unused')), 'demo', deps);
    assert.equal(batch.phase, 'ready');
    assert.equal(batch.documents.length, 10);
    assert.equal(batch.duplicates, 1);
    assert.deepEqual(new Set(batch.documents.map(document => document.file_type)), new Set(['application/pdf', 'image/png', 'message/rfc822', 'text/csv']));
    assert.equal(batch.imports.length, 2);
    assert.equal(batch.held.length, 4);
    assert.ok(batch.held.every(item => !batch.imports.some(saved => saved.document_ids.includes(item.document_id))));
    const ids = batch.imports.map(item => item.result.submission_id);
    const queued = workspaceRows(await core.store.snapshot()).filter(row => ids.includes(row.id));
    assert.equal(queued.length, 2);
    assert.ok(queued.every(row => !row.latest_run_id), 'source intake queues claims without starting hidden audits');
    assert.equal(queued.find(row => row.attendee_name === 'Ava Demo')!.amount_requested_minor, 19000);
    assert.equal(queued.find(row => row.attendee_name === 'Ava Demo')!.receipt!.parsed_fields_json!.amount_minor, 18000);
    assert.deepEqual(await advanceSourceAudit(request(Buffer.from('unused')), 'demo', deps), batch, 'resume neither rereads inputs nor duplicates claims');
    await core.reconcile(ids);
    const audited = workspaceRows(await core.store.snapshot()).filter(row => ids.includes(row.id));
    assert.equal(audited.find(row => row.attendee_name === 'Ava Demo')!.assessment_status, 'flagged');
    assert.equal(audited.find(row => row.attendee_name === 'Maya Demo')!.assessment_status, 'matched');
    const ben = batch.documents.find(document => document.filename === 'phone-photo-A.pdf')!;
    const email = batch.documents.find(document => document.filename === 'Re-train-tickets.pdf')!;
    await confirmImport({ receipt_id: ben.id, supporting_ids: [email.id], confirmed: true,
      submission: { attendee_name: 'Ben Demo', email: 'ben@example.invalid', amount_requested_minor: '12000', currency: 'USD', category: 'train', origin_location: 'New York' },
    }, deps);
    const resolved = await readSourceAudit(deps.dir);
    assert.equal(resolved.imports.length, 3, 'manual resolutions survive source-page reloads');
    assert.equal(resolved.held.length, 2);
  } finally {
    if (prior === undefined) delete process.env.RECONCILIATION_APP_ORIGIN; else process.env.RECONCILIATION_APP_ORIGIN = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
