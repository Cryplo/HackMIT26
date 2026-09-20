import test from 'node:test';
import assert from 'node:assert/strict';
import { spreadsheetRows, emailMessages } from './source-preview';
import { inboxSamples } from './samples';

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
