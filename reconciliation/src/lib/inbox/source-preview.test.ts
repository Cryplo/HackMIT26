import test from 'node:test';
import assert from 'node:assert/strict';
import { spreadsheetRows, spreadsheetResponse, emailMessages } from './source-preview';
import { inboxSamples, recognizedInboxSample } from './samples';
import { inboxFileType } from './file-types';
import { stageUpload } from './service';

test('source previews preserve CSV values and split the actual exported email messages', () => {
  assert.deepEqual(spreadsheetRows('\uFEFFName,Note,Amount\r\n"Demo, Ava","First line\n""quoted""",190.00\r\n'), [
    ['Name', 'Note', 'Amount'], ['Demo, Ava', 'First line\n"quoted"', '190.00'],
  ]);
  for (const sample of inboxSamples().filter(sample => sample.source === 'email')) {
    const messages = emailMessages(sample.evidence.raw_extracted_text);
    assert.equal(messages.length, 2, sample.name);
    assert.ok(messages.every(message => message.from && message.to && message.body));
    assert.match(messages[0].body, /Please reimburse/);
    assert.ok(messages[0].attachments.length);
    assert.equal(messages[1].from, 'travel@example.invalid');
    assert.doesNotMatch(messages[0].body, /On September 19/);
  }
  assert.equal(emailMessages('Unrecognized raw email export')[0].body, 'Unrecognized raw email export');
});

test('21-response sample stays separate from single-request extraction and source audit', async () => {
  const batch = inboxSamples(true).find(sample => sample.name === 'event-form-response.csv')!;
  const text = batch.bytes.toString(), [headers, ...rows] = spreadsheetRows(text);
  assert.equal(rows.length, 21);
  assert.ok(rows.every(row => row.length === headers.length && row[1].endsWith('@example.invalid')));
  assert.ok(new Set(rows.map(row => row[3])).size > 15);
  assert.ok(new Set(rows.map(row => row[5])).size > 10);
  assert.equal(recognizedInboxSample(batch.bytes), null, 'the full spreadsheet cannot supply one applicant');
  assert.equal(batch.evidence.request.attendee_name, null);
  assert.throws(() => inboxFileType(batch.bytes, 'text/csv', batch.name), { code: 'multiple_requests' });
  const form = new FormData();
  form.set('file', new File([new Uint8Array(batch.bytes)], batch.name, { type: batch.file_type }));
  const origin = process.env.RECONCILIATION_APP_ORIGIN || 'http://localhost:3199';
  await assert.rejects(stageUpload(new Request(`${origin}/api/inbox`, { method: 'POST', headers: { origin }, body: form }), 'live', '/unused-csv-test', async () => { throw new Error('Multirow input must be rejected before extraction.'); }), { code: 'multiple_requests' });
  for (const [index, row] of rows.entries()) {
    const selected = spreadsheetResponse(text, index), evidence = recognizedInboxSample(Buffer.from(selected))!;
    assert.deepEqual(spreadsheetRows(selected), [headers, row]);
    assert.equal(evidence.request.attendee_name, row[0]);
    assert.equal(evidence.request.email, row[1]);
    assert.equal(evidence.request.amount_requested_minor, Math.round(Number(row[8]) * 100));
    assert.equal(evidence.facts.amount_minor, null, 'requested amount is never a receipt total');
    assert.equal(inboxFileType(Buffer.from(selected), 'text/csv', 'row.csv'), 'text/csv');
  }
  const auditResponse = inboxSamples().find(sample => sample.file_type === 'text/csv')!;
  assert.equal(auditResponse.name, 'Ava-response.csv');
  assert.equal(auditResponse.bytes.toString(), spreadsheetResponse(text, 0));
  assert.deepEqual(spreadsheetRows(spreadsheetResponse('Name,Note\nAva,"A comma, and a\nnew line"\n', 0)), [['Name', 'Note'], ['Ava', 'A comma, and a\nnew line']]);
});
