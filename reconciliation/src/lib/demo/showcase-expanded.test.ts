import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { showcaseFixture, LIVE_SHOWCASE_COUNT } from './showcase';

test('expanded live fixture preserves the original cohort and adds distinct parsed, unchecked evidence', () => {
  const original = showcaseFixture(), expanded = showcaseFixture(LIVE_SHOWCASE_COUNT);
  assert.equal(expanded.state.submissions.length, 80);
  assert.equal(expanded.state.receipts.length, 80);
  assert.equal(expanded.supporting.length, 20);
  assert.deepEqual(expanded.state.submissions.slice(0, 14), original.state.submissions);
  assert.deepEqual(expanded.originals.slice(0, 14), original.originals);
  assert.deepEqual(expanded.supporting.slice(0, 8), original.supporting);
  assert.deepEqual(expanded, showcaseFixture(80), 'generation is deterministic for immutable originals');
  assert.equal(new Set(expanded.originals.map(x => x.receipt.sha256)).size, 80);
  assert.equal(new Set(expanded.state.submissions.map(x => x.id)).size, 80);
  assert.ok(expanded.state.submissions.every(x => x.latest_run_id === null && x.decision_status === 'pending'));
  assert.deepEqual(expanded.state.decisions, []);
  assert.deepEqual(expanded.state.runs, []);
  for (const { receipt, bytes } of expanded.originals) {
    assert.equal(receipt.extraction_status, 'succeeded');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.sha256);
    assert.match(receipt.extraction_provenance!, /cached transcription/);
    assert.ok(receipt.raw_extracted_text!.includes(receipt.parsed_fields_json!.receipt_number!));
    assert.ok(receipt.raw_extracted_text!.includes((receipt.parsed_fields_json!.amount_minor! / 100).toFixed(2)));
  }
  const additions = expanded.state.submissions.slice(14);
  assert.equal(new Set(additions.map(x => x.attendee_name)).size, 66);
  assert.ok(new Set(additions.map(x => x.origin_location)).size > 8);
  const titles = expanded.cases.slice(14).map(x => x.title);
  for (const title of ['Receipt total differs', 'Policy cap exceeded', 'Matching hotel booking', 'Conflicting hotel confirmations', 'Hotel booking missing']) assert.ok(titles.includes(title), title);
});
